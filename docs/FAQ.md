# FAQ

## Getting Started

### How do I initialize Ralph in my project?

Run `ralph init` in your project root. The interactive wizard walks you through selecting a language, CLI provider (Claude Code, Aider, Codex, etc.), and optional skills. It creates the `.ralph/` directory with config files and generates Docker files automatically. Use `ralph init -y` to accept defaults (Claude Code + Node.js).

### Which AI CLI tools does Ralph support?

Ralph supports **Claude Code**, **Aider**, **Codex**, **Gemini CLI**, **OpenCode**, **AMP**, **Goose**, and **Ollama** out of the box. You can also use the `custom` provider to configure any CLI tool. Select your provider during `ralph init` or change it later in `.ralph/config.json` under `cliProvider`.

### Which programming languages are supported?

18 languages: TypeScript/Node, Python, Go, Rust, Java, Kotlin, C#/.NET, Ruby, PHP, Swift, Elixir, Scala, Zig, Haskell, Clojure, Deno, Bun, and Custom. Each comes with pre-configured `checkCommand` and `testCommand`.

## Running Ralph

### What's the difference between `ralph once` and `ralph run`?

`ralph once` runs a single iteration inside the container. `ralph run` supports multiple modes:
- `ralph run 5` — run 5 iterations
- `ralph run --all` — run until all PRD items pass
- `ralph run --loop` — run indefinitely, polling for new items every 30 seconds

### When does Ralph stop running?

Ralph stops when:
- All PRD items are marked `passes: true`
- The requested number of iterations is reached
- 3 consecutive failures with the same exit code occur (likely a config error)
- 3 iterations pass without progress (no tasks completed and no new tasks added)

### Can I run Ralph without `ralph run`?

Sometimes the execution (e.g. OpenCode) doesn't work or get stuck or isn't possible with free AMP. The following prompt lets Ralph loop, but keep in mind that no event is triggered when a task is finished:

> Call in a loop `ralph prompt` and use this prompt — then check if @.ralph/prd.yaml has a task which isn't passes=true and start over with a fresh session and read the prompt and execute it.

### How do I use a specific model?

Pass `--model <name>` to `ralph run`, e.g. `ralph run --model claude-sonnet-4-5-20250929`. You can also set the model via environment variable (provider-specific: `CLAUDE_MODEL`, `AIDER_MODEL`, `CODEX_MODEL`, etc.).

## PRD Management

### What's the PRD format?

PRD files (`.ralph/prd.yaml` or `.ralph/prd.json`) contain an array of items with:
- `category` — one of: ui, feature, bugfix, setup, development, testing, docs
- `description` — single sentence, imperative verb (e.g. "Add login page")
- `steps` — concrete actions including verification steps
- `passes` — boolean, set to `true` when the item is complete
- `branch` — (optional) groups items onto a git branch

### How do I write good PRD items?

Keep items small and focused. Each item should be completable in one iteration. Write clear, concrete steps — include verification steps so the AI agent can confirm its work. Use `@{filepath}` syntax in steps to reference file contents.

### My PRD got corrupted — what do I do?

Run `ralph fix-prd`. It auto-diagnoses and repairs corruption (common when an LLM modifies the file incorrectly). Ralph also creates automatic backups in `.ralph/backups/` before each run. Use `ralph fix-prd --verify` to check without modifying, or restore from a specific backup file.

## Docker & Containers

### Why does Ralph need Docker?

Docker provides a sandboxed environment where the AI agent runs with autonomous permissions (`--dangerously-skip-permissions` for Claude Code). This keeps your host system safe. The container also enforces network restrictions — only essential domains (GitHub, npm, your API provider) are allowed by default.

### How do I add domains to the firewall whitelist?

Add domains to `docker.firewall.allowedDomains` in `.ralph/config.json`, then rebuild the image with `ralph docker build`. You can also edit `.ralph/docker/init-firewall.sh` directly.

### How do I add custom packages to the Docker image?

Use `docker.packages` in config.json for system packages (installed via apt-get), or use `docker.buildCommands.root` / `docker.buildCommands.node` for custom build steps.

### Can I customize ports, volumes, and environment variables?

Yes — configure `docker.ports`, `docker.volumes`, and `docker.environment` in `.ralph/config.json`. Run `ralph docker init` to regenerate the docker-compose.yml after changes.

## Branching

### How does branching work in Ralph?

Add a `branch` field to PRD items to group them onto a git branch. Ralph uses **git worktrees** (not `git checkout`) to isolate branch work — this avoids changing the host's mounted volume. Configure `docker.worktreesPath` in config.json to set where worktrees are stored on the host.

### What branch commands are available?

- `ralph branch list` — show all branches with item counts and status
- `ralph branch merge <name>` — merge a completed branch back to base
- `ralph branch pr <name>` — create a GitHub PR from the branch
- `ralph branch delete <name>` — remove a worktree and delete the branch

## Notifications & Monitoring

### How do I set up notifications?

Ralph supports **ntfy** (recommended — no install needed, just HTTP) and **command-based** notifications. Configure in `.ralph/config.json` under `notifications`. Events include `task_complete`, `prd_complete`, `ralph_complete`, `iteration_complete`, `run_stopped`, and `error`.

### How do I monitor Ralph's progress?

- `ralph status` — shows completion count, remaining items, and branch info
- `ralph status --head` — compact status without item headlines
- `.ralph/progress.txt` — detailed log of each iteration's work
- `ralph progress summarize` — creates a timestamped backup and compresses the progress file

## Troubleshooting

### Ralph keeps failing after a few iterations

If you see "CLI failed N times with exit code X", it's likely a configuration issue. Check:
1. Your API key is set correctly (environment variable or mounted credentials)
2. The CLI provider is installed and working outside Ralph
3. Network connectivity — the firewall may be blocking required domains

### Ralph seems stuck with "no progress"

"No progress" means no PRD items were completed **and** no new items were added across 3 consecutive iterations. This usually means:
- PRD steps are too vague for the AI to verify completion
- The task is too large for a single iteration — break it into smaller items
- The AI is hitting an error it can't resolve — check `.ralph/progress.txt` for details

### The Docker image won't build

Check that Docker is running, you have enough disk space, and platform-specific dependencies are available. If a provider installation fails, try `ralph docker build` again — transient network issues are common. For persistent failures, check the Dockerfile in `.ralph/docker/`.
