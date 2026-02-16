# Ralph Chat Architecture

## Overview

The Ralph CLI chat system enables external control of Ralph projects via chat platforms (Slack, Discord, Telegram). It consists of two main components that communicate via a file-based message queue.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SLACK / DISCORD                                 │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ /ralph cmd   │  │ @bot mention │  │ @qa @review  │  │ Thread replies   │ │
│  │ (slash cmd)  │  │ (app_mention)│  │ (responders) │  │ (continuation)   │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘ │
└─────────┼─────────────────┼─────────────────┼───────────────────┼───────────┘
          │                 │                 │                   │
          ▼                 ▼                 ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         HOST: ralph chat start                               │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                        CHAT PROVIDER (Slack/Discord)                   │  │
│  │                                                                        │  │
│  │  ┌─────────────┐    ┌─────────────────┐    ┌──────────────────────┐   │  │
│  │  │ Event       │───▶│ ResponderMatcher │───▶│ Thread Conversations │   │  │
│  │  │ Handlers    │    │ (@qa, @review)   │    │ (multi-turn memory)  │   │  │
│  │  └─────────────┘    └────────┬────────┘    └──────────────────────┘   │  │
│  │                              │                                         │  │
│  └──────────────────────────────┼─────────────────────────────────────────┘  │
│                                 │                                            │
│         ┌───────────────────────┼───────────────────────┐                    │
│         ▼                       ▼                       ▼                    │
│  ┌─────────────┐    ┌───────────────────┐    ┌───────────────────┐          │
│  │ LLM         │    │ Claude Code       │    │ CLI Responder     │          │
│  │ Responder   │    │ Responder         │    │ (shell commands)  │          │
│  │             │    │                   │    │                   │          │
│  │ ┌─────────┐ │    │ claude -p "..."   │    │ eslint, etc.      │          │
│  │ │Anthropic│ │    │ --print           │    │                   │          │
│  │ │ OpenAI  │ │    │                   │    │                   │          │
│  │ └─────────┘ │    └───────────────────┘    └───────────────────┘          │
│  │             │                                                             │
│  │ ┌─────────┐ │                                                             │
│  │ │Git Diff │ │    /ralph commands (run, status, exec, etc.)                │
│  │ │Keywords │ │                    │                                        │
│  │ └─────────┘ │                    ▼                                        │
│  └─────────────┘    ┌───────────────────────────────────────┐               │
│                     │           Command Handler              │               │
│                     │  run, stop, status, exec, add, claude, │               │
│                     │  help, start, action, branch           │               │
│                     └───────────────────┬───────────────────┘               │
│                                         │                                    │
│                                         ▼                                    │
│                     ┌───────────────────────────────────────┐               │
│                     │         .ralph/messages.json           │               │
│                     │         (Message Queue)                │               │
│                     └───────────────────┬───────────────────┘               │
└─────────────────────────────────────────┼────────────────────────────────────┘
                                          │
                    ══════════════════════╪══════════════════════
                          DOCKER BOUNDARY │ (volume mount)
                    ══════════════════════╪══════════════════════
                                          │
┌─────────────────────────────────────────┼────────────────────────────────────┐
│                                         ▼                                    │
│                     ┌───────────────────────────────────────┐               │
│                     │    /workspace/.ralph/messages.json     │               │
│                     │         (same file via mount)          │               │
│                     └───────────────────┬───────────────────┘               │
│                                         │                                    │
│                                         ▼                                    │
│                     ┌───────────────────────────────────────┐               │
│                     │         ralph listen                   │               │
│                     │    (polls for pending messages)        │               │
│                     └───────────────────┬───────────────────┘               │
│                                         │                                    │
│         ┌───────────────────────────────┼───────────────────┐               │
│         ▼                               ▼                   ▼               │
│  ┌─────────────┐            ┌───────────────┐      ┌─────────────┐          │
│  │ ralph run   │            │ exec command  │      │ ralph       │          │
│  │ --category  │            │ (shell)       │      │ status      │          │
│  └─────────────┘            └───────────────┘      └─────────────┘          │
│                                                                              │
│                         CONTAINER: ralph listen                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Responder Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Message: "@review last"                       │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ResponderMatcher                              │
│                                                                  │
│  1. Check @mention triggers: @qa, @review, @arch, @explain, @code│
│  2. Check keyword triggers: !lint, help                          │
│  3. Fall back to default responder                               │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Match: @review → "reviewer"                   │
│                    Args: "last"                                  │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LLM Responder                                 │
│                                                                  │
│  1. Detect git keyword: "last" → git show HEAD --stat --patch   │
│  2. Fetch git diff content                                       │
│  3. Build message with diff                                      │
│  4. Load conversation history (if thread)                        │
│  5. Send to LLM (Anthropic/OpenAI/Ollama)                       │
│  6. Log to .ralph/logs/responder-YYYY-MM-DD.log                 │
│  7. Return response                                              │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Store in Thread Conversation                  │
│                                                                  │
│  threadConversations.set(threadTs, {                            │
│    responderName: "reviewer",                                    │
│    messages: [                                                   │
│      { role: "user", content: "..." },                          │
│      { role: "assistant", content: "..." }                       │
│    ]                                                             │
│  })                                                              │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Reply in Slack Thread                         │
└─────────────────────────────────────────────────────────────────┘
```

## Thread Conversation Flow

```
Thread Start                    Thread Continuation
─────────────                   ───────────────────

User: @review diff              User: What about security?
        │                               │
        ▼                               ▼
ResponderMatcher              Check threadConversations
matches "@review"             ─────────────────────────
        │                     Found existing conversation
        ▼                     for this thread_ts
Execute LLM with                        │
git diff content                        ▼
        │                     Execute LLM with:
        ▼                     - Previous messages (history)
Store conversation            - New user message
in threadConversations                  │
        │                               ▼
        ▼                     Append to conversation
Reply in thread               history (max 20 messages)
                                        │
                                        ▼
                              Reply in thread
```

## Message Queue Format

The messages file stores a direct JSON array (no wrapper object):

```json
[
  {
    "id": "uuid-1234",
    "from": "host",
    "action": "run",
    "args": ["feature"],
    "timestamp": 1706789012345,
    "status": "pending"
  },
  {
    "id": "uuid-1234",
    "from": "host",
    "action": "run",
    "args": ["feature"],
    "timestamp": 1706789012345,
    "status": "done",
    "response": {
      "success": true,
      "output": "Ralph run started (category: feature)"
    }
  }
]
```

Fields:
- `from`: `"sandbox"` or `"host"`
- `args`: optional string array
- `status`: `"pending"` or `"done"`
- `response`: optional, contains `success` (boolean), `output` (optional string), and `error` (optional string)

## Git Diff Keywords

| Keyword | Git Command | Description |
|---------|-------------|-------------|
| `diff` / `changes` | `git diff` | Unstaged changes |
| `staged` | `git diff --cached` | Staged changes |
| `last` / `last commit` | `git show HEAD --stat --patch` | Last commit |
| `all` | `git diff HEAD` | All uncommitted |
| `HEAD~N` | `git show HEAD~N --stat --patch` | N commits ago |

## Responder Types

| Type | Description | Example Trigger |
|------|-------------|-----------------|
| `llm` | Send to LLM (Anthropic/OpenAI/Ollama) | `@qa`, `@review` |
| `claude-code` | Spawn Claude Code CLI | `@code` |
| `cli` | Run shell command | `!lint` |

## Configuration

```json
{
  "chat": {
    "provider": "slack",
    "slack": {
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "signingSecret": "...",
      "allowedChannelIds": ["C1234567890"]
    },
    "responders": {
      "qa": {
        "type": "llm",
        "trigger": "@qa",
        "provider": "anthropic",
        "systemPrompt": "You are a QA assistant for {{project}}..."
      }
    }
  }
}
```

## File Locations

```
Host Machine                          Container
────────────                          ─────────
.ralph/
├── config.json                       /workspace/.ralph/
├── chat-state.json                   ├── messages.json (shared)
├── messages.json ◄──── mount ────►   ├── run.pid
└── logs/                             └── ...
    └── responder-YYYY-MM-DD.log
```
