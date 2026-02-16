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
| `ralph docker clean` | Remove Docker image and associated resources |
| `ralph docker help` | Show help message |

## Generated Files

After running `ralph init` or `ralph docker init`, you'll find:

```
.ralph/docker/
├── Dockerfile           # Container image definition
├── docker-compose.yml   # Container orchestration
├── init-firewall.sh     # Network sandbox rules
└── .dockerignore        # Build exclusions
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

### Asciinema Recording

Record terminal sessions inside the container for demos, debugging, or sharing AI coding sessions. Recordings are saved as `.cast` files that can be played back with `asciinema play` or uploaded to asciinema.org.

```json
{
  "docker": {
    "asciinema": {
      "enabled": true,
      "autoRecord": true,
      "outputDir": ".recordings"
    }
  }
}
```

| Setting | Description |
|---------|-------------|
| `enabled` | Install asciinema in the container |
| `autoRecord` | Automatically start recording when container starts |
| `outputDir` | Directory for recordings (default: `.recordings`) |

After enabling, regenerate Docker files: `ralph docker init`

**Where recordings are stored:**

Recordings are saved to the mounted workspace directory (e.g., `.recordings/`). They never leave the container automatically - no network access is needed.

To upload recordings:
1. Exit the container
2. From your host machine: `asciinema upload .recordings/session-*.cast`
3. Or set `ASCIINEMA_SERVER_URL` environment variable before uploading to use a self-hosted server

**Manual recording** (when `autoRecord: false`):

```bash
# Inside the container
asciinema rec .recordings/session.cast     # Start recording
exit                                        # Stop recording

# After exiting the container, from your host machine:
asciinema play .recordings/session.cast    # Playback
asciinema upload .recordings/session.cast  # Upload to asciinema.org
```

**Auto-recording** (when `autoRecord: true`):

Sessions are automatically recorded to `<outputDir>/session-YYYYMMDD-HHMMSS.cast` when the container starts. Recording stops when you exit the container. Files are available on your host machine in the configured output directory.

### Firewall Configuration

The container firewall allows only specific domains by default: GitHub, npm registry, and Anthropic API. To allow additional domains (e.g., PyPI, internal registries), configure `firewall.allowedDomains`:

```json
{
  "docker": {
    "firewall": {
      "allowedDomains": ["pypi.org", "files.pythonhosted.org"]
    }
  }
}
```

After adding domains, regenerate Docker files: `ralph docker init`

The firewall script resolves domains to IPs at container startup using `dig`. Common use cases:

| Use Case | Domains |
|----------|---------|
| Python/PyPI | `pypi.org`, `files.pythonhosted.org` |
| Maven Central | `repo1.maven.org`, `repo.maven.apache.org` |
| Internal registry | `registry.mycompany.com` |

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

1. Edit `.ralph/docker/init-firewall.sh`
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
