import { existsSync } from "fs";
import { isRunningInContainer } from "./config.js";
import { getMessagesPath, sendMessage, waitForResponse } from "./message-queue.js";

// Re-export types for backwards compatibility
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
 * Get the appropriate messages path based on whether we're in a container or on host.
 */
export function getDaemonSocketPath(): string {
  // For backwards compatibility, return the messages path
  return getMessagesPath(isRunningInContainer());
}

/**
 * Check if the daemon is available (messages file can be written).
 */
export function isDaemonAvailable(): boolean {
  const messagesPath = getMessagesPath(isRunningInContainer());

  // In container, check if the .ralph directory is mounted
  if (isRunningInContainer()) {
    return existsSync("/workspace/.ralph");
  }

  // On host, check if .ralph directory exists
  return existsSync(messagesPath.replace("/messages.json", ""));
}

/**
 * Send a request to the daemon and get a response.
 *
 * @param action The action to execute
 * @param args Optional arguments to pass to the action
 * @param timeout Timeout in milliseconds (default: 10000)
 */
export async function sendDaemonRequest(
  action: string,
  args?: string[],
  timeout: number = 10000,
): Promise<DaemonResponse> {
  const messagesPath = getMessagesPath(isRunningInContainer());

  try {
    // Send message via file queue
    const messageId = sendMessage(messagesPath, "sandbox", action, args);

    // Wait for response
    const response = await waitForResponse(messagesPath, messageId, timeout);

    if (!response) {
      return {
        success: false,
        error: `Request timed out after ${timeout}ms. Make sure the daemon is running on the host.`,
      };
    }

    return {
      success: response.success,
      output: response.output,
      error: response.error,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to send message: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

/**
 * Send a ping to check if daemon is responsive.
 */
export async function pingDaemon(): Promise<boolean> {
  const response = await sendDaemonRequest("ping", [], 5000);
  return response.success && response.output === "pong";
}

/**
 * Send a notification through the daemon.
 *
 * @param message The notification message
 */
export async function sendDaemonNotification(message: string): Promise<DaemonResponse> {
  return sendDaemonRequest("notify", [message]);
}
