/**
 * Chat client interface for communicating with external chat services.
 * This provides a unified interface for different chat providers (Telegram, Discord, Slack, etc.)
 */

export interface ChatMessage {
  /** The text content of the message */
  text: string;
  /** The chat/channel ID the message was sent in */
  chatId: string;
  /** The sender's ID (user or bot) */
  senderId?: string;
  /** The sender's display name */
  senderName?: string;
  /** Timestamp when the message was received */
  timestamp: Date;
  /** Raw message data from the provider */
  raw?: unknown;
}

export interface ChatCommand {
  /** The project ID extracted from the message (e.g., "abc" from "abc run") */
  projectId: string;
  /** The command name (e.g., "run", "status", "add", "exec") */
  command: string;
  /** Arguments passed to the command */
  args: string[];
  /** The original message */
  message: ChatMessage;
}

export interface ChatClientConfig {
  /** Whether the chat client is enabled */
  enabled: boolean;
  /** The chat provider type (e.g., "telegram") */
  provider: "telegram";
  /** Provider-specific settings */
  settings: TelegramSettings;
}

export interface TelegramSettings {
  /** Telegram Bot API token */
  botToken: string;
  /** Allowed chat IDs (for security - only respond in these chats) */
  allowedChatIds?: string[];
}

export type ChatProvider = "telegram";

/**
 * Callback for handling incoming chat commands.
 */
export type ChatCommandHandler = (command: ChatCommand) => Promise<void>;

/**
 * Callback for handling raw messages (for custom processing).
 */
export type ChatMessageHandler = (message: ChatMessage) => Promise<void>;

/**
 * Abstract interface for chat clients.
 * Implementations should handle provider-specific API calls.
 */
export interface ChatClient {
  /** The provider type */
  readonly provider: ChatProvider;

  /**
   * Connect to the chat service and start listening for messages.
   * @param onCommand Callback for parsed commands (e.g., "abc run")
   * @param onMessage Optional callback for all messages
   */
  connect(onCommand: ChatCommandHandler, onMessage?: ChatMessageHandler): Promise<void>;

  /**
   * Send a text message to a specific chat.
   * @param chatId The chat ID to send to
   * @param text The message text
   */
  sendMessage(chatId: string, text: string): Promise<void>;

  /**
   * Disconnect from the chat service.
   */
  disconnect(): Promise<void>;

  /**
   * Check if the client is currently connected.
   */
  isConnected(): boolean;
}

/**
 * Project registration for chat commands.
 * Maps project IDs to their configurations.
 */
export interface ChatProjectRegistration {
  /** Short project ID (3-digit identifier) */
  projectId: string;
  /** Full project name */
  projectName: string;
  /** Path to the project's .ralph directory */
  ralphDir: string;
  /** The chat ID where this project was registered */
  chatId: string;
  /** Timestamp when registered */
  registeredAt: Date;
}

/**
 * Generate a short project ID (3 alphanumeric characters).
 * Used to identify projects in chat commands.
 */
export function generateProjectId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 3; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Parse a chat message to extract a command.
 * Format: "<project_id> <command> [args...]"
 *
 * Examples:
 * - "abc run" -> { projectId: "abc", command: "run", args: [] }
 * - "xyz status" -> { projectId: "xyz", command: "status", args: [] }
 * - "123 exec npm test" -> { projectId: "123", command: "exec", args: ["npm", "test"] }
 * - "abc add Fix the login bug" -> { projectId: "abc", command: "add", args: ["Fix", "the", "login", "bug"] }
 */
export function parseCommand(text: string, message: ChatMessage): ChatCommand | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return null;

  const [projectId, command, ...args] = parts;

  // Project ID should be 3 alphanumeric characters
  if (!/^[a-z0-9]{3}$/i.test(projectId)) {
    return null;
  }

  // Valid commands
  const validCommands = ["run", "status", "add", "exec", "stop", "help"];
  if (!validCommands.includes(command.toLowerCase())) {
    return null;
  }

  return {
    projectId: projectId.toLowerCase(),
    command: command.toLowerCase(),
    args,
    message,
  };
}

/**
 * Format a status message for a project.
 */
export function formatStatusMessage(
  projectName: string,
  status: "running" | "idle" | "completed" | "error",
  details?: string
): string {
  const statusIcons: Record<string, string> = {
    running: "[...]",
    idle: "[_]",
    completed: "[OK]",
    error: "[X]",
  };

  const icon = statusIcons[status] || "[?]";
  let message = `${icon} ${projectName}: ${status}`;
  if (details) {
    message += `\n${details}`;
  }
  return message;
}
