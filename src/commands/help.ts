const HELP_TEXT = `
ralph - AI-driven development automation CLI

USAGE:
  ralph <command> [options]

COMMANDS:
  init [opts]       Initialize ralph in current project
  once              Run a single automation iteration
  run [n] [opts]    Run automation iterations (default: all tasks)
  add               Add a new PRD entry (interactive)
  list [opts]       List all PRD entries
  status            Show PRD completion status
  toggle <n>        Toggle passes status for entry n
  clean             Remove all passing entries from the PRD
  prompt [opts]     Display resolved prompt (for testing in Claude Code)
  docker <sub>      Manage Docker sandbox environment
  help              Show this help message

  prd <subcommand>  (Alias) Manage PRD entries - same as add/list/status/toggle/clean

INIT:
  The init command uses interactive prompts with arrow key navigation:
  1. Select AI CLI provider (Claude Code, Aider, OpenCode, etc.)
  2. Select project language/runtime
  3. Select technology stack (if available for the language)

RUN OPTIONS:
  <n>                        Run exactly n iterations (overrides default --all behavior)
  --all, -a                  Run until all tasks are complete (default behavior)
  --loop, -l                 Run continuously, waiting for new items when complete
  --category, -c <category>  Filter PRD items by category
                             Valid: ui, feature, bugfix, setup, development, testing, docs

LIST OPTIONS:
  --category, -c <category>  Filter PRD items by category
                             Valid: ui, feature, bugfix, setup, development, testing, docs
  --passes                   Show only completed items (passes=true)
  --no-passes                Show only incomplete items (passes=false)

TOGGLE OPTIONS:
  <n> [n2] [n3]...           Toggle one or more entries by number
  --all, -a                  Toggle all PRD entries

DOCKER SUBCOMMANDS:
  docker init       Generate Dockerfile and scripts
  docker build      Build image (always fetches latest Claude Code)
  docker run        Run container (auto-init and build if needed)
  docker clean      Remove Docker image and associated resources
  docker help       Show docker help message

EXAMPLES:
  ralph init                 # Initialize ralph (interactive CLI, language, tech selection)
  ralph once                 # Run single iteration
  ralph run                  # Run until all tasks complete (default)
  ralph run 5                # Run exactly 5 iterations
  ralph run -c feature       # Complete all feature tasks only
  ralph run --loop           # Run continuously until interrupted
  ralph add                  # Add new PRD entry
  ralph list                 # Show all entries
  ralph list -c feature      # Show only feature entries
  ralph list --passes        # Show only completed entries
  ralph list --no-passes     # Show only incomplete entries
  ralph status               # Show completion summary
  ralph toggle 1             # Toggle entry #1
  ralph toggle 1 2 3         # Toggle multiple entries
  ralph toggle --all         # Toggle all entries
  ralph clean                # Remove passing entries
  ralph prompt               # Display resolved prompt
  ralph docker init          # Generate Dockerfile for sandboxed env
  ralph docker build         # Build Docker image
  ralph docker run           # Run container (auto-init/build if needed)

CONFIGURATION:
  After running 'ralph init', you'll have:
  .ralph/
  ├── config.json      Project configuration (language, commands, cli)
  ├── prompt.md        Prompt template with $variables ($language, $checkCommand, etc.)
  ├── prd.json         Product requirements document
  └── progress.txt     Progress tracking file

CLI CONFIGURATION:
  The CLI tool is configured during 'ralph init' and stored in .ralph/config.json:
  {
    "cli": {
      "command": "claude",
      "args": ["--permission-mode", "acceptEdits"],
      "yoloArgs": ["--dangerously-skip-permissions"]
    },
    "cliProvider": "claude"
  }

  Available CLI providers (selected during 'ralph init'):
    - claude: Claude Code (default)
    - aider: AI pair programming
    - codex: OpenAI Codex CLI
    - gemini-cli: Google Gemini CLI
    - opencode: Open source AI coding agent
    - custom: Configure your own CLI

  Customize 'command', 'args', and 'yoloArgs' for other AI CLIs.
`;

export function help(_args: string[]): void {
  console.log(HELP_TEXT.trim());
}
