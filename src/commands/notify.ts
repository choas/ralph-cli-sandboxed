import { isRunningInContainer } from "../utils/config.js";
import { sendNotification, NotificationEvent } from "../utils/notification.js";
import { loadConfig } from "../utils/config.js";
import {
  getMessagesPath,
  sendMessage,
  waitForResponse,
} from "../utils/message-queue.js";
import { existsSync } from "fs";

/**
 * Send a notification - works both inside and outside containers.
 *
 * Inside container: Uses file-based message queue to communicate with host daemon
 * Outside container: Uses notifyCommand directly (for testing)
 */
export async function notify(args: string[]): Promise<void> {
  // Parse arguments
  let action = "notify";
  let message: string | undefined;
  let debug = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--action" || arg === "-a") {
      action = args[++i] || "notify";
    } else if (arg === "--debug" || arg === "-d") {
      debug = true;
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      return;
    } else if (!arg.startsWith("-")) {
      // Collect remaining args as message
      message = args.slice(i).join(" ");
      break;
    }
  }

  // Default message based on action
  if (!message) {
    if (action === "notify") {
      message = "Ralph notification";
    }
  }

  const inContainer = isRunningInContainer();
  const messagesPath = getMessagesPath(inContainer);

  if (debug) {
    console.log(`[notify] Action: ${action}`);
    console.log(`[notify] Message/Args: ${message || "(none)"}`);
    console.log(`[notify] In container: ${inContainer}`);
    console.log(`[notify] Messages file: ${messagesPath}`);
  }

  if (inContainer) {
    // Inside container - use file-based message queue
    if (!existsSync(messagesPath)) {
      // Check if .ralph directory exists (mounted from host)
      const ralphDir = "/workspace/.ralph";
      if (!existsSync(ralphDir)) {
        console.error("Error: .ralph directory not mounted in container.");
        console.error("Make sure the container is started with 'ralph docker run'.");
        process.exit(1);
      }
    }

    // Send message via file queue
    const messageId = sendMessage(
      messagesPath,
      "sandbox",
      action,
      message ? [message] : undefined
    );

    if (debug) {
      console.log(`[notify] Sent message: ${messageId}`);
    }

    console.log("Message sent. Waiting for daemon response...");

    // Wait for response
    const response = await waitForResponse(messagesPath, messageId, 10000);

    if (!response) {
      console.error("No response from daemon (timeout).");
      console.error("");
      console.error("Make sure the daemon is running on the host:");
      console.error("  ralph daemon start");
      process.exit(1);
    }

    if (debug) {
      console.log(`[notify] Response: ${JSON.stringify(response)}`);
    }

    if (response.success) {
      if (action === "ping") {
        console.log("Daemon is responsive: pong");
      } else {
        console.log("Notification sent successfully.");
        if (response.output && debug) {
          console.log(`Output: ${response.output}`);
        }
      }
    } else {
      console.error(`Failed: ${response.error}`);
      process.exit(1);
    }
  } else {
    // Outside container - use direct notification or message queue
    try {
      const config = loadConfig();
      if (config.notifyCommand) {
        await sendNotification("iteration_complete" as NotificationEvent, message, {
          command: config.notifyCommand,
          debug,
        });
        console.log("Notification sent directly.");
      } else {
        console.error("No notifyCommand configured.");
        console.error("Configure notifyCommand in .ralph/config.json");
        process.exit(1);
      }
    } catch {
      console.error("Failed to load config. Run 'ralph init' first.");
      process.exit(1);
    }
  }
}

function showHelp(): void {
  console.log(`
ralph notify - Send notification to host from sandbox

USAGE:
  ralph notify [message]              Send a notification message
  ralph notify --action <action> [args...]  Execute a daemon action
  ralph notify --help                 Show this help

OPTIONS:
  -a, --action <name>   Execute a specific daemon action (default: notify)
  -d, --debug           Show debug output
  -h, --help            Show this help message

DESCRIPTION:
  This command sends notifications or executes actions through the ralph
  daemon. Communication happens via a shared file (.ralph/messages.json)
  that is mounted into the container.

EXAMPLES:
  # Send a notification
  ralph notify "Build complete!"
  ralph notify "PRD task finished"

  # Check daemon connectivity
  ralph notify --action ping

  # Execute custom action (if configured)
  ralph notify --action custom-action arg1 arg2

SETUP:
  1. Configure notification command in .ralph/config.json:
     { "notifyCommand": "ntfy pub mytopic" }

  2. Start the daemon on the host:
     ralph daemon start

  3. Run the container:
     ralph docker run

  4. Send notifications from inside the container:
     ralph notify "Hello from sandbox!"

NOTES:
  - The daemon must be running on the host to process messages
  - Communication uses .ralph/messages.json (works on all platforms)
  - Other tools can also read/write to this file for integration
`);
}
