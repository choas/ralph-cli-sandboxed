# Changelog

## [0.7.1] - 2026-04-02

### Added
- MCP server with stdio transport and tools: `ralph_prd_list`, `ralph_prd_add`, `ralph_prd_status`, `ralph_prd_toggle`
- MCP server documentation
- Deno runtime support with npm blocking hook and firewall domains
- Dirigent Settings Agent for npm audit

### Fixed
- RCE vulnerability when Ralph opens a file
- npm audit security fixes
- Npm hook regex and various code correctness fixes
- Multiple code review findings verified and resolved

### Changed
- Upgraded @anthropic-ai/sdk to 0.82.0
- Removed unused dependencies (`@inkjs/ui`, `readline`)
- Code quality improvements: formatting, linting, error handling

## [0.7.0] - 2026-03-29

### Changed
- License changed from MIT to Apache-2.0

### Added
- `ralph ask` command to run responder presets from the CLI
- `docker.envFile` config to mount and inject env vars into containers
- CI tests for the ask command (#3)

### Fixed
- Security, bugs, tests, and code quality improvements across codebase
- Env file path injection security fix
- Multiple code verification and fix passes

### Improved
- Upgraded @anthropic-ai/sdk to 0.80.0
- Require Node.js 20+
- Added format, lint, build, and test scripts to package.json
- Added vitest dependency and oxfmt/oxlint tooling

## [0.6.6] and earlier

See [git history](https://github.com/choas/ralph-cli-sandboxed/commits/main) for previous changes.
