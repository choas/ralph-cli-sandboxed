import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { getRalphDir, getPrdFiles, loadConfig } from "../utils/config.js";
import { readPrdFile, writePrdAuto, PrdEntry } from "../utils/prd-validator.js";
import { promptConfirm } from "../utils/prompt.js";

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
 * Main branch command dispatcher.
 */
export async function branch(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "merge":
      await branchMerge(args.slice(1));
      break;
    default:
      console.error("Usage: ralph branch <subcommand>");
      console.error("\nSubcommands:");
      console.error("  merge <name>     Merge a branch worktree into the base branch");
      process.exit(1);
  }
}
