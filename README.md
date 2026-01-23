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
| `ralph fix-prd [opts]` | Validate and recover corrupted PRD file |
| `ralph prompt [opts]` | Display resolved prompt |
| `ralph docker <sub>` | Manage Docker sandbox environment |
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
| Ruby | `bundle exec rubocop` | `bundle exec rspec` |
| PHP | `composer validate` | `vendor/bin/phpunit` |
| Swift | `swift build` | `swift test` |
| Elixir | `mix compile` | `mix test` |
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
| [OpenCode](https://github.com/anomalyco/opencode) | Working | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` | Requires [PR #9073](https://github.com/anomalyco/opencode/pull/9073) |
| [Aider](https://github.com/paul-gauthier/aider) | Working | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | |
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

Categories: `setup`, `feature`, `bugfix`, `refactor`, `docs`, `test`, `release`, `config`, `ui`

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

- **Automatic backup**: Before each run, the PRD is backed up
- **Validation**: After each iteration, the PRD structure is validated
- **Smart recovery**: If corrupted, ralph attempts to extract `passes: true` flags from the corrupted PRD and merge them into the backup
- **Manual recovery**: Use `ralph fix-prd` to validate, auto-fix, or restore from a specific backup

### Dynamic Iteration Limits

To prevent runaway loops, `ralph run` limits iterations to `incomplete_tasks + 3`. This limit adjusts dynamically if new tasks are added during execution.

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
