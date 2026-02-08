/**
 * Chat command for managing Telegram, Slack, and other chat integrations.
 * Allows ralph to receive commands and send notifications via chat services.
 */

import { existsSync, readFileSync, writeFileSync, watch, type FSWatcher } from "fs";
import { join, basename, extname } from "path";
import { execSync, spawn } from "child_process";
import YAML from "yaml";
import { loadConfig, getRalphDir, isRunningInContainer, RalphConfig, getPrdFiles, loadBranchState, getProjectName as getConfigProjectName } from "../utils/config.js";
import { createTelegramClient } from "../providers/telegram.js";
import { createSlackClient } from "../providers/slack.js";
import { createDiscordClient } from "../providers/discord.js";
import {
  ChatClient,
  ChatCommand,
  ChatProvider,
  InlineButton,
  generateProjectId,
  formatStatusMessage,
  formatStatusForChat,
} from "../utils/chat-client.js";
import {
  getMessagesPath,
  sendMessage,
  waitForResponse,
  getPendingMessages,
  respondToMessage,
  cleanupOldMessages,
  Message,
} from "../utils/message-queue.js";

const CHAT_STATE_FILE = "chat-state.json";

interface ChatState {
  projectId: string;
  projectName: string;
  registeredChatIds: string[];
  lastActivity?: string;
  runningProcess?: number; // PID of running ralph process
}

/**
 * Load chat state from .ralph/chat-state.json
 */
function loadChatState(): ChatState | null {
  const ralphDir = getRalphDir();
  const statePath = join(ralphDir, CHAT_STATE_FILE);

  if (!existsSync(statePath)) {
    return null;
  }

  try {
    const content = readFileSync(statePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Save chat state to .ralph/chat-state.json
 */
function saveChatState(state: ChatState): void {
  const ralphDir = getRalphDir();
  const statePath = join(ralphDir, CHAT_STATE_FILE);

  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
}

/**
 * Get or create a project ID for this project.
 */
function getOrCreateProjectId(): string {
  const state = loadChatState();
  if (state?.projectId) {
    return state.projectId;
  }
  return generateProjectId();
}

/**
 * Get the project name from the current directory.
 */
function getProjectName(): string {
  return basename(process.cwd());
}

interface PrdItem {
  category?: string;
  description?: string;
  steps?: string[];
  passes?: boolean;
  branch?: string;
}

/**
 * Parse PRD file content based on file extension.
 */
function parsePrdContent(filePath: string, content: string): PrdItem[] | null {
  const ext = extname(filePath).toLowerCase();
  try {
    let parsed: unknown;
    if (ext === ".yaml" || ext === ".yml") {
      parsed = YAML.parse(content);
    } else {
      parsed = JSON.parse(content);
    }
    if (Array.isArray(parsed)) {
      return parsed as PrdItem[];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get PRD status (completed/total tasks).
 */
function getPrdStatus(): { complete: number; total: number; incomplete: number } {
  const prdFiles = getPrdFiles();

  if (prdFiles.none) {
    return { complete: 0, total: 0, incomplete: 0 };
  }

  try {
    const prdPath = prdFiles.primary!;
    const content = readFileSync(prdPath, "utf-8");
    const items = parsePrdContent(prdPath, content);
    if (!Array.isArray(items)) {
      return { complete: 0, total: 0, incomplete: 0 };
    }

    const complete = items.filter((item) => item.passes === true).length;
    const total = items.length;
    return { complete, total, incomplete: total - complete };
  } catch {
    return { complete: 0, total: 0, incomplete: 0 };
  }
}

/**
 * Get open (incomplete) categories from the PRD.
 * Returns unique categories that have at least one incomplete task.
 */
function getOpenCategories(): string[] {
  const prdFiles = getPrdFiles();

  if (prdFiles.none) {
    return [];
  }

  try {
    const prdPath = prdFiles.primary!;
    const content = readFileSync(prdPath, "utf-8");
    const items = parsePrdContent(prdPath, content);
    if (!Array.isArray(items)) {
      return [];
    }

    // Get unique categories that have incomplete tasks
    const openCategories = new Set<string>();
    for (const item of items) {
      if (item.passes !== true && item.category) {
        openCategories.add(item.category);
      }
    }

    return Array.from(openCategories);
  } catch {
    return [];
  }
}

/**
 * Add a new task to the PRD.
 */
function addPrdTask(description: string): boolean {
  const prdFiles = getPrdFiles();

  if (prdFiles.none) {
    return false;
  }

  try {
    const prdPath = prdFiles.primary!;
    const content = readFileSync(prdPath, "utf-8");
    const items = parsePrdContent(prdPath, content);
    if (!Array.isArray(items)) {
      return false;
    }

    items.push({
      category: "feature",
      description,
      steps: [],
      passes: false,
    });

    // Write back in the same format as the source file
    const ext = extname(prdPath).toLowerCase();
    if (ext === ".yaml" || ext === ".yml") {
      writeFileSync(prdPath, YAML.stringify(items));
    } else {
      writeFileSync(prdPath, JSON.stringify(items, null, 2) + "\n");
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current git branch in the project directory.
 */
function getBaseBranch(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      cwd: process.cwd(),
    }).trim();
  } catch {
    return "main";
  }
}

/**
 * Check if a git branch exists.
 */
function branchExists(branch: string): boolean {
  try {
    execSync(`git rev-parse --verify "${branch}"`, {
      stdio: "pipe",
      cwd: process.cwd(),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert branch name to worktree directory name.
 */
function branchToWorktreeName(branch: string): string {
  const projectName = getConfigProjectName();
  return `${projectName}_${branch.replace(/\//g, "-")}`;
}

/**
 * Handle /branch list — show branches from PRD grouped by branch field.
 */
async function handleBranchList(
  chatId: string,
  client: ChatClient,
  state: ChatState,
): Promise<void> {
  const prdFiles = getPrdFiles();
  if (prdFiles.none || !prdFiles.primary) {
    await client.sendMessage(chatId, `${state.projectName}: No PRD file found.`);
    return;
  }

  const content = readFileSync(prdFiles.primary, "utf-8");
  const items = parsePrdContent(prdFiles.primary, content);
  if (!Array.isArray(items) || items.length === 0) {
    await client.sendMessage(chatId, `${state.projectName}: No PRD items found.`);
    return;
  }

  const activeBranch = loadBranchState();

  // Group items by branch
  const branchGroups = new Map<string, PrdItem[]>();
  const noBranchItems: PrdItem[] = [];

  for (const item of items) {
    if (item.branch) {
      const group = branchGroups.get(item.branch) || [];
      group.push(item);
      branchGroups.set(item.branch, group);
    } else {
      noBranchItems.push(item);
    }
  }

  if (branchGroups.size === 0 && noBranchItems.length === 0) {
    await client.sendMessage(chatId, `${state.projectName}: No PRD items found.`);
    return;
  }

  const lines: string[] = [`${state.projectName}: Branches\n`];
  const sortedBranches = [...branchGroups.keys()].sort();

  for (const branchName of sortedBranches) {
    const branchItems = branchGroups.get(branchName)!;
    const passing = branchItems.filter((e) => e.passes === true).length;
    const total = branchItems.length;
    const allPassing = passing === total;
    const isActive = activeBranch?.currentBranch === branchName;

    const icon = allPassing ? "[OK]" : "[ ]";
    const active = isActive ? " << active" : "";
    lines.push(`  ${icon} ${branchName}  ${passing}/${total}${active}`);
  }

  if (noBranchItems.length > 0) {
    const passing = noBranchItems.filter((e) => e.passes === true).length;
    const total = noBranchItems.length;
    const icon = passing === total ? "[OK]" : "[ ]";
    lines.push(`  ${icon} (no branch)  ${passing}/${total}`);
  }

  await client.sendMessage(chatId, lines.join("\n"));
}

/**
 * Handle /branch pr <name> — create a pull request using gh CLI on the host.
 */
async function handleBranchPr(
  args: string[],
  chatId: string,
  client: ChatClient,
  state: ChatState,
): Promise<void> {
  const branchName = args[0];
  if (!branchName) {
    const usage = client.provider === "slack"
      ? "/ralph branch pr <branch-name>"
      : "/branch pr <branch-name>";
    await client.sendMessage(chatId, `${state.projectName}: Usage: ${usage}`);
    return;
  }

  // Pre-flight: verify gh is installed
  try {
    execSync("gh --version", { stdio: "pipe" });
  } catch {
    await client.sendMessage(chatId, `${state.projectName}: Error: 'gh' CLI is not installed.`);
    return;
  }

  // Pre-flight: verify gh is authenticated
  try {
    execSync("gh auth status", { stdio: "pipe" });
  } catch {
    await client.sendMessage(chatId, `${state.projectName}: Error: Not authenticated with GitHub. Run 'gh auth login' on the host.`);
    return;
  }

  if (!branchExists(branchName)) {
    await client.sendMessage(chatId, `${state.projectName}: Branch "${branchName}" does not exist.`);
    return;
  }

  // Verify a git remote exists
  let remote: string;
  try {
    remote = execSync("git remote", { encoding: "utf-8", cwd: process.cwd() }).trim().split("\n")[0];
    if (!remote) throw new Error("no remote");
  } catch {
    await client.sendMessage(chatId, `${state.projectName}: Error: No git remote configured.`);
    return;
  }

  const baseBranch = getBaseBranch();
  const cwd = process.cwd();

  // Auto-push: if branch has no upstream tracking, push it
  try {
    execSync(`git rev-parse --abbrev-ref "${branchName}@{upstream}"`, { stdio: "pipe", cwd });
  } catch {
    try {
      execSync(`git push -u "${remote}" "${branchName}"`, { stdio: "pipe", cwd });
    } catch {
      await client.sendMessage(chatId, `${state.projectName}: Error: Failed to push "${branchName}" to ${remote}.`);
      return;
    }
  }

  // Build PR body
  const bodyParts: string[] = [];

  // PRD Items section
  const prdFiles = getPrdFiles();
  if (!prdFiles.none && prdFiles.primary) {
    const content = readFileSync(prdFiles.primary, "utf-8");
    const items = parsePrdContent(prdFiles.primary, content);
    if (Array.isArray(items)) {
      const branchItems = items.filter((e) => e.branch === branchName);
      if (branchItems.length > 0) {
        bodyParts.push("## PRD Items\n");
        for (const item of branchItems) {
          const check = item.passes ? "x" : " ";
          bodyParts.push(`- [${check}] ${item.description}`);
        }
        bodyParts.push("");
      }
    }
  }

  // Commits section
  try {
    const log = execSync(`git log "${baseBranch}..${branchName}" --oneline --no-decorate`, {
      encoding: "utf-8",
      cwd,
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
  const prTitle = branchName;

  // Create the PR
  try {
    const prUrl = execSync(
      `gh pr create --base "${baseBranch}" --head "${branchName}" --title "${prTitle.replace(/"/g, '\\"')}" --body-file -`,
      {
        encoding: "utf-8",
        input: prBody,
        cwd,
      },
    ).trim();
    await client.sendMessage(chatId, `${state.projectName}: PR created: ${prUrl}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await client.sendMessage(chatId, `${state.projectName}: Failed to create PR: ${message}`);
  }
}

/**
 * Handle /branch merge <name> — merge branch into base branch.
 * Skips confirmation (user explicitly typed the command in chat).
 */
async function handleBranchMerge(
  args: string[],
  chatId: string,
  client: ChatClient,
  state: ChatState,
): Promise<void> {
  const branchName = args[0];
  if (!branchName) {
    const usage = client.provider === "slack"
      ? "/ralph branch merge <branch-name>"
      : "/branch merge <branch-name>";
    await client.sendMessage(chatId, `${state.projectName}: Usage: ${usage}`);
    return;
  }

  if (!branchExists(branchName)) {
    await client.sendMessage(chatId, `${state.projectName}: Branch "${branchName}" does not exist.`);
    return;
  }

  const baseBranch = getBaseBranch();
  const cwd = process.cwd();

  try {
    execSync(`git merge "${branchName}" --no-edit`, { stdio: "pipe", cwd });
    await client.sendMessage(
      chatId,
      `${state.projectName}: Merged "${branchName}" into "${baseBranch}".`,
    );
  } catch {
    // Check for merge conflicts
    let conflictingFiles: string[] = [];
    try {
      const status = execSync("git status --porcelain", { encoding: "utf-8", cwd });
      conflictingFiles = status
        .split("\n")
        .filter((line) =>
          line.startsWith("UU") || line.startsWith("AA") || line.startsWith("DD") ||
          line.startsWith("AU") || line.startsWith("UA") || line.startsWith("DU") ||
          line.startsWith("UD"))
        .map((line) => line.substring(3).trim());
    } catch {
      // Ignore status errors
    }

    if (conflictingFiles.length > 0) {
      // Abort the merge
      try {
        execSync("git merge --abort", { stdio: "pipe", cwd });
      } catch {
        // Ignore abort errors
      }
      await client.sendMessage(
        chatId,
        `${state.projectName}: Merge conflict! Conflicting files:\n${conflictingFiles.join("\n")}\nMerge aborted.`,
      );
    } else {
      try {
        execSync("git merge --abort", { stdio: "pipe", cwd });
      } catch {
        // Ignore
      }
      await client.sendMessage(
        chatId,
        `${state.projectName}: Merge of "${branchName}" failed. Merge aborted.`,
      );
    }
    return;
  }

  // Clean up worktree if it exists
  const dirName = branchToWorktreeName(branchName);
  const config = loadConfig();
  const worktreesPath = config.docker?.worktreesPath;
  if (worktreesPath) {
    const worktreePath = join(worktreesPath, dirName);
    if (existsSync(worktreePath)) {
      try {
        execSync(`git worktree remove "${worktreePath}"`, { stdio: "pipe", cwd });
      } catch {
        // Non-critical, ignore
      }
    }
  }
}

/**
 * Handle /branch delete <name> — delete branch, worktree, and untag PRD items.
 * Skips confirmation (user explicitly typed the command in chat).
 */
async function handleBranchDelete(
  args: string[],
  chatId: string,
  client: ChatClient,
  state: ChatState,
): Promise<void> {
  const branchName = args[0];
  if (!branchName) {
    const usage = client.provider === "slack"
      ? "/ralph branch delete <branch-name>"
      : "/branch delete <branch-name>";
    await client.sendMessage(chatId, `${state.projectName}: Usage: ${usage}`);
    return;
  }

  if (!branchExists(branchName)) {
    await client.sendMessage(chatId, `${state.projectName}: Branch "${branchName}" does not exist.`);
    return;
  }

  const cwd = process.cwd();
  const results: string[] = [];

  // Step 1: Remove worktree if it exists
  const dirName = branchToWorktreeName(branchName);
  const config = loadConfig();
  const worktreesPath = config.docker?.worktreesPath;
  if (worktreesPath) {
    const worktreePath = join(worktreesPath, dirName);
    if (existsSync(worktreePath)) {
      try {
        execSync(`git worktree remove "${worktreePath}" --force`, { stdio: "pipe", cwd });
        results.push("Worktree removed.");
      } catch {
        results.push("Warning: Could not remove worktree.");
      }
    }
  }

  // Step 2: Delete the git branch
  try {
    execSync(`git branch -D "${branchName}"`, { stdio: "pipe", cwd });
    results.push("Branch deleted.");
  } catch {
    results.push("Warning: Could not delete git branch.");
  }

  // Step 3: Remove branch tag from PRD items
  const prdFiles = getPrdFiles();
  if (!prdFiles.none && prdFiles.primary) {
    const content = readFileSync(prdFiles.primary, "utf-8");
    const items = parsePrdContent(prdFiles.primary, content);
    if (Array.isArray(items)) {
      const taggedCount = items.filter((e) => e.branch === branchName).length;
      if (taggedCount > 0) {
        const updatedItems = items.map((item) => {
          if (item.branch === branchName) {
            const { branch: _, ...rest } = item;
            return rest;
          }
          return item;
        });

        const ext = extname(prdFiles.primary).toLowerCase();
        if (ext === ".yaml" || ext === ".yml") {
          writeFileSync(prdFiles.primary, YAML.stringify(updatedItems));
        } else {
          writeFileSync(prdFiles.primary, JSON.stringify(updatedItems, null, 2) + "\n");
        }
        results.push(`${taggedCount} PRD item(s) untagged.`);
      }
    }
  }

  await client.sendMessage(
    chatId,
    `${state.projectName}: Deleted "${branchName}". ${results.join(" ")}`,
  );
}

/**
 * Execute a shell command and return the output.
 */
async function executeCommand(command: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const proc = spawn("sh", ["-c", command], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() || "(no output)" });
      } else {
        resolve({ success: false, output: stderr.trim() || stdout.trim() || `Exit code: ${code}` });
      }
    });

    proc.on("error", (err) => {
      resolve({ success: false, output: `Error: ${err.message}` });
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      proc.kill();
      resolve({ success: false, output: "Command timed out after 60 seconds" });
    }, 60000);
  });
}

/**
 * Send a command to the sandbox via message queue and wait for response.
 */
async function sendToSandbox(
  action: string,
  args: string[],
  debug: boolean,
  timeout: number = 60000,
): Promise<{ success: boolean; output?: string; error?: string } | null> {
  const messagesPath = getMessagesPath(false); // host path

  if (debug) {
    console.log(`[chat] Sending to sandbox: ${action} ${args.join(" ")}`);
  }

  const messageId = sendMessage(messagesPath, "host", action, args);
  const response = await waitForResponse(messagesPath, messageId, timeout);

  if (debug) {
    console.log(`[chat] Sandbox response: ${JSON.stringify(response)}`);
  }

  return response;
}

/**
 * Handle incoming chat commands.
 */
async function handleCommand(
  command: ChatCommand,
  client: ChatClient,
  config: RalphConfig,
  state: ChatState,
  debug: boolean,
): Promise<void> {
  const { command: cmd, args, message } = command;
  const chatId = message.chatId;

  if (debug) {
    console.log(`[chat] Received command: /${cmd} ${args.join(" ")}`);
  }

  switch (cmd) {
    case "run": {
      // Check for optional category filter
      const category = args.length > 0 ? args[0] : undefined;

      // Check PRD status first (from host)
      const prdStatus = getPrdStatus();
      if (prdStatus.incomplete === 0) {
        await client.sendMessage(
          chatId,
          `${state.projectName}: All tasks already complete (${prdStatus.complete}/${prdStatus.total})`,
        );
        return;
      }

      const categoryInfo = category ? ` (category: ${category})` : "";
      await client.sendMessage(
        chatId,
        `${state.projectName}: Starting ralph run${categoryInfo} (${prdStatus.incomplete} tasks remaining)...`,
      );

      // Send run command to sandbox with optional category argument
      const runArgs = category ? [category] : [];
      const response = await sendToSandbox("run", runArgs, debug, 10000);
      if (response) {
        if (response.success) {
          await client.sendMessage(
            chatId,
            `${state.projectName}: Ralph run started in sandbox${categoryInfo}`,
          );
        } else {
          await client.sendMessage(
            chatId,
            `${state.projectName}: Failed to start: ${response.error}`,
          );
        }
      } else {
        await client.sendMessage(
          chatId,
          `${state.projectName}: No response from sandbox. Is 'ralph listen' running?`,
        );
      }

      state.lastActivity = new Date().toISOString();
      saveChatState(state);
      break;
    }

    case "stop": {
      // Stop a running ralph run process in the sandbox
      await client.sendMessage(chatId, `${state.projectName}: Stopping ralph run...`);

      const response = await sendToSandbox("stop", [], debug, 10000);
      if (response) {
        if (response.success) {
          await client.sendMessage(chatId, `${state.projectName}: ${response.output}`);
        } else {
          await client.sendMessage(chatId, `${state.projectName}: ${response.error}`);
        }
      } else {
        await client.sendMessage(
          chatId,
          `${state.projectName}: No response from sandbox. Is 'ralph listen' running?`,
        );
      }
      break;
    }

    case "status": {
      // Try sandbox first, fall back to host
      const response = await sendToSandbox("status", [], debug, 5000);
      let statusMessage: string;
      if (response?.success && response.output) {
        // Strip ANSI codes and progress bar for clean chat output
        const cleanedOutput = formatStatusForChat(response.output);
        statusMessage = `${state.projectName}:\n${cleanedOutput}`;
      } else {
        // Fall back to host status
        const prdStatus = getPrdStatus();
        const status = prdStatus.incomplete === 0 ? "completed" : "idle";
        const details = `Progress: ${prdStatus.complete}/${prdStatus.total} tasks complete`;
        statusMessage = formatStatusMessage(state.projectName, status, details);
      }

      // Get open categories and create inline buttons (max 4)
      const openCategories = getOpenCategories();
      let inlineKeyboard: InlineButton[][] | undefined;

      if (openCategories.length > 0 && openCategories.length <= 4) {
        // Create a row of buttons, one per category
        inlineKeyboard = [
          openCategories.map((category) => ({
            text: `▶ Run ${category}`,
            callbackData: `/run ${category}`,
          })),
        ];
      }

      await client.sendMessage(chatId, statusMessage, { inlineKeyboard });
      break;
    }

    case "add": {
      if (args.length === 0) {
        const usage =
          client.provider === "slack" ? "/ralph add [task description]" : "/add [task description]";
        await client.sendMessage(chatId, `${state.projectName}: Usage: ${usage}`);
        return;
      }

      const description = args.join(" ");
      const success = addPrdTask(description);

      if (success) {
        await client.sendMessage(chatId, `${state.projectName}: Added task: "${description}"`);
      } else {
        await client.sendMessage(
          chatId,
          `${state.projectName}: Failed to add task. Check PRD file.`,
        );
      }
      break;
    }

    case "exec": {
      if (args.length === 0) {
        const usage = client.provider === "slack" ? "/ralph exec [command]" : "/exec [command]";
        await client.sendMessage(chatId, `${state.projectName}: Usage: ${usage}`);
        return;
      }

      // Send exec command to sandbox
      const response = await sendToSandbox("exec", args, debug, 65000);

      if (response) {
        let output = response.output || response.error || "(no output)";

        // Truncate long output
        if (output.length > 1000) {
          output = output.substring(0, 1000) + "\n...(truncated)";
        }

        await client.sendMessage(chatId, output);
      } else {
        await client.sendMessage(
          chatId,
          `${state.projectName}: No response from sandbox. Is 'ralph listen' running?`,
        );
      }
      break;
    }

    case "action": {
      // Reload config to pick up new actions
      const freshConfig = loadConfig();
      const actions = freshConfig.daemon?.actions || {};
      const actionNames = Object.keys(actions).filter(
        (name) => name !== "notify" && name !== "telegram_notify",
      );

      if (args.length === 0) {
        // List available actions
        const usage = client.provider === "slack" ? "/ralph action <name>" : "/action <name>";
        if (actionNames.length === 0) {
          await client.sendMessage(
            chatId,
            `${state.projectName}: No actions configured. Add actions to daemon.actions in config.json`,
          );
        } else {
          await client.sendMessage(
            chatId,
            `${state.projectName}: Available actions: ${actionNames.join(", ")}\nUsage: ${usage}`,
          );
        }
        return;
      }

      const actionName = args[0].toLowerCase();
      const action = actions[actionName];

      if (!action) {
        if (actionNames.length === 0) {
          await client.sendMessage(
            chatId,
            `${state.projectName}: No actions configured. Add actions to daemon.actions in config.json`,
          );
        } else {
          await client.sendMessage(
            chatId,
            `${state.projectName}: Unknown action '${actionName}'. Available: ${actionNames.join(", ")}`,
          );
        }
        return;
      }

      await client.sendMessage(chatId, `${state.projectName}: Running '${actionName}'...`);

      // Execute the script
      const result = await executeCommand(action.command);

      if (result.success) {
        let message = `${state.projectName}: '${actionName}' completed`;
        if (result.output && result.output !== "(no output)") {
          // Truncate long output
          let output = result.output;
          if (output.length > 500) {
            output = output.substring(0, 500) + "\n...(truncated)";
          }
          message += `\n${output}`;
        }
        await client.sendMessage(chatId, message);
      } else {
        let message = `${state.projectName}: '${actionName}' failed`;
        if (result.output) {
          let output = result.output;
          if (output.length > 500) {
            output = output.substring(0, 500) + "\n...(truncated)";
          }
          message += `\n${output}`;
        }
        await client.sendMessage(chatId, message);
      }
      break;
    }

    case "claude": {
      if (args.length === 0) {
        const usage = client.provider === "slack" ? "/ralph <prompt>" : "/claude [prompt]";
        await client.sendMessage(chatId, `${state.projectName}: Usage: ${usage}`);
        return;
      }

      const prompt = args.join(" ");
      await client.sendMessage(
        chatId,
        `⏳ ${state.projectName}: Running Claude Code...\n(this may take a few minutes)`,
      );

      // Send claude command to sandbox with longer timeout (5 minutes)
      const response = await sendToSandbox("claude", args, debug, 300000);

      if (response) {
        let output = response.output || response.error || "(no output)";

        // Truncate long output
        if (output.length > 2000) {
          output = output.substring(0, 2000) + "\n...(truncated)";
        }

        if (response.success) {
          await client.sendMessage(
            chatId,
            `✅ ${state.projectName}: Claude Code DONE\n\n${output}`,
          );
        } else {
          // Check for version mismatch (sandbox has old version without /claude support)
          if (response.error?.includes("Unknown action: claude")) {
            await client.sendMessage(
              chatId,
              `❌ ${state.projectName}: Claude Code failed - sandbox needs update.\n` +
                `The sandbox listener doesn't support /claude. Rebuild your Docker container:\n` +
                `  ralph docker build --no-cache`,
            );
          } else {
            await client.sendMessage(
              chatId,
              `❌ ${state.projectName}: Claude Code FAILED\n\n${output}`,
            );
          }
        }
      } else {
        await client.sendMessage(
          chatId,
          `❌ ${state.projectName}: No response from sandbox. Is 'ralph listen' running?`,
        );
      }
      break;
    }

    case "branch": {
      const subCmd = args[0]?.toLowerCase();
      const branchArgs = args.slice(1);

      switch (subCmd) {
        case "list":
          await handleBranchList(chatId, client, state);
          break;
        case "pr":
          await handleBranchPr(branchArgs, chatId, client, state);
          break;
        case "merge":
          await handleBranchMerge(branchArgs, chatId, client, state);
          break;
        case "delete":
          await handleBranchDelete(branchArgs, chatId, client, state);
          break;
        default: {
          const usage = client.provider === "slack"
            ? `/ralph branch list - List branches
/ralph branch pr <name> - Create a GitHub PR
/ralph branch merge <name> - Merge branch into base
/ralph branch delete <name> - Delete branch and worktree`
            : `/branch list - List branches
/branch pr <name> - Create a GitHub PR
/branch merge <name> - Merge branch into base
/branch delete <name> - Delete branch and worktree`;
          await client.sendMessage(chatId, `${state.projectName}: ${usage}`);
        }
      }
      break;
    }

    case "help": {
      const isSlack = client.provider === "slack";

      const helpText = isSlack
        ? `/ralph help - This help
/ralph status - PRD progress
/ralph run [category] - Start automation
/ralph stop - Stop automation
/ralph add [desc] - Add task
/ralph exec [cmd] - Shell command
/ralph action [name] - Run action
/ralph branch ... - Manage branches
/ralph <prompt> - Run Claude Code`
        : `/help - This help
/status - PRD progress
/run - Start automation
/stop - Stop automation
/add [desc] - Add task
/exec [cmd] - Shell command
/action [name] - Run action
/branch ... - Manage branches
/claude [prompt] - Run Claude Code`;

      await client.sendMessage(chatId, helpText);
      break;
    }

    default:
      await client.sendMessage(chatId, `${state.projectName}: Unknown command: /${cmd}. Try /help`);
  }
}

/**
 * Create a chat client based on the provider configuration.
 */
function createChatClient(
  config: RalphConfig,
  debug: boolean,
): { client: ChatClient; provider: ChatProvider; allowedChatIds?: string[] } {
  const provider = config.chat?.provider || "telegram";

  if (provider === "slack") {
    // Check that Slack is configured
    if (!config.chat?.slack?.botToken) {
      console.error("Error: Slack bot token not configured");
      console.error("Set chat.slack.botToken in .ralph/config.json");
      console.error("Get a token from your Slack app settings: https://api.slack.com/apps");
      process.exit(1);
    }
    if (!config.chat?.slack?.appToken) {
      console.error("Error: Slack app token not configured");
      console.error("Set chat.slack.appToken in .ralph/config.json");
      console.error("Enable Socket Mode in your Slack app and generate an app token");
      process.exit(1);
    }
    if (!config.chat?.slack?.signingSecret) {
      console.error("Error: Slack signing secret not configured");
      console.error("Set chat.slack.signingSecret in .ralph/config.json");
      console.error("Find your signing secret in Slack app Basic Information");
      process.exit(1);
    }
    if (config.chat.slack.enabled === false) {
      console.error("Error: Slack is disabled in config (slack.enabled = false)");
      process.exit(1);
    }

    return {
      client: createSlackClient(
        {
          botToken: config.chat.slack.botToken,
          appToken: config.chat.slack.appToken,
          signingSecret: config.chat.slack.signingSecret,
          allowedChannelIds: config.chat.slack.allowedChannelIds,
        },
        debug,
      ),
      provider: "slack",
      allowedChatIds: config.chat.slack.allowedChannelIds,
    };
  }

  if (provider === "discord") {
    // Check that Discord is configured
    if (!config.chat?.discord?.botToken) {
      console.error("Error: Discord bot token not configured");
      console.error("Set chat.discord.botToken in .ralph/config.json");
      console.error(
        "Get a token from the Discord Developer Portal: https://discord.com/developers/applications",
      );
      process.exit(1);
    }
    if (config.chat.discord.enabled === false) {
      console.error("Error: Discord is disabled in config (discord.enabled = false)");
      process.exit(1);
    }

    return {
      client: createDiscordClient(
        {
          botToken: config.chat.discord.botToken,
          allowedGuildIds: config.chat.discord.allowedGuildIds,
          allowedChannelIds: config.chat.discord.allowedChannelIds,
        },
        debug,
      ),
      provider: "discord",
      allowedChatIds: config.chat.discord.allowedChannelIds,
    };
  }

  // Default to Telegram
  if (!config.chat?.telegram?.botToken) {
    console.error("Error: Telegram bot token not configured");
    console.error("Set chat.telegram.botToken in .ralph/config.json");
    console.error("Get a token from @BotFather on Telegram");
    process.exit(1);
  }
  if (config.chat.telegram.enabled === false) {
    console.error("Error: Telegram is disabled in config (telegram.enabled = false)");
    process.exit(1);
  }

  return {
    client: createTelegramClient(
      {
        botToken: config.chat.telegram.botToken,
        allowedChatIds: config.chat.telegram.allowedChatIds,
      },
      debug,
    ),
    provider: "telegram",
    allowedChatIds: config.chat.telegram.allowedChatIds,
  };
}

/**
 * Process a message from the sandbox (container).
 * Handles notification actions like slack_notify, telegram_notify, discord_notify.
 */
async function processSandboxMessage(
  message: Message,
  client: ChatClient,
  allowedChatIds: string[] | undefined,
  messagesPath: string,
  debug: boolean,
): Promise<void> {
  const { action, args } = message;

  if (debug) {
    console.log(`[chat] Processing sandbox message: ${action} ${args?.join(" ") || ""}`);
  }

  // Handle notification actions
  if (action === "slack_notify" || action === "telegram_notify" || action === "discord_notify") {
    const notifyMessage = args?.join(" ") || "Ralph notification";

    // Check if this notification is for our provider
    const expectedProvider =
      action === "slack_notify" ? "slack" : action === "telegram_notify" ? "telegram" : "discord";

    if (client.provider !== expectedProvider) {
      if (debug) {
        console.log(
          `[chat] Ignoring ${action} - current provider is ${client.provider}`,
        );
      }
      respondToMessage(messagesPath, message.id, {
        success: false,
        error: `Chat provider is ${client.provider}, not ${expectedProvider}`,
      });
      return;
    }

    // Send to all allowed chat IDs
    if (!allowedChatIds || allowedChatIds.length === 0) {
      respondToMessage(messagesPath, message.id, {
        success: false,
        error: "No chat IDs configured",
      });
      return;
    }

    try {
      for (const chatId of allowedChatIds) {
        await client.sendMessage(chatId, notifyMessage);
      }
      if (debug) {
        console.log(`[chat] Sent notification to ${allowedChatIds.length} chat(s)`);
      }
      respondToMessage(messagesPath, message.id, {
        success: true,
        output: `Sent to ${client.provider}`,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      if (debug) {
        console.error(`[chat] Failed to send notification: ${errorMsg}`);
      }
      respondToMessage(messagesPath, message.id, {
        success: false,
        error: errorMsg,
      });
    }
    return;
  }

  // Unknown action - don't respond (let daemon handle it if running)
  if (debug) {
    console.log(`[chat] Ignoring unknown action: ${action}`);
  }
}

/**
 * Start the chat daemon (listens for messages and handles commands).
 */
async function startChat(config: RalphConfig, debug: boolean): Promise<void> {
  // Create or load chat state
  let state = loadChatState();
  const projectId = getOrCreateProjectId();
  const projectName = getProjectName();

  if (!state) {
    state = {
      projectId,
      projectName,
      registeredChatIds: [],
    };
    saveChatState(state);
  }

  // Create chat client based on provider
  const { client, provider, allowedChatIds } = createChatClient(config, debug);

  console.log("Ralph Chat Daemon");
  console.log("-".repeat(40));
  console.log(`Project: ${projectName}`);
  console.log(`Provider: ${provider}`);
  console.log("");

  // Connect and start listening
  try {
    await client.connect(
      (command) => handleCommand(command, client, config, state!, debug),
      debug
        ? (message) => {
            console.log(
              `[chat] Message from ${message.senderName || message.senderId}: ${message.text}`,
            );
            return Promise.resolve();
          }
        : undefined,
    );

    const providerName =
      provider === "slack" ? "Slack" : provider === "discord" ? "Discord" : "Telegram";
    console.log(`Connected to ${providerName}!`);
    console.log("");
    console.log(`Commands (send in ${providerName}):`);
    if (provider === "slack") {
      console.log("  /ralph help       - Show help");
      console.log("  /ralph status     - Show PRD progress");
      console.log("  /ralph run        - Start ralph automation");
      console.log("  /ralph stop       - Stop running automation");
      console.log("  /ralph add ...    - Add new task to PRD");
      console.log("  /ralph exec ...   - Execute shell command");
      console.log("  /ralph action ... - Run daemon action");
      console.log("  /ralph branch ... - Manage branches");
      console.log("  /ralph <prompt>   - Run Claude Code with prompt");
    } else {
      console.log("  /run         - Start ralph automation");
      console.log("  /status      - Show PRD progress");
      console.log("  /add ...     - Add new task to PRD");
      console.log("  /exec ...    - Execute shell command");
      console.log("  /action ...  - Run daemon action");
      console.log("  /claude ...  - Run Claude Code with prompt (YOLO mode)");
      console.log("  /help        - Show help");
    }
    console.log("");
    console.log("Press Ctrl+C to stop the daemon.");

    // Send connected message to all allowed chats
    if (allowedChatIds && allowedChatIds.length > 0) {
      for (const chatId of allowedChatIds) {
        try {
          await client.sendMessage(chatId, `${projectName} connected`);
        } catch (err) {
          if (debug) {
            console.error(`[chat] Failed to send connected message to ${chatId}: ${err}`);
          }
        }
      }
    }
  } catch (err) {
    console.error(`Failed to connect: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // Watch for sandbox messages (notifications from container)
  const messagesPath = getMessagesPath(false); // host path
  const ralphDir = getRalphDir();
  let sandboxWatcher: FSWatcher | null = null;
  let sandboxPollInterval: ReturnType<typeof setInterval> | null = null;
  let processingMessages = false;

  const checkSandboxMessages = async () => {
    if (processingMessages) return;
    processingMessages = true;

    try {
      const pending = getPendingMessages(messagesPath, "sandbox");
      for (const msg of pending) {
        // Only handle notification actions - let daemon handle others
        if (
          msg.action === "slack_notify" ||
          msg.action === "telegram_notify" ||
          msg.action === "discord_notify"
        ) {
          await processSandboxMessage(msg, client, allowedChatIds, messagesPath, debug);
        }
      }

      // Cleanup old messages periodically
      cleanupOldMessages(messagesPath, 60000);
    } catch (err) {
      if (debug) {
        console.error(`[chat] Error processing sandbox messages: ${err}`);
      }
    }

    processingMessages = false;
  };

  // Process any pending sandbox messages on startup
  await checkSandboxMessages();

  // Watch the .ralph directory for changes
  if (existsSync(ralphDir)) {
    sandboxWatcher = watch(ralphDir, { persistent: true }, (eventType, filename) => {
      if (filename === "messages.json") {
        checkSandboxMessages();
      }
    });
  }

  // Also poll periodically as backup
  sandboxPollInterval = setInterval(checkSandboxMessages, 1000);

  if (debug) {
    console.log(`[chat] Watching for sandbox notifications at: ${messagesPath}`);
  }

  // Handle shutdown
  const shutdown = async () => {
    console.log("\nShutting down chat daemon...");

    // Stop sandbox message watching
    if (sandboxWatcher) {
      sandboxWatcher.close();
    }
    if (sandboxPollInterval) {
      clearInterval(sandboxPollInterval);
    }

    // Send disconnected message to all allowed chats
    if (allowedChatIds && allowedChatIds.length > 0) {
      for (const chatId of allowedChatIds) {
        try {
          await client.sendMessage(chatId, `${projectName} disconnected`);
        } catch {
          // Ignore errors during shutdown
        }
      }
    }

    await client.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Show chat status.
 */
function showStatus(config: RalphConfig): void {
  console.log("Ralph Chat Status");
  console.log("-".repeat(40));

  const state = loadChatState();

  if (!config.chat?.enabled) {
    console.log("Chat: disabled");
    console.log("");
    console.log("To enable, set chat.enabled to true in .ralph/config.json");
    return;
  }

  console.log(`Chat: enabled`);
  console.log(`Provider: ${config.chat.provider || "not configured"}`);

  if (state) {
    console.log(`Project ID: ${state.projectId}`);
    console.log(`Project Name: ${state.projectName}`);
    if (state.lastActivity) {
      console.log(`Last Activity: ${state.lastActivity}`);
    }
  } else {
    console.log("State: not initialized (run 'ralph chat start' to initialize)");
  }

  console.log("");

  if (config.chat.provider === "slack") {
    if (
      config.chat.slack?.botToken &&
      config.chat.slack?.appToken &&
      config.chat.slack?.signingSecret
    ) {
      console.log("Slack: configured");
      if (config.chat.slack.allowedChannelIds && config.chat.slack.allowedChannelIds.length > 0) {
        console.log(`Allowed channels: ${config.chat.slack.allowedChannelIds.join(", ")}`);
      } else {
        console.log("Allowed channels: all (no restrictions)");
      }
    } else {
      const missing: string[] = [];
      if (!config.chat.slack?.botToken) missing.push("botToken");
      if (!config.chat.slack?.appToken) missing.push("appToken");
      if (!config.chat.slack?.signingSecret) missing.push("signingSecret");
      console.log(`Slack: not configured (missing: ${missing.join(", ")})`);
    }
  } else if (config.chat.provider === "discord") {
    if (config.chat.discord?.botToken) {
      console.log("Discord: configured");
      if (config.chat.discord.allowedGuildIds && config.chat.discord.allowedGuildIds.length > 0) {
        console.log(`Allowed guilds: ${config.chat.discord.allowedGuildIds.join(", ")}`);
      } else {
        console.log("Allowed guilds: all (no restrictions)");
      }
      if (
        config.chat.discord.allowedChannelIds &&
        config.chat.discord.allowedChannelIds.length > 0
      ) {
        console.log(`Allowed channels: ${config.chat.discord.allowedChannelIds.join(", ")}`);
      } else {
        console.log("Allowed channels: all (no restrictions)");
      }
    } else {
      console.log("Discord: not configured (missing botToken)");
    }
  } else if (config.chat.provider === "telegram") {
    if (config.chat.telegram?.botToken) {
      console.log("Telegram: configured");
      if (config.chat.telegram.allowedChatIds && config.chat.telegram.allowedChatIds.length > 0) {
        console.log(`Allowed chats: ${config.chat.telegram.allowedChatIds.join(", ")}`);
      } else {
        console.log("Allowed chats: all (no restrictions)");
      }
    } else {
      console.log("Telegram: not configured (missing botToken)");
    }
  }
}

/**
 * Test chat connection by sending a test message.
 */
async function testChat(config: RalphConfig, chatId?: string): Promise<void> {
  if (!config.chat?.enabled) {
    console.error("Error: Chat is not enabled in config.json");
    process.exit(1);
  }

  const provider = config.chat.provider || "telegram";

  let client: ChatClient;
  let targetChatId: string | undefined;

  if (provider === "slack") {
    if (
      !config.chat.slack?.botToken ||
      !config.chat.slack?.appToken ||
      !config.chat.slack?.signingSecret
    ) {
      console.error("Error: Slack configuration incomplete");
      console.error("Required: botToken, appToken, signingSecret");
      process.exit(1);
    }

    targetChatId = chatId || config.chat.slack.allowedChannelIds?.[0];
    if (!targetChatId) {
      console.error("Error: No channel ID specified and no allowed channel IDs configured");
      console.error("Usage: ralph chat test <channel_id>");
      console.error("Or add channel IDs to chat.slack.allowedChannelIds in config.json");
      process.exit(1);
    }

    client = createSlackClient({
      botToken: config.chat.slack.botToken,
      appToken: config.chat.slack.appToken,
      signingSecret: config.chat.slack.signingSecret,
      allowedChannelIds: config.chat.slack.allowedChannelIds,
    });
  } else if (provider === "discord") {
    if (!config.chat.discord?.botToken) {
      console.error("Error: Discord bot token not configured");
      process.exit(1);
    }

    targetChatId = chatId || config.chat.discord.allowedChannelIds?.[0];
    if (!targetChatId) {
      console.error("Error: No channel ID specified and no allowed channel IDs configured");
      console.error("Usage: ralph chat test <channel_id>");
      console.error("Or add channel IDs to chat.discord.allowedChannelIds in config.json");
      process.exit(1);
    }

    client = createDiscordClient({
      botToken: config.chat.discord.botToken,
      allowedGuildIds: config.chat.discord.allowedGuildIds,
      allowedChannelIds: config.chat.discord.allowedChannelIds,
    });
  } else {
    // Telegram
    if (!config.chat.telegram?.botToken) {
      console.error("Error: Telegram bot token not configured");
      process.exit(1);
    }

    targetChatId = chatId || config.chat.telegram.allowedChatIds?.[0];
    if (!targetChatId) {
      console.error("Error: No chat ID specified and no allowed chat IDs configured");
      console.error("Usage: ralph chat test <chat_id>");
      console.error("Or add chat IDs to chat.telegram.allowedChatIds in config.json");
      process.exit(1);
    }

    client = createTelegramClient({
      botToken: config.chat.telegram.botToken,
      allowedChatIds: config.chat.telegram.allowedChatIds,
    });
  }

  console.log(`Testing connection to ${provider} chat ${targetChatId}...`);

  try {
    // Just connect to verify credentials
    await client.connect(() => Promise.resolve());

    // Send test message
    const projectName = getProjectName();
    const state = loadChatState();
    const projectId = state?.projectId || "???";

    await client.sendMessage(targetChatId, `Test message from ${projectName} (${projectId})`);

    console.log("Test message sent successfully!");

    await client.disconnect();
  } catch (err) {
    console.error(`Test failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

/**
 * Main chat command handler.
 */
export async function chat(args: string[]): Promise<void> {
  const subcommand = args[0];
  const debug = args.includes("--debug") || args.includes("-d");
  const subArgs = args.filter((a) => a !== "--debug" && a !== "-d").slice(1);

  // Show help
  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h" || !subcommand) {
    console.log(`
ralph chat - Chat client integration (Telegram, Slack, Discord)

USAGE:
  ralph chat start [--debug]  Start the chat daemon
  ralph chat status           Show chat configuration status
  ralph chat test [chat_id]   Test connection by sending a message
  ralph chat help             Show this help message

CONFIGURATION:
  Configure chat in .ralph/config.json:

  Telegram:
  {
    "chat": {
      "enabled": true,
      "provider": "telegram",
      "telegram": {
        "botToken": "YOUR_BOT_TOKEN",
        "allowedChatIds": ["123456789"]
      }
    }
  }

  Slack:
  {
    "chat": {
      "enabled": true,
      "provider": "slack",
      "slack": {
        "botToken": "xoxb-YOUR-BOT-TOKEN",
        "appToken": "xapp-YOUR-APP-TOKEN",
        "signingSecret": "YOUR_SIGNING_SECRET",
        "allowedChannelIds": ["C01234567"]
      }
    }
  }

  Discord:
  {
    "chat": {
      "enabled": true,
      "provider": "discord",
      "discord": {
        "botToken": "YOUR_BOT_TOKEN",
        "allowedGuildIds": ["123456789"],
        "allowedChannelIds": ["987654321"]
      }
    }
  }

TELEGRAM SETUP:
  1. Create a bot with @BotFather on Telegram
  2. Copy the bot token to chat.telegram.botToken
  3. Start a chat with your bot and send any message
  4. Get your chat ID:
     curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
     Note: "bot" is a literal prefix, not a placeholder!
     Example: https://api.telegram.org/bot123456:ABC-xyz/getUpdates
  5. Add the chat ID to chat.telegram.allowedChatIds (optional security)

SLACK SETUP:
  1. Create a Slack app at https://api.slack.com/apps
  2. Enable Socket Mode in the app settings
  3. Generate an App-Level Token with connections:write scope (xapp-...)
  4. Under OAuth & Permissions, add these Bot Token Scopes:
     - chat:write (send messages)
     - channels:history (read public channel messages)
     - groups:history (read private channel messages)
     - im:history (read direct messages)
     - commands (for slash commands, optional)
  5. Install the app to your workspace
  6. Copy the Bot User OAuth Token (xoxb-...) to chat.slack.botToken
  7. Copy the App Token (xapp-...) to chat.slack.appToken
  8. Copy the Signing Secret to chat.slack.signingSecret
  9. Invite the bot to channels: /invite @your-bot-name
  10. Add channel IDs to chat.slack.allowedChannelIds (optional security)

DISCORD SETUP:
  1. Create an application at https://discord.com/developers/applications
  2. Go to "Bot" section and click "Add Bot"
  3. Enable these Privileged Gateway Intents:
     - MESSAGE CONTENT INTENT (to read message content)
  4. Copy the bot token to chat.discord.botToken
  5. Go to "OAuth2" > "URL Generator":
     - Select scopes: bot, applications.commands
     - Select permissions: Send Messages, Read Message History, Use Slash Commands
  6. Use the generated URL to invite the bot to your server
  7. Get your guild (server) ID: Enable Developer Mode in Discord settings,
     then right-click your server and "Copy Server ID"
  8. Get channel IDs: Right-click a channel and "Copy Channel ID"
  9. Add IDs to allowedGuildIds and allowedChannelIds (optional security)

CHAT COMMANDS:
  Once connected, send commands to your bot:

  /run            - Start ralph automation
  /status         - Show PRD progress
  /add [desc]     - Add new task to PRD
  /exec [cmd]     - Execute shell command
  /action [name]  - Run daemon action (e.g., /action build)
  /claude [prompt] - Run Claude Code with prompt in YOLO mode
  /stop           - Stop running ralph process
  /help           - Show help

SECURITY:
  - Use allowedChatIds/allowedChannelIds/allowedGuildIds to restrict access
  - Never share your bot tokens
  - The daemon should run on the host, not in the container

DAEMON ACTIONS:
  Configure custom actions in .ralph/config.json under daemon.actions:

  {
    "daemon": {
      "actions": {
        "build": {
          "command": "/path/to/build-script.sh",
          "description": "Run build script"
        },
        "deploy": {
          "command": "/path/to/deploy-script.sh",
          "description": "Run deploy script"
        }
      }
    }
  }

  Then trigger them via chat: /action build or /action deploy

EXAMPLES:
  # Start the chat daemon
  ralph chat start

  # Test the connection (Telegram)
  ralph chat test 123456789

  # Test the connection (Slack)
  ralph chat test C01234567

  # Test the connection (Discord)
  ralph chat test 123456789012345678

  # In Telegram/Slack/Discord:
  /run              # Start ralph automation
  /status           # Show task progress
  /add Fix login    # Add new task
  /exec npm test    # Run npm test
  /action build     # Run build action
  /action deploy    # Run deploy action
  /claude Fix the login bug  # Run Claude Code with prompt
`);
    return;
  }

  const ralphDir = getRalphDir();

  if (!existsSync(ralphDir)) {
    console.error("Error: .ralph/ directory not found. Run 'ralph init' first.");
    process.exit(1);
  }

  const config = loadConfig();

  switch (subcommand) {
    case "start":
      // Chat daemon should run on host, not in container
      if (isRunningInContainer()) {
        console.error("Error: 'ralph chat' should run on the host, not inside a container.");
        console.error("The chat daemon provides external communication for the sandbox.");
        process.exit(1);
      }
      await startChat(config, debug);
      break;

    case "status":
      showStatus(config);
      break;

    case "test":
      await testChat(config, subArgs[0]);
      break;

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error("Run 'ralph chat help' for usage information.");
      process.exit(1);
  }
}
