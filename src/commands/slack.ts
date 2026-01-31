/**
 * Slack setup command - automates Slack app creation for Ralph instances.
 *
 * Uses Slack's App Manifest API to programmatically create apps,
 * ensuring each Ralph instance has its own dedicated Slack app.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getRalphDir, loadConfig, RalphConfig } from "../utils/config.js";
import { promptInput, promptConfirm } from "../utils/prompt.js";

const HELP_TEXT = `
ralph slack - Slack integration setup

Usage:
  ralph slack setup     Create a new Slack app for this Ralph instance
  ralph slack status    Show current Slack configuration
  ralph slack help      Show this help message

The setup command will:
  1. Create a new Slack app using the Slack App Manifest API
  2. Guide you through installing the app to your workspace
  3. Help you generate the required tokens
  4. Save the configuration to .ralph/config.json

Prerequisites:
  - A Slack workspace where you have admin permissions
  - A configuration token from https://api.slack.com/apps (click "Your App Configuration Tokens")

Why separate apps?
  Slack Socket Mode only allows ONE connection per app. Using the same app
  for multiple Ralph instances causes messages to be randomly delivered to
  the wrong instance. Each Ralph chat needs its own Slack app.
`;

/**
 * Slack App Manifest for Ralph bot.
 * Includes all required scopes, slash commands, and Socket Mode support.
 */
function createAppManifest(appName: string): object {
  return {
    display_information: {
      name: appName,
      description: "Ralph AI assistant for software development",
      background_color: "#1a1a2e",
    },
    features: {
      bot_user: {
        display_name: appName,
        always_online: true,
      },
      slash_commands: [
        {
          command: "/run",
          description: "Run a PRD task or custom prompt",
          usage_hint: "[task_id | prompt text]",
          should_escape: false,
        },
        {
          command: "/status",
          description: "Show current Ralph status and PRD progress",
          should_escape: false,
        },
        {
          command: "/add",
          description: "Add a new task to the PRD",
          usage_hint: "[task description]",
          should_escape: false,
        },
        {
          command: "/exec",
          description: "Execute a daemon action",
          usage_hint: "<action_name> [args]",
          should_escape: false,
        },
        {
          command: "/stop",
          description: "Stop the currently running task",
          should_escape: false,
        },
        {
          command: "/help",
          description: "Show available commands",
          should_escape: false,
        },
        {
          command: "/action",
          description: "Run a predefined action",
          usage_hint: "<action_name>",
          should_escape: false,
        },
        {
          command: "/claude",
          description: "Send a prompt directly to Claude",
          usage_hint: "<prompt>",
          should_escape: false,
        },
      ],
    },
    oauth_config: {
      scopes: {
        bot: [
          "chat:write",
          "chat:write.public",
          "commands",
          "channels:history",
          "groups:history",
          "im:history",
          "mpim:history",
          "channels:read",
          "groups:read",
          "im:read",
          "mpim:read",
          "users:read",
        ],
      },
    },
    settings: {
      event_subscriptions: {
        bot_events: [
          "message.channels",
          "message.groups",
          "message.im",
          "message.mpim",
          "app_mention",
        ],
      },
      interactivity: {
        is_enabled: true,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  };
}

/**
 * Create a Slack app using the Manifest API.
 */
async function createSlackApp(
  configToken: string,
  appName: string
): Promise<{
  appId: string;
  clientId: string;
  clientSecret: string;
  signingSecret: string;
} | null> {
  const manifest = createAppManifest(appName);

  try {
    const response = await fetch("https://slack.com/api/apps.manifest.create", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${configToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ manifest: JSON.stringify(manifest) }),
    });

    const data = await response.json() as {
      ok: boolean;
      app_id?: string;
      credentials?: {
        client_id: string;
        client_secret: string;
        signing_secret: string;
      };
      error?: string;
      errors?: Array<{ message: string; pointer: string }>;
    };

    if (!data.ok) {
      console.error(`\nError creating Slack app: ${data.error}`);
      if (data.errors) {
        console.error("Manifest errors:");
        for (const err of data.errors) {
          console.error(`  - ${err.message} (at ${err.pointer})`);
        }
      }
      return null;
    }

    return {
      appId: data.app_id!,
      clientId: data.credentials!.client_id,
      clientSecret: data.credentials!.client_secret,
      signingSecret: data.credentials!.signing_secret,
    };
  } catch (err) {
    console.error(`\nNetwork error: ${err instanceof Error ? err.message : "Unknown error"}`);
    return null;
  }
}

/**
 * Interactive setup flow for creating a new Slack app.
 */
async function setupSlack(): Promise<void> {
  console.log("\n=== Ralph Slack Setup ===\n");
  console.log("This wizard will create a new Slack app for your Ralph instance.");
  console.log("Each Ralph instance needs its own Slack app to avoid message routing issues.\n");

  // Check if config exists
  const ralphDir = getRalphDir();
  const configPath = join(ralphDir, "config.json");

  if (!existsSync(configPath)) {
    console.error("Error: .ralph/config.json not found. Run 'ralph init' first.");
    process.exit(1);
  }

  // Step 1: Get configuration token
  console.log("Step 1: Configuration Token\n");
  console.log("You need a Slack configuration token to create apps programmatically.");
  console.log("Get one at: https://api.slack.com/apps");
  console.log("  → Scroll down to 'Your App Configuration Tokens'");
  console.log("  → Click 'Generate Token' and select your workspace\n");

  const configToken = await promptInput("Paste your configuration token (xoxe-...): ");

  if (!configToken.startsWith("xoxe")) {
    console.error("\nInvalid token format. Configuration tokens start with 'xoxe'.");
    console.error("Note: This is different from bot tokens (xoxb-) or app tokens (xapp-).");
    process.exit(1);
  }

  // Step 2: Choose app name
  console.log("\nStep 2: App Name\n");

  // Try to derive a name from the project directory
  const projectDir = process.cwd().split("/").pop() || "ralph";
  const suggestedName = `Ralph - ${projectDir}`;

  let appName = await promptInput(`App name [${suggestedName}]: `);
  if (!appName) {
    appName = suggestedName;
  }

  // Validate app name (max 35 chars, must be unique)
  if (appName.length > 35) {
    appName = appName.substring(0, 35);
    console.log(`  (Truncated to: ${appName})`);
  }

  // Step 3: Create the app
  console.log("\nStep 3: Creating Slack App...\n");

  const appResult = await createSlackApp(configToken, appName);

  if (!appResult) {
    console.error("\nFailed to create Slack app. Please check your token and try again.");
    process.exit(1);
  }

  console.log(`✓ Created Slack app: ${appName}`);
  console.log(`  App ID: ${appResult.appId}`);

  // Step 4: Install the app
  console.log("\nStep 4: Install the App to Your Workspace\n");
  console.log("Open this URL in your browser to install the app:");
  console.log(`\n  https://api.slack.com/apps/${appResult.appId}/install-on-team\n`);
  console.log("Click 'Install to Workspace' and authorize the app.");

  await promptInput("Press Enter after you've installed the app...");

  // Step 5: Get the Bot Token
  console.log("\nStep 5: Bot Token (xoxb-...)\n");
  console.log("After installation, get your Bot Token from:");
  console.log(`  https://api.slack.com/apps/${appResult.appId}/oauth`);
  console.log("\nLook for 'Bot User OAuth Token' (starts with xoxb-).\n");

  const botToken = await promptInput("Paste your Bot Token (xoxb-...): ");

  if (!botToken.startsWith("xoxb-")) {
    console.error("\nInvalid token format. Bot tokens start with 'xoxb-'.");
    process.exit(1);
  }

  // Step 6: Generate App-Level Token for Socket Mode
  console.log("\nStep 6: App-Level Token for Socket Mode\n");
  console.log("Socket Mode requires an app-level token. Generate one at:");
  console.log(`  https://api.slack.com/apps/${appResult.appId}/general`);
  console.log("\nScroll to 'App-Level Tokens' and click 'Generate Token and Scopes'.");
  console.log("  → Name it something like 'socket-mode'");
  console.log("  → Add the scope: connections:write");
  console.log("  → Click 'Generate'\n");

  const appToken = await promptInput("Paste your App Token (xapp-...): ");

  if (!appToken.startsWith("xapp-")) {
    console.error("\nInvalid token format. App tokens start with 'xapp-'.");
    process.exit(1);
  }

  // Step 7: Get Channel ID (optional)
  console.log("\nStep 7: Channel Configuration (Optional)\n");
  console.log("For security, you can restrict Ralph to specific channels.");
  console.log("To get a channel ID: right-click the channel → 'View channel details' → scroll down.\n");

  const channelId = await promptInput("Channel ID to restrict to (leave empty for all): ");

  // Step 8: Save configuration
  console.log("\nStep 8: Saving Configuration...\n");

  const config = loadConfig();
  const updatedConfig: RalphConfig = {
    ...config,
    chat: {
      ...config.chat,
      enabled: true,
      provider: "slack",
      slack: {
        enabled: true,
        botToken,
        appToken,
        signingSecret: appResult.signingSecret,
        allowedChannelIds: channelId ? [channelId] : undefined,
      },
    },
  };

  writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2) + "\n");

  console.log("✓ Configuration saved to .ralph/config.json\n");

  // Step 9: Test connection
  const shouldTest = await promptConfirm("Test the connection now?");

  if (shouldTest && channelId) {
    console.log("\nTesting connection...\n");

    try {
      // Dynamic import to avoid issues if @slack/web-api isn't installed
      const dynamicImport = new Function("specifier", "return import(specifier)");
      const { WebClient } = await dynamicImport("@slack/web-api");
      const client = new WebClient(botToken);

      // Test auth
      const authResult = await client.auth.test();
      console.log(`✓ Authenticated as @${authResult.user}`);

      // Send test message
      await client.chat.postMessage({
        channel: channelId,
        text: "👋 Ralph is now connected! Use `/help` to see available commands.",
      });
      console.log(`✓ Test message sent to channel ${channelId}`);
    } catch (err) {
      console.error(`\nConnection test failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      console.log("You can test later with: ralph chat test <channel_id>");
    }
  }

  // Done!
  console.log("\n=== Setup Complete ===\n");
  console.log("Your Ralph instance now has its own Slack app!");
  console.log("\nNext steps:");
  console.log("  1. Start the chat daemon: ralph chat start");
  console.log("  2. Invite the bot to your channel: /invite @" + appName);
  console.log("  3. Try a command: /status");
  console.log("\nImportant: Each Ralph project should have its own Slack app.");
  console.log("Run 'ralph slack setup' in each project directory.\n");
}

/**
 * Show current Slack configuration status.
 */
function showStatus(): void {
  console.log("\n=== Slack Configuration Status ===\n");

  try {
    const config = loadConfig();
    const slack = config.chat?.slack;

    if (!slack) {
      console.log("Status: Not configured");
      console.log("\nRun 'ralph slack setup' to configure Slack integration.\n");
      return;
    }

    console.log(`Provider: ${config.chat?.provider || "not set"}`);
    console.log(`Enabled: ${slack.enabled !== false ? "Yes" : "No"}`);
    console.log(`Bot Token: ${slack.botToken ? maskToken(slack.botToken) : "not set"}`);
    console.log(`App Token: ${slack.appToken ? maskToken(slack.appToken) : "not set"}`);
    console.log(`Signing Secret: ${slack.signingSecret ? "••••••••" : "not set"}`);
    console.log(`Allowed Channels: ${slack.allowedChannelIds?.join(", ") || "all"}`);
    console.log();
  } catch (err) {
    console.error("Error loading config:", err instanceof Error ? err.message : "Unknown error");
    process.exit(1);
  }
}

/**
 * Mask a token for display, showing only prefix and last 4 chars.
 */
function maskToken(token: string): string {
  if (token.length <= 10) return "••••••••";
  const prefix = token.substring(0, token.indexOf("-") + 1);
  const suffix = token.substring(token.length - 4);
  return `${prefix}••••${suffix}`;
}

/**
 * Main command handler.
 */
export async function slack(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "help") {
    console.log(HELP_TEXT);
    return;
  }

  switch (subcommand) {
    case "setup":
      await setupSlack();
      break;
    case "status":
      showStatus();
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error("Run 'ralph slack help' for usage information.");
      process.exit(1);
  }
}
