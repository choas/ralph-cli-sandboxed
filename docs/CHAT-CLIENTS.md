# Chat Client Setup Guide

Ralph supports multiple chat providers for remote control and notifications. You can control your Ralph automation from Telegram, Slack, or Discord - running commands, checking status, and receiving notifications all from your phone or desktop chat client.

## Supported Providers

| Provider | Status | Use Case |
|----------|--------|----------|
| Telegram | ✅ Supported | Personal use, simple setup |
| Slack | ✅ Supported | Team collaboration, workspace integration |
| Discord | ✅ Supported | Community servers, gaming-style interaction |

## Quick Start

1. Choose your chat provider
2. Create a bot/app on that platform
3. Add credentials to `.ralph/config.json`
4. Start the chat daemon: `ralph chat start`

---

## Telegram Setup

Telegram is the simplest option for personal use with minimal setup.

### Step 1: Create a Bot with BotFather

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` command
3. Choose a name (e.g., "Ralph Automation")
4. Choose a username (must end in `bot`, e.g., `ralph_dev_bot`)
5. Copy the **bot token** (looks like `123456789:ABCdefGHIjklMNOpqrSTUvwxYZ`)

### Step 2: Get Your Chat ID

1. Start a chat with your new bot
2. Send any message to the bot
3. Open this URL in your browser (replace `YOUR_BOT_TOKEN`):
   ```
   https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
   ```
4. Look for `"chat":{"id":123456789}` - this is your chat ID
5. For group chats, add the bot to the group first, then check getUpdates

### Step 3: Configure Ralph

Add to `.ralph/config.json`:

```json
{
  "chat": {
    "enabled": true,
    "provider": "telegram",
    "telegram": {
      "botToken": "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ",
      "allowedChatIds": ["123456789"]
    }
  }
}
```

### Step 4: Start the Chat Daemon

```bash
ralph chat start
```

The bot will respond to commands in the allowed chats.

### Telegram Commands

| Command | Description |
|---------|-------------|
| `/run` | Start ralph automation |
| `/run feature` | Run only feature tasks |
| `/status` | Show PRD progress |
| `/add Fix the login bug` | Add a new task |
| `/exec npm test` | Execute a shell command |
| `/stop` | Stop running ralph process |
| `/action build` | Execute a daemon action |
| `/claude Fix the CSS` | Run Claude Code with a prompt |
| `/branch list` | List branches and their status |
| `/help` | Show available commands |

---

## Slack Setup

Slack requires more setup but provides deeper workspace integration with slash commands.

### Step 1: Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name your app (e.g., "Ralph Automation")
4. Select your workspace
5. Click **Create App**

### Step 2: Enable Socket Mode

Socket Mode allows the bot to receive events without a public URL.

1. In your app settings, go to **Socket Mode**
2. Toggle **Enable Socket Mode** to ON
3. Click **Generate Token**
4. Name it (e.g., "ralph-socket")
5. Copy the **App-Level Token** (starts with `xapp-`)

### Step 3: Configure Bot Token

1. Go to **OAuth & Permissions**
2. Under **Scopes** → **Bot Token Scopes**, add:
   - `chat:write` - Send messages
   - `channels:history` - Read channel messages
   - `groups:history` - Read private channel messages
   - `im:history` - Read DMs
   - `commands` - Use slash commands
3. Click **Install to Workspace** at the top
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### Step 4: Get Signing Secret

1. Go to **Basic Information**
2. Under **App Credentials**, copy the **Signing Secret**

### Step 5: Configure Event Subscriptions

1. Go to **Event Subscriptions**
2. Toggle **Enable Events** to ON
3. Under **Subscribe to bot events**, add:
   - `message.channels` - Messages in public channels
   - `message.groups` - Messages in private channels
   - `message.im` - Direct messages
4. Click **Save Changes**

### Step 6: Create Slash Command (Optional)

1. Go to **Slash Commands**
2. Click **Create New Command**:

| Command | Request URL | Description |
|---------|-------------|-------------|
| `/ralph` | (leave empty for Socket Mode) | Ralph unified command (use subcommands like `/ralph run`, `/ralph status`) |

### Step 7: Get Channel IDs

1. Right-click on a channel in Slack
2. Select **View channel details** (or **Copy link**)
3. The channel ID is the last part of the URL (e.g., `C0123456789`)

### Step 8: Install Dependencies

```bash
npm install @slack/bolt @slack/web-api
```

### Step 9: Configure Ralph

Add to `.ralph/config.json`:

```json
{
  "chat": {
    "enabled": true,
    "provider": "slack",
    "slack": {
      "botToken": "xoxb-your-bot-token",
      "appToken": "xapp-your-app-token",
      "signingSecret": "your-signing-secret",
      "allowedChannelIds": ["C0123456789"]
    }
  }
}
```

### Step 10: Start the Chat Daemon

```bash
ralph chat start
```

### Slack Commands

Use the `/ralph` slash command with subcommands, or message the bot directly:

| Command | Description |
|---------|-------------|
| `/ralph run` or `/ralph run feature` | Start automation |
| `/ralph status` | Show PRD progress |
| `/ralph add Fix the bug` | Add a task |
| `/ralph exec npm test` | Execute command |
| `/ralph stop` | Stop ralph |
| `/ralph action build` | Execute action |
| `/ralph branch list` | Manage branches |
| `/ralph Fix CSS` | Run Claude Code (any unrecognized subcommand) |

---

## Discord Setup

Discord provides bot integration with slash commands and button interactions.

### Step 1: Create a Discord Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application**
3. Name your app (e.g., "Ralph Automation")
4. Click **Create**

### Step 2: Create a Bot

1. Go to the **Bot** section in your app
2. Click **Add Bot** → **Yes, do it!**
3. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** (required to read message content)
4. Under **Token**, click **Reset Token** and copy it

### Step 3: Configure OAuth2 and Invite the Bot

1. Go to **OAuth2** → **URL Generator**
2. Under **Scopes**, select:
   - `bot`
   - `applications.commands`
3. Under **Bot Permissions**, select:
   - Send Messages
   - Read Message History
   - Use Slash Commands
4. Copy the generated URL and open it in your browser
5. Select your server and click **Authorize**

### Step 4: Get Server and Channel IDs

1. In Discord, enable Developer Mode:
   - User Settings → App Settings → Advanced → Developer Mode
2. Right-click on your server icon → **Copy Server ID** (this is the Guild ID)
3. Right-click on a channel → **Copy Channel ID**

### Step 5: Install Dependencies

```bash
npm install discord.js
```

### Step 6: Configure Ralph

Add to `.ralph/config.json`:

```json
{
  "chat": {
    "enabled": true,
    "provider": "discord",
    "discord": {
      "botToken": "your-discord-bot-token",
      "allowedGuildIds": ["123456789012345678"],
      "allowedChannelIds": ["987654321098765432"]
    }
  }
}
```

### Step 7: Start the Chat Daemon

```bash
ralph chat start
```

The first time the bot connects, it will register slash commands with Discord. This may take a few minutes to propagate.

### Discord Commands

Use slash commands (type `/` to see available commands):

| Command | Description |
|---------|-------------|
| `/run` | Start automation |
| `/run category:feature` | Run specific category |
| `/status` | Show PRD progress |
| `/add description:Fix the bug` | Add a task |
| `/exec command:npm test` | Execute command |
| `/stop` | Stop ralph |
| `/action name:build` | Execute action |
| `/claude prompt:Fix CSS` | Run Claude Code |

---

## Configuration Reference

### Full Config Example

```json
{
  "chat": {
    "enabled": true,
    "provider": "telegram",
    "telegram": {
      "enabled": true,
      "botToken": "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ",
      "allowedChatIds": ["123456789", "-987654321"]
    },
    "slack": {
      "enabled": false,
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "signingSecret": "...",
      "allowedChannelIds": ["C0123456789"]
    },
    "discord": {
      "enabled": false,
      "botToken": "...",
      "allowedGuildIds": ["123456789012345678"],
      "allowedChannelIds": ["987654321098765432"]
    }
  }
}
```

### Config Options

| Field | Type | Description |
|-------|------|-------------|
| `chat.enabled` | boolean | Enable/disable chat integration |
| `chat.provider` | string | Active provider: `"telegram"`, `"slack"`, or `"discord"` |

#### Telegram Settings

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `telegram.enabled` | boolean | No | Enable/disable (default: true if botToken set) |
| `telegram.botToken` | string | Yes | Bot API token from @BotFather |
| `telegram.allowedChatIds` | string[] | No | Restrict to specific chat IDs |

#### Slack Settings

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `slack.enabled` | boolean | No | Enable/disable (default: true if tokens set) |
| `slack.botToken` | string | Yes | Bot User OAuth Token (xoxb-...) |
| `slack.appToken` | string | Yes | App-Level Token for Socket Mode (xapp-...) |
| `slack.signingSecret` | string | Yes | Signing Secret for request verification |
| `slack.allowedChannelIds` | string[] | No | Restrict to specific channel IDs |

#### Discord Settings

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `discord.enabled` | boolean | No | Enable/disable (default: true if botToken set) |
| `discord.botToken` | string | Yes | Bot token from Developer Portal |
| `discord.allowedGuildIds` | string[] | No | Restrict to specific server IDs |
| `discord.allowedChannelIds` | string[] | No | Restrict to specific channel IDs |

---

## Using the TUI Config Editor

Ralph includes a terminal UI config editor that makes setup easier:

```bash
ralph config
```

1. Navigate to the **Chat** section
2. Press `p` to select a preset (Telegram, Slack, or Discord)
3. Fill in your credentials
4. Press `S` to save

---

## Daemon Notifications

You can also configure the daemon to send notifications to chat when events occur:

```json
{
  "daemon": {
    "actions": {
      "notify": {
        "command": "ralph notify"
      }
    },
    "events": {
      "task_complete": [
        { "action": "telegram_notify", "message": "✅ Task complete: {{task}}" }
      ],
      "ralph_complete": [
        { "action": "telegram_notify", "message": "🎉 All tasks complete!" }
      ],
      "error": [
        { "action": "telegram_notify", "message": "❌ Error: {{error}}" }
      ]
    }
  }
}
```

Built-in notification actions (available when daemon is running):
- `telegram_notify` - Send via Telegram
- `slack_notify` - Send via Slack
- `discord_notify` - Send via Discord

---

## Troubleshooting

### General Issues

#### "Chat daemon not responding"

1. Check that the daemon is running:
   ```bash
   ralph chat status
   ```

2. Start the daemon if it's not running:
   ```bash
   ralph chat start
   ```

3. Check your credentials are correct in config.json

#### "Command not recognized"

Make sure you're using the correct command format:
- Telegram: `/run`, `/status`, etc.
- Slack: `/run` or message the bot
- Discord: `/run` (slash commands)

### Telegram Issues

#### "Unauthorized chat" messages not appearing

Your chat ID may not be in `allowedChatIds`. Get your chat ID:

```bash
curl "https://api.telegram.org/botYOUR_TOKEN/getUpdates"
```

Look for `"chat":{"id":...}` in the response.

#### Bot not responding in groups

1. Make sure the bot is added to the group
2. In BotFather, use `/setprivacy` and set to DISABLED to receive all messages
3. Or mention the bot directly with commands

### Slack Issues

#### "Failed to load Slack modules"

Install the required packages:

```bash
npm install @slack/bolt @slack/web-api
```

#### "Socket Mode connection failed"

1. Verify Socket Mode is enabled in your Slack app settings
2. Check that your App Token (xapp-...) is correct
3. Make sure the App Token has the `connections:write` scope

#### Slash commands not appearing

1. Reinstall the app to your workspace from the OAuth & Permissions page
2. Wait a few minutes for changes to propagate
3. Try refreshing Slack (Cmd+R / Ctrl+R)

### Discord Issues

#### "Failed to load Discord modules"

Install the required package:

```bash
npm install discord.js
```

#### "Missing Intents"

Make sure **Message Content Intent** is enabled in the Discord Developer Portal under Bot settings.

#### Slash commands not appearing

1. Discord can take up to an hour to register global commands
2. Try kicking and re-inviting the bot
3. Check the bot has `applications.commands` scope

#### "Missing Access" errors

Ensure the bot has permissions in the channel:
1. Right-click the channel → Edit Channel
2. Go to Permissions
3. Add the bot role with Send Messages and Read Message History

### Connection Timeouts

If the chat daemon keeps disconnecting:

1. Check your internet connection
2. Verify your tokens haven't expired or been revoked
3. Check rate limits (don't send too many messages)

### Security Best Practices

1. **Always use `allowedChatIds`/`allowedChannelIds`** to restrict which chats can control Ralph
2. **Never commit tokens** to version control - use environment variables or `.gitignore` your config
3. **Rotate tokens** periodically and if you suspect they've been compromised
4. **Limit permissions** - only grant the minimum required scopes

---

## Related Documentation

- [Daemon Configuration](../README.md#daemon-configuration) - Host daemon setup
- [Notifications](../README.md#notifications) - Notification system setup
- [Docker Sandbox](./DOCKER.md) - Running Ralph in containers
