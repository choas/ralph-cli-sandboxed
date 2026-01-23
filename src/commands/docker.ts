import { existsSync, writeFileSync, readFileSync, mkdirSync, chmodSync } from "fs";
import { join, basename } from "path";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { loadConfig, getRalphDir, RalphConfig, McpServerConfig, SkillConfig, AsciinemaConfig } from "../utils/config.js";
import { promptConfirm } from "../utils/prompt.js";
import { getLanguagesJson, getCliProvidersJson } from "../templates/prompts.js";

const DOCKER_DIR = "docker";
const CONFIG_HASH_FILE = ".config-hash";

// Compute hash of docker-relevant config fields
function computeConfigHash(config: RalphConfig): string {
  const relevantConfig = {
    language: config.language,
    javaVersion: config.javaVersion,
    cliProvider: config.cliProvider,
    docker: config.docker,
    claude: config.claude,
  };
  const content = JSON.stringify(relevantConfig, null, 2);
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

// Save config hash to docker directory
function saveConfigHash(dockerDir: string, hash: string): void {
  writeFileSync(join(dockerDir, CONFIG_HASH_FILE), hash + '\n');
}

// Load saved config hash, returns null if not found
function loadConfigHash(dockerDir: string): string | null {
  const hashPath = join(dockerDir, CONFIG_HASH_FILE);
  if (!existsSync(hashPath)) {
    return null;
  }
  return readFileSync(hashPath, 'utf-8').trim();
}

// Check if config has changed since last docker init
function hasConfigChanged(ralphDir: string, config: RalphConfig): boolean {
  const dockerDir = join(ralphDir, DOCKER_DIR);
  const savedHash = loadConfigHash(dockerDir);
  if (!savedHash) {
    return false; // No hash file means docker init hasn't run yet
  }
  const currentHash = computeConfigHash(config);
  return savedHash !== currentHash;
}

// Get language Docker snippet from config, with version substitution
function getLanguageSnippet(language: string, javaVersion?: number): string {
  const languagesJson = getLanguagesJson();
  const langConfig = languagesJson.languages[language];

  if (!langConfig || !langConfig.docker) {
    return "# Custom language - add your dependencies here";
  }

  let snippet = langConfig.docker.install;

  // Replace ${version} placeholder with actual version
  if (langConfig.docker.versionConfigurable && javaVersion) {
    snippet = snippet.replace(/\$\{version\}/g, String(javaVersion));
  } else if (langConfig.docker.version) {
    snippet = snippet.replace(/\$\{version\}/g, String(langConfig.docker.version));
  }

  return "\n" + snippet + "\n";
}

// Get CLI provider Docker snippet from config
function getCliProviderSnippet(cliProvider?: string): string {
  const cliProvidersJson = getCliProvidersJson();
  const providerKey = cliProvider || "claude";
  const provider = cliProvidersJson.providers[providerKey];

  if (!provider || !provider.docker) {
    // Default to Claude Code CLI if provider not found
    return "# Install Claude Code CLI (as node user so it installs to /home/node/.local/bin)\nRUN su - node -c 'curl -fsSL https://claude.ai/install.sh | bash' \\\n    && echo 'export PATH=\"$HOME/.local/bin:$PATH\"' >> /home/node/.zshrc";
  }

  return provider.docker.install;
}

function generateDockerfile(language: string, javaVersion?: number, cliProvider?: string, dockerConfig?: RalphConfig['docker']): string {
  const languageSnippet = getLanguageSnippet(language, javaVersion);
  const cliSnippet = getCliProviderSnippet(cliProvider);

  // Build custom packages section
  let customPackages = '';
  if (dockerConfig?.packages && dockerConfig.packages.length > 0) {
    customPackages = dockerConfig.packages.map(pkg => `    ${pkg} \\`).join('\n') + '\n';
  }

  // Build root build commands section
  let rootBuildCommands = '';
  if (dockerConfig?.buildCommands?.root && dockerConfig.buildCommands.root.length > 0) {
    const commands = dockerConfig.buildCommands.root.map(cmd => `RUN ${cmd}`).join('\n');
    rootBuildCommands = `
# Custom build commands (root)
${commands}
`;
  }

  // Build node build commands section
  let nodeBuildCommands = '';
  if (dockerConfig?.buildCommands?.node && dockerConfig.buildCommands.node.length > 0) {
    const commands = dockerConfig.buildCommands.node.map(cmd => `RUN ${cmd}`).join('\n');
    nodeBuildCommands = `
# Custom build commands (node user)
${commands}
`;
  }

  // Build git config section if configured
  let gitConfigSection = '';
  if (dockerConfig?.git && (dockerConfig.git.name || dockerConfig.git.email)) {
    const gitCommands: string[] = [];
    if (dockerConfig.git.name) {
      gitCommands.push(`git config --global user.name "${dockerConfig.git.name}"`);
    }
    if (dockerConfig.git.email) {
      gitCommands.push(`git config --global user.email "${dockerConfig.git.email}"`);
    }
    gitConfigSection = `
# Configure git identity
RUN ${gitCommands.join(' \\\n    && ')}
`;
  }

  // Build asciinema installation section if enabled
  let asciinemaInstall = '';
  let asciinemaDir = '';
  let streamScriptCopy = '';
  if (dockerConfig?.asciinema?.enabled) {
    const outputDir = dockerConfig.asciinema.outputDir || '.recordings';
    asciinemaInstall = `
# Install asciinema for terminal recording/streaming
RUN apt-get update && apt-get install -y asciinema && rm -rf /var/lib/apt/lists/*
`;
    asciinemaDir = `
# Create asciinema recordings directory
RUN mkdir -p /workspace/${outputDir} && chown node:node /workspace/${outputDir}
`;
    // Add stream script if streamJson is enabled
    if (dockerConfig.asciinema.streamJson?.enabled) {
      streamScriptCopy = `
# Copy ralph stream wrapper script for clean JSON output
COPY ralph-stream.sh /usr/local/bin/ralph-stream.sh
RUN chmod +x /usr/local/bin/ralph-stream.sh
`;
    }
  }

  return `# Ralph CLI Sandbox Environment
# Based on Claude Code devcontainer
# Generated by ralph-cli

FROM node:20-bookworm

ARG DEBIAN_FRONTEND=noninteractive
ARG TZ=UTC
ARG ZSH_IN_DOCKER_VERSION="1.2.1"

# Set timezone
ENV TZ=\${TZ}
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Install system dependencies
RUN apt-get update && apt-get install -y \\
    git \\
    curl \\
    wget \\
    nano \\
    vim \\
    less \\
    procps \\
    sudo \\
    man-db \\
    unzip \\
    gnupg2 \\
    jq \\
    fzf \\
    iptables \\
    ipset \\
    iproute2 \\
    dnsutils \\
    zsh \\
${customPackages}    && rm -rf /var/lib/apt/lists/*

# Setup zsh with oh-my-zsh and plugins (no theme, we set custom prompt)
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v\${ZSH_IN_DOCKER_VERSION}/zsh-in-docker.sh)" -- \\
    -t "" \\
    -p git \\
    -p fzf \\
    -a "source /usr/share/doc/fzf/examples/key-bindings.zsh 2>/dev/null || true" \\
    -a "source /usr/share/doc/fzf/examples/completion.zsh 2>/dev/null || true" \\
    -a "export HISTFILE=/commandhistory/.zsh_history" \\
    -a 'alias ll="ls -la"'

# Set custom prompt for node user (after oh-my-zsh to avoid override)
RUN cp -r /root/.oh-my-zsh /home/node/.oh-my-zsh && chown -R node:node /home/node/.oh-my-zsh && \\
    cp /root/.zshrc /home/node/.zshrc && chown node:node /home/node/.zshrc && \\
    sed -i 's|/root/.oh-my-zsh|/home/node/.oh-my-zsh|g' /home/node/.zshrc && \\
    echo 'PROMPT="%K{yellow}%F{black}[ralph]%f%k%K{yellow}%F{black}%d%f%k\\$ "' >> /home/node/.zshrc && \\
    echo '' >> /home/node/.zshrc && \\
    echo '# Ralph ASCII art banner' >> /home/node/.zshrc && \\
    echo 'if [ -z "$RALPH_BANNER_SHOWN" ]; then' >> /home/node/.zshrc && \\
    echo '  export RALPH_BANNER_SHOWN=1' >> /home/node/.zshrc && \\
    echo '  echo ""' >> /home/node/.zshrc && \\
    echo '  echo " ____      _    _     ____  _   _ "' >> /home/node/.zshrc && \\
    echo '  echo "|  _ \\\\    / \\\\  | |   |  _ \\\\| | | |"' >> /home/node/.zshrc && \\
    echo '  echo "| |_) |  / _ \\\\ | |   | |_) | |_| |"' >> /home/node/.zshrc && \\
    echo '  echo "|  _ <  / ___ \\\\| |___|  __/|  _  |"' >> /home/node/.zshrc && \\
    echo '  echo "|_| \\\\_\\\\/_/   \\\\_\\\\_____|_|   |_| |_|"' >> /home/node/.zshrc && \\
    echo '  echo ""' >> /home/node/.zshrc && \\
    echo '  RALPH_VERSION=$(ralph --version 2>/dev/null | head -1 || echo "unknown")' >> /home/node/.zshrc && \\
    echo '  echo "CLI - Version $RALPH_VERSION"' >> /home/node/.zshrc && \\
    echo '  echo ""' >> /home/node/.zshrc && \\
    echo 'fi' >> /home/node/.zshrc

${cliSnippet}

# Install ralph-cli-sandboxed from npm registry
RUN npm install -g ralph-cli-sandboxed
${languageSnippet}
# Setup sudo only for firewall script (no general sudo for security)
RUN echo "node ALL=(ALL) NOPASSWD: /usr/local/bin/init-firewall.sh" >> /etc/sudoers.d/node-firewall

# Create directories
RUN mkdir -p /workspace && chown node:node /workspace
RUN mkdir -p /home/node/.claude && chown node:node /home/node/.claude
RUN mkdir -p /commandhistory && chown node:node /commandhistory
${asciinemaDir}
# Copy firewall script
COPY init-firewall.sh /usr/local/bin/init-firewall.sh
RUN chmod +x /usr/local/bin/init-firewall.sh

# Set environment variables
ENV DEVCONTAINER=true
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV CLAUDE_CONFIG_DIR="/home/node/.claude"
ENV SHELL=/bin/zsh
ENV EDITOR=nano

# Add bash aliases and prompt (fallback if using bash)
RUN echo 'alias ll="ls -la"' >> /etc/bash.bashrc && \\
    echo 'PS1="\\[\\033[43;30m\\][ralph]\\w\\[\\033[0m\\]\\$ "' >> /etc/bash.bashrc
${rootBuildCommands}${asciinemaInstall}${streamScriptCopy}
# Switch to non-root user
USER node
${gitConfigSection}${nodeBuildCommands}
WORKDIR /workspace

# Default to zsh
CMD ["zsh"]
`;
}

function generateFirewallScript(customDomains: string[] = []): string {
  // Generate custom domains section if any are configured
  let customDomainsSection = '';
  if (customDomains.length > 0) {
    const domainList = customDomains.join(' ');
    customDomainsSection = `
# Custom allowed domains (from config)
for ip in $(dig +short ${domainList}); do
    ipset add allowed_ips $ip 2>/dev/null || true
done
`;
  }

  // Generate echo line with custom domains if configured
  const allowedList = customDomains.length > 0
    ? `GitHub, npm, Anthropic API, local network, ${customDomains.join(', ')}`
    : 'GitHub, npm, Anthropic API, local network';

  return `#!/bin/bash
# Firewall initialization script for Ralph sandbox
# Based on Claude Code devcontainer firewall

set -e

echo "Initializing sandbox firewall..."

# Get Docker DNS before flushing
DOCKER_DNS=$(cat /etc/resolv.conf | grep nameserver | head -1 | awk '{print $2}')

# Flush existing rules
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X

# Create ipset for allowed IPs
ipset destroy allowed_ips 2>/dev/null || true
ipset create allowed_ips hash:net

# Allow localhost
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT

# Allow established connections
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DNS
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT
if [ -n "$DOCKER_DNS" ]; then
    iptables -A OUTPUT -d $DOCKER_DNS -j ACCEPT
fi

# Allow SSH (for git)
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT

# Add allowed domains to ipset
# GitHub
for ip in $(dig +short github.com api.github.com raw.githubusercontent.com); do
    ipset add allowed_ips $ip 2>/dev/null || true
done

# npm registry
for ip in $(dig +short registry.npmjs.org); do
    ipset add allowed_ips $ip 2>/dev/null || true
done

# Anthropic API
for ip in $(dig +short api.anthropic.com); do
    ipset add allowed_ips $ip 2>/dev/null || true
done
${customDomainsSection}
# Allow host network (for mounted volumes, etc.)
HOST_NETWORK=$(ip route | grep default | awk '{print $3}' | head -1)
if [ -n "$HOST_NETWORK" ]; then
    HOST_SUBNET=$(echo $HOST_NETWORK | sed 's/\\.[0-9]*$/.0\\/24/')
    ipset add allowed_ips $HOST_SUBNET 2>/dev/null || true
fi

# Allow traffic to allowed IPs
iptables -A OUTPUT -m set --match-set allowed_ips dst -j ACCEPT

# Set default policies to DROP
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# Allow HTTPS to allowed IPs
iptables -I OUTPUT -p tcp --dport 443 -m set --match-set allowed_ips dst -j ACCEPT
iptables -I OUTPUT -p tcp --dport 80 -m set --match-set allowed_ips dst -j ACCEPT

echo "Firewall initialized. Only allowed destinations are accessible."
echo "Allowed: ${allowedList}"
`;
}

function generateDockerCompose(imageName: string, dockerConfig?: RalphConfig['docker']): string {
  // Build ports section if configured
  let portsSection = '';
  if (dockerConfig?.ports && dockerConfig.ports.length > 0) {
    const portLines = dockerConfig.ports.map(port => `      - "${port}"`).join('\n');
    portsSection = `    ports:\n${portLines}\n`;
  }

  // Build volumes array: base volumes + custom volumes
  const baseVolumes = [
    '      # Mount project root (two levels up from .ralph/docker/)',
    '      - ../..:/workspace',
    "      # Mount host's ~/.claude for Pro/Max OAuth credentials",
    '      - ${HOME}/.claude:/home/node/.claude',
    `      - ${imageName}-history:/commandhistory`,
  ];

  if (dockerConfig?.volumes && dockerConfig.volumes.length > 0) {
    const customVolumeLines = dockerConfig.volumes.map(vol => `      - ${vol}`);
    baseVolumes.push(...customVolumeLines);
  }

  const volumesSection = baseVolumes.join('\n');

  // Build environment section if configured
  let environmentSection = '';
  const envEntries: string[] = [];

  // Add user-configured environment variables
  if (dockerConfig?.environment && Object.keys(dockerConfig.environment).length > 0) {
    for (const [key, value] of Object.entries(dockerConfig.environment)) {
      envEntries.push(`      - ${key}=${value}`);
    }
  }

  if (envEntries.length > 0) {
    environmentSection = `    environment:\n${envEntries.join('\n')}\n`;
  } else {
    // Keep the commented placeholder for users who don't have config
    environmentSection = `    # Uncomment to use API key instead of OAuth:
    # environment:
    #   - ANTHROPIC_API_KEY=\${ANTHROPIC_API_KEY}\n`;
  }

  // Build command section if configured
  let commandSection = '';
  let streamJsonNote = '';
  if (dockerConfig?.asciinema?.enabled && dockerConfig?.asciinema?.autoRecord) {
    // Wrap with asciinema recording
    const outputDir = dockerConfig.asciinema.outputDir || '.recordings';
    const innerCommand = dockerConfig.startCommand || 'zsh';
    commandSection = `    command: bash -c "mkdir -p /workspace/${outputDir} && asciinema rec -c '${innerCommand}' /workspace/${outputDir}/session-$$(date +%Y%m%d-%H%M%S).cast"\n`;

    // Add note about stream-json if enabled
    if (dockerConfig.asciinema.streamJson?.enabled) {
      streamJsonNote = `
    # Stream JSON mode enabled - use ralph-stream.sh for clean Claude output:
    #   ralph-stream.sh -p "your prompt here"
    # This formats stream-json output for readable terminal display.
    # Raw JSON is saved to ${outputDir}/session-*.jsonl for later analysis.
`;
    }
  } else if (dockerConfig?.startCommand) {
    commandSection = `    command: ${dockerConfig.startCommand}\n`;
  } else {
    // Keep the commented placeholder for users who don't have config
    commandSection = `    # Uncomment to enable firewall sandboxing:
    # command: bash -c "sudo /usr/local/bin/init-firewall.sh && zsh"\n`;
  }

  return `# Ralph CLI Docker Compose
# Generated by ralph-cli

services:
  ralph:
    image: ${imageName}
    build:
      context: .
      dockerfile: Dockerfile
${portsSection}    volumes:
${volumesSection}
${environmentSection}    working_dir: /workspace
    stdin_open: true
    tty: true
    cap_add:
      - NET_ADMIN  # Required for firewall
${streamJsonNote}${commandSection}
volumes:
  ${imageName}-history:
`;
}

const DOCKERIGNORE = `# Docker ignore file
node_modules
dist
.git
*.log
`;

// Generate stream wrapper script for clean asciinema recordings
function generateStreamScript(outputDir: string, saveRawJson: boolean): string {
  const saveJsonSection = saveRawJson ? `
# Save raw JSON for later analysis
JSON_LOG="$OUTPUT_DIR/session-$TIMESTAMP.jsonl"
TEE_CMD="tee \\"$JSON_LOG\\""` : `
TEE_CMD="cat"`;

  return `#!/bin/bash
# Ralph stream wrapper - formats Claude stream-json output for clean terminal display
# Generated by ralph-cli

set -e

OUTPUT_DIR="\${RALPH_RECORDING_DIR:-/workspace/${outputDir}}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Ensure output directory exists
mkdir -p "$OUTPUT_DIR"
${saveJsonSection}

# jq filter to extract and format content from stream-json
# Handles text, tool calls, tool results, file operations, and commands
JQ_FILTER='
  if .type == "content_block_delta" then
    (if .delta.type == "text_delta" then .delta.text // empty
     elif .delta.text then .delta.text
     else empty end)
  elif .type == "content_block_start" then
    (if .content_block.type == "tool_use" then "\\n── Tool: " + (.content_block.name // "unknown") + " ──\\n"
     elif .content_block.type == "text" then .content_block.text // empty
     else empty end)
  elif .type == "tool_result" then
    "\\n── Tool Result ──\\n" + ((.content // .output // "") | tostring) + "\\n"
  elif .type == "assistant" then
    ([.message.content[]? | select(.type == "text") | .text] | join(""))
  elif .type == "message_start" then
    "\\n"
  elif .type == "message_delta" then
    (if .delta.stop_reason then "\\n[" + .delta.stop_reason + "]\\n" else empty end)
  elif .type == "file_edit" or .type == "file_write" then
    "\\n── Writing: " + (.path // .file // "unknown") + " ──\\n"
  elif .type == "file_read" then
    "── Reading: " + (.path // .file // "unknown") + " ──\\n"
  elif .type == "bash" or .type == "command" then
    "\\n── Running: " + (.command // .content // "") + " ──\\n"
  elif .type == "bash_output" or .type == "command_output" then
    (.output // .content // "") + "\\n"
  elif .type == "result" then
    (if .result then "\\n── Result ──\\n" + (.result | tostring) + "\\n" else empty end)
  elif .type == "error" then
    "\\n[Error] " + (.error.message // (.error | tostring)) + "\\n"
  elif .type == "system" then
    (if .message then "[System] " + .message + "\\n" else empty end)
  elif .text then
    .text
  elif (.content | type) == "string" then
    .content
  else
    empty
  end
'

# Pass all arguments to claude with stream-json output
# Filter JSON lines, optionally save raw JSON, and display formatted text
claude \\
  --output-format stream-json \\
  --verbose \\
  --print \\
  "\$@" 2>&1 \\
| grep --line-buffered '^{' \\
| eval $TEE_CMD \\
| jq --unbuffered -rj "$JQ_FILTER"

echo ""  # Ensure final newline
`;
}

// Generate .mcp.json content for Claude Code MCP servers
function generateMcpJson(mcpServers: Record<string, McpServerConfig>): string {
  return JSON.stringify({ mcpServers }, null, 2);
}

// Generate skill file content with YAML frontmatter
function generateSkillFile(skill: SkillConfig): string {
  const lines = ['---', `description: ${skill.description}`];
  if (skill.userInvocable === false) {
    lines.push('user-invocable: false');
  }
  lines.push('---', '', skill.instructions, '');
  return lines.join('\n');
}

async function generateFiles(ralphDir: string, language: string, imageName: string, force: boolean = false, javaVersion?: number, cliProvider?: string, dockerConfig?: RalphConfig['docker'], claudeConfig?: RalphConfig['claude']): Promise<void> {
  const dockerDir = join(ralphDir, DOCKER_DIR);

  // Create docker directory
  if (!existsSync(dockerDir)) {
    mkdirSync(dockerDir, { recursive: true });
    console.log(`Created ${DOCKER_DIR}/`);
  }

  const customDomains = dockerConfig?.firewall?.allowedDomains || [];
  const files: { name: string; content: string }[] = [
    { name: "Dockerfile", content: generateDockerfile(language, javaVersion, cliProvider, dockerConfig) },
    { name: "init-firewall.sh", content: generateFirewallScript(customDomains) },
    { name: "docker-compose.yml", content: generateDockerCompose(imageName, dockerConfig) },
    { name: ".dockerignore", content: DOCKERIGNORE },
  ];

  // Add stream script if streamJson is enabled
  if (dockerConfig?.asciinema?.enabled && dockerConfig.asciinema.streamJson?.enabled) {
    const outputDir = dockerConfig.asciinema.outputDir || '.recordings';
    const saveRawJson = dockerConfig.asciinema.streamJson.saveRawJson !== false; // default true
    files.push({ name: "ralph-stream.sh", content: generateStreamScript(outputDir, saveRawJson) });
  }

  for (const file of files) {
    const filePath = join(dockerDir, file.name);

    if (existsSync(filePath) && !force) {
      const overwrite = await promptConfirm(`${DOCKER_DIR}/${file.name} already exists. Overwrite?`);
      if (!overwrite) {
        console.log(`Skipped ${file.name}`);
        continue;
      }
    }

    writeFileSync(filePath, file.content);

    if (file.name.endsWith(".sh")) {
      chmodSync(filePath, 0o755);
    }

    console.log(`Created ${DOCKER_DIR}/${file.name}`);
  }

  // Generate Claude config files at project root
  const projectRoot = process.cwd();

  // Generate .mcp.json if MCP servers are configured
  if (claudeConfig?.mcpServers && Object.keys(claudeConfig.mcpServers).length > 0) {
    const mcpJsonPath = join(projectRoot, '.mcp.json');
    if (existsSync(mcpJsonPath) && !force) {
      const overwrite = await promptConfirm('.mcp.json already exists. Overwrite?');
      if (!overwrite) {
        console.log('Skipped .mcp.json');
      } else {
        writeFileSync(mcpJsonPath, generateMcpJson(claudeConfig.mcpServers));
        console.log('Created .mcp.json');
      }
    } else {
      writeFileSync(mcpJsonPath, generateMcpJson(claudeConfig.mcpServers));
      console.log('Created .mcp.json');
    }
  }

  // Generate skill files if skills are configured
  if (claudeConfig?.skills && claudeConfig.skills.length > 0) {
    const commandsDir = join(projectRoot, '.claude', 'commands');
    if (!existsSync(commandsDir)) {
      mkdirSync(commandsDir, { recursive: true });
      console.log('Created .claude/commands/');
    }

    for (const skill of claudeConfig.skills) {
      const skillPath = join(commandsDir, `${skill.name}.md`);
      if (existsSync(skillPath) && !force) {
        const overwrite = await promptConfirm(`.claude/commands/${skill.name}.md already exists. Overwrite?`);
        if (!overwrite) {
          console.log(`Skipped .claude/commands/${skill.name}.md`);
          continue;
        }
      }
      writeFileSync(skillPath, generateSkillFile(skill));
      console.log(`Created .claude/commands/${skill.name}.md`);
    }
  }

  // Save config hash for change detection
  const configForHash: RalphConfig = {
    language,
    checkCommand: '',
    testCommand: '',
    javaVersion,
    cliProvider,
    docker: dockerConfig,
    claude: claudeConfig,
  };
  const hash = computeConfigHash(configForHash);
  saveConfigHash(dockerDir, hash);
}

async function buildImage(ralphDir: string): Promise<void> {
  const dockerDir = join(ralphDir, DOCKER_DIR);

  if (!existsSync(join(dockerDir, "Dockerfile"))) {
    console.error("Dockerfile not found. Run 'ralph docker' first.");
    process.exit(1);
  }

  // Get config and check for changes
  const config = loadConfig();

  // Check if config has changed since last docker init
  if (hasConfigChanged(ralphDir, config)) {
    const regenerate = await promptConfirm("Config has changed since last docker init. Regenerate Docker files?");
    if (regenerate) {
      await generateFiles(ralphDir, config.language, config.imageName || `ralph-${basename(process.cwd()).toLowerCase().replace(/[^a-z0-9-]/g, "-")}`, true, config.javaVersion, config.cliProvider, config.docker, config.claude);
      console.log("");
    }
  }

  console.log("Building Docker image...\n");
  const imageName = config.imageName || `ralph-${basename(process.cwd()).toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;

  return new Promise((resolve, reject) => {
    // Use --no-cache and --pull to ensure we always get the latest CLI versions
    // Use -p to set unique project name per ralph project
    const proc = spawn("docker", ["compose", "-p", imageName, "build", "--no-cache", "--pull"], {
      cwd: dockerDir,
      stdio: "inherit",
    });

    proc.on("close", (code) => {
      if (code === 0) {
        console.log("\nDocker image built successfully!");
        resolve();
      } else {
        reject(new Error(`Docker build failed with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run docker: ${err.message}`));
    });
  });
}

async function imageExists(imageName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("docker", ["images", "-q", imageName], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    let output = "";
    proc.stdout.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", () => {
      // If output is non-empty, image exists
      resolve(output.trim().length > 0);
    });

    proc.on("error", () => {
      resolve(false);
    });
  });
}

// Get CLI provider configuration
function getCliProviderConfig(cliProvider?: string): { name: string; command: string; yoloArgs: string[]; envVars: string[]; modelConfig?: { envVar?: string; note?: string } } {
  const cliProvidersJson = getCliProvidersJson();
  const providerKey = cliProvider || "claude";
  const provider = cliProvidersJson.providers[providerKey];

  if (!provider) {
    // Default to Claude Code CLI if provider not found
    return {
      name: "Claude Code",
      command: "claude",
      yoloArgs: ["--dangerously-skip-permissions"],
      envVars: ["ANTHROPIC_API_KEY"],
      modelConfig: { envVar: "CLAUDE_MODEL", note: "Or use --model flag" },
    };
  }

  return {
    name: provider.name,
    command: provider.command,
    yoloArgs: provider.yoloArgs || [],
    envVars: provider.envVars || [],
    modelConfig: provider.modelConfig,
  };
}

async function runContainer(ralphDir: string, imageName: string, language: string, javaVersion?: number, cliProvider?: string, dockerConfig?: RalphConfig['docker'], claudeConfig?: RalphConfig['claude']): Promise<void> {
  const dockerDir = join(ralphDir, DOCKER_DIR);
  const dockerfileExists = existsSync(join(dockerDir, "Dockerfile"));
  const hasImage = await imageExists(imageName);

  // Check if config has changed since last docker init
  if (dockerfileExists) {
    const configForHash: RalphConfig = {
      language,
      checkCommand: '',
      testCommand: '',
      javaVersion,
      cliProvider,
      docker: dockerConfig,
      claude: claudeConfig,
    };
    if (hasConfigChanged(ralphDir, configForHash)) {
      const regenerate = await promptConfirm("Config has changed since last docker init. Regenerate Docker files?");
      if (regenerate) {
        await generateFiles(ralphDir, language, imageName, true, javaVersion, cliProvider, dockerConfig, claudeConfig);
        console.log("");
      }
    }
  }

  // Auto-init and build if docker folder or image doesn't exist
  if (!dockerfileExists || !hasImage) {
    if (!dockerfileExists) {
      console.log("Docker folder not found. Initializing docker setup...\n");
      await generateFiles(ralphDir, language, imageName, true, javaVersion, cliProvider, dockerConfig, claudeConfig);
      console.log("");
    }

    if (!hasImage) {
      console.log("Docker image not found. Building image...\n");
      await buildImage(ralphDir);
      console.log("");
    }
  }

  // Get CLI provider info for the startup note
  const cliConfig = getCliProviderConfig(cliProvider);
  const yoloCommand = cliConfig.yoloArgs.length > 0
    ? `${cliConfig.command} ${cliConfig.yoloArgs.join(" ")}`
    : cliConfig.command;

  console.log("Starting Docker container...\n");

  // Show note about yolo mode and credentials
  console.log("IMPORTANT: Getting Started");
  console.log("-".repeat(40));
  console.log("");
  console.log("To run ralph automation, you might need to activate YOLO mode");
  console.log("which allows the AI to execute commands without prompts.");
  console.log("");
  console.log(`CLI Provider: ${cliConfig.name}`);
  console.log(`Yolo command: ${yoloCommand}`);
  console.log("");
  console.log("Before running 'ralph run' or 'ralph once', ensure your");
  console.log("credentials are configured:");
  console.log("");
  if (cliConfig.envVars.length > 0) {
    console.log("Required environment variables:");
    for (const envVar of cliConfig.envVars) {
      console.log(`  - ${envVar}`);
    }
  }
  console.log("");

  // Display model configuration info if available
  if (cliConfig.modelConfig) {
    console.log("Model configuration (optional):");
    if (cliConfig.modelConfig.envVar) {
      const note = cliConfig.modelConfig.note ? ` - ${cliConfig.modelConfig.note}` : "";
      console.log(`  ${cliConfig.modelConfig.envVar}${note}`);
    } else if (cliConfig.modelConfig.note) {
      console.log(`  ${cliConfig.modelConfig.note}`);
    }
    console.log("");
  }

  console.log("Set them in docker-compose.yml or export before running.");
  console.log("");

  return new Promise((resolve, reject) => {
    // Use -p to set unique project name per ralph project
    const proc = spawn("docker", ["compose", "-p", imageName, "run", "--rm", "ralph"], {
      cwd: dockerDir,
      stdio: "inherit",
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Docker run failed with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run docker: ${err.message}`));
    });
  });
}

async function cleanImage(imageName: string, ralphDir: string): Promise<void> {
  const dockerDir = join(ralphDir, DOCKER_DIR);

  console.log(`Cleaning Docker image: ${imageName}...\n`);

  // First, stop any running containers via docker compose
  if (existsSync(join(dockerDir, "docker-compose.yml"))) {
    // Stop running containers first
    // Use -p to target only this project's resources
    await new Promise<void>((resolve) => {
      const proc = spawn("docker", ["compose", "-p", imageName, "stop", "--timeout", "5"], {
        cwd: dockerDir,
        stdio: "inherit",
      });

      proc.on("close", () => {
        resolve();
      });

      proc.on("error", () => {
        resolve();
      });
    });

    // Remove containers, volumes, networks, and local images
    // Use -p to target only this project's resources
    await new Promise<void>((resolve) => {
      const proc = spawn("docker", ["compose", "-p", imageName, "down", "--rmi", "local", "-v", "--remove-orphans", "--timeout", "5"], {
        cwd: dockerDir,
        stdio: "inherit",
      });

      proc.on("close", () => {
        // Continue regardless of exit code (image may not exist)
        resolve();
      });

      proc.on("error", () => {
        resolve();
      });
    });
  }

  // Find and forcibly remove any containers using volumes with our project name pattern
  // This handles orphaned containers from previous runs or pods
  // Project name is now imageName (via -p flag), so volumes are named ${imageName}_*
  const volumePattern = imageName;
  await new Promise<void>((resolve) => {
    // List all containers (including stopped) and filter by volume name pattern
    const proc = spawn("docker", ["ps", "-aq", "--filter", `volume=${volumePattern}`], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    let output = "";
    proc.stdout.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", async () => {
      const containerIds = output.trim().split("\n").filter((id) => id.length > 0);
      if (containerIds.length > 0) {
        // Force remove these containers
        await new Promise<void>((innerResolve) => {
          const rmProc = spawn("docker", ["rm", "-f", ...containerIds], {
            stdio: "inherit",
          });
          rmProc.on("close", () => innerResolve());
          rmProc.on("error", () => innerResolve());
        });
      }
      resolve();
    });

    proc.on("error", () => {
      resolve();
    });
  });

  // Also try to remove the image directly (in case it was built outside compose)
  await new Promise<void>((resolve) => {
    const proc = spawn("docker", ["rmi", "-f", imageName], {
      stdio: "inherit",
    });

    proc.on("close", () => {
      resolve();
    });

    proc.on("error", () => {
      resolve();
    });
  });

  // Clean up volumes matching our pattern
  await new Promise<void>((resolve) => {
    // List volumes matching our pattern
    const proc = spawn("docker", ["volume", "ls", "-q", "--filter", `name=${volumePattern}`], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    let output = "";
    proc.stdout.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", async () => {
      const volumeNames = output.trim().split("\n").filter((name) => name.length > 0);
      if (volumeNames.length > 0) {
        // Force remove these volumes
        await new Promise<void>((innerResolve) => {
          const rmProc = spawn("docker", ["volume", "rm", "-f", ...volumeNames], {
            stdio: "inherit",
          });
          rmProc.on("close", () => innerResolve());
          rmProc.on("error", () => innerResolve());
        });
      }
      resolve();
    });

    proc.on("error", () => {
      resolve();
    });
  });

  // Also try removing the simple volume name pattern
  const volumeName = `${imageName}-history`;
  await new Promise<void>((resolve) => {
    const proc = spawn("docker", ["volume", "rm", "-f", volumeName], {
      stdio: "inherit",
    });

    proc.on("close", () => {
      resolve();
    });

    proc.on("error", () => {
      resolve();
    });
  });

  // For Podman: clean up any orphaned pods matching this specific project
  // Use imageName to ensure we only clean this project's pods, not other ralph projects
  await new Promise<void>((resolve) => {
    const proc = spawn("docker", ["pod", "ls", "-q", "--filter", `name=${imageName}`], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    let output = "";
    proc.stdout.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", async () => {
      const podIds = output.trim().split("\n").filter((id) => id.length > 0);
      if (podIds.length > 0) {
        // Force remove these pods (this also removes their containers)
        await new Promise<void>((innerResolve) => {
          const rmProc = spawn("docker", ["pod", "rm", "-f", ...podIds], {
            stdio: "inherit",
          });
          rmProc.on("close", () => innerResolve());
          rmProc.on("error", () => innerResolve());
        });
      }
      resolve();
    });

    proc.on("error", () => {
      // docker pod command doesn't exist (not Podman) - ignore
      resolve();
    });
  });

  // Clean up project-specific network (project name is imageName via -p flag)
  const networkName = `${imageName}_default`;
  await new Promise<void>((resolve) => {
    const proc = spawn("docker", ["network", "rm", networkName], {
      stdio: ["ignore", "ignore", "ignore"], // Suppress output - network may not exist
    });

    proc.on("close", () => {
      resolve();
    });

    proc.on("error", () => {
      resolve();
    });
  });

  console.log("\nDocker image and associated resources cleaned.");
  console.log("Run 'ralph docker build' to rebuild the image.");
}

/**
 * Initialize Docker files. Can be called directly from other commands.
 * @param silent - If true, suppress the "Next steps" message
 */
export async function dockerInit(silent: boolean = false): Promise<void> {
  const config = loadConfig();
  const ralphDir = getRalphDir();
  const imageName = config.imageName ?? `ralph-${basename(process.cwd()).toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;

  console.log(`\nGenerating Docker files for: ${config.language}`);
  if ((config.language === "java" || config.language === "kotlin") && config.javaVersion) {
    console.log(`Java version: ${config.javaVersion}`);
  }
  if (config.cliProvider && config.cliProvider !== "claude") {
    console.log(`CLI provider: ${config.cliProvider}`);
  }
  console.log(`Image name: ${imageName}\n`);

  await generateFiles(ralphDir, config.language, imageName, true, config.javaVersion, config.cliProvider, config.docker, config.claude);

  if (!silent) {
    console.log(`
Docker files generated in .ralph/docker/

Next steps:
  1. Build the image: ralph docker build
  2. Run container:    ralph docker run

Or use docker compose directly:
  cd .ralph/docker && docker compose run --rm ralph
`);
  }
}

export async function docker(args: string[]): Promise<void> {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  // Show help without requiring init
  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    console.log(`
ralph docker - Generate and manage Docker sandbox environment

USAGE:
  ralph docker init         Generate Dockerfile and scripts
  ralph docker init -y      Generate files, overwrite without prompting
  ralph docker build        Build image (fetches latest CLI versions)
  ralph docker build --clean  Clean existing image and rebuild from scratch
                              (alias: --no-cache)
  ralph docker run          Run container (auto-init and build if needed)
  ralph docker clean        Remove Docker image and associated resources
  ralph docker help         Show this help message

FILES GENERATED:
  .ralph/docker/
  ├── Dockerfile            Based on Claude Code devcontainer
  ├── init-firewall.sh      Sandbox firewall script
  ├── docker-compose.yml    Container orchestration
  └── .dockerignore         Build exclusions

AUTHENTICATION:
  Pro/Max users: Your ~/.claude credentials are mounted automatically.
  API key users: Uncomment ANTHROPIC_API_KEY in docker-compose.yml.

EXAMPLES:
  ralph docker init               # Generate files
  ralph docker build              # Build image
  ralph docker build --clean      # Clean and rebuild from scratch
  ralph docker run                # Start interactive shell
  ralph docker clean              # Remove image and volumes

  # Or use docker compose directly:
  cd .ralph/docker && docker compose run --rm ralph

  # Run ralph automation in container:
  docker compose run --rm ralph ralph once

INSTALLING PACKAGES (works with Docker & Podman):
  # 1. Run as root to install packages:
  docker compose run -u root ralph apt-get update
  docker compose run -u root ralph apt-get install <package>

  # 2. Or commit changes to a new image:
  docker run -it --name temp -u root <image> bash
  # inside: apt-get update && apt-get install <package>
  # exit, then:
  docker commit temp <image>:custom
  docker rm temp
`);
    return;
  }

  const ralphDir = getRalphDir();

  if (!existsSync(ralphDir)) {
    console.error("Error: .ralph/ directory not found. Run 'ralph init' first.");
    process.exit(1);
  }

  const config = loadConfig();

  // Get image name from config or generate default
  const imageName = config.imageName || `ralph-${basename(process.cwd()).toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;

  const hasFlag = (flag: string): boolean => subArgs.includes(flag);

  switch (subcommand) {
    case "build":
      // Handle build --clean combination: clean first, then build
      // Also support --no-cache as alias for --clean
      if (hasFlag("--clean") || hasFlag("--no-cache") || hasFlag("-no-cache")) {
        await cleanImage(imageName, ralphDir);
        console.log(""); // Add spacing between clean and build output
      }
      await buildImage(ralphDir);
      break;

    case "run":
      await runContainer(ralphDir, imageName, config.language, config.javaVersion, config.cliProvider, config.docker, config.claude);
      break;

    case "clean":
      await cleanImage(imageName, ralphDir);
      break;

    case "init":
    default: {
      // Default to init if no subcommand or unrecognized subcommand
      const force = subcommand === "init"
        ? (subArgs[0] === "-y" || subArgs[0] === "--yes")
        : (subcommand === "-y" || subcommand === "--yes");
      console.log(`Generating Docker files for: ${config.language}`);
      if ((config.language === "java" || config.language === "kotlin") && config.javaVersion) {
        console.log(`Java version: ${config.javaVersion}`);
      }
      if (config.cliProvider && config.cliProvider !== "claude") {
        console.log(`CLI provider: ${config.cliProvider}`);
      }
      console.log(`Image name: ${imageName}\n`);
      await generateFiles(ralphDir, config.language, imageName, force, config.javaVersion, config.cliProvider, config.docker, config.claude);

      console.log(`
Docker files generated in .ralph/docker/

Next steps:
  1. Build the image: ralph docker build
  2. Run container:    ralph docker run

Or use docker compose directly:
  cd .ralph/docker && docker compose run --rm ralph
`);
      break;
    }
  }
}
