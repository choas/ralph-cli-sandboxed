/**
 * Telegram chat client implementation.
 * Uses the Telegram Bot API with long polling to receive messages.
 */

import https from "https";
import {
  ChatClient,
  ChatCommand,
  ChatCommandHandler,
  ChatMessage,
  ChatMessageHandler,
  TelegramSettings,
  parseCommand,
} from "../utils/chat-client.js";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
      title?: string;
      username?: string;
    };
    date: number;
    text?: string;
  };
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export class TelegramChatClient implements ChatClient {
  readonly provider = "telegram" as const;

  private settings: TelegramSettings;
  private connected = false;
  private polling = false;
  private lastUpdateId = 0;
  private pollingTimeout: NodeJS.Timeout | null = null;
  private debug: boolean;

  constructor(settings: TelegramSettings, debug = false) {
    this.settings = settings;
    this.debug = debug;
  }

  /**
   * Make a request to the Telegram Bot API.
   */
  private async apiRequest<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = `https://api.telegram.org/bot${this.settings.botToken}/${method}`;

      const options: https.RequestOptions = {
        method: body ? "POST" : "GET",
        headers: body
          ? {
              "Content-Type": "application/json",
            }
          : undefined,
      };

      const req = https.request(url, options, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            const response: TelegramApiResponse<T> = JSON.parse(data);
            if (response.ok && response.result !== undefined) {
              resolve(response.result);
            } else {
              reject(
                new Error(
                  `Telegram API error: ${response.description || "Unknown error"} (code: ${response.error_code})`
                )
              );
            }
          } catch (err) {
            reject(new Error(`Failed to parse Telegram response: ${data}`));
          }
        });
      });

      req.on("error", (err) => {
        reject(new Error(`Telegram request failed: ${err.message}`));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  /**
   * Check if a chat ID is allowed.
   */
  private isChatAllowed(chatId: string): boolean {
    // If no allowed chat IDs specified, allow all
    if (!this.settings.allowedChatIds || this.settings.allowedChatIds.length === 0) {
      return true;
    }
    return this.settings.allowedChatIds.includes(chatId);
  }

  /**
   * Start long polling for updates.
   */
  private async poll(onCommand: ChatCommandHandler, onMessage?: ChatMessageHandler): Promise<void> {
    if (!this.polling) return;

    try {
      const updates = await this.apiRequest<TelegramUpdate[]>("getUpdates", {
        offset: this.lastUpdateId + 1,
        timeout: 30, // Long polling timeout in seconds
      });

      for (const update of updates) {
        this.lastUpdateId = update.update_id;

        if (update.message?.text) {
          const chatId = String(update.message.chat.id);

          // Check if chat is allowed
          if (!this.isChatAllowed(chatId)) {
            if (this.debug) {
              console.log(`[telegram] Ignoring message from unauthorized chat: ${chatId}`);
            }
            continue;
          }

          const message: ChatMessage = {
            text: update.message.text,
            chatId,
            senderId: update.message.from ? String(update.message.from.id) : undefined,
            senderName: update.message.from
              ? [update.message.from.first_name, update.message.from.last_name].filter(Boolean).join(" ")
              : undefined,
            timestamp: new Date(update.message.date * 1000),
            raw: update,
          };

          // Call raw message handler if provided
          if (onMessage) {
            try {
              await onMessage(message);
            } catch (err) {
              if (this.debug) {
                console.error(`[telegram] Message handler error: ${err}`);
              }
            }
          }

          // Try to parse as a command
          const command = parseCommand(message.text, message);
          if (command) {
            try {
              await onCommand(command);
            } catch (err) {
              if (this.debug) {
                console.error(`[telegram] Command handler error: ${err}`);
              }
              // Send error message to chat
              await this.sendMessage(chatId, `Error executing command: ${err instanceof Error ? err.message : "Unknown error"}`);
            }
          }
        }
      }
    } catch (err) {
      if (this.debug) {
        console.error(`[telegram] Poll error: ${err}`);
      }
      // Wait a bit before retrying on error
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    // Schedule next poll
    if (this.polling) {
      this.pollingTimeout = setTimeout(() => this.poll(onCommand, onMessage), 100);
    }
  }

  async connect(onCommand: ChatCommandHandler, onMessage?: ChatMessageHandler): Promise<void> {
    if (this.connected) {
      throw new Error("Already connected");
    }

    // Verify bot token by calling getMe
    try {
      const me = await this.apiRequest<{ id: number; first_name: string; username?: string }>("getMe");
      if (this.debug) {
        console.log(`[telegram] Connected as @${me.username || me.first_name} (ID: ${me.id})`);
      }
    } catch (err) {
      throw new Error(`Failed to connect to Telegram: ${err instanceof Error ? err.message : "Unknown error"}`);
    }

    this.connected = true;
    this.polling = true;

    // Start polling
    this.poll(onCommand, onMessage);
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    await this.apiRequest("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    });
  }

  async disconnect(): Promise<void> {
    this.polling = false;
    this.connected = false;

    if (this.pollingTimeout) {
      clearTimeout(this.pollingTimeout);
      this.pollingTimeout = null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * Create a Telegram chat client from settings.
 */
export function createTelegramClient(settings: TelegramSettings, debug = false): ChatClient {
  return new TelegramChatClient(settings, debug);
}
