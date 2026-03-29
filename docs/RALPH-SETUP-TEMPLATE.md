# Ralph Project Setup Template

Copy this template, fill in the fields, then paste to Claude Code.

---

## Project Info

```
PROJECT_NAME: _______________
DESCRIPTION:  _______________
REPO_URL:     _______________ (optional)
```

## Tech Stack (check one)

- [ ] Node.js / TypeScript (pnpm)
- [ ] Node.js / TypeScript (npm)
- [ ] Node.js / TypeScript (bun)
- [ ] Python (pip)
- [ ] Python (poetry)
- [ ] Python (uv)
- [ ] Go
- [ ] Rust
- [ ] Other: _______________

## API Providers (check all that apply)

- [ ] Anthropic Claude
- [ ] OpenAI
- [ ] Google AI
- [ ] AWS
- [ ] Telegram
- [ ] Slack
- [ ] Discord
- [ ] Supabase
- [ ] Firebase
- [ ] Other: _______________

## Notifications (optional)

- [ ] ntfy.sh - Topic: _______________
- [ ] Custom command: _______________
- [ ] None

## Daemon Events (optional)

- [ ] Log task completions to file
- [ ] Log ralph completion to file
- [ ] Send webhook on completion: _______________
- [ ] None

## Project Concept

```
Describe what you want to build. Be specific about:
- Core functionality
- Key features
- External integrations
- Expected behavior
```

---

## Instructions for Claude Code

After filling in the template above, paste it to Claude Code with this prompt:

```
Set up a Ralph CLI project based on the configuration above.

1. Run `ralph init -y` to initialize
2. Edit `.ralph/config.json`:
   - Set language, checkCommand, testCommand for the tech stack
   - Add allowed domains to docker.firewall.allowedDomains
   - Configure notifications if selected (see Reference below)
   - Configure daemon events if selected (see Reference below)
3. Regenerate Docker files: `ralph docker init <language>`
4. Create `.ralph/prd.yaml` with tasks based on the concept
5. Verify with `ralph list` and `ralph status`
6. Start daemon on host (if using notifications): `ralph daemon start`
```

---

## Reference

### Config Values by Tech Stack

| Stack | language | checkCommand | testCommand |
|-------|----------|--------------|-------------|
| Node/TS (npm) | `node` | `npm run typecheck` | `npm test` |
| Node/TS (bun) | `bun` | `bun check` | `bun test` |
| Python | `python` | `mypy .` | `pytest` |
| Go | `go` | `go build ./...` | `go test ./...` |
| Rust | `rust` | `cargo check` | `cargo test` |

### Firewall Domains

The Docker firewall allows these domains by default: `github.com`, `api.github.com`, `raw.githubusercontent.com`, `registry.npmjs.org`, `api.anthropic.com`.

Add additional domains to `docker.firewall.allowedDomains` in `.ralph/config.json` based on your stack:

| Stack | Recommended Additions |
|-------|----------------------|
| Python | `pypi.org`, `files.pythonhosted.org` |
| Go | `proxy.golang.org`, `sum.golang.org` |
| Rust | `crates.io`, `static.crates.io` |

### API Provider Domains

Add these to `docker.firewall.allowedDomains` if using external APIs:

| Provider | Domains |
|----------|---------|
| OpenAI | `api.openai.com` |
| Google AI | `generativelanguage.googleapis.com` |
| AWS | `*.amazonaws.com` |
| Telegram | `api.telegram.org` |
| Slack | `slack.com`, `api.slack.com` |
| Discord | `discord.com`, `gateway.discord.gg` |
| Supabase | `*.supabase.co` |
| Firebase | `*.firebaseio.com`, `*.googleapis.com` |
| ntfy.sh | `ntfy.sh` |

### Notifications Config

Supported providers: `ntfy`, `pushover`, `gotify`, `command`.

Using ntfy (recommended - no install needed):
```json
{
  "notifications": {
    "provider": "ntfy",
    "ntfy": {
      "topic": "my-ralph-notifications",
      "server": "https://ntfy.sh"
    }
  }
}
```

Using pushover:
```json
{
  "notifications": {
    "provider": "pushover",
    "pushover": {
      "user": "your-user-key",
      "token": "your-app-token"
    }
  }
}
```

Using gotify:
```json
{
  "notifications": {
    "provider": "gotify",
    "gotify": {
      "server": "https://gotify.example.com",
      "token": "your-app-token"
    }
  }
}
```

Using custom command:
```json
{
  "notifications": {
    "provider": "command",
    "command": "notify-send Ralph"
  }
}
```

### Daemon Events Config

Log task completions and ralph finished to file:
```json
{
  "daemon": {
    "actions": {
      "log_task": {
        "command": "echo \"$(date '+%Y-%m-%d %H:%M:%S') - Task completed:\" >> log.txt && echo",
        "description": "Log task completion"
      },
      "log_complete": {
        "command": "echo \"$(date '+%Y-%m-%d %H:%M:%S') - Ralph finished\" >> log.txt",
        "description": "Log ralph completion"
      }
    },
    "events": {
      "task_complete": [{ "action": "log_task", "message": "{{task}}" }],
      "ralph_complete": [{ "action": "log_complete" }, { "action": "notify" }]
    }
  }
}
```

| Event | When Triggered |
|-------|----------------|
| `task_complete` | After each PRD task passes |
| `ralph_complete` | When all PRD tasks complete |
| `iteration_complete` | After each `ralph once` iteration |
| `error` | When an error occurs |

### Telegram Chat Setup

1. Message @BotFather on Telegram, send `/newbot`
2. Copy the bot token to `chat.telegram.botToken`
3. Start a chat with your bot and send any message
4. Get your chat ID:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
   ```
   **Note:** `bot` is a literal prefix, not a placeholder!
   Example: `https://api.telegram.org/bot123456:ABC-xyz/getUpdates`
5. Add chat ID to `chat.telegram.allowedChatIds` (optional)

```json
{
  "chat": {
    "enabled": true,
    "provider": "telegram",
    "telegram": {
      "botToken": "123456:ABC-xyz",
      "allowedChatIds": ["987654321"]
    }
  }
}
```

Chat commands (send in Telegram):
- `/run [category]` - Start ralph automation
- `/status` - Show PRD progress
- `/stop` - Stop a running ralph process
- `/add [desc]` - Add new task
- `/exec [cmd]` - Execute shell command
- `/action [name]` - Execute a daemon action
- `/claude [prompt]` - Run Claude Code with a prompt
- `/branch [subcommand]` - Manage git branches
- `/help` - Show help

### PRD Task Categories

| Category | Use For |
|----------|---------|
| `setup` | Project initialization, dependency installation |
| `feature` | New functionality implementation |
| `bugfix` | Bug fixes |
| `ui` | User interface changes |
| `development` | Development tooling, build configuration |
| `testing` | Unit tests, integration tests |
| `docs` | Documentation |

### PRD Guidelines

- Each task should be completable in one AI iteration
- Use imperative verbs: "Implement", "Create", "Add", "Configure"
- Include 2-4 concrete steps per task
- End with a verification step (build, typecheck, test)
- All tasks start with `"passes": false`
- Order by dependency: setup -> development -> feature -> testing -> docs

### Sandbox Safety

**Avoid** (long-running/interactive):
- `pnpm dev`, `npm start`, `python -m http.server`
- `docker compose up`
- Commands requiring user input

**Use instead** (verification commands):
- `pnpm build`, `npm run build`, `go build`
- `pnpm test`, `pytest`, `go test`
- `tsc --noEmit`, `mypy .`, `go vet`

---

## Ralph Commands

| Command | Description |
|---------|-------------|
| `ralph init -y` | Initialize with defaults |
| `ralph list` | Show all PRD tasks |
| `ralph status` | Show completion status |
| `ralph docker init <lang>` | Generate Docker files |
| `ralph docker run` | Run sandboxed session |
| `ralph docker run --yolo` | Run without confirmations |
| `ralph daemon start` | Start daemon on host (for notifications) |
| `ralph daemon status` | Check daemon status |
| `ralph notify "msg"` | Send notification from sandbox |
