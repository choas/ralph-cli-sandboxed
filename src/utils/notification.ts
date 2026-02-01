import { spawn } from "child_process";
import {
  isRunningInContainer,
  DaemonEventType,
  DaemonEventConfig,
  DaemonConfig,
} from "./config.js";
import { isDaemonAvailable, sendDaemonNotification, sendDaemonRequest } from "./daemon-client.js";

export interface NotificationOptions {
  /** The notification command from config (e.g., "ntfy pub mytopic" or "notify-send") */
  command?: string;
  /** Whether to enable debug output */
  debug?: boolean;
  /** Whether to try using daemon if available (default: true when in container) */
  useDaemon?: boolean;
  /** Daemon configuration for event-based notifications */
  daemonConfig?: DaemonConfig;
  /** Task name for task_complete events (used in message placeholders) */
  taskName?: string;
  /** Error message for error events (used in {{error}} placeholder) */
  errorMessage?: string;
}

export type NotificationEvent =
  | "prd_complete" // All PRD tasks finished
  | "iteration_complete" // Single iteration finished (ralph once)
  | "run_stopped" // Ralph run stopped (max failures, no progress, etc.)
  | "task_complete" // A single task completed
  | "error"; // An error occurred

/**
 * Send a notification using the configured notify command.
 *
 * The notification command is split by spaces, with the message appended as the last argument.
 * This supports various notification tools:
 * - ntfy: "ntfy pub mytopic" → "ntfy pub mytopic 'message'"
 * - notify-send: "notify-send Ralph" → "notify-send Ralph 'message'"
 * - terminal-notifier: "terminal-notifier -title Ralph -message" → "terminal-notifier -title Ralph -message 'message'"
 * - Custom scripts: "/path/to/notify.sh" → "/path/to/notify.sh 'message'"
 *
 * @param event The type of notification event
 * @param message Optional custom message (default message based on event)
 * @param options Notification options including the command
 * @returns Promise that resolves when notification is sent (or immediately if no command configured)
 */
export async function sendNotification(
  event: NotificationEvent,
  message?: string,
  options?: NotificationOptions,
): Promise<void> {
  const { command, debug, useDaemon } = options ?? {};

  // Generate default message based on event type
  const defaultMessages: Record<NotificationEvent, string> = {
    prd_complete: "Ralph: PRD Complete! All tasks finished.",
    iteration_complete: "Ralph: Iteration complete.",
    run_stopped: "Ralph: Run stopped.",
    task_complete: "Ralph: Task complete.",
    error: "Ralph: An error occurred.",
  };

  const finalMessage = message ?? defaultMessages[event];

  // Try daemon when in container (unless explicitly disabled)
  const shouldTryDaemon = useDaemon !== false && isRunningInContainer();

  if (shouldTryDaemon && isDaemonAvailable()) {
    if (debug) {
      console.error("[notification] Using daemon to send notification");
    }

    try {
      const response = await sendDaemonNotification(finalMessage);
      if (response.success) {
        if (debug) {
          console.error("[notification] Notification sent via daemon");
        }
        return;
      } else if (debug) {
        console.error(`[notification] Daemon notification failed: ${response.error}`);
        console.error("[notification] Falling back to direct command");
      }
    } catch (err) {
      if (debug) {
        console.error(
          `[notification] Daemon error: ${err instanceof Error ? err.message : "unknown"}`,
        );
        console.error("[notification] Falling back to direct command");
      }
    }
  }

  // No notification if command is not configured or empty
  if (!command || command.trim() === "") {
    if (debug) {
      console.error("[notification] No notifyCommand configured, skipping notification");
    }
    return;
  }

  // Split command into executable and args
  const parts = command.trim().split(/\s+/);
  const [cmd, ...cmdArgs] = parts;

  if (debug) {
    console.error(`[notification] Sending: ${cmd} ${[...cmdArgs, finalMessage].join(" ")}`);
  }

  return new Promise((resolve) => {
    // Spawn the notification process, appending the message as the last argument
    const proc = spawn(cmd, [...cmdArgs, finalMessage], {
      stdio: "ignore",
      // Don't let notification process block ralph from exiting
      detached: true,
    });

    // Unref so the parent process can exit independently
    proc.unref();

    proc.on("error", (err) => {
      if (debug) {
        console.error(`[notification] Failed to send notification: ${err.message}`);
      }
      // Don't reject - notification failures shouldn't break ralph
      resolve();
    });

    proc.on("spawn", () => {
      // Notification process started successfully
      resolve();
    });
  });
}

/**
 * Create a notifier function bound to specific options.
 * Useful for creating a reusable notifier within a command.
 */
export function createNotifier(options: NotificationOptions) {
  return (event: NotificationEvent, message?: string) => sendNotification(event, message, options);
}

/**
 * Map NotificationEvent to DaemonEventType.
 * Some events map directly, others map to the closest equivalent.
 */
function mapEventToDaemonEvent(event: NotificationEvent): DaemonEventType | null {
  switch (event) {
    case "prd_complete":
      return "ralph_complete";
    case "task_complete":
      return "task_complete";
    case "iteration_complete":
      return "iteration_complete";
    case "error":
    case "run_stopped":
      return "error";
    default:
      return null;
  }
}

/**
 * Trigger daemon event handlers for a given event.
 * This allows multiple daemon actions to be triggered for each event.
 *
 * @param event The daemon event type
 * @param options Notification options containing daemon config
 * @param context Additional context (e.g., task name for task_complete, error message for error)
 */
export async function triggerDaemonEvents(
  event: DaemonEventType,
  options?: NotificationOptions,
  context?: { taskName?: string; errorMessage?: string },
): Promise<void> {
  const { daemonConfig, debug } = options ?? {};

  // Skip if no daemon config or no events configured
  if (!daemonConfig?.events) {
    return;
  }

  const eventHandlers = daemonConfig.events[event];
  if (!eventHandlers || eventHandlers.length === 0) {
    if (debug) {
      console.error(`[daemon-events] No handlers configured for event: ${event}`);
    }
    return;
  }

  // Check if daemon is available
  if (!isDaemonAvailable()) {
    if (debug) {
      console.error("[daemon-events] Daemon not available, skipping event handlers");
    }
    return;
  }

  // Execute each event handler
  for (const handler of eventHandlers) {
    try {
      // Prepare message with placeholders replaced
      let message = handler.message || "";
      if (context?.taskName) {
        message = message.replace(/\{\{task\}\}/g, context.taskName);
      }
      if (context?.errorMessage) {
        message = message.replace(/\{\{error\}\}/g, context.errorMessage);
      }

      // Build args array
      const args = [...(handler.args || [])];
      if (message) {
        args.push(message);
      }

      if (debug) {
        console.error(
          `[daemon-events] Triggering ${event}: action=${handler.action}, args=${JSON.stringify(args)}`,
        );
      }

      const response = await sendDaemonRequest(handler.action, args);

      if (debug) {
        if (response.success) {
          console.error(`[daemon-events] Action ${handler.action} succeeded`);
        } else {
          console.error(`[daemon-events] Action ${handler.action} failed: ${response.error}`);
        }
      }
    } catch (err) {
      if (debug) {
        console.error(
          `[daemon-events] Error executing action ${handler.action}: ${err instanceof Error ? err.message : "unknown"}`,
        );
      }
      // Continue with other handlers even if one fails
    }
  }
}

/**
 * Send notification and also trigger any configured daemon events.
 * This is the recommended function to use for comprehensive notification handling.
 *
 * @param event The notification event type
 * @param message Optional custom message
 * @param options Notification options
 */
export async function sendNotificationWithDaemonEvents(
  event: NotificationEvent,
  message?: string,
  options?: NotificationOptions,
): Promise<void> {
  // Send the regular notification
  await sendNotification(event, message, options);

  // Also trigger daemon events if configured
  const daemonEvent = mapEventToDaemonEvent(event);
  if (daemonEvent) {
    await triggerDaemonEvents(daemonEvent, options, {
      taskName: options?.taskName,
      errorMessage: options?.errorMessage,
    });
  }
}
