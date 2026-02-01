/**
 * CLI Responder - Executes configured CLI commands with user messages.
 * Useful for integrating with aider, custom scripts, or other AI CLIs.
 */

import { spawn, ChildProcess } from "child_process";
import { ResponderConfig } from "../utils/config.js";
import { ResponderResult, truncateResponse } from "./llm-responder.js";

/**
 * Options for executing a CLI responder.
 */
export interface CLIResponderOptions {
  /** Callback for progress updates during execution */
  onProgress?: (output: string) => void;
  /** Override default timeout in milliseconds */
  timeout?: number;
  /** Maximum response length in characters */
  maxLength?: number;
  /** Working directory for command execution */
  cwd?: string;
  /** Additional environment variables */
  env?: Record<string, string>;
}

/**
 * Default timeout for CLI execution (2 minutes).
 */
const DEFAULT_TIMEOUT = 120000;

/**
 * Default max length for chat responses (characters).
 */
const DEFAULT_MAX_LENGTH = 2000;

/**
 * Interval for sending progress updates (milliseconds).
 */
const PROGRESS_INTERVAL = 5000;

/**
 * Replaces {{message}} placeholder in command string with the actual message.
 * Escapes the message to prevent shell injection.
 */
export function replaceMessagePlaceholder(command: string, message: string): string {
  // Escape single quotes in the message for safe shell interpolation
  const escapedMessage = message.replace(/'/g, "'\\''");
  return command.replace(/\{\{message\}\}/g, escapedMessage);
}

/**
 * Parses a command string into command and arguments.
 * Handles quoted strings and basic shell syntax.
 */
export function parseCommand(commandString: string): { command: string; args: string[] } {
  const tokens: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;

  for (let i = 0; i < commandString.length; i++) {
    const char = commandString[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === " " && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  const [command, ...args] = tokens;
  return { command: command || "", args };
}

/**
 * Executes a CLI command with the given message.
 *
 * The command string can include {{message}} placeholder which will be replaced
 * with the user's message. If no placeholder is present, the message is appended
 * as an argument.
 *
 * @param message The user message to include in the command
 * @param responderConfig The responder configuration
 * @param options Optional execution options
 * @returns The responder result with response or error
 */
export async function executeCLIResponder(
  message: string,
  responderConfig: ResponderConfig,
  options?: CLIResponderOptions
): Promise<ResponderResult> {
  const timeout = options?.timeout ?? responderConfig.timeout ?? DEFAULT_TIMEOUT;
  const maxLength = options?.maxLength ?? responderConfig.maxLength ?? DEFAULT_MAX_LENGTH;
  const cwd = options?.cwd ?? process.cwd();
  const onProgress = options?.onProgress;
  const additionalEnv = options?.env ?? {};

  // Get command from config
  const commandTemplate = responderConfig.command;
  if (!commandTemplate) {
    return {
      success: false,
      response: "",
      error: "CLI responder requires a 'command' field in configuration",
    };
  }

  // Replace {{message}} placeholder or append message as argument
  let commandString: string;
  if (commandTemplate.includes("{{message}}")) {
    commandString = replaceMessagePlaceholder(commandTemplate, message);
  } else {
    // Append message as a quoted argument
    const escapedMessage = message.replace(/'/g, "'\\''");
    commandString = `${commandTemplate} '${escapedMessage}'`;
  }

  // Parse the command string
  const { command, args } = parseCommand(commandString);

  if (!command) {
    return {
      success: false,
      response: "",
      error: "Failed to parse command from configuration",
    };
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let killed = false;
    let lastProgressSent = 0;
    let progressTimer: NodeJS.Timeout | null = null;

    // Spawn the process
    let proc: ChildProcess;
    try {
      proc = spawn(command, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        env: { ...process.env, ...additionalEnv },
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      resolve({
        success: false,
        response: "",
        error: `Failed to spawn command "${command}": ${error}`,
      });
      return;
    }

    // Handle timeout
    const timeoutTimer = setTimeout(() => {
      killed = true;
      proc.kill("SIGTERM");

      // Give it a moment to terminate gracefully, then force kill
      setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // Already dead
        }
      }, 2000);

      if (progressTimer) {
        clearInterval(progressTimer);
      }

      resolve({
        success: false,
        response: stdout,
        error: `Command timed out after ${Math.round(timeout / 1000)} seconds`,
      });
    }, timeout);

    // Set up progress updates
    if (onProgress) {
      progressTimer = setInterval(() => {
        const now = Date.now();
        if (now - lastProgressSent >= PROGRESS_INTERVAL && stdout.length > 0) {
          // Send a progress indicator
          const lines = stdout.split("\n");
          const lastLine = lines[lines.length - 1] || lines[lines.length - 2] || "";
          const truncatedLine = lastLine.length > 100
            ? lastLine.substring(0, 100) + "..."
            : lastLine;
          onProgress(`⏳ Running... ${truncatedLine}`);
          lastProgressSent = now;
        }
      }, PROGRESS_INTERVAL);
    }

    // Capture stdout
    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    // Capture stderr
    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    // Handle process completion
    proc.on("close", (code: number | null) => {
      if (killed) return;

      clearTimeout(timeoutTimer);
      if (progressTimer) {
        clearInterval(progressTimer);
      }

      if (code === 0 || code === null) {
        // Success - format and truncate output
        const output = formatCLIOutput(stdout, stderr);
        const { text, truncated, originalLength } = truncateResponse(output, maxLength);

        resolve({
          success: true,
          response: text,
          truncated,
          originalLength: truncated ? originalLength : undefined,
        });
      } else {
        // Failure - include stderr in error message
        const errorMsg = stderr.trim() || `Command exited with code ${code}`;
        const output = formatCLIOutput(stdout, "");
        const { text, truncated, originalLength } = truncateResponse(output, maxLength);

        resolve({
          success: false,
          response: text,
          error: errorMsg,
          truncated,
          originalLength: truncated ? originalLength : undefined,
        });
      }
    });

    // Handle spawn errors
    proc.on("error", (err: Error) => {
      if (killed) return;

      clearTimeout(timeoutTimer);
      if (progressTimer) {
        clearInterval(progressTimer);
      }

      resolve({
        success: false,
        response: "",
        error: `Command error: ${err.message}`,
      });
    });
  });
}

/**
 * Formats CLI output for chat display.
 * Cleans up ANSI codes, excessive whitespace, and combines stdout/stderr.
 */
function formatCLIOutput(stdout: string, stderr: string): string {
  // Combine stdout and stderr
  let output = stdout;
  if (stderr.trim()) {
    output = output.trim() + "\n\n[stderr]\n" + stderr.trim();
  }

  // Remove ANSI escape codes
  let cleaned = output.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");

  // Remove carriage returns (used for progress overwriting)
  cleaned = cleaned.replace(/\r/g, "");

  // Collapse multiple blank lines into one
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  // Trim leading/trailing whitespace
  cleaned = cleaned.trim();

  // If output is empty, provide a default message
  if (!cleaned) {
    return "(Command completed with no output)";
  }

  return cleaned;
}

/**
 * Creates a reusable CLI responder function.
 * This is useful for handling multiple messages with the same configuration.
 *
 * @param responderConfig The responder configuration
 * @returns A function that executes the responder with a message
 */
export function createCLIResponder(
  responderConfig: ResponderConfig
): (message: string, options?: CLIResponderOptions) => Promise<ResponderResult> {
  return async (
    message: string,
    options?: CLIResponderOptions
  ): Promise<ResponderResult> => {
    return executeCLIResponder(message, responderConfig, options);
  };
}

/**
 * Validates that a responder configuration is valid for CLI execution.
 *
 * @param responderConfig The responder configuration to validate
 * @returns An error message if invalid, or null if valid
 */
export function validateCLIResponder(
  responderConfig: ResponderConfig
): string | null {
  if (responderConfig.type !== "cli") {
    return `Responder type is "${responderConfig.type}", expected "cli"`;
  }

  if (!responderConfig.command) {
    return "CLI responder requires a 'command' field";
  }

  if (typeof responderConfig.command !== "string") {
    return "CLI responder 'command' field must be a string";
  }

  // Check that timeout is reasonable if specified
  if (responderConfig.timeout !== undefined) {
    if (responderConfig.timeout < 1000) {
      return `Timeout ${responderConfig.timeout}ms is too short (minimum: 1000ms)`;
    }
    if (responderConfig.timeout > 600000) {
      return `Timeout ${responderConfig.timeout}ms is too long (maximum: 600000ms / 10 minutes)`;
    }
  }

  return null;
}
