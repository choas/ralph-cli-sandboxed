# ralph-cli-sandboxed

AI-driven development automation CLI for [Claude Code](https://github.com/anthropics/claude-code), implementing the [Ralph Wiggum technique](https://ghuntley.com/ralph/) created by Geoffrey Huntley.

The Ralph Wiggum technique (named after the Simpsons character) runs a coding agent from a clean slate, over and over, until a stop condition is met. As [Matt Pocock describes it](https://x.com/mattpocockuk/status/2008200878633931247): "an AI coding approach that lets you run seriously long-running AI agents (hours, days) that ship code while you sleep."

This CLI automates iterative development by having Claude work through a PRD (Product Requirements Document), implementing features one at a time, running tests, and committing changes. When an iteration completes, the next one starts fresh - preventing context rot and allowing long-running autonomous development.

## Installation

```bash
# Use directly with npx
npx ralph-cli-sandboxed init

# Or install globally
npm install -g ralph-cli-sandboxed
ralph init
```

## Quick Start

```bash
# 1. Initialize ralph in your project (creates config AND Docker files)
ralph init

# 2. Edit .ralph/prd.json with your requirements, or use:
ralph add

# 3. Run in Docker sandbox (auto-builds image on first run)
ralph docker run
```

## Commands

| Command | Description |
|---------|-------------|
| `ralph init` | Initialize ralph in current project (config + Docker files) |
| `ralph once` | Run a single automation iteration |
| `ralph run [n]` | Run automation iterations (default: all tasks) |
| `ralph add` | Add a new PRD entry (interactive) |
| `ralph list` | List all PRD entries |
| `ralph status` | Show PRD completion status |
| `ralph toggle <n>` | Toggle passes status for entry n |
| `ralph clean` | Remove all passing entries from PRD |
| `ralph reset` | Reset all PRD entries to passes: false |
| `ralph fix-prd [opts]` | Validate and recover corrupted PRD file |
| `ralph prompt [opts]` | Display resolved prompt |
| `ralph progress <sub>` | Manage progress file (summarize) |
| `ralph branch <sub>` | Manage PRD branches (list, merge, pr, delete) |
| `ralph docker <sub>` | Manage Docker sandbox environment |
| `ralph daemon <sub>` | Manage host daemon for sandbox notifications |
| `ralph notify [msg]` | Send notification (from sandbox to host) |
| `ralph help` | Show help message |

> **Note:** `ralph prd <subcommand>` still works for compatibility (e.g., `ralph prd add`).

### Run Options

```bash
ralph run --model claude-sonnet-4-20250514  # Use specific model
ralph run -m claude-sonnet-4-20250514       # Short form
```

The `--model` flag is passed to the underlying CLI provider. Support depends on your CLI configuration (see [CLI Configuration](#cli-configuration)).

### fix-prd Options

```bash
ralph fix-prd              # Validate and auto-fix corrupted PRD
ralph fix-prd --verify     # Check only, don't fix
ralph fix-prd <backup>     # Restore from specific backup file
```

## Configuration

After running `ralph init`, you'll have:

```
.ralph/
├── config.json          # Project configuration
├── prompt.md            # Shared prompt template
├── prd.json             # Product requirements document
├── progress.txt         # Progress tracking file
├── HOW-TO-WRITE-PRDs.md # PRD writing guide
└── docker/              # Docker sandbox files
    ├── Dockerfile
    ├── docker-compose.yml
    └── ...
```

### Notifications

Ralph can send notifications when events occur during automation. Configure notifications in `.ralph/config.json`:

#### Using ntfy (Recommended)

[ntfy](https://ntfy.sh/) is a simple HTTP-based pub-sub notification service. Ralph uses curl to send notifications, so **no ntfy CLI installation is required**:

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

| Field | Description |
|-------|-------------|
| `provider` | Set to `"ntfy"` for ntfy notifications |
| `ntfy.topic` | Your unique topic name (required) |
| `ntfy.server` | ntfy server URL (default: `https://ntfy.sh`) |

To receive notifications:
1. Subscribe to your topic on your phone ([ntfy app](https://ntfy.sh/)) or browser (`https://ntfy.sh/your-topic`)
2. Run `ralph docker run` - you'll get notifications on completion

#### Using a Custom Command

For other notification tools, use the `command` provider:

```json
{
  "notifications": {
    "provider": "command",
    "command": "notify-send Ralph"
  }
}
```

The message is appended as the last argument to your command. Supported tools include:

| Tool | Example Command | Description |
|------|----------------|-------------|
| notify-send (Linux) | `notify-send Ralph` | Desktop notifications on Linux |
| terminal-notifier (macOS) | `terminal-notifier -title Ralph -message` | Desktop notifications on macOS |
| Custom script | `/path/to/notify.sh` | Your own notification script |

#### Notification Events

Ralph sends notifications for these events:

| Event | Message | When |
|-------|---------|------|
| PRD Complete | "Ralph: PRD Complete! All tasks finished." | All PRD tasks are marked as passing |
| Iteration Complete | "Ralph: Iteration complete." | Single `ralph once` iteration finishes |
| Run Stopped | "Ralph: Run stopped..." | `ralph run` stops due to no progress or max failures |
| Error | "Ralph: An error occurred." | CLI fails repeatedly |

#### Sandbox-to-Host Notifications (Daemon)

When running in a Docker sandbox, notifications are sent via the ralph daemon which runs on the host. The sandbox communicates with the daemon through a shared message file (`.ralph/messages.json`).

```bash
# Terminal 1: Start daemon on host
ralph daemon start

# Terminal 2: Run container
ralph docker run

# Inside container: Send notification manually
ralph notify "Hello from sandbox!"
```

The daemon watches for messages and executes the configured notification command on the host. This file-based approach works on all platforms (macOS, Linux, Windows) and allows other tools to integrate with the message queue.

#### Custom Daemon Actions

You can define custom actions that the sandbox can trigger. This example logs task completions and ralph finished events to a file:

```json
{
  "daemon": {
    "actions": {
      "log_task": {
        "command": "echo \"$(date '+%Y-%m-%d %H:%M:%S') - Task completed:\" >> log.txt && echo",
        "description": "Log task completion to file"
      },
      "log_complete": {
        "command": "echo \"$(date '+%Y-%m-%d %H:%M:%S') - Ralph finished: All PRD tasks complete\" >> log.txt",
        "description": "Log ralph completion to file"
      }
    },
    "events": {
      "task_complete": [
        {
          "action": "log_task",
          "message": "{{task}}"
        }
      ],
      "ralph_complete": [
        {
          "action": "log_complete"
        },
        {
          "action": "notify",
          "message": "All tasks done!"
        }
      ]
    }
  }
}
```

| Event | When Triggered |
|-------|----------------|
| `task_complete` | After each PRD task is marked as passing |
| `ralph_complete` | When all PRD tasks are complete |
| `iteration_complete` | After each `ralph once` iteration |
| `error` | When an error occurs |

The `{{task}}` placeholder is replaced with the task description. Events can trigger multiple actions - for example, `ralph_complete` above both logs to file and sends a notification.

Example `log.txt` output:
```
2024-01-15 14:23:01 - Task completed: Add user authentication
2024-01-15 14:45:32 - Task completed: Implement JWT tokens
2024-01-15 15:02:18 - Ralph finished: All PRD tasks complete
```

### Supported Languages

Ralph supports 18 programming languages with pre-configured build/test commands:

| Language | Check Command | Test Command |
|----------|--------------|--------------|
| Bun (TypeScript) | `bun check` | `bun test` |
| Node.js (TypeScript) | `npm run typecheck` | `npm test` |
| Python | `mypy .` | `pytest` |
| Go | `go build ./...` | `go test ./...` |
| Rust | `cargo check` | `cargo test` |
| Java | `mvn compile` | `mvn test` |
| Kotlin | `gradle build` | `gradle test` |
| C#/.NET | `dotnet build` | `dotnet test` |
| Ruby | `bundle exec rubocop --fail-level error` | `bundle exec rspec` |
| PHP | `composer validate && php -l` | `vendor/bin/phpunit` |
| Swift | `swift build` | `swift test` |
| Elixir | `mix compile --warnings-as-errors` | `mix test` |
| Scala | `sbt compile` | `sbt test` |
| Zig | `zig build` | `zig build test` |
| Haskell | `stack build` | `stack test` |
| Clojure | `lein check` | `lein test` |
| Deno (TypeScript) | `deno check **/*.ts` | `deno test` |
| Custom | User-defined | User-defined |

### Supported CLI Providers

Ralph supports multiple AI CLI tools. Select your provider during `ralph init`:

| CLI | Status | Environment Variables | Notes |
|-----|--------|----------------------|-------|
| [Claude Code](https://github.com/anthropics/claude-code) | Working | `ANTHROPIC_API_KEY` | Default provider. Also supports ~/.claude OAuth credentials |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Working | `GEMINI_API_KEY`, `GOOGLE_API_KEY` | |
| [OpenCode](https://github.com/anomalyco/opencode) | Working | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` | No autonomous/yolo mode yet. Requires [PR #9073](https://github.com/anomalyco/opencode/pull/9073) |
| [Aider](https://github.com/paul-gauthier/aider) | Working | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | |
| [Goose](https://github.com/block/goose) | Working | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Block's AI coding agent |
| [Ollama](https://ollama.com/) | Working | (none) | Local LLM server |
| [Codex CLI](https://github.com/openai/codex) | Testers wanted | `OPENAI_API_KEY` | Sponsors welcome |
| [AMP](https://ampcode.com/) | Testers wanted | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Sponsors welcome |
| Custom | - | User-defined | Configure your own CLI |

### CLI Configuration

Ralph can be configured to use different AI CLI tools. By default, it uses Claude Code. Configure in `.ralph/config.json`:

```json
{
  "cli": {
    "command": "claude",
    "args": [],
    "modelArgs": ["--model"],
    "promptArgs": ["-p"]
  }
}
```

- `command`: The CLI executable name (must be in PATH)
- `args`: Default arguments passed to the CLI
- `modelArgs`: Arguments for passing model (e.g., `["--model"]`). Required for `--model` flag support.
- `promptArgs`: Arguments for passing prompt (e.g., `["-p"]` or `[]` for positional)

The prompt content and `--dangerously-skip-permissions` (in containers) are added automatically at runtime.

### Skills Configuration

Skills are reusable instruction sets that extend Claude's behavior for specific languages or project requirements. They inject additional context and rules into prompts.

Configure skills in `.ralph/config.json`:

```json
{
  "claude": {
    "skills": [
      {
        "name": "swift-main-naming",
        "description": "Prevents naming files main.swift when using @main attribute",
        "instructions": "IMPORTANT: In Swift, files with @main attribute MUST NOT be named main.swift...",
        "userInvocable": false
      }
    ]
  }
}
```

| Field | Description |
|-------|-------------|
| `name` | Unique skill identifier (kebab-case) |
| `description` | Brief description shown during selection |
| `instructions` | Full instructions injected into Claude's prompt |
| `userInvocable` | If `true`, user can invoke via `/skill-name` (default: `true`) |

During `ralph init`, you can select built-in skills for your chosen language. See [docs/SKILLS.md](docs/SKILLS.md) for detailed configuration, custom skills, and best practices.

### Stream-JSON Output

Ralph supports stream-json output mode for real-time streaming of AI responses. This feature provides cleaner terminal output and enables recording of raw JSON logs for debugging or replay.

#### Enabling Stream-JSON

Configure stream-json in `.ralph/config.json`:

```json
{
  "docker": {
    "asciinema": {
      "enabled": true,
      "autoRecord": true,
      "outputDir": ".recordings",
      "streamJson": {
        "enabled": true,
        "saveRawJson": true
      }
    }
  }
}
```

Configuration options:
- `enabled`: Enable stream-json output mode (default: `false`)
- `saveRawJson`: Save raw JSON output to `.jsonl` files (default: `true` when enabled)
- `outputDir`: Directory for recordings and logs (default: `.recordings`)

#### Provider Compatibility

Not all CLI providers support stream-json output. Here's the compatibility matrix:

| CLI Provider | Stream-JSON Support | Arguments Used |
|--------------|---------------------|----------------|
| Claude Code | ✅ Yes | `--output-format stream-json --verbose --print` |
| Gemini CLI | ✅ Yes | `--output-format json` |
| OpenCode | ✅ Yes | `--format json` |
| Codex CLI | ✅ Yes | `--json` |
| Goose | ✅ Yes | `--output-format stream-json` |
| Aider | ❌ No | - |
| AMP | ❌ No | - |
| Ollama | ❌ No | - |
| Custom | ❌ No* | *Add `streamJsonArgs` to your custom config |

Each provider uses different command-line arguments and output formats. Ralph automatically selects the correct parser based on your configured provider.

#### Output Files

When stream-json is enabled, Ralph creates the following files in the `.recordings/` directory (configurable via `outputDir`):

| File Type | Pattern | Description |
|-----------|---------|-------------|
| `.jsonl` | `ralph-run-YYYYMMDD-HHMMSS.jsonl` | Raw JSON Lines log from `ralph run` |
| `.jsonl` | `ralph-once-YYYYMMDD-HHMMSS.jsonl` | Raw JSON Lines log from `ralph once` |
| `.cast` | `session-YYYYMMDD-HHMMSS.cast` | Asciinema terminal recording (when asciinema enabled) |

The `.jsonl` files contain one JSON object per line with the raw streaming events from the AI provider. These files are useful for:
- Debugging AI responses
- Replaying sessions
- Analyzing tool calls and outputs
- Building custom post-processing pipelines

#### Troubleshooting Stream-JSON

**Stream-JSON not working:**
1. Verify your CLI provider supports stream-json (see compatibility matrix above)
2. Check that `streamJson.enabled` is set to `true` in config
3. Ensure your CLI provider is correctly installed and accessible

**No output appearing:**
- Stream-json parsing extracts human-readable text from JSON events
- Some providers emit different event types; Ralph handles the most common ones
- Use `--debug` flag with ralph commands to see raw parsing output: `[stream-json]` prefixed lines go to stderr

**Missing .jsonl files:**
- Verify `saveRawJson` is `true` (or not set, as it defaults to `true`)
- Check that the `outputDir` directory is writable
- Files are created at command start; check for permission errors

**Parser not recognizing events:**
- Each provider has a specific parser (ClaudeStreamParser, GeminiStreamParser, etc.)
- Unknown event types are handled by a default parser that extracts common fields
- If you see raw JSON in output, the parser may not support that event type yet

**Custom CLI provider:**
To add stream-json support for a custom CLI provider, add `streamJsonArgs` to your CLI config:
```json
{
  "cli": {
    "command": "my-cli",
    "promptArgs": ["-p"],
    "streamJsonArgs": ["--json-output"]
  }
}
```

## PRD Format

The PRD (`prd.json`) is an array of requirements:

```json
[
  {
    "category": "feature",
    "description": "Add user authentication",
    "steps": [
      "Create login form",
      "Implement JWT tokens",
      "Add protected routes"
    ],
    "passes": false
  }
]
```

Categories: `ui`, `feature`, `bugfix`, `setup`, `development`, `testing`, `docs`

### Branching

PRD items can be tagged with a `branch` field to group work onto separate git branches. Ralph uses git worktrees to isolate branch work from the main checkout, so the host's working directory stays untouched.

```yaml
- category: feature
  description: Add login page
  branch: feat/auth
  steps: [...]
  passes: false
```

See [docs/BRANCHING.md](docs/BRANCHING.md) for the full architecture, configuration, and branch management commands.

### Advanced: File References

PRD steps can include file contents using the `@{filepath}` syntax:

```json
{
  "steps": ["Based on content: @{backup.prd.2024-01-15.json}"]
}
```

File paths are resolved relative to the project root. Absolute paths are also supported.

## PRD Protection

Ralph includes automatic PRD protection to handle cases where the LLM corrupts the PRD structure:

- **Automatic backup**: Before each run, the PRD is backed up to `.ralph/backups/`
- **Validation**: After each iteration, the PRD structure is validated
- **Smart recovery**: If corrupted, ralph attempts to extract `passes: true` flags from the corrupted PRD and merge them into the backup
- **Manual recovery**: Use `ralph fix-prd` to validate, auto-fix, or restore from a specific backup

### When PRD Corruption Happens

LLMs sometimes modify the PRD file incorrectly, such as:
- Converting the array to an object
- Adding invalid JSON syntax
- Changing the structure entirely

If you see an error like:
```
Error: prd.json is corrupted - expected an array of items.
The file may have been modified incorrectly by an LLM.

Run ralph fix-prd to diagnose and repair the file.
```

### Using fix-prd

The `ralph fix-prd` command diagnoses and repairs corrupted PRD files:

```bash
ralph fix-prd              # Auto-diagnose and fix
ralph fix-prd --verify     # Check structure without modifying
ralph fix-prd backup.json  # Restore from a specific backup file
```

**What fix-prd does:**
1. Validates JSON syntax and structure
2. Checks that all required fields exist (category, description, steps, passes)
3. Attempts to recover `passes: true` flags from corrupted files
4. Falls back to the most recent backup if recovery fails
5. Creates a fresh template PRD as a last resort

**Backups are stored in:** `.ralph/backups/backup.prd.YYYY-MM-DD-HHMMSS.json`

### Dynamic Iteration Limits

To prevent runaway loops, `ralph run` stops after 3 consecutive iterations without progress (no tasks completed and no new tasks added). It also stops after 3 consecutive failures with the same exit code.

## Docker Sandbox

Run ralph in an isolated Docker container:

```bash
# Run container (auto-builds image on first run)
ralph docker run
```

> **Note:** `ralph init` auto-creates Docker files in `.ralph/docker/`. Use `ralph docker init` to regenerate them if needed.

Features:
- Based on [Claude Code devcontainer](https://github.com/anthropics/claude-code/tree/main/.devcontainer)
- Network sandboxing (firewall allows only GitHub, npm, Anthropic API)
- Your `~/.claude` credentials mounted automatically (Pro/Max OAuth)
- Language-specific tooling pre-installed

See [docs/DOCKER.md](docs/DOCKER.md) for detailed Docker configuration, customization, and troubleshooting.

## Chat Integration

Ralph can be controlled via chat platforms (Slack, Telegram, Discord) and includes intelligent chat responders powered by LLMs.

### Chat Commands

Control Ralph remotely via chat:
- `/ralph run` - Start ralph automation
- `/ralph status` - Check PRD status
- `/ralph stop` - Stop running automation

### Chat Responders

Responders handle messages and can answer questions about your codebase:

| Trigger | Type | Description |
|---------|------|-------------|
| `@qa` | LLM | Answer questions about the codebase |
| `@review` | LLM | Review code changes (supports `@review diff`, `@review last`) |
| `@code` | Claude Code | Make file modifications |
| `!lint` | CLI | Run custom commands |

**Features:**
- **Automatic file detection**: Mention file paths (e.g., `src/config.ts:42`) and they're automatically included in context
- **Git diff keywords**: Use `diff`, `staged`, `last`, `HEAD~N` to include git changes
- **Multi-turn conversations**: Continue discussions in Slack/Discord threads
- **Auto-notifications**: Results from `ralph run` are automatically sent to connected chat

See [docs/CHAT-CLIENTS.md](docs/CHAT-CLIENTS.md) for chat platform setup and [docs/CHAT-RESPONDERS.md](docs/CHAT-RESPONDERS.md) for responder configuration.

## How It Works

1. **Read PRD**: Claude reads your requirements from `prd.json`
2. **Implement**: Works on the highest priority incomplete feature
3. **Verify**: Runs your check and test commands
4. **Update**: Marks the feature as complete in the PRD
5. **Commit**: Creates a git commit for the feature
6. **Repeat**: Continues to the next feature (in `run` mode)

When all PRD items pass, Claude outputs `<promise>COMPLETE</promise>` and stops.

## Security

**It is strongly recommended to run ralph inside a Docker container for security.** The Ralph Wiggum technique involves running an AI agent autonomously with elevated permissions.

When running inside a container, ralph automatically passes `--dangerously-skip-permissions` to Claude Code, allowing autonomous operation. This flag is only enabled in containers for safety.

See [docs/SECURITY.md](docs/SECURITY.md) for detailed security information, container detection, and best practices.

## Development

To contribute or test changes to ralph locally:

```bash
git clone https://github.com/choas/ralph-cli-sandboxed
cd ralph-cli-sandboxed
npm install
npm run dev -- <args>  # Run from TypeScript source
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for detailed development setup, project structure, and contribution guidelines.

## Requirements

- Node.js 18+
- A supported AI CLI tool installed (see [Supported CLI Providers](#supported-cli-providers))
- API key or subscription for your chosen provider

## License

MIT
