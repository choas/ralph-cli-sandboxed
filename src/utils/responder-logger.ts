/**
 * Logger for responder calls.
 * Logs LLM requests to .ralph/logs/ for debugging and auditing.
 */

import { mkdirSync, appendFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Log entry for a responder call.
 */
export interface ResponderLogEntry {
  timestamp: string;
  responderName?: string;
  responderType?: string;
  trigger?: string;
  gitCommand?: string;
  gitDiffLength?: number;
  threadContextLength?: number;
  messageLength: number;
  message: string;
  systemPrompt?: string;
}

/**
 * Get the logs directory path (.ralph/logs).
 */
function getLogsDir(): string {
  return join(process.cwd(), ".ralph", "logs");
}

/**
 * Ensure the logs directory exists.
 */
function ensureLogsDir(): void {
  const logsDir = getLogsDir();
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
}

/**
 * Get today's log file path.
 */
function getLogFilePath(): string {
  const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  return join(getLogsDir(), `responder-${date}.log`);
}

/**
 * Format a log entry for file output.
 */
function formatLogEntry(entry: ResponderLogEntry): string {
  const lines = [
    ``,
    `================================================================================`,
    `[${entry.timestamp}] ${entry.responderName || "unknown"} (${entry.responderType || "unknown"})`,
    `================================================================================`,
  ];

  if (entry.trigger) {
    lines.push(`Trigger: ${entry.trigger}`);
  }

  if (entry.gitCommand) {
    lines.push(`Git command: ${entry.gitCommand}`);
    lines.push(`Git diff length: ${entry.gitDiffLength || 0} chars`);
  }

  if (entry.threadContextLength) {
    lines.push(`Thread context: ${entry.threadContextLength} chars`);
  }

  lines.push(`Message length: ${entry.messageLength} chars`);
  lines.push(``);

  if (entry.systemPrompt) {
    lines.push(`--- System Prompt ---`);
    lines.push(entry.systemPrompt);
    lines.push(``);
  }

  lines.push(`--- Message to LLM ---`);
  lines.push(entry.message);
  lines.push(``);

  return lines.join("\n");
}

/**
 * Log a responder call to the log file.
 */
export function logResponderCall(entry: ResponderLogEntry): void {
  try {
    ensureLogsDir();
    const logFile = getLogFilePath();
    const formatted = formatLogEntry(entry);
    appendFileSync(logFile, formatted, "utf-8");
  } catch {
    // Silently ignore logging errors to not disrupt the main flow
  }
}

/**
 * Log a responder call to console (for debug mode).
 */
export function logResponderCallToConsole(entry: ResponderLogEntry): void {
  console.log(`[responder] ${entry.responderName} (${entry.responderType})`);
  if (entry.gitCommand) {
    console.log(`[responder] Git command: ${entry.gitCommand}`);
    console.log(`[responder] Git diff: ${entry.gitDiffLength || 0} chars`);
  }
  if (entry.threadContextLength) {
    console.log(`[responder] Thread context: ${entry.threadContextLength} chars`);
  }
  console.log(`[responder] Total message: ${entry.messageLength} chars`);
  console.log(`[responder] Log file: ${getLogFilePath()}`);
}

/**
 * Create a log entry and optionally log to console.
 */
export function createResponderLog(
  options: {
    responderName?: string;
    responderType?: string;
    trigger?: string;
    gitCommand?: string;
    gitDiffLength?: number;
    threadContextLength?: number;
    message: string;
    systemPrompt?: string;
    debug?: boolean;
  },
): void {
  const entry: ResponderLogEntry = {
    timestamp: new Date().toISOString(),
    responderName: options.responderName,
    responderType: options.responderType,
    trigger: options.trigger,
    gitCommand: options.gitCommand,
    gitDiffLength: options.gitDiffLength,
    threadContextLength: options.threadContextLength,
    messageLength: options.message.length,
    message: options.message,
    systemPrompt: options.systemPrompt,
  };

  // Always log to file
  logResponderCall(entry);

  // Log to console if debug mode
  if (options.debug) {
    logResponderCallToConsole(entry);
  }
}
