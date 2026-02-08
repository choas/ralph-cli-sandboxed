import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { getPrdFiles, loadBranchState, getProjectName } from "../utils/config.js";
import { readPrdFile, writePrdAuto, PrdEntry } from "../utils/prd-validator.js";
import { promptConfirm } from "../utils/prompt.js";

/**
 * Converts a branch name to a worktree directory name, prefixed with the project name.
 * e.g., "feat/login" -> "myproject_feat-login"
 * The project prefix avoids conflicts when multiple projects share the same worktrees directory.
 */
function branchToWorktreeName(branch: string): string {
  const projectName = getProjectName();
  return `${projectName}_${branch.replace(/\//g, "-")}`;
}

/**
 * Gets the worktrees base path from config or defaults to /worktrees.
 */
function getWorktreesBase(): string {
  return "/worktrees";
}

/**
 * Loads PRD entries from the primary PRD file.
 */
function loadPrdEntries(): { entries: PrdEntry[]; prdPath: string } | null {
  const prdFiles = getPrdFiles();
  if (!prdFiles.primary) {
    console.error("\x1b[31mError: No PRD file found. Run 'ralph init' first.\x1b[0m");
    return null;
  }
  const parsed = readPrdFile(prdFiles.primary);
  if (!parsed || !Array.isArray(parsed.content)) {
    console.error("\x1b[31mError: PRD file is corrupted. Run 'ralph fix-prd' to repair.\x1b[0m");
    return null;
  }
  return { entries: parsed.content as PrdEntry[], prdPath: prdFiles.primary };
}

/**
 * Gets the base branch (the current branch of the project).
 */
function getBaseBranch(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "main";
  }
}

/**
 * Checks if a git branch exists.
 */
function branchExists(branch: string): boolean {
  try {
    execSync(`git rev-parse --verify "${branch}"`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * List all branches referenced in the PRD and their status.
 * Shows item counts, pass/fail status, worktree existence, and active branch indicator.
 */
function branchList(): void {
  const result = loadPrdEntries();
  if (!result) return;

  const { entries } = result;
  const worktreesBase = getWorktreesBase();
  const activeBranch = loadBranchState();

  // Group items by branch
  const branchGroups = new Map<string, PrdEntry[]>();
  const noBranchItems: PrdEntry[] = [];

  for (const entry of entries) {
    if (entry.branch) {
      const group = branchGroups.get(entry.branch) || [];
      group.push(entry);
      branchGroups.set(entry.branch, group);
    } else {
      noBranchItems.push(entry);
    }
  }

  if (branchGroups.size === 0 && noBranchItems.length === 0) {
    console.log("No PRD items found.");
    return;
  }

  console.log("\x1b[1mBranches:\x1b[0m\n");

  // Sort branches alphabetically
  const sortedBranches = [...branchGroups.keys()].sort();

  for (const branchName of sortedBranches) {
    const items = branchGroups.get(branchName)!;
    const passing = items.filter((e) => e.passes).length;
    const total = items.length;
    const allPassing = passing === total;

    // Check if worktree exists on disk
    const dirName = branchToWorktreeName(branchName);
    const worktreePath = join(worktreesBase, dirName);
    const hasWorktree = existsSync(worktreePath);

    // Check if this is the active branch
    const isActive = activeBranch?.currentBranch === branchName;

    // Build the line
    const statusIcon = allPassing ? "\x1b[32m✅\x1b[0m" : "\x1b[33m○\x1b[0m";
    const activeIndicator = isActive ? " \x1b[36m◀ active\x1b[0m" : "";
    const worktreeStatus = hasWorktree ? " \x1b[32m[worktree]\x1b[0m" : "";
    const countStr = `${passing}/${total}`;

    console.log(`  ${statusIcon} \x1b[1m${branchName}\x1b[0m  ${countStr}${worktreeStatus}${activeIndicator}`);
  }

  // Show no-branch group
  if (noBranchItems.length > 0) {
    const passing = noBranchItems.filter((e) => e.passes).length;
    const total = noBranchItems.length;
    const allPassing = passing === total;
    const statusIcon = allPassing ? "\x1b[32m✅\x1b[0m" : "\x1b[33m○\x1b[0m";
    const countStr = `${passing}/${total}`;

    console.log(`  ${statusIcon} \x1b[2m(no branch)\x1b[0m  ${countStr}`);
  }

  console.log();
}

/**
 * Merge a completed branch worktree back into the base branch.
 * Handles merge conflicts by aborting and showing conflicting files.
 */
async function branchMerge(args: string[]): Promise<void> {
  const branchName = args[0];
  if (!branchName) {
    console.error("Usage: ralph branch merge <branch-name>");
    console.error("\nExample: ralph branch merge feat/login");
    process.exit(1);
  }

  // Verify the branch exists
  if (!branchExists(branchName)) {
    console.error(`\x1b[31mError: Branch "${branchName}" does not exist.\x1b[0m`);
    process.exit(1);
  }

  const baseBranch = getBaseBranch();
  const worktreesBase = getWorktreesBase();
  const dirName = branchToWorktreeName(branchName);
  const worktreePath = join(worktreesBase, dirName);

  console.log(`Branch: ${branchName}`);
  console.log(`Base branch: ${baseBranch}`);
  if (existsSync(worktreePath)) {
    console.log(`Worktree: ${worktreePath}`);
  }
  console.log();

  // Ask for confirmation
  const confirmed = await promptConfirm(
    `Merge "${branchName}" into "${baseBranch}"?`,
    true,
  );

  if (!confirmed) {
    console.log("Merge cancelled.");
    return;
  }

  // Perform the merge into the base branch
  try {
    console.log(`\nMerging "${branchName}" into "${baseBranch}"...`);
    execSync(`git merge "${branchName}" --no-edit`, { stdio: "pipe" });
    console.log(`\x1b[32mSuccessfully merged "${branchName}" into "${baseBranch}".\x1b[0m`);
  } catch (err) {
    // Check if this is a merge conflict
    let conflictingFiles: string[] = [];
    try {
      const status = execSync("git status --porcelain", { encoding: "utf-8" });
      conflictingFiles = status
        .split("\n")
        .filter((line) => line.startsWith("UU") || line.startsWith("AA") || line.startsWith("DD") || line.startsWith("AU") || line.startsWith("UA") || line.startsWith("DU") || line.startsWith("UD"))
        .map((line) => line.substring(3).trim());
    } catch {
      // Ignore status errors
    }

    if (conflictingFiles.length > 0) {
      // Merge conflict detected - abort and report
      console.error(`\n\x1b[31mMerge conflict detected!\x1b[0m`);
      console.error(`\nConflicting files:`);
      for (const file of conflictingFiles) {
        console.error(`  \x1b[33m${file}\x1b[0m`);
      }

      // Abort the merge
      try {
        execSync("git merge --abort", { stdio: "pipe" });
        console.error(`\n\x1b[36mMerge aborted.\x1b[0m`);
      } catch {
        console.error("\n\x1b[33mWarning: Could not abort merge. You may need to run 'git merge --abort' manually.\x1b[0m");
      }

      console.error(`\nTo resolve:`);
      console.error(`  1. Resolve conflicts manually and merge again`);
      console.error(`  2. Or add a PRD item to resolve the conflicts:`);
      console.error(`     ralph prd add  # describe the conflict resolution needed`);
      process.exit(1);
    } else {
      // Some other merge error
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\x1b[31mMerge failed: ${message}\x1b[0m`);

      // Try to abort in case merge is in progress
      try {
        execSync("git merge --abort", { stdio: "pipe" });
      } catch {
        // Ignore if nothing to abort
      }

      process.exit(1);
    }
  }

  // Clean up worktree if it exists
  if (existsSync(worktreePath)) {
    console.log(`\nCleaning up worktree at ${worktreePath}...`);
    try {
      execSync(`git worktree remove "${worktreePath}"`, { stdio: "pipe" });
      console.log(`\x1b[32mWorktree removed.\x1b[0m`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`\x1b[33mWarning: Could not remove worktree: ${message}\x1b[0m`);
      console.warn("You can remove it manually with: git worktree remove " + worktreePath);
    }
  }

  // Clean up the branch itself (optional - merged branches can be deleted)
  console.log(`\n\x1b[32mDone!\x1b[0m Branch "${branchName}" has been merged into "${baseBranch}".`);
}

/**
 * Create a pull request for a branch using the gh CLI on the host.
 */
async function branchPr(args: string[]): Promise<void> {
  const branchName = args[0];
  if (!branchName) {
    console.error("Usage: ralph branch pr <branch-name>");
    console.error("\nExample: ralph branch pr feat/login");
    process.exit(1);
  }

  // Pre-flight: verify gh is installed
  try {
    execSync("gh --version", { stdio: "pipe" });
  } catch {
    console.error("\x1b[31mError: 'gh' CLI is not installed.\x1b[0m");
    console.error("Install it from https://cli.github.com/");
    process.exit(1);
  }

  // Pre-flight: verify gh is authenticated
  try {
    execSync("gh auth status", { stdio: "pipe" });
  } catch {
    console.error("\x1b[31mError: Not authenticated with GitHub.\x1b[0m");
    console.error("Run 'gh auth login' first.");
    process.exit(1);
  }

  // Verify the branch exists
  if (!branchExists(branchName)) {
    console.error(`\x1b[31mError: Branch "${branchName}" does not exist.\x1b[0m`);
    process.exit(1);
  }

  // Verify a git remote exists
  let remote: string;
  try {
    remote = execSync("git remote", { encoding: "utf-8" }).trim().split("\n")[0];
    if (!remote) throw new Error("no remote");
  } catch {
    console.error("\x1b[31mError: No git remote configured.\x1b[0m");
    process.exit(1);
  }

  const baseBranch = getBaseBranch();

  // Auto-push: if branch has no upstream tracking, push it
  try {
    execSync(`git rev-parse --abbrev-ref "${branchName}@{upstream}"`, { stdio: "pipe" });
  } catch {
    console.log(`Pushing "${branchName}" to ${remote}...`);
    try {
      execSync(`git push -u "${remote}" "${branchName}"`, { stdio: "inherit" });
    } catch {
      console.error(`\x1b[31mError: Failed to push "${branchName}" to ${remote}.\x1b[0m`);
      process.exit(1);
    }
  }

  // Build PR title from branch name
  const prTitle = branchName;

  // Build PR body
  const bodyParts: string[] = [];

  // PRD Items section
  const result = loadPrdEntries();
  if (result) {
    const branchItems = result.entries.filter((e) => e.branch === branchName);
    if (branchItems.length > 0) {
      bodyParts.push("## PRD Items\n");
      for (const item of branchItems) {
        const check = item.passes ? "x" : " ";
        bodyParts.push(`- [${check}] ${item.description}`);
      }
      bodyParts.push("");
    }
  }

  // Commits section
  try {
    const log = execSync(`git log "${baseBranch}..${branchName}" --oneline --no-decorate`, {
      encoding: "utf-8",
    }).trim();
    if (log) {
      bodyParts.push("## Commits\n");
      bodyParts.push(log);
      bodyParts.push("");
    }
  } catch {
    // No commits or branch comparison failed — skip
  }

  const prBody = bodyParts.join("\n");

  // Show summary and confirm
  console.log(`\nCreate PR: ${branchName} → ${baseBranch}`);
  console.log(`Title: ${prTitle}`);
  if (prBody) {
    console.log(`\n${prBody}`);
  }

  const confirmed = await promptConfirm("Create this pull request?", true);
  if (!confirmed) {
    console.log("Cancelled.");
    return;
  }

  // Create the PR using gh, piping body via stdin to avoid shell escaping issues
  try {
    const prUrl = execSync(
      `gh pr create --base "${baseBranch}" --head "${branchName}" --title "${prTitle.replace(/"/g, '\\"')}" --body-file -`,
      {
        encoding: "utf-8",
        input: prBody,
      },
    ).trim();
    console.log(`\n\x1b[32mPR created:\x1b[0m ${prUrl}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\x1b[31mFailed to create PR: ${message}\x1b[0m`);
    process.exit(1);
  }
}

/**
 * Delete a branch: remove worktree, delete git branch, and untag PRD items.
 * Asks for confirmation before proceeding.
 */
async function branchDelete(args: string[]): Promise<void> {
  const branchName = args[0];
  if (!branchName) {
    console.error("Usage: ralph branch delete <branch-name>");
    console.error("\nExample: ralph branch delete feat/old-branch");
    process.exit(1);
  }

  // Verify the branch exists
  if (!branchExists(branchName)) {
    console.error(`\x1b[31mError: Branch "${branchName}" does not exist.\x1b[0m`);
    process.exit(1);
  }

  const worktreesBase = getWorktreesBase();
  const dirName = branchToWorktreeName(branchName);
  const worktreePath = join(worktreesBase, dirName);
  const hasWorktree = existsSync(worktreePath);

  // Load PRD to check for tagged items
  const result = loadPrdEntries();
  const taggedCount = result
    ? result.entries.filter((e) => e.branch === branchName).length
    : 0;

  console.log(`Branch: ${branchName}`);
  if (hasWorktree) {
    console.log(`Worktree: ${worktreePath}`);
  }
  if (taggedCount > 0) {
    console.log(`PRD items tagged: ${taggedCount}`);
  }
  console.log();

  // Ask for confirmation
  const confirmed = await promptConfirm(
    `Delete branch "${branchName}"${hasWorktree ? " and its worktree" : ""}?`,
    false,
  );

  if (!confirmed) {
    console.log("Delete cancelled.");
    return;
  }

  // Step 1: Remove worktree if it exists
  if (hasWorktree) {
    console.log(`\nRemoving worktree at ${worktreePath}...`);
    try {
      execSync(`git worktree remove "${worktreePath}" --force`, { stdio: "pipe" });
      console.log(`\x1b[32mWorktree removed.\x1b[0m`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`\x1b[33mWarning: Could not remove worktree: ${message}\x1b[0m`);
      console.warn("You can remove it manually with: git worktree remove " + worktreePath);
    }
  }

  // Step 2: Delete the git branch
  console.log(`Deleting branch "${branchName}"...`);
  try {
    execSync(`git branch -D "${branchName}"`, { stdio: "pipe" });
    console.log(`\x1b[32mBranch deleted.\x1b[0m`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\x1b[31mError deleting branch: ${message}\x1b[0m`);
  }

  // Step 3: Remove branch tag from PRD items
  if (result && taggedCount > 0) {
    console.log(`Removing branch tag from ${taggedCount} PRD item(s)...`);
    const updatedEntries = result.entries.map((entry) => {
      if (entry.branch === branchName) {
        const { branch: _, ...rest } = entry;
        return rest as PrdEntry;
      }
      return entry;
    });
    writePrdAuto(result.prdPath, updatedEntries);
    console.log(`\x1b[32mPRD items updated.\x1b[0m`);
  }

  console.log(`\n\x1b[32mDone!\x1b[0m Branch "${branchName}" has been deleted.`);
}

/**
 * Main branch command dispatcher.
 */
export async function branch(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "list":
      branchList();
      break;
    case "merge":
      await branchMerge(args.slice(1));
      break;
    case "delete":
      await branchDelete(args.slice(1));
      break;
    case "pr":
      await branchPr(args.slice(1));
      break;
    default:
      console.error("Usage: ralph branch <subcommand>");
      console.error("\nSubcommands:");
      console.error("  list             List all branches and their status");
      console.error("  merge <name>     Merge a branch worktree into the base branch");
      console.error("  delete <name>    Delete a branch and its worktree");
      console.error("  pr <name>        Create a pull request for a branch using gh CLI");
      process.exit(1);
  }
}
