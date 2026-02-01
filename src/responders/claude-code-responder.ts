/**
 * Claude Code Responder - Spawns Claude Code CLI with user prompts.
 * Executes Claude Code in --dangerously-skip-permissions mode to run autonomously.
 */

import { spawn, ChildProcess } from "child_process";
import { ResponderConfig } from "../utils/config.js";
import { ResponderResult, truncateResponse } from "./llm-responder.js";

/**
 * Options for executing a Claude Code responder.
 */
export interface ClaudeCodeResponderOptions {
  /** Callback for progress updates during execution */
  onProgress?: (output: string) => void;
  /** Override default timeout in milliseconds */
  timeout?: number;
  /** Maximum response length in characters */
  maxLength?: number;
  /** Working directory for Claude Code execution */
  cwd?: string;
}

/**
 * Default timeout for Claude Code execution (5 minutes).
 */
const DEFAULT_TIMEOUT = 300000;

/**
 * Default max length for chat responses (characters).
 */
const DEFAULT_MAX_LENGTH = 2000;

/**
 * Interval for sending progress updates (milliseconds).
 */
const PROGRESS_INTERVAL = 5000;

/**
 * Executes Claude Code with the given prompt.
 *
 * Spawns the claude CLI with:
 * - -p flag for non-interactive prompt mode
 * - --dangerously-skip-permissions to skip all permission prompts
 * - --print to get clean output
 *
 * @param prompt The user prompt to send to Claude Code
 * @param responderConfig The responder configuration
 * @param options Optional execution options
 * @returns The responder result with response or error
 */
export async function executeClaudeCodeResponder(
  prompt: string,
  responderConfig: ResponderConfig,
  options?: ClaudeCodeResponderOptions
): Promise<ResponderResult> {
  const timeout = options?.timeout ?? responderConfig.timeout ?? DEFAULT_TIMEOUT;
  const maxLength = options?.maxLength ?? responderConfig.maxLength ?? DEFAULT_MAX_LENGTH;
  const cwd = options?.cwd ?? process.cwd();
  const onProgress = options?.onProgress;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let killed = false;
    let lastProgressSent = 0;
    let progressTimer: NodeJS.Timeout | null = null;

    // Build the command arguments
    const args = [
      "-p",
      prompt,
      "--dangerously-skip-permissions",
      "--print",
    ];

    // Spawn claude process
    let proc: ChildProcess;
    try {
      proc = spawn("claude", args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      resolve({
        success: false,
        response: "",
        error: `Failed to spawn claude: ${error}`,
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
        error: `Claude Code timed out after ${Math.round(timeout / 1000)} seconds`,
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
          onProgress(`⏳ Working... ${truncatedLine}`);
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
        const output = formatClaudeCodeOutput(stdout);
        const { text, truncated, originalLength } = truncateResponse(output, maxLength);

        resolve({
          success: true,
          response: text,
          truncated,
          originalLength: truncated ? originalLength : undefined,
        });
      } else {
        // Failure
        const errorMsg = stderr.trim() || `Claude Code exited with code ${code}`;
        resolve({
          success: false,
          response: stdout,
          error: errorMsg,
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
        error: `Claude Code error: ${err.message}`,
      });
    });
  });
}

/**
 * Formats Claude Code output for chat display.
 * Cleans up ANSI codes, excessive whitespace, and formats for readability.
 */
function formatClaudeCodeOutput(output: string): string {
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
    return "(Claude Code completed with no output)";
  }

  return cleaned;
}

/**
 * Creates a reusable Claude Code responder function.
 * This is useful for handling multiple messages with the same configuration.
 *
 * @param responderConfig The responder configuration
 * @returns A function that executes the responder with a prompt
 */
export function createClaudeCodeResponder(
  responderConfig: ResponderConfig
): (prompt: string, options?: ClaudeCodeResponderOptions) => Promise<ResponderResult> {
  return async (
    prompt: string,
    options?: ClaudeCodeResponderOptions
  ): Promise<ResponderResult> => {
    return executeClaudeCodeResponder(prompt, responderConfig, options);
  };
}

/**
 * Validates that a responder configuration is valid for Claude Code execution.
 *
 * @param responderConfig The responder configuration to validate
 * @returns An error message if invalid, or null if valid
 */
export function validateClaudeCodeResponder(
  responderConfig: ResponderConfig
): string | null {
  if (responderConfig.type !== "claude-code") {
    return `Responder type is "${responderConfig.type}", expected "claude-code"`;
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
