import { existsSync, watch, FSWatcher } from "fs";
import { spawn } from "child_process";
import { loadConfig, getRalphDir, isRunningInContainer } from "../utils/config.js";
import {
  getMessagesPath,
  readMessages,
  getPendingMessages,
  respondToMessage,
  cleanupOldMessages,
  initializeMessages,
  Message,
} from "../utils/message-queue.js";
import { getDefaultActions, DaemonAction } from "../utils/daemon-actions.js";

export type { DaemonAction };

export interface DaemonConfig {
  enabled?: boolean;
  actions?: Record<string, DaemonAction>;
}

export interface DaemonRequest {
  action: string;
  args?: string[];
}

export interface DaemonResponse {
  success: boolean;
  message?: string;
  output?: string;
  error?: string;
}

// Telegram client for sending messages (lazy loaded)
let telegramClient: { sendMessage: (chatId: string, text: string) => Promise<void> } | null = null;
let telegramConfig: { botToken: string; allowedChatIds?: string[] } | null = null;

// Slack client for sending messages (lazy loaded)
let slackClient: { sendMessage: (channelId: string, text: string) => Promise<void> } | null = null;
let slackConfig: { botToken: string; appToken: string; signingSecret: string; allowedChannelIds?: string[] } | null = null;

// Discord client for sending messages (lazy loaded)
let discordClient: { sendMessage: (channelId: string, text: string) => Promise<void> } | null = null;
let discordConfig: { botToken: string; allowedGuildIds?: string[]; allowedChannelIds?: string[] } | null = null;

/**
 * Check if Telegram is enabled (has token and not explicitly disabled).
 */
function isTelegramEnabled(config: ReturnType<typeof loadConfig>): boolean {
  if (!config.chat?.telegram?.botToken) return false;
  if (config.chat.telegram.enabled === false) return false;
  return true;
}

/**
 * Check if Slack is enabled (has required tokens and not explicitly disabled).
 */
function isSlackEnabled(config: ReturnType<typeof loadConfig>): boolean {
  if (!config.chat?.slack?.botToken) return false;
  if (!config.chat?.slack?.appToken) return false;
  if (!config.chat?.slack?.signingSecret) return false;
  if (config.chat.slack.enabled === false) return false;
  return true;
}

/**
 * Check if Discord is enabled (has token and not explicitly disabled).
 */
function isDiscordEnabled(config: ReturnType<typeof loadConfig>): boolean {
  if (!config.chat?.discord?.botToken) return false;
  if (config.chat.discord.enabled === false) return false;
  return true;
}

// Note: getDefaultActions moved to utils/daemon-actions.ts for sharing with action.ts

/**
 * Initialize Telegram client if configured.
 */
async function initTelegramClient(config: ReturnType<typeof loadConfig>): Promise<void> {
  if (isTelegramEnabled(config)) {
    telegramConfig = config.chat!.telegram!;
    // Dynamic import to avoid circular dependency
    const { createTelegramClient } = await import("../providers/telegram.js");
    telegramClient = createTelegramClient(telegramConfig, false);
  }
}

/**
 * Initialize Slack client if configured.
 */
async function initSlackClient(config: ReturnType<typeof loadConfig>): Promise<void> {
  if (isSlackEnabled(config)) {
    slackConfig = config.chat!.slack!;
    // Dynamic import to avoid circular dependency
    const { createSlackClient } = await import("../providers/slack.js");
    slackClient = createSlackClient(slackConfig, false);
  }
}

/**
 * Initialize Discord client if configured.
 */
async function initDiscordClient(config: ReturnType<typeof loadConfig>): Promise<void> {
  if (isDiscordEnabled(config)) {
    discordConfig = config.chat!.discord!;
    // Dynamic import to avoid circular dependency
    const { createDiscordClient } = await import("../providers/discord.js");
    discordClient = createDiscordClient(discordConfig, false);
  }
}

/**
 * Send a message via Telegram if configured.
 */
async function sendTelegramMessage(message: string): Promise<{ success: boolean; error?: string }> {
  if (!telegramClient || !telegramConfig) {
    return { success: false, error: "Telegram not configured" };
  }

  try {
    // Send to all allowed chat IDs, or fail if none configured
    const chatIds = telegramConfig.allowedChatIds;
    if (!chatIds || chatIds.length === 0) {
      return { success: false, error: "No chat IDs configured for Telegram" };
    }

    for (const chatId of chatIds) {
      await telegramClient.sendMessage(chatId, message);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Send a message via Slack if configured.
 */
async function sendSlackMessage(message: string): Promise<{ success: boolean; error?: string }> {
  if (!slackClient || !slackConfig) {
    return { success: false, error: "Slack not configured" };
  }

  try {
    // Send to all allowed channel IDs, or fail if none configured
    const channelIds = slackConfig.allowedChannelIds;
    if (!channelIds || channelIds.length === 0) {
      return { success: false, error: "No channel IDs configured for Slack" };
    }

    for (const channelId of channelIds) {
      await slackClient.sendMessage(channelId, message);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Send a message via Discord if configured.
 */
async function sendDiscordMessage(message: string): Promise<{ success: boolean; error?: string }> {
  if (!discordClient || !discordConfig) {
    return { success: false, error: "Discord not configured" };
  }

  try {
    // Send to all allowed channel IDs, or fail if none configured
    const channelIds = discordConfig.allowedChannelIds;
    if (!channelIds || channelIds.length === 0) {
      return { success: false, error: "No channel IDs configured for Discord" };
    }

    for (const channelId of channelIds) {
      await discordClient.sendMessage(channelId, message);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}


/**
 * Execute an action command with arguments.
 * Environment variables are passed to the command:
 * - RALPH_MESSAGE: The message argument (if provided)
 */
async function executeAction(
  action: DaemonAction,
  args: string[] = []
): Promise<{ success: boolean; output: string; error?: string }> {
  // Special handling for Telegram
  if (action.command === "__telegram__") {
    const message = args.join(" ") || "Ralph notification";
    const result = await sendTelegramMessage(message);
    return {
      success: result.success,
      output: result.success ? "Sent to Telegram" : "",
      error: result.error,
    };
  }

  // Special handling for Slack
  if (action.command === "__slack__") {
    const message = args.join(" ") || "Ralph notification";
    const result = await sendSlackMessage(message);
    return {
      success: result.success,
      output: result.success ? "Sent to Slack" : "",
      error: result.error,
    };
  }

  // Special handling for Discord
  if (action.command === "__discord__") {
    const message = args.join(" ") || "Ralph notification";
    const result = await sendDiscordMessage(message);
    return {
      success: result.success,
      output: result.success ? "Sent to Discord" : "",
      error: result.error,
    };
  }

  return new Promise((resolve) => {
    let fullCommand: string;
    const message = args.join(" ") || "";

    // Build environment with RALPH_MESSAGE
    const env = {
      ...process.env,
      RALPH_MESSAGE: message,
    };

    // Special handling for ntfy - use curl with proper syntax
    if (action.ntfyUrl) {
      // curl -s -d "message" https://ntfy.sh/topic
      fullCommand = `curl -s -d "${message.replace(/"/g, '\\"')}" "${action.ntfyUrl}"`;
    } else {
      // Command can use $RALPH_MESSAGE env var
      // Also pass args for backwards compatibility
      fullCommand = args.length > 0
        ? `${action.command} ${args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(" ")}`
        : action.command;
    }

    const proc = spawn(fullCommand, [], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      env,
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
        resolve({ success: true, output: stdout.trim() });
      } else {
        resolve({
          success: false,
          output: stdout.trim(),
          error: stderr.trim() || `Exit code: ${code}`,
        });
      }
    });

    proc.on("error", (err) => {
      resolve({ success: false, output: "", error: err.message });
    });
  });
}

/**
 * Process a message from the sandbox.
 */
async function processMessage(
  message: Message,
  actions: Record<string, DaemonAction>,
  messagesPath: string,
  debug: boolean
): Promise<void> {
  if (debug) {
    console.log(`[daemon] Processing: ${message.action} (${message.id})`);
  }

  const action = actions[message.action];

  if (!action) {
    respondToMessage(messagesPath, message.id, {
      success: false,
      error: `Unknown action: ${message.action}. Available: ${Object.keys(actions).join(", ")}`,
    });
    return;
  }

  const result = await executeAction(action, message.args);

  respondToMessage(messagesPath, message.id, {
    success: result.success,
    output: result.output,
    error: result.error,
  });

  if (debug) {
    console.log(`[daemon] Responded: ${result.success ? "success" : "failed"}`);
  }
}

/**
 * Start the daemon - watches for messages from sandbox.
 */
async function startDaemon(debug: boolean): Promise<void> {
  // Daemon should not run inside a container
  if (isRunningInContainer()) {
    console.error("Error: 'ralph daemon' should run on the host, not inside a container.");
    console.error("The daemon processes messages from the sandbox.");
    process.exit(1);
  }

  const config = loadConfig();
  const daemonConfig = config.daemon || {};

  // Initialize chat clients if configured
  await initTelegramClient(config);
  await initSlackClient(config);
  await initDiscordClient(config);

  // Merge default and configured actions
  const defaultActions = getDefaultActions(config);
  const configuredActions = daemonConfig.actions || {};
  const actions = { ...defaultActions, ...configuredActions };

  const messagesPath = getMessagesPath(false);
  const ralphDir = getRalphDir();

  // Initialize messages file with daemon_started message
  initializeMessages(messagesPath);

  console.log("Ralph daemon started");
  console.log(`Messages file: ${messagesPath}`);
  console.log("");
  console.log("Available actions:");
  for (const [name, action] of Object.entries(actions)) {
    console.log(`  ${name}: ${action.description || action.command}`);
  }
  console.log("");
  console.log("Watching for messages from sandbox...");
  console.log("Press Ctrl+C to stop.");

  // Process any pending messages on startup
  const pending = getPendingMessages(messagesPath, "sandbox");
  for (const msg of pending) {
    await processMessage(msg, actions, messagesPath, debug);
  }

  // Watch for file changes
  let processing = false;
  let watcher: FSWatcher | null = null;

  const checkMessages = async () => {
    if (processing) return;
    processing = true;

    try {
      const pending = getPendingMessages(messagesPath, "sandbox");
      for (const msg of pending) {
        await processMessage(msg, actions, messagesPath, debug);
      }

      // Cleanup old messages periodically
      cleanupOldMessages(messagesPath, 60000);
    } catch (err) {
      if (debug) {
        console.error(`[daemon] Error processing messages: ${err}`);
      }
    }

    processing = false;
  };

  // Watch the .ralph directory for changes
  if (existsSync(ralphDir)) {
    watcher = watch(ralphDir, { persistent: true }, (eventType, filename) => {
      if (filename === "messages.json") {
        checkMessages();
      }
    });
  }

  // Also poll periodically as backup (file watching can be unreliable)
  const pollInterval = setInterval(checkMessages, 1000);

  // Handle shutdown
  const shutdown = () => {
    console.log("\nShutting down daemon...");
    if (watcher) {
      watcher.close();
    }
    clearInterval(pollInterval);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Show daemon status.
 */
function showStatus(): void {
  const messagesPath = getMessagesPath(false);

  console.log("Ralph Daemon Status");
  console.log("-".repeat(40));
  console.log(`Messages file: ${messagesPath}`);
  console.log(`File exists: ${existsSync(messagesPath) ? "yes" : "no"}`);

  if (existsSync(messagesPath)) {
    const messages = readMessages(messagesPath);
    const pending = messages.filter((m) => m.status === "pending");
    console.log(`Total messages: ${messages.length}`);
    console.log(`Pending messages: ${pending.length}`);
  }

  console.log("");
  console.log("To start the daemon: ralph daemon start");
}

/**
 * Main daemon command handler.
 */
export async function daemon(args: string[]): Promise<void> {
  const subcommand = args[0];
  const debug = args.includes("--debug") || args.includes("-d");

  // Show help
  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h" || !subcommand) {
    console.log(`
ralph daemon - Host daemon for sandbox-to-host communication

USAGE:
  ralph daemon start [--debug]  Start the daemon (run on host, not in container)
  ralph daemon status           Show daemon status
  ralph daemon help             Show this help message

DESCRIPTION:
  The daemon runs on the host machine and watches the .ralph/messages.json
  file for messages from the sandboxed container. When the sandbox sends
  a message, the daemon processes it and writes a response.

  This file-based approach works on all platforms (macOS, Linux, Windows)
  and allows other tools to also interact with the message queue.

CONFIGURATION:
  Configure notifications in .ralph/config.json:

  Using ntfy (recommended - no install needed, uses curl):
  {
    "notifications": {
      "provider": "ntfy",
      "ntfy": {
        "topic": "my-ralph-notifications",
        "server": "https://ntfy.sh"
      }
    }
  }

  Using a custom command:
  {
    "notifications": {
      "provider": "command",
      "command": "notify-send Ralph"
    }
  }

  Custom daemon actions:
  {
    "daemon": {
      "actions": {
        "custom-action": {
          "command": "/path/to/script.sh",
          "description": "Run custom script"
        }
      }
    }
  }

DEFAULT ACTIONS:
  ping         Health check - responds with 'pong'
  notify       Send notification (uses notifications config)
  chat_status  Get PRD status as JSON
  chat_add     Add a new task to the PRD

SANDBOX USAGE:
  From inside the container, use 'ralph notify' to send messages:

  ralph notify "Task completed!"
  ralph notify --action ping

MESSAGE FORMAT:
  The messages.json file contains an array of messages:

  [
    {
      "id": "uuid",
      "from": "sandbox",
      "action": "notify",
      "args": ["Hello!"],
      "timestamp": 1234567890,
      "status": "pending"
    }
  ]

  When the daemon processes a message, it updates the status and adds a response:

  {
    "id": "uuid",
    "from": "sandbox",
    "action": "notify",
    "args": ["Hello!"],
    "timestamp": 1234567890,
    "status": "done",
    "response": {
      "success": true,
      "output": "..."
    }
  }

  Other tools can read/write to this file for integration.

EXAMPLES:
  # Terminal 1: Start daemon on host
  ralph daemon start

  # Terminal 2: Run container
  ralph docker run

  # Inside container: Send notification
  ralph notify "PRD complete!"
`);
    return;
  }

  switch (subcommand) {
    case "start":
      await startDaemon(debug);
      break;

    case "status":
      showStatus();
      break;

    case "stop":
      console.log("The file-based daemon doesn't require stopping.");
      console.log("Just press Ctrl+C in the terminal where it's running.");
      break;

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error("Run 'ralph daemon help' for usage information.");
      process.exit(1);
  }
}
