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
# 1. Initialize ralph in your project
ralph init

# 2. Add requirements to your PRD
ralph add

# 3. Run a single iteration
ralph once

# 4. Or run multiple iterations
ralph run 5
```

## Commands

| Command | Description |
|---------|-------------|
| `ralph init` | Initialize ralph in current project |
| `ralph once` | Run a single automation iteration |
| `ralph run <n>` | Run n automation iterations |
| `ralph add` | Add a new PRD entry (interactive) |
| `ralph list` | List all PRD entries |
| `ralph status` | Show PRD completion status |
| `ralph toggle <n>` | Toggle passes status for entry n |
| `ralph clean` | Remove all passing entries from PRD |
| `ralph docker` | Generate Docker sandbox environment |
| `ralph help` | Show help message |

> **Note:** `ralph prd <subcommand>` still works for compatibility (e.g., `ralph prd add`).

## Configuration

After running `ralph init`, you'll have:

```
.ralph/
├── config.json      # Project configuration
├── prompt.md        # Shared prompt template
├── prd.json         # Product requirements document
└── progress.txt     # Progress tracking file
```

### Supported Languages

- **Bun** (TypeScript) - `bun check`, `bun test`
- **Node.js** (TypeScript) - `npm run typecheck`, `npm test`
- **Python** - `mypy .`, `pytest`
- **Go** - `go build ./...`, `go test ./...`
- **Rust** - `cargo check`, `cargo test`
- **Custom** - Define your own commands

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

## Docker Sandbox

Run ralph in an isolated Docker container:

```bash
# Generate Docker files
ralph docker

# Build the image
ralph docker --build

# Run container
ralph docker --run
```

Features:
- Based on [Claude Code devcontainer](https://github.com/anthropics/claude-code/tree/main/.devcontainer)
- Network sandboxing (firewall allows only GitHub, npm, Anthropic API)
- Your `~/.claude` credentials mounted automatically (Pro/Max OAuth)
- Language-specific tooling pre-installed

### Installing packages in container

```bash
# Run as root to install packages
docker compose run -u root ralph apt-get update
docker compose run -u root ralph apt-get install <package>
```

## How It Works

1. **Read PRD**: Claude reads your requirements from `prd.json`
2. **Implement**: Works on the highest priority incomplete feature
3. **Verify**: Runs your check and test commands
4. **Update**: Marks the feature as complete in the PRD
5. **Commit**: Creates a git commit for the feature
6. **Repeat**: Continues to the next feature (in `run` mode)

When all PRD items pass, Claude outputs `<promise>COMPLETE</promise>` and stops.

## Security

### Container Requirement

**It is strongly recommended to run ralph inside a Docker container for security.** The Ralph Wiggum technique involves running an AI agent autonomously, which means granting it elevated permissions to execute code and modify files without manual approval for each action.

### The `--dangerously-skip-permissions` Flag

When running inside a container, ralph automatically passes the `--dangerously-skip-permissions` flag to Claude Code. This flag:

- Allows Claude to execute commands and modify files without prompting for permission
- Is **only** enabled when ralph detects it's running inside a container
- Is required for autonomous operation (otherwise Claude would pause for approval on every action)

**Warning:** The `--dangerously-skip-permissions` flag gives the AI agent full control over the environment. This is why container isolation is critical:

- The container provides a sandbox boundary
- Network access is restricted to essential services (GitHub, npm, Anthropic API)
- Your host system remains protected even if something goes wrong

### Container Detection

Ralph detects container environments by checking:
- `DEVCONTAINER` environment variable
- Presence of `/.dockerenv` file
- Container indicators in `/proc/1/cgroup`
- `container` environment variable

If you're running outside a container and need autonomous mode, use `ralph docker` to set up a safe sandbox environment first.

## Development

To contribute or test changes to ralph locally:

```bash
# Clone the repository
git clone https://github.com/choas/ralph-cli-sandboxed
cd ralph-cli-sandboxed

# Install dependencies
npm install

# Run ralph in development mode (without building)
npm run dev -- <args>

# Examples:
npm run dev -- --version
npm run dev -- list
npm run dev -- once
```

The `npm run dev -- <args>` command runs ralph directly from TypeScript source using `tsx`, allowing you to test changes without rebuilding.

### Platform-Specific Dependencies

The `node_modules` folder contains platform-specific binaries (e.g., esbuild). If you switch between running on your host machine and inside a Docker/Podman container, you'll need to reinstall dependencies:

```bash
# When switching environments (host <-> container)
rm -rf node_modules && npm install
```

Alternatively, when mounting your project into a container, use a separate volume for node_modules to keep host and container dependencies isolated:

```bash
podman run -v $(pwd):/workspace -v /workspace/node_modules your-image
```

## Requirements

- Node.js 18+
- [Claude Code CLI](https://github.com/anthropics/claude-code) installed
- Claude Pro/Max subscription or Anthropic API key

## License

MIT
