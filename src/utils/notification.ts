import { spawn } from "child_process";

export interface NotificationOptions {
  /** The notification command from config (e.g., "ntfy pub mytopic" or "notify-send") */
  command?: string;
  /** Whether to enable debug output */
  debug?: boolean;
}

export type NotificationEvent =
  | "prd_complete"      // All PRD tasks finished
  | "iteration_complete" // Single iteration finished (ralph once)
  | "run_stopped"       // Ralph run stopped (max failures, no progress, etc.)
  | "error";            // An error occurred

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
export function sendNotification(
  event: NotificationEvent,
  message?: string,
  options?: NotificationOptions
): Promise<void> {
  return new Promise((resolve) => {
    const { command, debug } = options ?? {};

    // No notification if command is not configured or empty
    if (!command || command.trim() === "") {
      if (debug) {
        console.error("[notification] No notifyCommand configured, skipping notification");
      }
      resolve();
      return;
    }

    // Generate default message based on event type
    const defaultMessages: Record<NotificationEvent, string> = {
      prd_complete: "Ralph: PRD Complete! All tasks finished.",
      iteration_complete: "Ralph: Iteration complete.",
      run_stopped: "Ralph: Run stopped.",
      error: "Ralph: An error occurred.",
    };

    const finalMessage = message ?? defaultMessages[event];

    // Split command into executable and args
    const parts = command.trim().split(/\s+/);
    const [cmd, ...cmdArgs] = parts;

    if (debug) {
      console.error(`[notification] Sending: ${cmd} ${[...cmdArgs, finalMessage].join(" ")}`);
    }

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
  return (event: NotificationEvent, message?: string) =>
    sendNotification(event, message, options);
}
