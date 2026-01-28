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
4. Create `.ralph/prd.json` with tasks based on the concept
5. Verify with `ralph list` and `ralph status`
6. Start daemon on host (if using notifications): `ralph daemon start`
```

---

## Reference

### Config Values by Tech Stack

| Stack | language | checkCommand | testCommand |
|-------|----------|--------------|-------------|
| Node/TS (pnpm) | `typescript` | `pnpm lint && pnpm build` | `pnpm test` |
| Node/TS (npm) | `node` | `npm run lint && npm run build` | `npm test` |
| Node/TS (bun) | `typescript` | `bun run lint && bun run build` | `bun test` |
| Python (pip) | `python` | `mypy . && ruff check .` | `pytest` |
| Python (poetry) | `python` | `poetry run mypy . && poetry run ruff check .` | `poetry run pytest` |
| Python (uv) | `python` | `uv run mypy . && uv run ruff check .` | `uv run pytest` |
| Go | `go` | `go build ./... && go vet ./...` | `go test ./...` |
| Rust | `rust` | `cargo build && cargo clippy` | `cargo test` |

### Required Domains by Tech Stack

| Stack | Package Registry Domains |
|-------|--------------------------|
| Node.js | `registry.npmjs.org`, `github.com` |
| Python | `pypi.org`, `files.pythonhosted.org`, `github.com` |
| Go | `proxy.golang.org`, `sum.golang.org`, `github.com` |
| Rust | `crates.io`, `static.crates.io`, `github.com` |

### API Provider Domains

| Provider | Domains |
|----------|---------|
| Anthropic Claude | `api.anthropic.com` |
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

### PRD Task Categories

| Category | Use For |
|----------|---------|
| `setup` | Project initialization, dependency installation |
| `config` | Environment variables, configuration files |
| `feature` | New functionality implementation |
| `integration` | External API clients, third-party services |
| `test` | Unit tests, integration tests |
| `refactor` | Code restructuring without behavior change |
| `bugfix` | Bug fixes |
| `docs` | Documentation |

### PRD Guidelines

- Each task should be completable in one AI iteration
- Use imperative verbs: "Implement", "Create", "Add", "Configure"
- Include 2-4 concrete steps per task
- End with a verification step (build, typecheck, test)
- All tasks start with `"passes": false`
- Order by dependency: setup -> config -> features -> tests -> docs

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
