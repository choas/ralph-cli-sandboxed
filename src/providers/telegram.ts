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
  SendMessageOptions,
  parseCommand,
  escapeHtml,
} from "../utils/chat-client.js";
import { ResponderMatcher, ResponderMatch } from "../utils/responder.js";
import { ResponderConfig, RespondersConfig, loadConfig } from "../utils/config.js";
import { executeLLMResponder, ResponderResult } from "../responders/llm-responder.js";
import { executeClaudeCodeResponder } from "../responders/claude-code-responder.js";
import { executeCLIResponder } from "../responders/cli-responder.js";

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
    reply_to_message?: {
      message_id: number;
      from?: {
        id: number;
        first_name: string;
        last_name?: string;
        username?: string;
      };
      text?: string;
    };
    entities?: Array<{
      type: string;
      offset: number;
      length: number;
      user?: {
        id: number;
        username?: string;
      };
    }>;
  };
  callback_query?: TelegramCallbackQuery;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

/**
 * Inline keyboard button for Telegram.
 */
/**
 * Telegram-specific inline keyboard button format.
 */
interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
  };
  message?: {
    message_id: number;
    chat: {
      id: number;
      type: string;
    };
  };
  data?: string;
}

export class TelegramChatClient implements ChatClient {
  readonly provider = "telegram" as const;

  private settings: TelegramSettings;
  private connected = false;
  private polling = false;
  private lastUpdateId = 0;
  private pollingTimeout: NodeJS.Timeout | null = null;
  private debug: boolean;
  private responderMatcher: ResponderMatcher | null = null;
  private respondersConfig: RespondersConfig | null = null;
  private botUserId: number | null = null;
  private botUsername: string | null = null;

  constructor(settings: TelegramSettings, debug = false) {
    this.settings = settings;
    this.debug = debug;

    // Initialize responders from config if available
    this.initializeResponders();
  }

  /**
   * Initialize responder matching from config.
   */
  private initializeResponders(): void {
    try {
      const config = loadConfig();
      if (config.chat?.responders) {
        this.respondersConfig = config.chat.responders;
        this.responderMatcher = new ResponderMatcher(config.chat.responders);
        if (this.debug) {
          console.log(
            `[telegram] Initialized ${Object.keys(config.chat.responders).length} responders`,
          );
        }
      }
    } catch {
      // Config not available or responders not configured
      if (this.debug) {
        console.log("[telegram] No responders configured");
      }
    }
  }

  /**
   * Execute a responder and return the result.
   */
  private async executeResponder(match: ResponderMatch, message: string): Promise<ResponderResult> {
    const { responder } = match;

    switch (responder.type) {
      case "llm":
        return executeLLMResponder(message, responder);

      case "claude-code":
        return executeClaudeCodeResponder(message, responder);

      case "cli":
        return executeCLIResponder(message, responder);

      default:
        return {
          success: false,
          response: "",
          error: `Unknown responder type: ${(responder as ResponderConfig).type}`,
        };
    }
  }

  /**
   * Handle a message that might match a responder.
   * Returns true if a responder was matched and executed.
   */
  private async handleResponderMessage(message: ChatMessage, messageId: number): Promise<boolean> {
    if (!this.responderMatcher) {
      return false;
    }

    const match = this.responderMatcher.matchResponder(message.text);
    if (!match) {
      return false;
    }

    if (this.debug) {
      console.log(`[telegram] Matched responder: ${match.name} (type: ${match.responder.type})`);
    }

    // Execute the responder
    const result = await this.executeResponder(match, match.args || message.text);

    // Send the response (reply to the original message for context)
    if (result.success) {
      await this.sendMessage(message.chatId, result.response, {
        replyToMessageId: messageId,
      });
    } else {
      const errorMsg = result.error
        ? `Error: ${result.error}`
        : "An error occurred while processing your message.";
      await this.sendMessage(message.chatId, errorMsg, {
        replyToMessageId: messageId,
      });
    }

    return true;
  }

  /**
   * Check if the bot is mentioned in a message.
   * Handles both @username mentions and direct replies to the bot.
   */
  private isBotMentioned(update: TelegramUpdate): boolean {
    const msg = update.message;
    if (!msg) return false;

    // Check if this is a reply to the bot's message
    if (msg.reply_to_message?.from?.id === this.botUserId) {
      return true;
    }

    // Check for @mention in message entities
    if (msg.entities && this.botUsername) {
      for (const entity of msg.entities) {
        if (entity.type === "mention" && msg.text) {
          const mention = msg.text.substring(entity.offset, entity.offset + entity.length);
          if (mention.toLowerCase() === `@${this.botUsername.toLowerCase()}`) {
            return true;
          }
        }
        if (entity.type === "text_mention" && entity.user?.id === this.botUserId) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Remove bot mention from message text.
   */
  private removeBotMention(text: string): string {
    if (!this.botUsername) {
      return text;
    }
    // Remove @username and any surrounding whitespace
    const regex = new RegExp(`@${this.botUsername}\\s*`, "gi");
    return text.replace(regex, "").trim();
  }

  /**
   * Check if a chat is a group chat (group or supergroup).
   */
  private isGroupChat(chatType: string): boolean {
    return chatType === "group" || chatType === "supergroup";
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
                  `Telegram API error: ${response.description || "Unknown error"} (code: ${response.error_code})`,
                ),
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

        // Handle callback queries (button presses)
        if (update.callback_query) {
          const callbackQuery = update.callback_query;
          const chatId = callbackQuery.message?.chat?.id
            ? String(callbackQuery.message.chat.id)
            : null;

          if (chatId && this.isChatAllowed(chatId) && callbackQuery.data) {
            // Acknowledge the callback query
            try {
              await this.answerCallbackQuery(callbackQuery.id);
            } catch (err) {
              if (this.debug) {
                console.error(`[telegram] Failed to answer callback query: ${err}`);
              }
            }

            // Create a synthetic message from the callback data
            // The callback_data is the command string (e.g., "/run feature")
            const message: ChatMessage = {
              text: callbackQuery.data,
              chatId,
              senderId: String(callbackQuery.from.id),
              senderName: [callbackQuery.from.first_name, callbackQuery.from.last_name]
                .filter(Boolean)
                .join(" "),
              timestamp: new Date(),
              raw: update,
            };

            // Parse and execute the command
            const command = parseCommand(message.text, message);
            if (command) {
              try {
                await onCommand(command);
              } catch (err) {
                if (this.debug) {
                  console.error(`[telegram] Callback command error: ${err}`);
                }
                await this.sendMessage(
                  chatId,
                  `Error executing command: ${err instanceof Error ? err.message : "Unknown error"}`,
                );
              }
            }
          }
          continue;
        }

        if (update.message?.text) {
          const chatId = String(update.message.chat.id);
          const messageId = update.message.message_id;
          const chatType = update.message.chat.type;

          // Check if chat is allowed
          if (!this.isChatAllowed(chatId)) {
            if (this.debug) {
              console.log(`[telegram] Ignoring message from unauthorized chat: ${chatId}`);
            }
            continue;
          }

          // In group chats, only process messages that mention the bot or are replies to the bot
          const isGroup = this.isGroupChat(chatType);
          const isMention = this.isBotMentioned(update);

          // Clean the message text (remove bot mention if present)
          let messageText = update.message.text;
          if (isMention) {
            messageText = this.removeBotMention(messageText);
          }

          const message: ChatMessage = {
            text: messageText,
            chatId,
            senderId: update.message.from ? String(update.message.from.id) : undefined,
            senderName: update.message.from
              ? [update.message.from.first_name, update.message.from.last_name]
                  .filter(Boolean)
                  .join(" ")
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

          // Try to parse as a command first
          const command = parseCommand(message.text, message);
          if (command) {
            try {
              await onCommand(command);
            } catch (err) {
              if (this.debug) {
                console.error(`[telegram] Command handler error: ${err}`);
              }
              // Send error message to chat
              await this.sendMessage(
                chatId,
                `Error executing command: ${err instanceof Error ? err.message : "Unknown error"}`,
                {
                  replyToMessageId: messageId,
                },
              );
            }
            continue; // Command handled, don't process as responder message
          }

          // For non-command messages, route through responders
          // In group chats: only respond if bot is mentioned or message is a reply to bot
          // In private chats: always respond if responders are configured
          const shouldProcessAsResponder = !isGroup || isMention;

          if (shouldProcessAsResponder && this.responderMatcher) {
            // Check if there's a matching responder or a default responder
            const hasDefaultResponder = this.responderMatcher.hasDefaultResponder();
            const match = this.responderMatcher.matchResponder(message.text);

            if (match) {
              try {
                const handled = await this.handleResponderMessage(message, messageId);
                if (handled) {
                  continue;
                }
              } catch (err) {
                if (this.debug) {
                  console.error(`[telegram] Responder error: ${err}`);
                }
                await this.sendMessage(
                  chatId,
                  `Error processing message: ${err instanceof Error ? err.message : "Unknown error"}`,
                  { replyToMessageId: messageId },
                );
                continue;
              }
            } else if (isMention && !hasDefaultResponder) {
              // Bot was mentioned but no responder matched and no default responder
              // Send a helpful message
              await this.sendMessage(
                chatId,
                "I received your message, but no responders are configured. Use /help for available commands.",
                { replyToMessageId: messageId },
              );
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

    // Verify bot token by calling getMe and store bot info
    try {
      const me = await this.apiRequest<{ id: number; first_name: string; username?: string }>(
        "getMe",
      );
      this.botUserId = me.id;
      this.botUsername = me.username || null;
      if (this.debug) {
        console.log(`[telegram] Connected as @${me.username || me.first_name} (ID: ${me.id})`);
      }
    } catch (err) {
      throw new Error(
        `Failed to connect to Telegram: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }

    this.connected = true;
    this.polling = true;

    // Start polling
    this.poll(onCommand, onMessage);
  }

  async sendMessage(chatId: string, text: string, options?: SendMessageOptions): Promise<void> {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    // Escape HTML special characters since we use parse_mode: "HTML".
    // This prevents API errors when text contains <, >, & (e.g., git status output with <file>).
    const escapedText = escapeHtml(text);

    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: escapedText,
      parse_mode: "HTML",
    };

    // Add reply_to_message_id for context in group chats
    if (options?.replyToMessageId) {
      body.reply_to_message_id = options.replyToMessageId;
    }

    // Convert generic InlineButton format to Telegram's InlineKeyboardMarkup
    if (options?.inlineKeyboard && options.inlineKeyboard.length > 0) {
      const inlineKeyboard: InlineKeyboardButton[][] = options.inlineKeyboard.map((row) =>
        row.map((button) => ({
          text: button.text,
          callback_data: button.callbackData,
          url: button.url,
        })),
      );
      body.reply_markup = { inline_keyboard: inlineKeyboard };
    }

    await this.apiRequest("sendMessage", body);
  }

  /**
   * Answer a callback query (acknowledge button press).
   */
  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    await this.apiRequest("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
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
