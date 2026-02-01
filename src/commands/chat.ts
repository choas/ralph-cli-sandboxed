/**
 * Chat command for managing Telegram, Slack, and other chat integrations.
 * Allows ralph to receive commands and send notifications via chat services.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { spawn } from "child_process";
import { loadConfig, getRalphDir, isRunningInContainer, RalphConfig } from "../utils/config.js";
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
import { getMessagesPath, sendMessage, waitForResponse } from "../utils/message-queue.js";

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

/**
 * Get PRD status (completed/total tasks).
 */
function getPrdStatus(): { complete: number; total: number; incomplete: number } {
  const ralphDir = getRalphDir();
  const prdPath = join(ralphDir, "prd.json");

  if (!existsSync(prdPath)) {
    return { complete: 0, total: 0, incomplete: 0 };
  }

  try {
    const content = readFileSync(prdPath, "utf-8");
    const items = JSON.parse(content);
    if (!Array.isArray(items)) {
      return { complete: 0, total: 0, incomplete: 0 };
    }

    const complete = items.filter((item: { passes?: boolean }) => item.passes === true).length;
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
  const ralphDir = getRalphDir();
  const prdPath = join(ralphDir, "prd.json");

  if (!existsSync(prdPath)) {
    return [];
  }

  try {
    const content = readFileSync(prdPath, "utf-8");
    const items = JSON.parse(content);
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
  const ralphDir = getRalphDir();
  const prdPath = join(ralphDir, "prd.json");

  if (!existsSync(prdPath)) {
    return false;
  }

  try {
    const content = readFileSync(prdPath, "utf-8");
    const items = JSON.parse(content);
    if (!Array.isArray(items)) {
      return false;
    }

    items.push({
      category: "feature",
      description,
      steps: [],
      passes: false,
    });

    writeFileSync(prdPath, JSON.stringify(items, null, 2) + "\n");
    return true;
  } catch {
    return false;
  }
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
/ralph <prompt> - Run Claude Code`
        : `/help - This help
/status - PRD progress
/run - Start automation
/stop - Stop automation
/add [desc] - Add task
/exec [cmd] - Shell command
/action [name] - Run action
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

  // Handle shutdown
  const shutdown = async () => {
    console.log("\nShutting down chat daemon...");

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
