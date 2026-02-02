# Development

Guide for contributing to ralph-cli-sandboxed.

## Setup

```bash
# Clone the repository
git clone https://github.com/choas/ralph-cli-sandboxed
cd ralph-cli-sandboxed

# Install dependencies
npm install
```

## Development Mode

Run ralph directly from TypeScript source without building:

```bash
npm run dev -- <args>

# Examples:
npm run dev -- --version
npm run dev -- list
npm run dev -- once
npm run dev -- help
```

This uses `tsx` to run TypeScript directly, allowing you to test changes immediately.

## Building

```bash
# Build for distribution
npm run build

# This runs:
# 1. tsc - Compiles TypeScript to dist/
# 2. Copies config files to dist/config/
```

## Project Structure

```
ralph-cli-sandboxed/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── commands/             # Command implementations
│   │   ├── init.ts           # ralph init
│   │   ├── run.ts            # ralph run
│   │   ├── once.ts           # ralph once
│   │   ├── prd.ts            # PRD management commands
│   │   ├── docker.ts         # Docker commands
│   │   ├── prompt.ts         # ralph prompt
│   │   ├── fix-prd.ts        # ralph fix-prd
│   │   └── help.ts           # ralph help
│   ├── utils/
│   │   ├── config.ts         # Configuration loading
│   │   ├── prd-validator.ts  # PRD validation and recovery
│   │   └── prompt.ts         # Interactive prompts
│   ├── templates/
│   │   └── prompts.ts        # Prompt template generation
│   └── config/
│       ├── languages.json    # Language configurations
│       └── cli-providers.json # CLI provider configurations
├── docs/                     # Documentation
├── dist/                     # Compiled output (generated)
└── package.json
```

## Adding a New Language

Edit `src/config/languages.json`:

```json
{
  "languages": {
    "your-language": {
      "name": "Your Language",
      "description": "Description here",
      "checkCommand": "your-check-command",
      "testCommand": "your-test-command",
      "docker": {
        "install": "# Installation commands for Dockerfile"
      },
      "technologies": [
        { "name": "Framework", "description": "Description" }
      ]
    }
  }
}
```

## Adding a New CLI Provider

Edit `src/config/cli-providers.json`:

```json
{
  "providers": {
    "your-cli": {
      "name": "Your CLI",
      "description": "Description",
      "command": "cli-command",
      "defaultArgs": [],
      "yoloArgs": ["--auto-approve-flag"],
      "promptArgs": ["--prompt"],
      "docker": {
        "install": "# Installation commands"
      },
      "envVars": ["YOUR_API_KEY"],
      "modelArgs": ["--model"]
    }
  }
}
```

## Testing Changes

Since ralph automates AI agents, testing requires caution:

1. **Use a test project** - Create a sample project to test changes
2. **Use `ralph once`** - Run single iterations for testing
3. **Check output** - Review `.ralph/progress.txt` and git commits

## Platform-Specific Dependencies

The `node_modules` folder contains platform-specific binaries. If you switch between environments:

```bash
# When switching between host and container
rm -rf node_modules && npm install
```

Or use a separate volume for container node_modules:

```bash
docker run -v $(pwd):/workspace -v /workspace/node_modules your-image
```

## Code Style

- TypeScript with ES2022 target
- Node.js 18+ required
- Use async/await for asynchronous operations
- Keep functions focused and small

### Linting with Oxlint

Ralph uses [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) for fast TypeScript-aware linting:

```bash
npm run lint          # Run linter
```

Configuration is in `oxlintrc.json`. Oxlint is significantly faster than ESLint while providing TypeScript-aware rules.

### Formatting with Oxfmt

Ralph uses [Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) for code formatting:

```bash
npm run format        # Format all files
npm run format:check  # Check formatting without changes
```

Configuration is in `.oxfmtrc.json`:
- 2 spaces indentation
- Double quotes
- Semicolons
- 100 character line width

## Submitting Changes

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Requirements

- Node.js 18+
- npm
- Docker (for testing container functionality)
