# Chat Responders

Chat responders allow your Ralph chat bot to intelligently respond to messages using LLMs, Claude Code, or custom CLI commands. Instead of just executing commands, your bot can answer questions about your codebase, review code, or run custom automation scripts.

## Overview

Responders are message handlers that process incoming chat messages based on trigger patterns. When a message matches a responder's trigger, the message content is sent to the configured handler (LLM, Claude Code, or CLI command) and the response is sent back to the chat.

### Responder Types

| Type | Description | Use Case |
|------|-------------|----------|
| `llm` | Send message to an LLM provider (Anthropic, OpenAI, Ollama) | Q&A, code review, explanations |
| `claude-code` | Run Claude Code CLI with the message as prompt | File modifications, complex tasks |
| `cli` | Execute a custom CLI command | Run aider, linters, custom scripts |

### Trigger Patterns

| Pattern | Example | Matches |
|---------|---------|---------|
| `@mention` | `@qa` | Messages starting with `@qa what does this function do?` |
| `keyword` | `!lint` | Messages starting with `!lint src/index.ts` |
| (none) | - | Default responder for messages that don't match any trigger |

---

## Quick Start

### 1. Configure LLM Providers

Add your LLM provider credentials to `.ralph/config.json`:

```json
{
  "llmProviders": {
    "anthropic": {
      "type": "anthropic",
      "model": "claude-sonnet-4-20250514"
    },
    "openai": {
      "type": "openai",
      "model": "gpt-4o"
    },
    "ollama": {
      "type": "ollama",
      "model": "llama3",
      "baseUrl": "http://localhost:11434"
    }
  }
}
```

API keys can be set via environment variables:
- `ANTHROPIC_API_KEY` for Anthropic
- `OPENAI_API_KEY` for OpenAI
- Ollama doesn't require an API key

### 2. Configure Responders

Add responders to your chat configuration:

```json
{
  "chat": {
    "enabled": true,
    "provider": "telegram",
    "telegram": {
      "botToken": "your-bot-token",
      "allowedChatIds": ["123456789"]
    },
    "responders": {
      "qa": {
        "type": "llm",
        "trigger": "@qa",
        "provider": "anthropic",
        "systemPrompt": "You are a helpful assistant for the {{project}} project. Answer questions about the codebase."
      },
      "code": {
        "type": "claude-code",
        "trigger": "@code"
      },
      "lint": {
        "type": "cli",
        "trigger": "!lint",
        "command": "npm run lint"
      }
    }
  }
}
```

### 3. Start the Chat Daemon

```bash
ralph chat start
```

Now you can message your bot:
- `@qa What does the config loader do?` - Get an LLM-powered answer
- `@code Add error handling to the login function` - Claude Code modifies files
- `!lint src/` - Run the linter

---

## LLM Provider Setup

### Anthropic (Claude)

The recommended provider for high-quality responses.

```json
{
  "llmProviders": {
    "anthropic": {
      "type": "anthropic",
      "model": "claude-sonnet-4-20250514"
    }
  }
}
```

**Environment variable:** `ANTHROPIC_API_KEY`

**Available models:**
- `claude-sonnet-4-20250514` (recommended - fast and capable)
- `claude-opus-4-20250514` (most capable, slower)

### OpenAI

```json
{
  "llmProviders": {
    "openai": {
      "type": "openai",
      "model": "gpt-4o"
    }
  }
}
```

**Environment variable:** `OPENAI_API_KEY`

**Available models:**
- `gpt-4o` (recommended)
- `gpt-4o-mini` (faster, cheaper)
- `gpt-4-turbo`

### Ollama (Local)

Run models locally without API keys.

```json
{
  "llmProviders": {
    "local": {
      "type": "ollama",
      "model": "llama3",
      "baseUrl": "http://localhost:11434"
    }
  }
}
```

**Setup:**
1. Install Ollama: https://ollama.ai
2. Pull a model: `ollama pull llama3`
3. Start Ollama: `ollama serve`

**Popular models:**
- `llama3` - General purpose
- `codellama` - Code-focused
- `mistral` - Fast and capable

### Custom API Endpoints

For OpenAI-compatible APIs (e.g., Azure OpenAI, local servers):

```json
{
  "llmProviders": {
    "azure": {
      "type": "openai",
      "model": "gpt-4",
      "apiKey": "your-azure-api-key",
      "baseUrl": "https://your-resource.openai.azure.com/openai/deployments/gpt-4"
    }
  }
}
```

---

## Responder Types

### LLM Responder

Send messages to an LLM and return the response.

```json
{
  "qa": {
    "type": "llm",
    "trigger": "@qa",
    "provider": "anthropic",
    "systemPrompt": "You are a Q&A assistant for {{project}}. Answer questions about the codebase.",
    "timeout": 60000,
    "maxLength": 2000
  }
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `type` | string | Yes | - | Must be `"llm"` |
| `trigger` | string | No | - | Trigger pattern (`@mention` or `keyword`) |
| `provider` | string | No | `"anthropic"` | LLM provider name from `llmProviders` config |
| `systemPrompt` | string | No | - | System prompt (supports `{{project}}` placeholder) |
| `timeout` | number | No | `60000` | Timeout in milliseconds |
| `maxLength` | number | No | `2000` | Max response length in characters |

**System Prompt Placeholder:**
- `{{project}}` - Replaced with the project directory name

#### Automatic File Detection

LLM responders automatically detect file paths mentioned in messages and include their contents in the context. This allows you to ask questions about specific files without manually copying code.

**Supported formats:**
- `src/utils/config.ts` - Full file path
- `src/utils/config.ts:42` - File with line number (shows context around that line)
- `./relative/path.js` - Relative paths
- `package.json` - Root-level files
- `Dockerfile`, `Makefile`, `.gitignore`, `.env` - Config files without extensions

**Example:**
```
@qa What does the loadConfig function do in src/utils/config.ts:50?
```

The responder will automatically read the file, extract ~20 lines around line 50, and include it in the LLM context.

**Limits:**
- Max 50KB total file content per message
- Max 30KB per individual file
- Files larger than 100KB are skipped
- 50+ file extensions supported (ts, js, py, go, rs, java, etc.)

#### Git Diff Keywords

LLM responders recognize git-related keywords and automatically include relevant diffs:

| Keyword | Git Command | Description |
|---------|-------------|-------------|
| `diff` / `changes` | `git diff` | Unstaged changes |
| `staged` | `git diff --cached` | Staged changes |
| `last` / `last commit` | `git show HEAD` | Last commit |
| `all` | `git diff HEAD` | All uncommitted changes |
| `HEAD~N` | `git show HEAD~N` | Specific commit (e.g., `HEAD~2`) |

**Examples:**
```
@review diff           # Review unstaged changes
@review last           # Review the last commit
@review staged         # Review staged changes
@qa what changed in HEAD~3?  # Ask about a specific commit
```

#### Multi-Turn Thread Conversations

When using Slack or Discord, responders support multi-turn conversations within threads:

1. Start a conversation with a trigger (e.g., `@review diff`)
2. The response appears in a thread
3. Reply in the thread to continue the conversation
4. The responder maintains context from previous messages (up to 20 messages)

**How it works:**
- Thread replies don't need the trigger prefix
- The same responder handles all messages in a thread
- Conversation history is included in each LLM call
- History is stored in memory (cleared on restart)

**Example thread:**
```
User: @review diff
Bot: [Reviews the diff, identifies potential issues]

User: Can you explain the change to the config loader?
Bot: [Explains with full context from previous messages]

User: How would you refactor this?
Bot: [Suggests refactoring based on the entire conversation]
```

### Claude Code Responder

Run Claude Code CLI to make file modifications or perform complex coding tasks.

```json
{
  "code": {
    "type": "claude-code",
    "trigger": "@code",
    "timeout": 300000,
    "maxLength": 2000
  }
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `type` | string | Yes | - | Must be `"claude-code"` |
| `trigger` | string | No | - | Trigger pattern |
| `timeout` | number | No | `300000` | Timeout in milliseconds (5 minutes) |
| `maxLength` | number | No | `2000` | Max response length in characters |

**Note:** Claude Code runs with `--dangerously-skip-permissions` for autonomous operation. Use with caution and only in trusted environments.

### CLI Responder

Execute custom CLI commands with the user's message.

```json
{
  "lint": {
    "type": "cli",
    "trigger": "!lint",
    "command": "npm run lint {{message}}",
    "timeout": 120000,
    "maxLength": 2000
  }
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `type` | string | Yes | - | Must be `"cli"` |
| `trigger` | string | No | - | Trigger pattern |
| `command` | string | Yes | - | Command to execute |
| `timeout` | number | No | `120000` | Timeout in milliseconds (2 minutes) |
| `maxLength` | number | No | `2000` | Max response length in characters |

**Command Placeholder:**
- `{{message}}` - Replaced with the user's message (properly escaped)
- If no placeholder is present, the message is appended as a quoted argument

**Examples:**

```json
{
  "aider": {
    "type": "cli",
    "trigger": "@aider",
    "command": "aider --message '{{message}}'",
    "timeout": 300000
  },
  "test": {
    "type": "cli",
    "trigger": "!test",
    "command": "npm test"
  },
  "grep": {
    "type": "cli",
    "trigger": "!grep",
    "command": "grep -rn"
  }
}
```

---

## Trigger Patterns and Matching

### Mention Triggers (`@name`)

Match when the message starts with `@name`:

```
@qa what does this function do?
@review check this code for bugs
@code add logging to the auth module
```

The responder receives the text after the mention as the message.

### Keyword Triggers

Match when the message starts with a keyword:

```
!lint src/
help me understand this error
debug: the login is broken
```

Keywords can be any text that identifies the command.

### Default Responder

Handle messages that don't match any trigger:

```json
{
  "default": {
    "type": "llm",
    "provider": "anthropic",
    "systemPrompt": "You are a helpful assistant."
  }
}
```

Note: The default responder has no trigger field or is named "default".

### Matching Priority

1. **Mention triggers** (`@name`) - Highest priority
2. **Keyword triggers** - Match by prefix
3. **Default responder** - Fallback

---

## Preset Configurations

Ralph includes preset responder configurations for common use cases. Select presets during `ralph init` or add them manually.

### Available Presets

| Preset | Trigger | Type | Description |
|--------|---------|------|-------------|
| `qa` | `@qa` | LLM | Q&A about the codebase |
| `reviewer` | `@review` | LLM | Code review feedback |
| `architect` | `@arch` | LLM | Architecture discussions |
| `explain` | `@explain` | LLM | Detailed code explanations |
| `code` | `@code` | Claude Code | File modifications |

### Preset Bundles

| Bundle | Presets | Description |
|--------|---------|-------------|
| `standard` | qa, reviewer, code | Common workflow (recommended) |
| `full` | All presets | Complete feature set |
| `minimal` | qa, code | Just the essentials |

### Using Presets

**During initialization:**
```bash
ralph init
# Answer "Yes" when asked about chat responders
# Select a bundle or individual presets
```

**Manual configuration:**

Copy preset configs from `src/config/responder-presets.json` or use these examples:

```json
{
  "chat": {
    "responders": {
      "qa": {
        "type": "llm",
        "trigger": "@qa",
        "provider": "anthropic",
        "systemPrompt": "You are a knowledgeable Q&A assistant for the {{project}} project. Answer questions accurately and concisely about the codebase, its architecture, and functionality.",
        "timeout": 60000,
        "maxLength": 2000
      },
      "code": {
        "type": "claude-code",
        "trigger": "@code",
        "timeout": 300000,
        "maxLength": 2000
      }
    }
  }
}
```

---

## Example Configurations

### Basic Q&A Bot

Simple setup for answering questions about your project:

```json
{
  "llmProviders": {
    "anthropic": {
      "type": "anthropic",
      "model": "claude-sonnet-4-20250514"
    }
  },
  "chat": {
    "enabled": true,
    "provider": "telegram",
    "telegram": {
      "botToken": "YOUR_BOT_TOKEN",
      "allowedChatIds": ["YOUR_CHAT_ID"]
    },
    "responders": {
      "default": {
        "type": "llm",
        "provider": "anthropic",
        "systemPrompt": "You are a helpful assistant for the {{project}} project. Answer questions about the codebase, explain how things work, and help with development tasks."
      }
    }
  }
}
```

### Multi-Purpose Development Bot

A complete development assistant with multiple responders:

```json
{
  "llmProviders": {
    "anthropic": {
      "type": "anthropic",
      "model": "claude-sonnet-4-20250514"
    },
    "local": {
      "type": "ollama",
      "model": "codellama",
      "baseUrl": "http://localhost:11434"
    }
  },
  "chat": {
    "enabled": true,
    "provider": "slack",
    "slack": {
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "signingSecret": "...",
      "allowedChannelIds": ["C0123456789"]
    },
    "responders": {
      "qa": {
        "type": "llm",
        "trigger": "@qa",
        "provider": "anthropic",
        "systemPrompt": "Answer questions about the {{project}} codebase."
      },
      "review": {
        "type": "llm",
        "trigger": "@review",
        "provider": "anthropic",
        "systemPrompt": "Review the provided code for bugs, security issues, and improvements."
      },
      "code": {
        "type": "claude-code",
        "trigger": "@code",
        "timeout": 300000
      },
      "lint": {
        "type": "cli",
        "trigger": "!lint",
        "command": "npm run lint"
      },
      "test": {
        "type": "cli",
        "trigger": "!test",
        "command": "npm test"
      },
      "quick": {
        "type": "llm",
        "trigger": "@quick",
        "provider": "local",
        "systemPrompt": "Give brief, direct answers."
      }
    }
  }
}
```

### Aider Integration

Use Aider as a responder for code modifications:

```json
{
  "chat": {
    "responders": {
      "aider": {
        "type": "cli",
        "trigger": "@aider",
        "command": "aider --yes --message '{{message}}'",
        "timeout": 600000,
        "maxLength": 3000
      }
    }
  }
}
```

---

## Troubleshooting

### API Key and Connection Issues

#### "API key not found"

Set the appropriate environment variable:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
```

Or add the key directly to config (not recommended for production):

```json
{
  "llmProviders": {
    "anthropic": {
      "type": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "apiKey": "sk-ant-..."
    }
  }
}
```

#### "LLM provider not found"

Make sure the provider name in the responder matches a key in `llmProviders`:

```json
{
  "llmProviders": {
    "my-claude": {  // This name...
      "type": "anthropic",
      "model": "claude-sonnet-4-20250514"
    }
  },
  "chat": {
    "responders": {
      "qa": {
        "type": "llm",
        "provider": "my-claude"  // ...must match here
      }
    }
  }
}
```

#### "Ollama connection failed"

1. Check Ollama is running: `ollama list`
2. Verify the base URL matches your Ollama server
3. Try: `curl http://localhost:11434/api/tags`

### Responder Not Triggering

#### Message doesn't match trigger

- Mention triggers must be at the start: `@qa question` (not `question @qa`)
- Check case sensitivity (triggers are case-insensitive for matching)
- Ensure no extra whitespace before the trigger

#### Bot not responding at all

1. Check the chat daemon is running: `ralph chat status`
2. Verify responders are configured in config.json
3. Check the chat ID is in `allowedChatIds`

### Response Issues

#### Response is truncated

Increase `maxLength` in the responder config:

```json
{
  "qa": {
    "type": "llm",
    "maxLength": 4000
  }
}
```

Note: Chat platforms have their own limits (Telegram: 4096 chars, Slack: 40000 chars, Discord: 2000 chars).

#### Response times out

Increase `timeout` in the responder config:

```json
{
  "code": {
    "type": "claude-code",
    "timeout": 600000  // 10 minutes
  }
}
```

#### CLI command not working

1. Test the command manually in the terminal
2. Check the command path is correct
3. Ensure required tools are installed in the execution environment
4. Check the `{{message}}` placeholder is properly placed

### Claude Code Issues

#### "Failed to spawn claude"

Ensure Claude Code is installed and in PATH:

```bash
which claude
claude --version
```

#### "Claude Code timed out"

Increase the timeout for complex tasks:

```json
{
  "code": {
    "type": "claude-code",
    "timeout": 600000  // 10 minutes
  }
}
```

---

## Auto-Send Run Results

When a chat provider (Slack, Telegram, or Discord) is configured and enabled, Ralph automatically sends notifications about `ralph run` progress to your chat:

| Event | Message |
|-------|---------|
| Task Complete | "Task completed: [description]" |
| Iteration Complete | "Iteration complete" |
| PRD Complete | "All PRD tasks complete!" |
| Run Stopped | "Run stopped: [reason]" |
| Error | "Error: [message]" |

**Requirements:**
- Chat provider must be configured in `.ralph/config.json`
- `chat.enabled` must be `true`
- Bot must have permission to send messages to the configured channel/chat

**Example config:**
```json
{
  "chat": {
    "enabled": true,
    "provider": "slack",
    "slack": {
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "allowedChannelIds": ["C0123456789"]
    }
  }
}
```

With this configuration, running `ralph run` or `ralph docker run` will automatically post updates to your Slack channel.

---

## Security Considerations

1. **Restrict chat access** - Always use `allowedChatIds`/`allowedChannelIds`
2. **Be cautious with `claude-code`** - It can modify files autonomously
3. **Validate CLI commands** - Don't expose dangerous system commands
4. **Protect API keys** - Use environment variables, not hardcoded values
5. **Run in containers** - Use Ralph's Docker sandbox for isolation

---

## Related Documentation

- [Chat Clients Setup](./CHAT-CLIENTS.md) - Setting up Telegram, Slack, Discord
- [Chat Architecture](./chat-architecture.md) - Technical architecture diagrams and message flow
- [Docker Sandbox](./DOCKER.md) - Running Ralph in containers
- [Daemon Actions](./USEFUL_ACTIONS.md) - Host daemon configuration
