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

export interface DaemonAction {
  command: string;
  description?: string;
  ntfyUrl?: string;  // Special case for ntfy provider - curl target URL
}

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

/**
 * Default actions available to the sandbox.
 */
function getDefaultActions(config: ReturnType<typeof loadConfig>): Record<string, DaemonAction> {
  const actions: Record<string, DaemonAction> = {
    ping: {
      command: "echo pong",
      description: "Health check - responds with 'pong'",
    },
  };

  // Add notify action based on notifications config
  if (config.notifications?.provider === "ntfy" && config.notifications.ntfy?.topic) {
    const server = config.notifications.ntfy.server || "https://ntfy.sh";
    const topic = config.notifications.ntfy.topic;
    actions.notify = {
      command: "curl",  // Placeholder - ntfyUrl triggers special handling
      description: `Send notification via ntfy to ${topic}`,
      ntfyUrl: `${server}/${topic}`,
    };
  } else if (config.notifications?.provider === "command" && config.notifications.command) {
    actions.notify = {
      command: config.notifications.command,
      description: "Send notification to host",
    };
  } else if (config.notifyCommand) {
    // Fallback to deprecated notifyCommand
    actions.notify = {
      command: config.notifyCommand,
      description: "Send notification to host",
    };
  }

  // Add chat_status action for querying PRD status from container
  actions.chat_status = {
    command: "ralph prd status --json 2>/dev/null || echo '{}'",
    description: "Get PRD status as JSON",
  };

  // Add chat_add action for adding PRD tasks from container
  actions.chat_add = {
    command: "ralph add",
    description: "Add a new task to the PRD",
  };

  return actions;
}

/**
 * Execute an action command with arguments.
 */
async function executeAction(
  action: DaemonAction,
  args: string[] = []
): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    let fullCommand: string;

    // Special handling for ntfy - use curl with proper syntax
    if (action.ntfyUrl) {
      const message = args.join(" ") || "Ralph notification";
      // curl -s -d "message" https://ntfy.sh/topic
      fullCommand = `curl -s -d "${message.replace(/"/g, '\\"')}" "${action.ntfyUrl}"`;
    } else {
      // Build the full command with args
      fullCommand = args.length > 0
        ? `${action.command} ${args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(" ")}`
        : action.command;
    }

    const proc = spawn(fullCommand, [], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
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
