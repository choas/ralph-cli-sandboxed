/**
 * Chat command for managing Telegram (and other) chat integrations.
 * Allows ralph to receive commands and send notifications via chat services.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { spawn } from "child_process";
import { loadConfig, getRalphDir, isRunningInContainer, RalphConfig } from "../utils/config.js";
import { createTelegramClient } from "../providers/telegram.js";
import {
  ChatClient,
  ChatCommand,
  InlineButton,
  generateProjectId,
  formatStatusMessage,
  formatStatusForChat,
} from "../utils/chat-client.js";
import {
  getMessagesPath,
  sendMessage,
  waitForResponse,
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
  timeout: number = 60000
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
  debug: boolean
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
        await client.sendMessage(chatId, `${state.projectName}: All tasks already complete (${prdStatus.complete}/${prdStatus.total})`);
        return;
      }

      const categoryInfo = category ? ` (category: ${category})` : "";
      await client.sendMessage(
        chatId,
        `${state.projectName}: Starting ralph run${categoryInfo} (${prdStatus.incomplete} tasks remaining)...`
      );

      // Send run command to sandbox with optional category argument
      const runArgs = category ? [category] : [];
      const response = await sendToSandbox("run", runArgs, debug, 10000);
      if (response) {
        if (response.success) {
          await client.sendMessage(chatId, `${state.projectName}: Ralph run started in sandbox${categoryInfo}`);
        } else {
          await client.sendMessage(chatId, `${state.projectName}: Failed to start: ${response.error}`);
        }
      } else {
        await client.sendMessage(chatId, `${state.projectName}: No response from sandbox. Is 'ralph listen' running?`);
      }

      state.lastActivity = new Date().toISOString();
      saveChatState(state);
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
        await client.sendMessage(chatId, `${state.projectName}: Usage: /add [task description]`);
        return;
      }

      const description = args.join(" ");
      const success = addPrdTask(description);

      if (success) {
        await client.sendMessage(chatId, `${state.projectName}: Added task: "${description}"`);
      } else {
        await client.sendMessage(chatId, `${state.projectName}: Failed to add task. Check PRD file.`);
      }
      break;
    }

    case "exec": {
      if (args.length === 0) {
        await client.sendMessage(chatId, `${state.projectName}: Usage: /exec [command]`);
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
        await client.sendMessage(chatId, `${state.projectName}: No response from sandbox. Is 'ralph listen' running?`);
      }
      break;
    }

    case "stop": {
      await client.sendMessage(chatId, `${state.projectName}: Stop command received (not implemented yet)`);
      break;
    }

    case "action": {
      // Reload config to pick up new actions
      const freshConfig = loadConfig();
      const actions = freshConfig.daemon?.actions || {};
      const actionNames = Object.keys(actions).filter(name => name !== "notify" && name !== "telegram_notify");

      if (args.length === 0) {
        // List available actions
        if (actionNames.length === 0) {
          await client.sendMessage(chatId, `${state.projectName}: No actions configured. Add actions to daemon.actions in config.json`);
        } else {
          await client.sendMessage(chatId, `${state.projectName}: Available actions: ${actionNames.join(", ")}\nUsage: /action <name>`);
        }
        return;
      }

      const actionName = args[0].toLowerCase();
      const action = actions[actionName];

      if (!action) {
        if (actionNames.length === 0) {
          await client.sendMessage(chatId, `${state.projectName}: No actions configured. Add actions to daemon.actions in config.json`);
        } else {
          await client.sendMessage(chatId, `${state.projectName}: Unknown action '${actionName}'. Available: ${actionNames.join(", ")}`);
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
        await client.sendMessage(chatId, `${state.projectName}: Usage: /claude [prompt]`);
        return;
      }

      const prompt = args.join(" ");
      await client.sendMessage(chatId, `⏳ ${state.projectName}: Running Claude Code...\n(this may take a few minutes)`);

      // Send claude command to sandbox with longer timeout (5 minutes)
      const response = await sendToSandbox("claude", args, debug, 300000);

      if (response) {
        let output = response.output || response.error || "(no output)";

        // Truncate long output
        if (output.length > 2000) {
          output = output.substring(0, 2000) + "\n...(truncated)";
        }

        if (response.success) {
          await client.sendMessage(chatId, `✅ ${state.projectName}: Claude Code DONE\n\n${output}`);
        } else {
          // Check for version mismatch (sandbox has old version without /claude support)
          if (response.error?.includes("Unknown action: claude")) {
            await client.sendMessage(
              chatId,
              `❌ ${state.projectName}: Claude Code failed - sandbox needs update.\n` +
              `The sandbox listener doesn't support /claude. Rebuild your Docker container:\n` +
              `  ralph docker build --no-cache`
            );
          } else {
            await client.sendMessage(chatId, `❌ ${state.projectName}: Claude Code FAILED\n\n${output}`);
          }
        }
      } else {
        await client.sendMessage(chatId, `❌ ${state.projectName}: No response from sandbox. Is 'ralph listen' running?`);
      }
      break;
    }

    case "help": {
      const helpText = `
/run - Start automation
/status - PRD progress
/add [desc] - Add task
/exec [cmd] - Shell command
/action [name] - Run action
/claude [prompt] - Run Claude Code
/help - This help
`.trim();
      await client.sendMessage(chatId, helpText);
      break;
    }

    default:
      await client.sendMessage(chatId, `${state.projectName}: Unknown command: /${cmd}. Try /help`);
  }
}

/**
 * Start the chat daemon (listens for messages and handles commands).
 */
async function startChat(config: RalphConfig, debug: boolean): Promise<void> {
  // Check that Telegram is configured
  if (!config.chat?.telegram?.botToken) {
    console.error("Error: Telegram bot token not configured");
    console.error("Set chat.telegram.botToken in .ralph/config.json");
    console.error("Get a token from @BotFather on Telegram");
    process.exit(1);
  }

  // Check if Telegram is explicitly disabled
  if (config.chat.telegram.enabled === false) {
    console.error("Error: Telegram is disabled in config (telegram.enabled = false)");
    process.exit(1);
  }

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

  // Create Telegram client
  const client = createTelegramClient(
    {
      botToken: config.chat.telegram.botToken,
      allowedChatIds: config.chat.telegram.allowedChatIds,
    },
    debug
  );

  console.log("Ralph Chat Daemon");
  console.log("-".repeat(40));
  console.log(`Project: ${projectName}`);
  console.log(`Provider: ${config.chat.provider}`);
  console.log("");

  // Connect and start listening
  try {
    await client.connect(
      (command) => handleCommand(command, client, config, state!, debug),
      debug
        ? (message) => {
            console.log(`[chat] Message from ${message.senderName || message.senderId}: ${message.text}`);
            return Promise.resolve();
          }
        : undefined
    );

    console.log("Connected to Telegram!");
    console.log("");
    console.log("Commands (send in Telegram):");
    console.log("  /run         - Start ralph automation");
    console.log("  /status      - Show PRD progress");
    console.log("  /add ...     - Add new task to PRD");
    console.log("  /exec ...    - Execute shell command");
    console.log("  /action ...  - Run daemon action");
    console.log("  /claude ...  - Run Claude Code with prompt (YOLO mode)");
    console.log("  /help        - Show help");
    console.log("");
    console.log("Press Ctrl+C to stop the daemon.");

    // Send connected message to all allowed chats
    if (config.chat.telegram.allowedChatIds && config.chat.telegram.allowedChatIds.length > 0) {
      for (const chatId of config.chat.telegram.allowedChatIds) {
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
    if (config.chat?.telegram?.allowedChatIds) {
      for (const chatId of config.chat.telegram.allowedChatIds) {
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

  if (config.chat.provider === "telegram") {
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

  if (!config.chat.telegram?.botToken) {
    console.error("Error: Telegram bot token not configured");
    process.exit(1);
  }

  // If no chat ID provided, use the first allowed chat ID
  const targetChatId = chatId || (config.chat.telegram.allowedChatIds?.[0]);
  if (!targetChatId) {
    console.error("Error: No chat ID specified and no allowed chat IDs configured");
    console.error("Usage: ralph chat test <chat_id>");
    console.error("Or add chat IDs to chat.telegram.allowedChatIds in config.json");
    process.exit(1);
  }

  const client = createTelegramClient({
    botToken: config.chat.telegram.botToken,
    allowedChatIds: config.chat.telegram.allowedChatIds,
  });

  console.log(`Testing connection to chat ${targetChatId}...`);

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
ralph chat - Chat client integration (Telegram, etc.)

USAGE:
  ralph chat start [--debug]  Start the chat daemon
  ralph chat status           Show chat configuration status
  ralph chat test [chat_id]   Test connection by sending a message
  ralph chat help             Show this help message

CONFIGURATION:
  Configure chat in .ralph/config.json:

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

TELEGRAM SETUP:
  1. Create a bot with @BotFather on Telegram
  2. Copy the bot token to chat.telegram.botToken
  3. Start a chat with your bot and send any message
  4. Get your chat ID:
     curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
     Note: "bot" is a literal prefix, not a placeholder!
     Example: https://api.telegram.org/bot123456:ABC-xyz/getUpdates
  5. Add the chat ID to chat.telegram.allowedChatIds (optional security)

CHAT COMMANDS:
  Once connected, send commands to your Telegram bot:

  /run            - Start ralph automation
  /status         - Show PRD progress
  /add [desc]     - Add new task to PRD
  /exec [cmd]     - Execute shell command
  /action [name]  - Run daemon action (e.g., /action build)
  /claude [prompt] - Run Claude Code with prompt in YOLO mode
  /stop           - Stop running ralph process
  /help           - Show help

SECURITY:
  - Use allowedChatIds to restrict which chats can control ralph
  - Never share your bot token
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

  Then trigger them via Telegram: /action build or /action deploy

EXAMPLES:
  # Start the chat daemon
  ralph chat start

  # Test the connection
  ralph chat test 123456789

  # In Telegram:
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
