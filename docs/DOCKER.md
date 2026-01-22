# Docker Sandbox

Ralph runs AI agents in isolated Docker containers for security. This document covers Docker setup and usage.

## Quick Start

```bash
# Run container (auto-builds image on first run)
ralph docker run
```

> **Note:** `ralph init` automatically creates Docker files in `.ralph/docker/`. Use `ralph docker init` to regenerate them if needed.

## Docker Commands

| Command | Description |
|---------|-------------|
| `ralph docker init` | Generate/regenerate Docker configuration files |
| `ralph docker build` | Build the Docker image |
| `ralph docker run` | Run ralph inside the container (auto-builds if needed) |
| `ralph docker shell` | Open an interactive shell in the container |
| `ralph docker status` | Show container and image status |

## Generated Files

After running `ralph init` or `ralph docker init`, you'll find:

```
.ralph/docker/
├── Dockerfile           # Container image definition
├── docker-compose.yml   # Container orchestration
└── firewall.sh          # Network sandbox rules
```

## Features

The Docker setup is based on [Claude Code devcontainer](https://github.com/anthropics/claude-code/tree/main/.devcontainer) and includes:

- **Network sandboxing** - Firewall allows only GitHub, npm, and Anthropic API
- **Credential mounting** - Your `~/.claude` OAuth credentials are mounted automatically
- **Language tooling** - Pre-installed based on your selected language
- **Non-root user** - Runs as `node` user for security

## Customization

### Adding Ports

Edit `.ralph/config.json`:

```json
{
  "docker": {
    "ports": ["3000:3000", "5432:5432"]
  }
}
```

Then regenerate: `ralph docker init`

### Adding Volumes

```json
{
  "docker": {
    "volumes": ["./data:/app/data"]
  }
}
```

### Environment Variables

```json
{
  "docker": {
    "environment": {
      "NODE_ENV": "development",
      "DEBUG": "true"
    }
  }
}
```

### Git Configuration

```json
{
  "docker": {
    "git": {
      "name": "Your Name",
      "email": "your@email.com"
    }
  }
}
```

## Installing Packages

To install additional packages inside the container, run as root:

```bash
# Update package list and install
docker compose run -u root ralph apt-get update
docker compose run -u root ralph apt-get install <package>
```

For persistent changes, add the installation to the Dockerfile and rebuild:

```bash
ralph docker build
```

## Troubleshooting

### Image won't build

Check Docker is running and you have sufficient disk space:

```bash
docker info
df -h
```

### Permission denied errors

The container runs as user `node`. If you have permission issues with mounted volumes:

```bash
# Fix ownership on host
sudo chown -R $(id -u):$(id -g) .ralph/
```

### Network connectivity issues

The firewall script restricts outbound connections. If you need additional access:

1. Edit `.ralph/docker/firewall.sh`
2. Add your required domains/IPs
3. Rebuild: `ralph docker build`

### Platform-specific dependencies

If you switch between running on host and in container, reinstall node_modules:

```bash
rm -rf node_modules && npm install
```

Or use a separate volume for node_modules:

```bash
docker run -v $(pwd):/workspace -v /workspace/node_modules your-image
```
