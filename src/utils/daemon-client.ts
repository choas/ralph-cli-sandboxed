import { createConnection, Socket } from "net";
import { existsSync } from "fs";
import { getContainerSocketPath, getSocketPath, DaemonRequest, DaemonResponse } from "../commands/daemon.js";
import { isRunningInContainer } from "./config.js";

/**
 * Get the appropriate socket path based on whether we're in a container or on host.
 */
export function getDaemonSocketPath(): string {
  if (isRunningInContainer()) {
    return getContainerSocketPath();
  }
  return getSocketPath();
}

/**
 * Check if the daemon is available (socket exists).
 */
export function isDaemonAvailable(): boolean {
  const socketPath = getDaemonSocketPath();
  return existsSync(socketPath);
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
  timeout: number = 10000
): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const socketPath = getDaemonSocketPath();

    // Check if socket exists
    if (!existsSync(socketPath)) {
      resolve({
        success: false,
        error: `Daemon not available. Socket not found at ${socketPath}. Start the daemon on the host with 'ralph daemon start'.`,
      });
      return;
    }

    let socket: Socket | null = null;
    let timeoutId: NodeJS.Timeout | null = null;
    let buffer = "";
    let resolved = false;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (socket) {
        socket.destroy();
        socket = null;
      }
    };

    const resolveOnce = (response: DaemonResponse) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(response);
      }
    };

    // Set timeout
    timeoutId = setTimeout(() => {
      resolveOnce({
        success: false,
        error: `Request timed out after ${timeout}ms`,
      });
    }, timeout);

    // Connect to daemon
    socket = createConnection(socketPath);

    socket.on("connect", () => {
      const request: DaemonRequest = { action, args };
      socket!.write(JSON.stringify(request) + "\n");
    });

    socket.on("data", (data) => {
      buffer += data.toString();

      // Look for complete response (newline-delimited JSON)
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex !== -1) {
        const jsonStr = buffer.substring(0, newlineIndex);
        try {
          const response: DaemonResponse = JSON.parse(jsonStr);
          resolveOnce(response);
        } catch {
          resolveOnce({
            success: false,
            error: `Invalid response from daemon: ${jsonStr}`,
          });
        }
      }
    });

    socket.on("error", (err) => {
      resolveOnce({
        success: false,
        error: `Connection error: ${err.message}`,
      });
    });

    socket.on("close", () => {
      if (!resolved) {
        resolveOnce({
          success: false,
          error: "Connection closed before receiving response",
        });
      }
    });
  });
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
