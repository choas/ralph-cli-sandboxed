/**
 * Slack chat client implementation.
 * Uses @slack/bolt for WebSocket-based real-time messaging via Socket Mode.
 *
 * Required packages (must be installed separately):
 *   npm install @slack/bolt @slack/web-api
 */

import {
  ChatClient,
  ChatCommand,
  ChatCommandHandler,
  ChatMessage,
  ChatMessageHandler,
  SlackSettings,
  SendMessageOptions,
  parseCommand,
} from "../utils/chat-client.js";
import { ResponderMatcher, ResponderMatch } from "../utils/responder.js";
import { ResponderConfig, RespondersConfig, loadConfig } from "../utils/config.js";
import { executeLLMResponder, ResponderResult } from "../responders/llm-responder.js";
import { executeClaudeCodeResponder } from "../responders/claude-code-responder.js";
import { executeCLIResponder } from "../responders/cli-responder.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SlackApp = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SlackWebClient = any;

// Dynamic imports for @slack/bolt and @slack/web-api
// These packages may not be installed in all environments
let AppConstructor: (new (options: {
  token: string;
  appToken: string;
  signingSecret: string;
  socketMode: boolean;
}) => SlackApp) | null = null;
let WebClientConstructor: (new (token: string) => SlackWebClient) | null = null;

async function loadSlackModules(): Promise<boolean> {
  try {
    // Dynamic import to avoid compile-time errors when packages aren't installed
    // Using Function constructor to prevent TypeScript from analyzing the import paths
    const dynamicImport = new Function("specifier", "return import(specifier)");
    const bolt = await dynamicImport("@slack/bolt");
    const webApi = await dynamicImport("@slack/web-api");
    AppConstructor = bolt.App;
    WebClientConstructor = webApi.WebClient;
    return true;
  } catch {
    return false;
  }
}

/**
 * Slack Block Kit button element.
 */
interface SlackButton {
  type: "button";
  text: {
    type: "plain_text";
    text: string;
    emoji?: boolean;
  };
  action_id: string;
  value?: string;
  url?: string;
}

/**
 * Slack Block Kit actions block.
 */
interface SlackActionsBlock {
  type: "actions";
  elements: SlackButton[];
}

/**
 * Slack Block Kit section block.
 */
interface SlackSectionBlock {
  type: "section";
  text: {
    type: "mrkdwn" | "plain_text";
    text: string;
  };
}

type SlackBlock = SlackActionsBlock | SlackSectionBlock;

/**
 * Callback for handling responder matches.
 * Returns the response text to send back to the channel.
 */
export type ResponderHandler = (
  match: ResponderMatch,
  message: ChatMessage
) => Promise<string | null>;

export class SlackChatClient implements ChatClient {
  readonly provider = "slack" as const;

  private settings: SlackSettings;
  private connected = false;
  private debug: boolean;
  private app: SlackApp | null = null;
  private webClient: SlackWebClient | null = null;
  private onCommand: ChatCommandHandler | null = null;
  private onMessage: ChatMessageHandler | null = null;
  private responderMatcher: ResponderMatcher | null = null;
  private respondersConfig: RespondersConfig | null = null;
  private botUserId: string | null = null;

  constructor(settings: SlackSettings, debug = false) {
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
          console.log(`[slack] Initialized ${Object.keys(config.chat.responders).length} responders`);
        }
      }
    } catch {
      // Config not available or responders not configured
      if (this.debug) {
        console.log("[slack] No responders configured");
      }
    }
  }

  /**
   * Execute a responder and return the result.
   */
  private async executeResponder(
    match: ResponderMatch,
    message: string
  ): Promise<ResponderResult> {
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
  private async handleResponderMessage(
    message: ChatMessage,
    say: (options: { text: string; thread_ts?: string }) => Promise<unknown>,
    threadTs?: string
  ): Promise<boolean> {
    if (!this.responderMatcher) {
      return false;
    }

    const match = this.responderMatcher.matchResponder(message.text);
    if (!match) {
      return false;
    }

    if (this.debug) {
      console.log(`[slack] Matched responder: ${match.name} (type: ${match.responder.type})`);
    }

    // Execute the responder
    const result = await this.executeResponder(match, match.args || message.text);

    // Send the response (use thread_ts for context continuity)
    if (result.success) {
      await say({
        text: result.response,
        thread_ts: threadTs,
      });
    } else {
      const errorMsg = result.error
        ? `Error: ${result.error}`
        : "An error occurred while processing your message.";
      await say({
        text: errorMsg,
        thread_ts: threadTs,
      });
    }

    return true;
  }

  /**
   * Check if a message is mentioning the bot.
   */
  private isBotMentioned(text: string): boolean {
    if (!this.botUserId) {
      return false;
    }
    // Check for <@USERID> format used by Slack
    return text.includes(`<@${this.botUserId}>`);
  }

  /**
   * Remove bot mention from message text.
   */
  private removeBotMention(text: string): string {
    if (!this.botUserId) {
      return text;
    }
    // Remove <@USERID> and any surrounding whitespace
    return text.replace(new RegExp(`<@${this.botUserId}>\\s*`, "g"), "").trim();
  }

  /**
   * Check if a channel ID is allowed.
   */
  private isChannelAllowed(channelId: string): boolean {
    // If no allowed channel IDs specified, allow all
    if (!this.settings.allowedChannelIds || this.settings.allowedChannelIds.length === 0) {
      return true;
    }
    return this.settings.allowedChannelIds.includes(channelId);
  }

  /**
   * Convert a Slack message event to our ChatMessage format.
   */
  private toMessage(event: {
    text?: string;
    channel: string;
    user?: string;
    ts: string;
  }): ChatMessage {
    return {
      text: event.text || "",
      chatId: event.channel,
      senderId: event.user,
      timestamp: new Date(parseFloat(event.ts) * 1000),
      raw: event,
    };
  }

  /**
   * Setup event handlers for the Slack app.
   */
  private setupEventHandlers(): void {
    if (!this.app) return;

    // Handle app_mention events (when someone @mentions the bot)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.app.event("app_mention", async ({ event, say }: { event: any; say: (options: string | { text: string; thread_ts?: string }) => Promise<unknown> }) => {
      if (this.debug) {
        console.log(`[slack] Received app_mention in channel ${event.channel}`);
      }

      const channelId = event.channel as string;

      // Check if channel is allowed
      if (!this.isChannelAllowed(channelId)) {
        if (this.debug) {
          console.log(`[slack] Ignoring mention from unauthorized channel: ${channelId}`);
        }
        return;
      }

      // Remove the bot mention from the message text
      const cleanedText = this.removeBotMention(event.text || "");

      const chatMessage = this.toMessage({
        text: cleanedText,
        channel: channelId,
        user: event.user,
        ts: event.ts || String(Date.now() / 1000),
      });

      // Get thread_ts for reply context (use parent thread or message ts)
      const threadTs = event.thread_ts || event.ts;

      // Try responder matching first
      try {
        const handled = await this.handleResponderMessage(
          chatMessage,
          async (opts) => {
            if (typeof opts === "string") {
              await say({ text: opts, thread_ts: threadTs });
            } else {
              await say({ ...opts, thread_ts: threadTs });
            }
          },
          threadTs
        );
        if (handled) {
          return;
        }
      } catch (err) {
        if (this.debug) {
          console.error(`[slack] Responder error: ${err}`);
        }
        await say({
          text: `Error processing message: ${err instanceof Error ? err.message : "Unknown error"}`,
          thread_ts: threadTs,
        });
        return;
      }

      // If no responder matched and no default responder, reply with help
      if (!this.responderMatcher?.hasDefaultResponder()) {
        await say({
          text: "I received your message, but no responders are configured. Use /ralph for commands.",
          thread_ts: threadTs,
        });
      }
    });

    // Handle all messages (including DMs and channel messages)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.app.message(async ({ message, say }: { message: any; say: (options: string | { text: string; thread_ts?: string }) => Promise<unknown> }) => {
      // Type guard for message with text
      if (!message.text) return;
      if (!message.channel) return;

      // Ignore bot messages to prevent loops
      if (message.bot_id || message.subtype === "bot_message") {
        return;
      }

      const channelId = message.channel as string;

      // Check if channel is allowed
      if (!this.isChannelAllowed(channelId)) {
        if (this.debug) {
          console.log(`[slack] Ignoring message from unauthorized channel: ${channelId}`);
        }
        return;
      }

      // Get thread_ts for reply context (use parent thread or message ts)
      const threadTs = message.thread_ts || message.ts;

      // Check if this is a bot mention - if so, process it
      const isMention = this.isBotMentioned(message.text);

      // Create chat message
      let messageText = message.text;
      if (isMention) {
        messageText = this.removeBotMention(message.text);
      }

      const chatMessage = this.toMessage({
        text: messageText,
        channel: channelId,
        user: message.user,
        ts: message.ts || String(Date.now() / 1000),
      });

      // Call raw message handler if provided
      if (this.onMessage) {
        try {
          await this.onMessage(chatMessage);
        } catch (err) {
          if (this.debug) {
            console.error(`[slack] Message handler error: ${err}`);
          }
        }
      }

      // Try to parse as a command first
      const command = parseCommand(chatMessage.text, chatMessage);
      if (command && this.onCommand) {
        try {
          await this.onCommand(command);
          return; // Command handled, don't process as responder message
        } catch (err) {
          if (this.debug) {
            console.error(`[slack] Command handler error: ${err}`);
          }
          // Send error message to channel
          await say({
            text: `Error executing command: ${err instanceof Error ? err.message : "Unknown error"}`,
            thread_ts: threadTs,
          });
          return;
        }
      }

      // If message contains a bot mention or responders are configured,
      // try to route through responder matching
      if (isMention || this.responderMatcher?.hasDefaultResponder()) {
        try {
          const handled = await this.handleResponderMessage(
            chatMessage,
            async (opts) => {
              if (typeof opts === "string") {
                await say({ text: opts, thread_ts: threadTs });
              } else {
                await say({ ...opts, thread_ts: threadTs });
              }
            },
            threadTs
          );
          if (handled) {
            return;
          }
        } catch (err) {
          if (this.debug) {
            console.error(`[slack] Responder error: ${err}`);
          }
          if (isMention) {
            // Only reply with error if this was a direct mention
            await say({
              text: `Error processing message: ${err instanceof Error ? err.message : "Unknown error"}`,
              thread_ts: threadTs,
            });
          }
        }
      }
    });

    // Handle the unified /ralph command
    // Subcommands: help, status, run, stop, add, exec, action
    // Anything else is treated as a prompt for Claude
    const knownSubcommands = ["help", "status", "run", "stop", "add", "exec", "action"];

    if (this.debug) {
      console.log(`[slack] Registering command: /ralph`);
    }

    this.app.command(
      "/ralph",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async ({ command, ack, respond }: { command: any; ack: () => Promise<void>; respond: (text: string) => Promise<void> }) => {
        if (this.debug) {
          console.log(`[slack] Received: /ralph ${command.text} from channel ${command.channel_id}`);
        }
        // Acknowledge the command immediately
        await ack();

        const channelId = command.channel_id as string;

        // Check if channel is allowed
        if (!this.isChannelAllowed(channelId)) {
          if (this.debug) {
            console.log(`[slack] Ignoring command from unauthorized channel: ${channelId}`);
          }
          return;
        }

        // Parse subcommand from command.text
        const parts = command.text ? command.text.trim().split(/\s+/) : [];
        const firstWord = parts[0]?.toLowerCase() || "";
        const restArgs = parts.slice(1);

        let internalCmd: string;
        let args: string[];

        if (!firstWord || firstWord === "help") {
          // /ralph or /ralph help -> help
          internalCmd = "help";
          args = [];
        } else if (knownSubcommands.includes(firstWord)) {
          // /ralph status, /ralph run, etc.
          internalCmd = firstWord;
          args = restArgs;
        } else {
          // Anything else -> Claude prompt (entire text)
          internalCmd = "claude";
          args = parts; // Include all parts as the prompt
        }

        const chatMessage: ChatMessage = {
          text: `/ralph ${command.text}`.trim(),
          chatId: channelId,
          senderId: command.user_id,
          senderName: command.user_name,
          timestamp: new Date(),
          raw: command,
        };

        const parsedCommand: ChatCommand = {
          projectId: "",
          command: internalCmd,
          args,
          message: chatMessage,
        };

        if (this.onCommand) {
          try {
            await this.onCommand(parsedCommand);
          } catch (err) {
            if (this.debug) {
              console.error(`[slack] Command error: ${err}`);
            }
            await respond(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
          }
        }
      }
    );

    // Handle button actions (Block Kit interactive components)
    this.app.action(
      /^ralph_action_.*/,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async ({ action, ack, body, respond }: { action: any; ack: () => Promise<void>; body: any; respond: (text: string) => Promise<void> }) => {
        await ack();

        if (!action.value) return;
        if (!body.channel) return;

        const channelId = body.channel.id as string;

        // Check if channel is allowed
        if (!this.isChannelAllowed(channelId)) {
          if (this.debug) {
            console.log(`[slack] Ignoring button action from unauthorized channel: ${channelId}`);
          }
          return;
        }

        // The action value contains the command (e.g., "/run feature")
        const commandText = action.value as string;

        const chatMessage: ChatMessage = {
          text: commandText,
          chatId: channelId,
          senderId: body.user?.id,
          senderName: body.user?.name,
          timestamp: new Date(),
          raw: body,
        };

        // Parse and execute the command
        const command = parseCommand(commandText, chatMessage);
        if (command && this.onCommand) {
          try {
            await this.onCommand(command);
          } catch (err) {
            if (this.debug) {
              console.error(`[slack] Button action error: ${err}`);
            }
            await respond(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
          }
        }
      }
    );
  }

  async connect(onCommand: ChatCommandHandler, onMessage?: ChatMessageHandler): Promise<void> {
    if (this.connected) {
      throw new Error("Already connected");
    }

    // Load Slack modules dynamically
    const loaded = await loadSlackModules();
    if (!loaded || !AppConstructor || !WebClientConstructor) {
      throw new Error(
        "Failed to load Slack modules. Make sure @slack/bolt and @slack/web-api are installed:\n" +
        "  npm install @slack/bolt @slack/web-api"
      );
    }

    this.onCommand = onCommand;
    this.onMessage = onMessage || null;

    try {
      // Create Slack app with Socket Mode
      this.app = new AppConstructor({
        token: this.settings.botToken,
        appToken: this.settings.appToken,
        signingSecret: this.settings.signingSecret,
        socketMode: true,
      });

      // Also create a Web API client for sending messages
      this.webClient = new WebClientConstructor(this.settings.botToken);

      // Setup event handlers
      this.setupEventHandlers();

      // Start the app
      await this.app.start();

      // Verify connection by checking auth
      const authResult = await this.webClient.auth.test();
      this.botUserId = authResult.user_id || authResult.bot_id;
      if (this.debug) {
        console.log(`[slack] Connected as @${authResult.user} (user ID: ${this.botUserId})`);
      }

      this.connected = true;
    } catch (err) {
      throw new Error(`Failed to connect to Slack: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  async sendMessage(chatId: string, text: string, options?: SendMessageOptions): Promise<void> {
    if (!this.connected || !this.webClient) {
      throw new Error("Not connected");
    }

    // Build message payload
    const payload: {
      channel: string;
      text: string;
      blocks?: SlackBlock[];
      thread_ts?: string;
    } = {
      channel: chatId,
      text, // Fallback text for notifications
    };

    // Add thread_ts for context continuity if provided
    if (options?.threadTs) {
      payload.thread_ts = options.threadTs;
    }

    // Convert inline keyboard to Slack Block Kit buttons
    if (options?.inlineKeyboard && options.inlineKeyboard.length > 0) {
      const blocks: SlackBlock[] = [];

      // Add text as a section block
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text,
        },
      });

      // Convert each row of buttons to an actions block
      for (const row of options.inlineKeyboard) {
        const elements: SlackButton[] = row.map((button, index) => {
          const slackButton: SlackButton = {
            type: "button",
            text: {
              type: "plain_text",
              text: button.text,
              emoji: true,
            },
            action_id: `ralph_action_${Date.now()}_${index}`,
          };

          if (button.callbackData) {
            slackButton.value = button.callbackData;
          }
          if (button.url) {
            slackButton.url = button.url;
          }

          return slackButton;
        });

        blocks.push({
          type: "actions",
          elements,
        });
      }

      payload.blocks = blocks;
    }

    await this.webClient.chat.postMessage(payload);
  }

  async disconnect(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
    this.webClient = null;
    this.connected = false;
    this.onCommand = null;
    this.onMessage = null;
  }

  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * Create a Slack chat client from settings.
 */
export function createSlackClient(settings: SlackSettings, debug = false): ChatClient {
  return new SlackChatClient(settings, debug);
}
