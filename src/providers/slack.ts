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

export class SlackChatClient implements ChatClient {
  readonly provider = "slack" as const;

  private settings: SlackSettings;
  private connected = false;
  private debug: boolean;
  private app: SlackApp | null = null;
  private webClient: SlackWebClient | null = null;
  private onCommand: ChatCommandHandler | null = null;
  private onMessage: ChatMessageHandler | null = null;

  constructor(settings: SlackSettings, debug = false) {
    this.settings = settings;
    this.debug = debug;
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

    // Handle all messages (including DMs and channel messages)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.app.message(async ({ message, say }: { message: any; say: (text: string) => Promise<void> }) => {
      // Type guard for message with text
      if (!message.text) return;
      if (!message.channel) return;

      const channelId = message.channel as string;

      // Check if channel is allowed
      if (!this.isChannelAllowed(channelId)) {
        if (this.debug) {
          console.log(`[slack] Ignoring message from unauthorized channel: ${channelId}`);
        }
        return;
      }

      const chatMessage = this.toMessage({
        text: message.text,
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

      // Try to parse as a command
      const command = parseCommand(chatMessage.text, chatMessage);
      if (command && this.onCommand) {
        try {
          await this.onCommand(command);
        } catch (err) {
          if (this.debug) {
            console.error(`[slack] Command handler error: ${err}`);
          }
          // Send error message to channel
          await say(`Error executing command: ${err instanceof Error ? err.message : "Unknown error"}`);
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
      if (this.debug) {
        console.log(`[slack] Connected as @${authResult.user} (bot ID: ${authResult.bot_id})`);
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
    } = {
      channel: chatId,
      text, // Fallback text for notifications
    };

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
