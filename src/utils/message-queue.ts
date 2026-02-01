import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";

const MESSAGES_FILE = "messages.json";

export interface Message {
  id: string;
  from: "sandbox" | "host";
  action: string;
  args?: string[];
  timestamp: number;
  status: "pending" | "done";
  response?: {
    success: boolean;
    output?: string;
    error?: string;
  };
}

/**
 * Get the path to the messages file.
 * Uses /workspace/.ralph in container, .ralph in host.
 */
export function getMessagesPath(inContainer: boolean): string {
  if (inContainer) {
    return `/workspace/.ralph/${MESSAGES_FILE}`;
  }
  return join(process.cwd(), ".ralph", MESSAGES_FILE);
}

/**
 * Read all messages from the queue.
 */
export function readMessages(messagesPath: string): Message[] {
  if (!existsSync(messagesPath)) {
    return [];
  }
  try {
    const content = readFileSync(messagesPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

/**
 * Write messages to the queue (atomic write).
 */
export function writeMessages(messagesPath: string, messages: Message[]): void {
  const dir = dirname(messagesPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // Write to temp file first, then rename for atomic operation
  const tempPath = `${messagesPath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(messages, null, 2));
  writeFileSync(messagesPath, JSON.stringify(messages, null, 2));
}

/**
 * Initialize the messages file with a daemon_started message.
 * Called when the daemon starts.
 */
export function initializeMessages(messagesPath: string): void {
  const messages: Message[] = [
    {
      id: randomUUID(),
      from: "host",
      action: "daemon_started",
      timestamp: Date.now(),
      status: "done",
      response: {
        success: true,
        output: "Daemon is running and ready to receive messages",
      },
    },
  ];
  writeMessages(messagesPath, messages);
}

/**
 * Add a message to the queue.
 * Returns the message ID.
 */
export function sendMessage(
  messagesPath: string,
  from: "sandbox" | "host",
  action: string,
  args?: string[],
): string {
  const messages = readMessages(messagesPath);
  const id = randomUUID();

  messages.push({
    id,
    from,
    action,
    args,
    timestamp: Date.now(),
    status: "pending",
  });

  writeMessages(messagesPath, messages);
  return id;
}

export type MessageResponse = {
  success: boolean;
  output?: string;
  error?: string;
};

/**
 * Wait for a response to a message.
 * Returns the response or null if timeout.
 */
export async function waitForResponse(
  messagesPath: string,
  messageId: string,
  timeout: number = 10000,
  pollInterval: number = 100,
): Promise<MessageResponse | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const messages = readMessages(messagesPath);
    const message = messages.find((m) => m.id === messageId);

    if (message?.status === "done" && message.response) {
      // Clean up processed message
      const remaining = messages.filter((m) => m.id !== messageId);
      writeMessages(messagesPath, remaining);
      return message.response as MessageResponse;
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return null;
}

/**
 * Get pending messages for a recipient.
 */
export function getPendingMessages(messagesPath: string, from: "sandbox" | "host"): Message[] {
  const messages = readMessages(messagesPath);
  return messages.filter((m) => m.from === from && m.status === "pending");
}

/**
 * Mark a message as done with a response.
 */
export function respondToMessage(
  messagesPath: string,
  messageId: string,
  response: MessageResponse,
): boolean {
  const messages = readMessages(messagesPath);
  const message = messages.find((m) => m.id === messageId);

  if (!message) {
    return false;
  }

  message.status = "done";
  message.response = response;
  writeMessages(messagesPath, messages);
  return true;
}

/**
 * Clean up old messages (older than maxAge milliseconds).
 */
export function cleanupOldMessages(messagesPath: string, maxAge: number = 60000): number {
  const messages = readMessages(messagesPath);
  const now = Date.now();
  const remaining = messages.filter((m) => now - m.timestamp < maxAge);
  const removed = messages.length - remaining.length;

  if (removed > 0) {
    writeMessages(messagesPath, remaining);
  }

  return removed;
}
