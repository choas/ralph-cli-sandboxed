/**
 * Discord chat client implementation.
 * Uses discord.js for WebSocket-based real-time messaging via the Discord Gateway.
 *
 * Required packages (must be installed separately):
 *   npm install discord.js
 */

import {
  ChatClient,
  ChatCommand,
  ChatCommandHandler,
  ChatMessage,
  ChatMessageHandler,
  DiscordSettings,
  SendMessageOptions,
  parseCommand,
} from "../utils/chat-client.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DiscordClient = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DiscordMessage = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DiscordInteraction = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DiscordTextChannel = any;

// Discord.js classes loaded dynamically
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ClientConstructor: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GatewayIntentBits: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ActionRowBuilder: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ButtonBuilder: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ButtonStyle: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SlashCommandBuilder: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let REST: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Routes: any = null;

async function loadDiscordModules(): Promise<boolean> {
  try {
    // Dynamic import to avoid compile-time errors when packages aren't installed
    const dynamicImport = new Function("specifier", "return import(specifier)");
    const discordJs = await dynamicImport("discord.js");

    ClientConstructor = discordJs.Client;
    GatewayIntentBits = discordJs.GatewayIntentBits;
    ActionRowBuilder = discordJs.ActionRowBuilder;
    ButtonBuilder = discordJs.ButtonBuilder;
    ButtonStyle = discordJs.ButtonStyle;
    SlashCommandBuilder = discordJs.SlashCommandBuilder;
    REST = discordJs.REST;
    Routes = discordJs.Routes;

    return true;
  } catch {
    return false;
  }
}

/**
 * Discord ActionRow with buttons.
 */
interface DiscordActionRow {
  type: 1;
  components: DiscordButton[];
}

/**
 * Discord button component.
 */
interface DiscordButton {
  type: 2;
  style: number;
  label: string;
  custom_id?: string;
  url?: string;
}

export class DiscordChatClient implements ChatClient {
  readonly provider = "discord" as const;

  private settings: DiscordSettings;
  private connected = false;
  private debug: boolean;
  private client: DiscordClient | null = null;
  private onCommand: ChatCommandHandler | null = null;
  private onMessage: ChatMessageHandler | null = null;

  constructor(settings: DiscordSettings, debug = false) {
    this.settings = settings;
    this.debug = debug;
  }

  /**
   * Check if a guild ID is allowed.
   */
  private isGuildAllowed(guildId: string | null): boolean {
    // If no allowed guild IDs specified, allow all
    if (!this.settings.allowedGuildIds || this.settings.allowedGuildIds.length === 0) {
      return true;
    }
    if (!guildId) return false;
    return this.settings.allowedGuildIds.includes(guildId);
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
   * Convert a Discord message to our ChatMessage format.
   */
  private toMessage(message: DiscordMessage): ChatMessage {
    return {
      text: message.content || "",
      chatId: message.channel.id,
      senderId: message.author?.id,
      senderName: message.author?.username,
      timestamp: message.createdAt || new Date(),
      raw: message,
    };
  }

  /**
   * Register slash commands with Discord.
   */
  private async registerSlashCommands(): Promise<void> {
    if (!this.client || !REST || !Routes || !SlashCommandBuilder) return;

    const commands = [
      { name: "run", description: "Start ralph automation", hasArgs: true, argName: "category", argDesc: "Optional category filter" },
      { name: "status", description: "Show PRD progress", hasArgs: false },
      { name: "add", description: "Add new task to PRD", hasArgs: true, argName: "description", argDesc: "Task description", required: true },
      { name: "exec", description: "Execute shell command", hasArgs: true, argName: "command", argDesc: "Shell command to run", required: true },
      { name: "stop", description: "Stop running ralph process", hasArgs: false },
      { name: "help", description: "Show help", hasArgs: false },
      { name: "action", description: "Run daemon action", hasArgs: true, argName: "name", argDesc: "Action name" },
      { name: "claude", description: "Run Claude Code with prompt", hasArgs: true, argName: "prompt", argDesc: "Prompt for Claude Code", required: true },
    ];

    const slashCommands = commands.map((cmd) => {
      const builder = new SlashCommandBuilder()
        .setName(cmd.name)
        .setDescription(cmd.description);

      if (cmd.hasArgs && cmd.argName) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        builder.addStringOption((option: any) =>
          option
            .setName(cmd.argName)
            .setDescription(cmd.argDesc || "Argument")
            .setRequired(cmd.required || false)
        );
      }

      return builder;
    });

    const rest = new REST({ version: "10" }).setToken(this.settings.botToken);

    try {
      const clientId = this.client.user?.id;
      if (!clientId) {
        if (this.debug) {
          console.log("[discord] Cannot register slash commands: client ID not available");
        }
        return;
      }

      if (this.debug) {
        console.log("[discord] Registering slash commands...");
      }

      await rest.put(Routes.applicationCommands(clientId), {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body: slashCommands.map((cmd: any) => cmd.toJSON()),
      });

      if (this.debug) {
        console.log("[discord] Slash commands registered successfully");
      }
    } catch (err) {
      if (this.debug) {
        console.error(`[discord] Failed to register slash commands: ${err}`);
      }
    }
  }

  /**
   * Handle incoming Discord messages.
   */
  private async handleMessage(message: DiscordMessage): Promise<void> {
    // Ignore messages from bots (including self)
    if (message.author?.bot) return;

    // Check if guild is allowed
    if (!this.isGuildAllowed(message.guild?.id)) {
      if (this.debug) {
        console.log(`[discord] Ignoring message from unauthorized guild: ${message.guild?.id}`);
      }
      return;
    }

    // Check if channel is allowed
    if (!this.isChannelAllowed(message.channel.id)) {
      if (this.debug) {
        console.log(`[discord] Ignoring message from unauthorized channel: ${message.channel.id}`);
      }
      return;
    }

    const chatMessage = this.toMessage(message);

    // Call raw message handler if provided
    if (this.onMessage) {
      try {
        await this.onMessage(chatMessage);
      } catch (err) {
        if (this.debug) {
          console.error(`[discord] Message handler error: ${err}`);
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
          console.error(`[discord] Command handler error: ${err}`);
        }
        // Send error message to channel
        try {
          await message.reply(`Error executing command: ${err instanceof Error ? err.message : "Unknown error"}`);
        } catch {
          // Ignore reply errors
        }
      }
    }
  }

  /**
   * Handle slash command interactions.
   */
  private async handleInteraction(interaction: DiscordInteraction): Promise<void> {
    // Handle button interactions
    if (interaction.isButton && interaction.isButton()) {
      await this.handleButtonInteraction(interaction);
      return;
    }

    // Only handle slash commands
    if (!interaction.isChatInputCommand || !interaction.isChatInputCommand()) return;

    // Check if guild is allowed
    if (!this.isGuildAllowed(interaction.guild?.id)) {
      if (this.debug) {
        console.log(`[discord] Ignoring interaction from unauthorized guild: ${interaction.guild?.id}`);
      }
      try {
        await interaction.reply({
          content: "This server is not authorized to use ralph commands.",
          ephemeral: true,
        });
      } catch {
        // Ignore reply errors
      }
      return;
    }

    // Check if channel is allowed
    if (!this.isChannelAllowed(interaction.channel?.id)) {
      if (this.debug) {
        console.log(`[discord] Ignoring interaction from unauthorized channel: ${interaction.channel?.id}`);
      }
      try {
        await interaction.reply({
          content: "This channel is not authorized to use ralph commands.",
          ephemeral: true,
        });
      } catch {
        // Ignore reply errors
      }
      return;
    }

    const commandName = interaction.commandName;
    const args: string[] = [];

    // Extract arguments based on command
    const argMappings: Record<string, string> = {
      run: "category",
      add: "description",
      exec: "command",
      action: "name",
      claude: "prompt",
    };

    const argName = argMappings[commandName];
    if (argName) {
      const argValue = interaction.options?.getString(argName);
      if (argValue) {
        // Split the argument for commands that expect multiple args
        if (commandName === "exec" || commandName === "add" || commandName === "claude") {
          args.push(...argValue.split(/\s+/));
        } else {
          args.push(argValue);
        }
      }
    }

    const chatMessage: ChatMessage = {
      text: `/${commandName} ${args.join(" ")}`.trim(),
      chatId: interaction.channel?.id || "",
      senderId: interaction.user?.id,
      senderName: interaction.user?.username,
      timestamp: new Date(),
      raw: interaction,
    };

    const parsedCommand: ChatCommand = {
      projectId: "",
      command: commandName,
      args,
      message: chatMessage,
    };

    // Acknowledge the interaction immediately (Discord requires response within 3 seconds)
    try {
      await interaction.deferReply();
    } catch (err) {
      if (this.debug) {
        console.error(`[discord] Failed to defer reply: ${err}`);
      }
      return;
    }

    if (this.onCommand) {
      try {
        await this.onCommand(parsedCommand);
      } catch (err) {
        if (this.debug) {
          console.error(`[discord] Slash command error: ${err}`);
        }
        try {
          await interaction.editReply(`Error executing /${commandName}: ${err instanceof Error ? err.message : "Unknown error"}`);
        } catch {
          // Ignore edit errors
        }
      }
    }
  }

  /**
   * Handle button interactions.
   */
  private async handleButtonInteraction(interaction: DiscordInteraction): Promise<void> {
    // Check if guild is allowed
    if (!this.isGuildAllowed(interaction.guild?.id)) {
      if (this.debug) {
        console.log(`[discord] Ignoring button from unauthorized guild: ${interaction.guild?.id}`);
      }
      return;
    }

    // Check if channel is allowed
    if (!this.isChannelAllowed(interaction.channel?.id)) {
      if (this.debug) {
        console.log(`[discord] Ignoring button from unauthorized channel: ${interaction.channel?.id}`);
      }
      return;
    }

    // The custom_id contains the command (e.g., "/run feature")
    const commandText = interaction.customId;
    if (!commandText) return;

    const chatMessage: ChatMessage = {
      text: commandText,
      chatId: interaction.channel?.id || "",
      senderId: interaction.user?.id,
      senderName: interaction.user?.username,
      timestamp: new Date(),
      raw: interaction,
    };

    // Parse and execute the command
    const command = parseCommand(commandText, chatMessage);

    // Acknowledge the button press
    try {
      await interaction.deferUpdate();
    } catch (err) {
      if (this.debug) {
        console.error(`[discord] Failed to defer button update: ${err}`);
      }
    }

    if (command && this.onCommand) {
      try {
        await this.onCommand(command);
      } catch (err) {
        if (this.debug) {
          console.error(`[discord] Button action error: ${err}`);
        }
      }
    }
  }

  async connect(onCommand: ChatCommandHandler, onMessage?: ChatMessageHandler): Promise<void> {
    if (this.connected) {
      throw new Error("Already connected");
    }

    // Load Discord modules dynamically
    const loaded = await loadDiscordModules();
    if (!loaded || !ClientConstructor || !GatewayIntentBits) {
      throw new Error(
        "Failed to load Discord modules. Make sure discord.js is installed:\n" +
        "  npm install discord.js"
      );
    }

    this.onCommand = onCommand;
    this.onMessage = onMessage || null;

    try {
      // Create Discord client with required intents
      this.client = new ClientConstructor({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
      });

      // Setup event handlers
      this.client.on("messageCreate", (message: DiscordMessage) => this.handleMessage(message));
      this.client.on("interactionCreate", (interaction: DiscordInteraction) => this.handleInteraction(interaction));

      // Handle ready event
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Discord login timed out after 30 seconds"));
        }, 30000);

        this.client!.once("ready", async () => {
          clearTimeout(timeout);

          if (this.debug) {
            console.log(`[discord] Connected as ${this.client!.user?.tag} (ID: ${this.client!.user?.id})`);
          }

          // Register slash commands after login
          await this.registerSlashCommands();

          resolve();
        });

        this.client!.once("error", (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });

        // Login to Discord
        this.client!.login(this.settings.botToken).catch((err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      this.connected = true;
    } catch (err) {
      throw new Error(`Failed to connect to Discord: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  async sendMessage(chatId: string, text: string, options?: SendMessageOptions): Promise<void> {
    if (!this.connected || !this.client) {
      throw new Error("Not connected");
    }

    // Get the channel
    let channel: DiscordTextChannel;
    try {
      channel = await this.client.channels.fetch(chatId);
    } catch (err) {
      throw new Error(`Failed to fetch channel ${chatId}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }

    if (!channel || !channel.send) {
      throw new Error(`Channel ${chatId} is not a text channel or doesn't exist`);
    }

    // Build message payload
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      content: text.substring(0, 2000), // Discord has 2000 char limit
    };

    // Convert inline keyboard to Discord buttons
    if (options?.inlineKeyboard && options.inlineKeyboard.length > 0 && ActionRowBuilder && ButtonBuilder && ButtonStyle) {
      const components: unknown[] = [];

      for (const row of options.inlineKeyboard) {
        const actionRow = new ActionRowBuilder();
        const buttons: unknown[] = [];

        for (const button of row) {
          const discordButton = new ButtonBuilder();

          if (button.url) {
            // URL buttons use Link style
            discordButton
              .setLabel(button.text.substring(0, 80)) // Discord button label limit
              .setStyle(ButtonStyle.Link)
              .setURL(button.url);
          } else {
            // Regular buttons use Primary style with custom_id
            discordButton
              .setLabel(button.text.substring(0, 80))
              .setStyle(ButtonStyle.Primary)
              .setCustomId(button.callbackData || button.text);
          }

          buttons.push(discordButton);
        }

        actionRow.addComponents(...buttons);
        components.push(actionRow);
      }

      payload.components = components;
    }

    await channel.send(payload);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.connected = false;
    this.onCommand = null;
    this.onMessage = null;
  }

  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * Create a Discord chat client from settings.
 */
export function createDiscordClient(settings: DiscordSettings, debug = false): ChatClient {
  return new DiscordChatClient(settings, debug);
}
