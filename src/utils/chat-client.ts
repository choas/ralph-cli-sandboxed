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
  /** The chat provider type (e.g., "telegram", "slack") */
  provider: ChatProvider;
  /** Provider-specific settings */
  settings: TelegramSettings | SlackSettings;
}

export interface TelegramSettings {
  /** Telegram Bot API token */
  botToken: string;
  /** Allowed chat IDs (for security - only respond in these chats) */
  allowedChatIds?: string[];
}

export interface SlackSettings {
  /** Slack Bot Token (xoxb-...) - for Web API calls */
  botToken: string;
  /** Slack App Token (xapp-...) - for Socket Mode connection */
  appToken: string;
  /** Slack Signing Secret - for verifying request signatures */
  signingSecret: string;
  /** Allowed channel IDs (for security - only respond in these channels) */
  allowedChannelIds?: string[];
}

export type ChatProvider = "telegram" | "slack";

/**
 * Callback for handling incoming chat commands.
 */
export type ChatCommandHandler = (command: ChatCommand) => Promise<void>;

/**
 * Callback for handling raw messages (for custom processing).
 */
export type ChatMessageHandler = (message: ChatMessage) => Promise<void>;

/**
 * Options for sending messages (provider-specific features).
 */
export interface SendMessageOptions {
  /** Inline keyboard buttons (Telegram-specific) */
  inlineKeyboard?: InlineButton[][];
}

/**
 * Inline button for chat messages.
 */
export interface InlineButton {
  /** Button text displayed to user */
  text: string;
  /** Callback data sent when button is pressed (used as command) */
  callbackData?: string;
  /** URL to open when button is pressed */
  url?: string;
}

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
   * @param options Optional message options (e.g., inline keyboard)
   */
  sendMessage(chatId: string, text: string, options?: SendMessageOptions): Promise<void>;

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
 *
 * Supports slash commands (preferred):
 * - "/run" -> { command: "run", args: [] }
 * - "/status" -> { command: "status", args: [] }
 * - "/exec npm test" -> { command: "exec", args: ["npm", "test"] }
 * - "/add Fix the login bug" -> { command: "add", args: ["Fix", "the", "login", "bug"] }
 */
export function parseCommand(text: string, message: ChatMessage): ChatCommand | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Valid commands
  const validCommands = ["run", "status", "add", "exec", "stop", "help", "start", "action", "claude"];

  // Check for slash command format: /command [args...]
  if (trimmed.startsWith("/")) {
    const parts = trimmed.slice(1).split(/\s+/);
    if (parts.length === 0) return null;

    const [command, ...args] = parts;
    const cmd = command.toLowerCase();

    // Handle Telegram's /start command specially
    if (cmd === "start") {
      return {
        projectId: "",
        command: "help",
        args: [],
        message,
      };
    }

    if (!validCommands.includes(cmd)) {
      return null;
    }

    return {
      projectId: "",
      command: cmd,
      args,
      message,
    };
  }

  return null;
}

/**
 * Strip ANSI escape codes from a string.
 * This is useful for cleaning output before sending to chat services
 * that don't support terminal formatting.
 */
export function stripAnsiCodes(text: string): string {
  // Match ANSI escape sequences: ESC[...m (SGR), ESC[...K (EL), etc.
  return text.replace(/\x1B\[[0-9;]*[mKJHfsu]/g, "");
}

/**
 * Format status output for chat by stripping ANSI codes and removing
 * progress bars that don't render well in chat.
 */
export function formatStatusForChat(output: string): string {
  // Strip ANSI escape codes
  let cleaned = stripAnsiCodes(output);

  // Remove progress bar lines (lines with block characters ██░)
  // These don't render well in chat clients
  cleaned = cleaned
    .split("\n")
    .filter((line) => !line.includes("█") && !line.includes("░"))
    .join("\n");

  // Clean up extra blank lines that may result from removing progress bar
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  return cleaned.trim();
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
