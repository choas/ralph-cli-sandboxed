import { isDaemonAvailable, sendDaemonRequest, getDaemonSocketPath } from "../utils/daemon-client.js";
import { isRunningInContainer } from "../utils/config.js";
import { sendNotification, NotificationEvent } from "../utils/notification.js";
import { loadConfig } from "../utils/config.js";

/**
 * Send a notification - works both inside and outside containers.
 *
 * Inside container: Uses daemon socket to communicate with host
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

  if (debug) {
    console.log(`[notify] Action: ${action}`);
    console.log(`[notify] Message/Args: ${message || "(none)"}`);
    console.log(`[notify] In container: ${isRunningInContainer()}`);
    console.log(`[notify] Daemon socket: ${getDaemonSocketPath()}`);
    console.log(`[notify] Daemon available: ${isDaemonAvailable()}`);
  }

  // Check if daemon is available
  if (isDaemonAvailable()) {
    // Use daemon for communication
    const response = await sendDaemonRequest(
      action,
      message ? [message] : undefined
    );

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
      console.error(`Failed to send notification: ${response.error}`);
      process.exit(1);
    }
  } else if (!isRunningInContainer()) {
    // Outside container, daemon not running - use direct notification
    try {
      const config = loadConfig();
      if (config.notifyCommand) {
        await sendNotification("iteration_complete" as NotificationEvent, message, {
          command: config.notifyCommand,
          debug,
        });
        console.log("Notification sent directly (daemon not running).");
      } else {
        console.error("No notifyCommand configured and daemon not running.");
        console.error("Configure notifyCommand in .ralph/config.json or start the daemon.");
        process.exit(1);
      }
    } catch {
      console.error("Failed to load config. Run 'ralph init' first.");
      process.exit(1);
    }
  } else {
    // Inside container but daemon not available
    console.error("Daemon not available.");
    console.error("");
    console.error("The daemon must be running on the host to receive notifications.");
    console.error("Start it with: ralph daemon start");
    console.error("");
    console.error(`Looking for socket at: ${getDaemonSocketPath()}`);
    process.exit(1);
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
  daemon. The daemon runs on the host and the sandbox communicates with
  it via a Unix socket.

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
  - The daemon must be running on the host for this to work inside containers
  - Outside containers, this command can send notifications directly if
    notifyCommand is configured
  - Custom actions can be configured in the daemon config
`);
}
