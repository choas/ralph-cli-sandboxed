# Security

Ralph automates AI agents that execute code and modify files autonomously. This document explains the security model and requirements.

## Container Requirement

**It is strongly recommended to run ralph inside a Docker container for security.** The Ralph Wiggum technique involves running an AI agent autonomously, which means granting it elevated permissions to execute code and modify files without manual approval for each action.

## Autonomous Mode Flags

When running inside a container, ralph automatically passes the appropriate autonomous mode flag to the CLI provider. This allows the AI agent to execute commands and modify files without prompting for permission.

### Provider Support

| Provider | Autonomous Flag | Status |
|----------|-----------------|--------|
| Claude Code | `--dangerously-skip-permissions` | ✅ Supported |
| Gemini CLI | `-y` | ✅ Supported |
| Codex CLI | `--approval-mode full-auto` | ✅ Supported |
| AMP | `--dangerously-allow-all` | ✅ Supported |
| Aider | `--yes-always` | ✅ Supported |
| Goose | (none needed) | ✅ Supported |
| OpenCode | (none) | ❌ Not yet implemented |
| Ollama | (none needed) | ✅ Supported |
| Custom | (none) | ⚙️ User-configured |

For providers without autonomous mode support, you may need to manually approve actions during execution.

### How It Works

- Autonomous mode is **only** enabled when ralph detects it's running inside a container
- It is required for fully autonomous operation (otherwise the CLI would pause for approval on every action)

**Warning:** Autonomous mode gives the AI agent full control over the environment. This is why container isolation is critical:

- The container provides a sandbox boundary
- Network access is restricted to essential services (GitHub, npm, Anthropic API)
- Your host system remains protected even if something goes wrong

## Container Detection

Ralph detects container environments by checking:

1. `DEVCONTAINER` environment variable
2. Presence of `/.dockerenv` file
3. Container indicators in `/proc/1/cgroup` (docker, podman, lxc, containerd)
4. `container` environment variable (podman, docker)

If you're running outside a container and need autonomous mode, use `ralph docker` to set up a safe sandbox environment first.

## Network Sandboxing

The Docker configuration includes firewall rules limiting network access to:

- **GitHub** - For git operations (clone, push, pull)
- **npm registry** - For dependency installation
- **Anthropic API** - For Claude API calls

All other outbound network traffic is blocked by default.

## Credential Handling

### OAuth Credentials (Claude Code)

For Claude Code users with Pro/Max subscriptions, the `~/.claude` directory is mounted into the container:

```yaml
volumes:
  - ~/.claude:/home/node/.claude
```

This allows the AI agent to use your existing OAuth credentials without exposing API keys.

### API Keys

For API key-based authentication, pass environment variables to the container:

```bash
docker compose run -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY ralph
```

**Never commit API keys to version control.** Use environment variables or Docker secrets.

## Best Practices

1. **Always use containers** - Never run `ralph run` or `ralph once` outside a container
2. **Review PRD items** - Check what you're asking the AI to do before running
3. **Use separate branches** - Let the AI work on feature branches, review before merging
4. **Monitor progress** - Check `.ralph/progress.txt` and git commits periodically
5. **Limit scope** - Keep PRD items small and focused to reduce risk

## Reporting Security Issues

If you discover a security vulnerability, please report it by opening an issue at:
https://github.com/choas/ralph-cli-sandboxed/issues
