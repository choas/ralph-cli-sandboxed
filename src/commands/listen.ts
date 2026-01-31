/**
 * Listen command - runs in sandbox to process commands from host.
 * This enables Telegram/chat commands to execute inside the container.
 */

import { spawn } from "child_process";
import { existsSync, readFileSync, unlinkSync, watch, FSWatcher } from "fs";
import { isRunningInContainer } from "../utils/config.js";
import {
  getMessagesPath,
  getPendingMessages,
  respondToMessage,
  cleanupOldMessages,
  Message,
} from "../utils/message-queue.js";

const RUN_PID_FILE = "/workspace/.ralph/run.pid";

/**
 * Check if a ralph run process is currently running.
 * Returns the PID if running, null otherwise.
 */
function getRunningPid(): number | null {
  if (!existsSync(RUN_PID_FILE)) {
    return null;
  }

  try {
    const pid = parseInt(readFileSync(RUN_PID_FILE, "utf-8").trim(), 10);
    if (isNaN(pid)) {
      return null;
    }

    // Check if process is still alive
    try {
      process.kill(pid, 0); // Signal 0 just checks if process exists
      return pid;
    } catch {
      // Process doesn't exist, clean up stale PID file
      try {
        unlinkSync(RUN_PID_FILE);
      } catch {
        // Ignore cleanup errors
      }
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Stop a running ralph run process by PID.
 * Returns true if successfully stopped, false otherwise.
 */
function stopRunningProcess(pid: number): { success: boolean; error?: string } {
  try {
    // Kill the process group (negative PID) to also kill child processes (claude)
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // If process group kill fails, try killing just the process
      process.kill(pid, "SIGTERM");
    }

    // Give it a moment to terminate gracefully
    setTimeout(() => {
      try {
        // Check if still alive and force kill if necessary
        process.kill(pid, 0);
        process.kill(-pid, "SIGKILL");
      } catch {
        // Already dead, good
      }
    }, 2000);

    // Clean up PID file
    try {
      unlinkSync(RUN_PID_FILE);
    } catch {
      // Ignore
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to stop process: ${err}` };
  }
}

/**
 * Execute a shell command and return the result.
 */
async function executeCommand(
  command: string,
  timeout: number = 60000
): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn("sh", ["-c", command], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: "/workspace",
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      proc.kill();
      resolve({
        success: false,
        output: stdout,
        error: "Command timed out after 60 seconds",
      });
    }, timeout);

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (killed) return;
      clearTimeout(timer);

      if (code === 0) {
        resolve({ success: true, output: stdout.trim() || "(no output)" });
      } else {
        resolve({
          success: false,
          output: stdout.trim(),
          error: stderr.trim() || `Exit code: ${code}`,
        });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ success: false, output: "", error: err.message });
    });
  });
}

/**
 * Process a message from the host.
 */
async function processMessage(
  message: Message,
  messagesPath: string,
  debug: boolean
): Promise<void> {
  const { action, args } = message;

  if (debug) {
    console.log(`[listen] Processing: ${action} ${args?.join(" ") || ""}`);
  }

  switch (action) {
    case "exec": {
      const command = args?.join(" ") || "";
      if (!command) {
        respondToMessage(messagesPath, message.id, {
          success: false,
          error: "No command provided",
        });
        return;
      }

      console.log(`[listen] Executing: ${command}`);
      const result = await executeCommand(command);

      // Truncate long output
      let output = result.output;
      if (output.length > 4000) {
        output = output.substring(0, 4000) + "\n...(truncated)";
      }

      respondToMessage(messagesPath, message.id, {
        success: result.success,
        output,
        error: result.error,
      });

      if (debug) {
        console.log(`[listen] Result: ${result.success ? "OK" : "FAILED"}`);
      }
      break;
    }

    case "run": {
      // Check if ralph run is already running
      const existingPid = getRunningPid();
      if (existingPid) {
        console.log(`[listen] Ralph run already running (PID ${existingPid})`);
        respondToMessage(messagesPath, message.id, {
          success: false,
          error: `Ralph run is already running (PID ${existingPid}). Use /stop to terminate it first.`,
        });
        return;
      }

      // Start ralph run in background
      // Support optional category filter: run [category]
      const runArgs = ["run"];
      if (message.args && message.args.length > 0) {
        runArgs.push("--category", message.args[0]);
        console.log(`[listen] Starting ralph run with category: ${message.args[0]}...`);
      } else {
        console.log("[listen] Starting ralph run...");
      }
      const proc = spawn("ralph", runArgs, {
        stdio: "inherit",
        cwd: "/workspace",
        detached: true,
      });
      proc.unref();

      respondToMessage(messagesPath, message.id, {
        success: true,
        output: message.args?.length ? `Ralph run started (category: ${message.args[0]})` : "Ralph run started",
      });
      break;
    }

    case "stop": {
      // Stop a running ralph run process
      const runningPid = getRunningPid();
      if (!runningPid) {
        respondToMessage(messagesPath, message.id, {
          success: true,
          output: "No ralph run process is currently running.",
        });
        return;
      }

      console.log(`[listen] Stopping ralph run (PID ${runningPid})...`);
      const stopResult = stopRunningProcess(runningPid);

      if (stopResult.success) {
        respondToMessage(messagesPath, message.id, {
          success: true,
          output: `Stopped ralph run (PID ${runningPid})`,
        });
      } else {
        respondToMessage(messagesPath, message.id, {
          success: false,
          error: stopResult.error,
        });
      }
      break;
    }

    case "status": {
      // Get PRD status
      const result = await executeCommand("ralph status");
      respondToMessage(messagesPath, message.id, {
        success: result.success,
        output: result.output,
        error: result.error,
      });
      break;
    }

    case "ping": {
      respondToMessage(messagesPath, message.id, {
        success: true,
        output: "pong from sandbox",
      });
      break;
    }

    case "claude": {
      // Run Claude Code with the provided prompt in YOLO mode
      const prompt = args?.join(" ") || "";
      if (!prompt) {
        respondToMessage(messagesPath, message.id, {
          success: false,
          error: "No prompt provided",
        });
        return;
      }

      console.log(`[listen] Running Claude Code with prompt: ${prompt.substring(0, 50)}...`);

      // Build the command: claude -p "prompt" --dangerously-skip-permissions
      // Using --print to get non-interactive output
      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      const command = `claude -p '${escapedPrompt}' --dangerously-skip-permissions --print`;

      // Run with 5 minute timeout
      const result = await executeCommand(command, 300000);

      // Truncate long output
      let output = result.output;
      if (output.length > 4000) {
        output = output.substring(0, 4000) + "\n...(truncated)";
      }

      respondToMessage(messagesPath, message.id, {
        success: result.success,
        output,
        error: result.error,
      });

      if (debug) {
        console.log(`[listen] Claude Code result: ${result.success ? "OK" : "FAILED"}`);
      }
      break;
    }

    default:
      respondToMessage(messagesPath, message.id, {
        success: false,
        error: `Unknown action: ${action}. Supported: exec, run, stop, status, ping, claude`,
      });
  }
}

/**
 * Start listening for messages from host.
 */
async function startListening(debug: boolean): Promise<void> {
  const messagesPath = getMessagesPath(true); // true = in container
  const ralphDir = "/workspace/.ralph";

  console.log("Ralph Sandbox Listener");
  console.log("-".repeat(40));
  console.log(`Messages file: ${messagesPath}`);
  console.log("");
  console.log("Listening for commands from host...");
  console.log("Supported actions: exec, run, stop, status, ping, claude");
  console.log("");
  console.log("Press Ctrl+C to stop.");

  // Process any pending messages on startup
  const pending = getPendingMessages(messagesPath, "host");
  for (const msg of pending) {
    await processMessage(msg, messagesPath, debug);
  }

  // Watch for file changes
  let processing = false;
  let watcher: FSWatcher | null = null;

  const checkMessages = async () => {
    if (processing) return;
    processing = true;

    try {
      const pending = getPendingMessages(messagesPath, "host");
      for (const msg of pending) {
        await processMessage(msg, messagesPath, debug);
      }

      // Cleanup old messages periodically
      cleanupOldMessages(messagesPath, 300000); // 5 minutes
    } catch (err) {
      if (debug) {
        console.error(`[listen] Error: ${err}`);
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

  // Also poll periodically as backup
  const pollInterval = setInterval(checkMessages, 1000);

  // Handle shutdown
  const shutdown = () => {
    console.log("\nStopping listener...");
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
 * Main listen command handler.
 */
export async function listen(args: string[]): Promise<void> {
  const debug = args.includes("--debug") || args.includes("-d");

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
ralph listen - Listen for commands from host (run inside sandbox)

USAGE:
  ralph listen [--debug]  Start listening for host commands

DESCRIPTION:
  This command runs inside the sandbox container and listens for
  commands sent from the host via the message queue. It enables
  remote control of the sandbox via Telegram or other chat clients.

  The host sends commands to .ralph/messages.json, and this listener
  processes them and writes responses back.

SUPPORTED ACTIONS:
  exec [cmd]     Execute a shell command in the sandbox
  run            Start ralph run (fails if already running)
  stop           Stop a running ralph run process
  status         Get PRD status
  ping           Health check
  claude [prompt] Run Claude Code with prompt (YOLO mode)

SETUP:
  1. Start the daemon on the host: ralph daemon start
  2. Start the chat client: ralph chat start
  3. Inside the container, start the listener: ralph listen
  4. Send commands via Telegram: /exec npm test

EXAMPLE:
  # Inside the container
  ralph listen --debug
`);
    return;
  }

  // Warn if not in container (but allow for testing)
  if (!isRunningInContainer()) {
    console.warn("Warning: ralph listen is designed to run inside a container.");
    console.warn("Running on host for testing purposes...");
    console.warn("");
  }

  await startListening(debug);
}
