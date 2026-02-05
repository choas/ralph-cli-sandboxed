import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { extname, join } from "path";
import { getRalphDir, getPrdFiles, loadConfig, loadBranchState } from "../utils/config.js";
import { readPrdFile, writePrdAuto, PrdEntry } from "../utils/prd-validator.js";
import { promptConfirm } from "../utils/prompt.js";
import YAML from "yaml";

/**
 * Converts a branch name to a worktree directory name.
 * e.g., "feat/login" -> "feat-login"
 */
function branchToWorktreeName(branch: string): string {
  return branch.replace(/\//g, "-");
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
 * Gets the base branch (the branch that /workspace is on).
 */
function getBaseBranch(): string {
  try {
    return execSync("git -C /workspace rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
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

  // Perform the merge from /workspace (which is on the base branch)
  try {
    console.log(`\nMerging "${branchName}" into "${baseBranch}"...`);
    execSync(`git -C /workspace merge "${branchName}" --no-edit`, { stdio: "pipe" });
    console.log(`\x1b[32mSuccessfully merged "${branchName}" into "${baseBranch}".\x1b[0m`);
  } catch (err) {
    // Check if this is a merge conflict
    let conflictingFiles: string[] = [];
    try {
      const status = execSync("git -C /workspace status --porcelain", { encoding: "utf-8" });
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
        execSync("git -C /workspace merge --abort", { stdio: "pipe" });
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
        execSync("git -C /workspace merge --abort", { stdio: "pipe" });
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
      execSync(`git -C /workspace worktree remove "${worktreePath}"`, { stdio: "pipe" });
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
 * Gets the PRD file path, preferring the primary if it exists.
 */
function getPrdPath(): string {
  const prdFiles = getPrdFiles();
  if (prdFiles.primary) {
    return prdFiles.primary;
  }
  return join(getRalphDir(), "prd.json");
}

/**
 * Parses a PRD file (YAML or JSON) and returns the entries.
 */
function parsePrdFile(path: string): PrdEntry[] {
  const content = readFileSync(path, "utf-8");
  const ext = extname(path).toLowerCase();

  try {
    let result: PrdEntry[] | null;
    if (ext === ".yaml" || ext === ".yml") {
      result = YAML.parse(content);
    } else {
      result = JSON.parse(content);
    }
    return result ?? [];
  } catch {
    console.error(`Error parsing ${path}. Run 'ralph fix-prd' to attempt automatic repair.`);
    process.exit(1);
  }
}

/**
 * Saves PRD entries to the PRD file (YAML or JSON based on extension).
 */
function savePrd(entries: PrdEntry[]): void {
  const path = getPrdPath();
  const ext = extname(path).toLowerCase();

  if (ext === ".yaml" || ext === ".yml") {
    writeFileSync(path, YAML.stringify(entries));
  } else {
    writeFileSync(path, JSON.stringify(entries, null, 2) + "\n");
  }
}

/**
 * Create a PRD item to open a pull request for a branch.
 */
function branchPr(args: string[]): void {
  const branchName = args[0];
  if (!branchName) {
    console.error("Usage: ralph branch pr <branch-name>");
    console.error("\nExample: ralph branch pr feat/login");
    process.exit(1);
  }

  // Verify the branch exists
  if (!branchExists(branchName)) {
    console.error(`\x1b[31mError: Branch "${branchName}" does not exist.\x1b[0m`);
    process.exit(1);
  }

  const baseBranch = getBaseBranch();

  const entry: PrdEntry = {
    category: "feature",
    description: `Create a pull request from \`${branchName}\` into \`${baseBranch}\``,
    steps: [
      `Ensure all changes on \`${branchName}\` are committed`,
      `Push \`${branchName}\` to the remote if not already pushed`,
      `Create a pull request from \`${branchName}\` into \`${baseBranch}\` using the appropriate tool (e.g. gh pr create)`,
      "Include a descriptive title and summary of the changes in the PR",
    ],
    passes: false,
    branch: branchName,
  };

  const prdPath = getPrdPath();
  const prd = parsePrdFile(prdPath);
  prd.push(entry);
  savePrd(prd);

  console.log(`Added PRD entry #${prd.length}: Create PR for ${branchName} → ${baseBranch}`);
  console.log(`Branch field set to: ${branchName}`);
  console.log("Run 'ralph run' or 'ralph once' to execute.");
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
    case "pr":
      branchPr(args.slice(1));
      break;
    default:
      console.error("Usage: ralph branch <subcommand>");
      console.error("\nSubcommands:");
      console.error("  list             List all branches and their status");
      console.error("  merge <name>     Merge a branch worktree into the base branch");
      console.error("  pr <name>        Create a PRD item to open a PR for a branch");
      process.exit(1);
  }
}
