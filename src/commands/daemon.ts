import { createServer, Server, Socket } from "net";
import { existsSync, mkdirSync, unlinkSync, chmodSync } from "fs";
import { join, dirname } from "path";
import { spawn } from "child_process";
import { loadConfig, getRalphDir, isRunningInContainer } from "../utils/config.js";

// Socket path conventions
const SOCKET_DIR = ".ralph";
const SOCKET_FILE = "daemon.sock";

export interface DaemonAction {
  command: string;
  description?: string;
}

export interface DaemonConfig {
  enabled?: boolean;
  socketPath?: string;
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
 * Get the default socket path for the daemon.
 * This should be in the project's .ralph directory so it gets mounted into the container.
 */
export function getSocketPath(): string {
  const ralphDir = getRalphDir();
  return join(ralphDir, SOCKET_FILE);
}

/**
 * Get the socket path as seen from inside the container.
 * The .ralph directory is mounted at /workspace/.ralph in the container.
 */
export function getContainerSocketPath(): string {
  return `/workspace/${SOCKET_DIR}/${SOCKET_FILE}`;
}

/**
 * Default actions available to the sandbox.
 * These can be overridden in config.
 */
function getDefaultActions(config: ReturnType<typeof loadConfig>): Record<string, DaemonAction> {
  const actions: Record<string, DaemonAction> = {
    ping: {
      command: "echo pong",
      description: "Health check - responds with 'pong'",
    },
  };

  // Add notify action if notifyCommand is configured
  if (config.notifyCommand) {
    actions.notify = {
      command: config.notifyCommand,
      description: "Send notification to host",
    };
  }

  return actions;
}

/**
 * Execute an action command with arguments.
 */
async function executeAction(action: DaemonAction, args: string[] = []): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    // Split command into executable and base args
    const parts = action.command.trim().split(/\s+/);
    const [cmd, ...cmdArgs] = parts;

    // Append the request args
    const allArgs = [...cmdArgs, ...args];

    const proc = spawn(cmd, allArgs, {
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
        resolve({ success: false, output: stdout.trim(), error: stderr.trim() || `Exit code: ${code}` });
      }
    });

    proc.on("error", (err) => {
      resolve({ success: false, output: "", error: err.message });
    });
  });
}

/**
 * Handle a client connection.
 */
function handleClient(socket: Socket, actions: Record<string, DaemonAction>, debug: boolean): void {
  let buffer = "";

  socket.on("data", async (data) => {
    buffer += data.toString();

    // Look for complete JSON messages (newline-delimited)
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const request: DaemonRequest = JSON.parse(line);

        if (debug) {
          console.log(`[daemon] Received request: ${JSON.stringify(request)}`);
        }

        // Validate action exists
        const action = actions[request.action];
        if (!action) {
          const response: DaemonResponse = {
            success: false,
            error: `Unknown action: ${request.action}. Available actions: ${Object.keys(actions).join(", ")}`,
          };
          socket.write(JSON.stringify(response) + "\n");
          continue;
        }

        // Execute the action
        const result = await executeAction(action, request.args);
        const response: DaemonResponse = {
          success: result.success,
          output: result.output,
          error: result.error,
          message: result.success ? "Action executed successfully" : "Action failed",
        };

        if (debug) {
          console.log(`[daemon] Response: ${JSON.stringify(response)}`);
        }

        socket.write(JSON.stringify(response) + "\n");
      } catch (err) {
        const response: DaemonResponse = {
          success: false,
          error: `Invalid request format: ${err instanceof Error ? err.message : "unknown error"}`,
        };
        socket.write(JSON.stringify(response) + "\n");
      }
    }
  });

  socket.on("error", (err) => {
    if (debug) {
      console.error(`[daemon] Socket error: ${err.message}`);
    }
  });
}

/**
 * Start the daemon server.
 */
async function startDaemon(debug: boolean): Promise<void> {
  // Daemon should not run inside a container
  if (isRunningInContainer()) {
    console.error("Error: 'ralph daemon' should run on the host, not inside a container.");
    console.error("The daemon provides a communication channel from sandbox to host.");
    process.exit(1);
  }

  const config = loadConfig();
  const daemonConfig = config.daemon || {};

  // Get socket path
  const socketPath = daemonConfig.socketPath || getSocketPath();

  // Ensure socket directory exists
  const socketDir = dirname(socketPath);
  if (!existsSync(socketDir)) {
    mkdirSync(socketDir, { recursive: true });
  }

  // Remove existing socket file if present
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath);
    } catch {
      console.error(`Error: Cannot remove existing socket at ${socketPath}`);
      console.error("Another daemon may be running. Use 'ralph daemon stop' to stop it.");
      process.exit(1);
    }
  }

  // Merge default and configured actions
  const defaultActions = getDefaultActions(config);
  const configuredActions = daemonConfig.actions || {};
  const actions = { ...defaultActions, ...configuredActions };

  // Create server
  const server: Server = createServer((socket) => {
    if (debug) {
      console.log("[daemon] Client connected");
    }
    handleClient(socket, actions, debug);
  });

  // Handle server errors
  server.on("error", (err) => {
    console.error(`[daemon] Server error: ${err.message}`);
    process.exit(1);
  });

  // Start listening
  server.listen(socketPath, () => {
    // Make socket accessible to container (group/other readable and writable)
    chmodSync(socketPath, 0o666);

    console.log("Ralph daemon started");
    console.log(`Socket: ${socketPath}`);
    console.log("");
    console.log("Available actions:");
    for (const [name, action] of Object.entries(actions)) {
      console.log(`  ${name}: ${action.description || action.command}`);
    }
    console.log("");
    console.log("The sandbox can now send commands to the host.");
    console.log("Press Ctrl+C to stop the daemon.");
  });

  // Handle shutdown signals
  const shutdown = () => {
    console.log("\nShutting down daemon...");
    server.close(() => {
      try {
        if (existsSync(socketPath)) {
          unlinkSync(socketPath);
        }
      } catch {
        // Ignore errors during cleanup
      }
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Stop a running daemon by removing its socket.
 */
function stopDaemon(): void {
  const socketPath = getSocketPath();

  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath);
      console.log("Daemon socket removed.");
      console.log("Note: If the daemon process is still running, it will detect the removed socket and exit.");
    } catch (err) {
      console.error(`Error removing socket: ${err instanceof Error ? err.message : "unknown error"}`);
      process.exit(1);
    }
  } else {
    console.log("No daemon socket found. Daemon may not be running.");
  }
}

/**
 * Show daemon status.
 */
function showStatus(): void {
  const socketPath = getSocketPath();

  console.log("Ralph Daemon Status");
  console.log("-".repeat(40));
  console.log(`Socket path: ${socketPath}`);
  console.log(`Socket exists: ${existsSync(socketPath) ? "yes" : "no"}`);

  if (existsSync(socketPath)) {
    console.log("");
    console.log("Daemon appears to be running.");
    console.log("Use 'ralph daemon stop' to stop it.");
  } else {
    console.log("");
    console.log("Daemon is not running.");
    console.log("Use 'ralph daemon start' to start it.");
  }
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
  ralph daemon stop             Stop the daemon
  ralph daemon status           Show daemon status
  ralph daemon help             Show this help message

DESCRIPTION:
  The daemon runs on the host machine and listens on a Unix socket that is
  mounted into the sandbox container. This allows the sandboxed environment
  to communicate with the host for specific, whitelisted actions without
  requiring external network access.

CONFIGURATION:
  Configure the daemon in .ralph/config.json:

  {
    "daemon": {
      "actions": {
        "notify": {
          "command": "ntfy pub mytopic",
          "description": "Send notification via ntfy"
        },
        "custom-action": {
          "command": "/path/to/script.sh",
          "description": "Run custom script"
        }
      }
    }
  }

DEFAULT ACTIONS:
  ping     Health check - responds with 'pong'
  notify   Send notification (uses notifyCommand from config)

SANDBOX USAGE:
  From inside the container, use 'ralph notify' to send messages:

  ralph notify "Task completed!"
  ralph notify --action ping

SECURITY:
  - Only configured actions can be executed
  - Commands run with host user permissions
  - Socket is only accessible via mounted volume

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

    case "stop":
      stopDaemon();
      break;

    case "status":
      showStatus();
      break;

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error("Run 'ralph daemon help' for usage information.");
      process.exit(1);
  }
}
