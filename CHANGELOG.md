# Changelog

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
