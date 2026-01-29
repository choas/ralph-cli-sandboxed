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
  fix-prd [opts]    Validate and recover corrupted PRD file
  fix-config [opts] Validate and recover corrupted config.json
  prompt [opts]     Display resolved prompt (for testing in Claude Code)
  docker <sub>      Manage Docker sandbox environment
  daemon <sub>      Host daemon for sandbox-to-host communication
  notify [msg]      Send notification to host from sandbox
  action [name]     Execute host actions from config.json
  chat <sub>        Chat client integration (Telegram, etc.)
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

FIX-PRD OPTIONS:
  <backup-file>              Restore PRD from a specific backup file
  --verify, -v               Only verify format, don't attempt to fix

FIX-CONFIG OPTIONS:
  --verify, -v               Only verify format, don't attempt to fix
  -y, --yes                  Skip confirmation prompt, apply fixes automatically

DOCKER SUBCOMMANDS:
  docker init       Generate Dockerfile and scripts
  docker build      Build image (always fetches latest Claude Code)
  docker run        Run container (auto-init and build if needed)
  docker clean      Remove Docker image and associated resources
  docker help       Show docker help message

DAEMON SUBCOMMANDS:
  daemon start      Start daemon on host (listens for sandbox requests)
  daemon stop       Stop the daemon
  daemon status     Show daemon status
  daemon help       Show daemon help message

CHAT SUBCOMMANDS:
  chat start        Start chat daemon (Telegram bot)
  chat status       Show chat configuration status
  chat test [id]    Test connection by sending a message
  chat help         Show chat help message

NOTIFY OPTIONS:
  [message]              Message to send as notification
  --action, -a <name>    Execute specific daemon action (default: notify)
  --debug, -d            Show debug output

ACTION OPTIONS:
  [name]                 Name of the action to execute
  [args...]              Arguments to pass to the action command
  --list, -l             List all configured actions
  --debug, -d            Show debug output

EXAMPLES:
  ralph init                 # Initialize ralph (interactive CLI, language, tech selection)
  ralph init -y              # Initialize with defaults (Claude + Node.js, no prompts)
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
  ralph fix-prd              # Validate/recover corrupted PRD file
  ralph fix-prd --verify     # Check PRD format without fixing
  ralph fix-prd backup.prd.2024-01-15.json  # Restore from specific backup
  ralph fix-config           # Validate/recover corrupted config.json
  ralph fix-config --verify  # Check config format without fixing
  ralph fix-config -y        # Auto-fix without prompts
  ralph prompt               # Display resolved prompt
  ralph docker init          # Generate Dockerfile for sandboxed env
  ralph docker build         # Build Docker image
  ralph docker run           # Run container (auto-init/build if needed)
  ralph daemon start         # Start daemon on host (in separate terminal)
  ralph notify "Task done!"  # Send notification from sandbox to host
  ralph chat start           # Start Telegram chat daemon
  ralph chat test 123456     # Test chat connection
  ralph action --list        # List available host actions
  ralph action build         # Execute 'build' action on host

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
      "args": [],
      "yoloArgs": ["--dangerously-skip-permissions"]
    },
    "cliProvider": "claude"
  }

  Available CLI providers (selected during 'ralph init'):
    - claude: Claude Code (default)
    - aider: AI pair programming
    - codex: OpenAI Codex CLI
    - gemini: Google Gemini CLI
    - goose: Block's Goose AI coding agent
    - opencode: Open source AI coding agent
    - amp: Sourcegraph AMP CLI
    - custom: Configure your own CLI

  Customize 'command', 'args', and 'yoloArgs' for other AI CLIs.

DAEMON CONFIGURATION:
  The daemon allows sandbox-to-host communication without external network.
  Configure custom actions in .ralph/config.json:
  {
    "notifyCommand": "ntfy pub mytopic",
    "daemon": {
      "actions": {
        "build": {
          "command": "./scripts/build.sh",
          "description": "Run build on host"
        }
      }
    }
  }

  Usage flow:
  1. Start daemon on host:  ralph daemon start
  2. Run sandbox:           ralph docker run
  3. From sandbox, notify:  ralph notify "Task complete!"

CHAT CONFIGURATION:
  Enable Telegram chat integration to control ralph from your phone:
  {
    "chat": {
      "enabled": true,
      "provider": "telegram",
      "telegram": {
        "botToken": "YOUR_BOT_TOKEN",
        "allowedChatIds": ["123456789"]
      }
    }
  }

  Setup:
  1. Create bot with @BotFather on Telegram
  2. Add bot token to config.json
  3. Start chat daemon: ralph chat start
  4. Send commands to your bot: abc run, abc status, abc add <task>
`;


export function help(_args: string[]): void {
  console.log(HELP_TEXT.trim());
}
