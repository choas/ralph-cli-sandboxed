import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getCliProviders } from "../templates/prompts.js";

export interface CliConfig {
  command: string;
  args?: string[];
  yoloArgs?: string[];
  promptArgs?: string[];
  modelArgs?: string[];
  fileArgs?: string[]; // Args for including files (e.g., ["--read"] for Aider). If not set, uses @file syntax in prompt.
}

/**
 * LLM Provider Types
 * - anthropic: Anthropic Claude API
 * - openai: OpenAI API (GPT models)
 * - ollama: Local Ollama server
 */
export type LLMProviderType = "anthropic" | "openai" | "ollama";

/**
 * Configuration for a single LLM provider.
 */
export interface LLMProviderConfig {
  type: LLMProviderType; // Provider type
  model: string; // Model name (e.g., "claude-sonnet-4-20250514", "gpt-4o", "llama3")
  apiKey?: string; // API key (optional - falls back to env var if not set)
  baseUrl?: string; // Base URL for API (optional - uses default if not set)
}

/**
 * Named LLM providers configuration.
 * Providers can be referenced by name in responder configs.
 *
 * Example:
 * {
 *   "claude": { "type": "anthropic", "model": "claude-sonnet-4-20250514" },
 *   "gpt4": { "type": "openai", "model": "gpt-4o" },
 *   "local": { "type": "ollama", "model": "llama3", "baseUrl": "http://localhost:11434" }
 * }
 */
export type LLMProvidersConfig = Record<string, LLMProviderConfig>;

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SkillConfig {
  name: string;
  description: string;
  instructions: string;
  userInvocable?: boolean; // defaults to true
}

export interface StreamJsonConfig {
  enabled: boolean; // Use --output-format stream-json with Claude
  saveRawJson?: boolean; // Save raw JSON output alongside recording (default: true)
}

export interface AsciinemaConfig {
  enabled: boolean; // Install asciinema in Docker container
  autoRecord?: boolean; // Auto-start recording on container start
  outputDir?: string; // Directory for recordings (default: .recordings)
  streamJson?: StreamJsonConfig; // Stream JSON output for cleaner recordings
}

export interface DaemonActionConfig {
  command: string; // Command to execute on host
  description?: string; // Human-readable description of the action
}

// Notification provider configs - support arbitrary key-value pairs for flexibility
export interface NotificationProviderConfig {
  [key: string]: string | undefined; // Arbitrary key-value pairs (e.g., topic, server, token)
}

// Legacy interface for backwards compatibility
export interface NtfyNotificationConfig {
  topic: string; // ntfy topic name (required)
  server?: string; // ntfy server URL (default: https://ntfy.sh)
}

export interface NotificationsConfig {
  provider: "ntfy" | "pushover" | "gotify" | "command"; // Which notification provider to use
  ntfy?: NotificationProviderConfig; // ntfy config (topic, server, etc.)
  pushover?: NotificationProviderConfig; // pushover config (user, token, etc.)
  gotify?: NotificationProviderConfig; // gotify config (server, token, etc.)
  command?: string; // Custom command (for "command" provider)
}

/**
 * Event types that can trigger daemon calls.
 * - task_complete: Fired after each task is completed
 * - ralph_complete: Fired when ralph finishes all work (PRD complete)
 * - iteration_complete: Fired after each iteration
 * - error: Fired when an error occurs
 */
export type DaemonEventType =
  | "task_complete" // After each task finishes
  | "ralph_complete" // When ralph finishes all work
  | "iteration_complete" // After each iteration
  | "error"; // When an error occurs

export interface DaemonEventConfig {
  action: string; // Name of the daemon action to call (must exist in actions)
  args?: string[]; // Additional arguments to pass to the action
  message?: string; // Custom message (can include {{task}} placeholder for task_complete)
}

export interface DaemonConfig {
  enabled?: boolean; // Enable daemon support (default: true if actions defined)
  socketPath?: string; // Deprecated - file-based messaging now used
  actions?: Record<string, DaemonActionConfig>; // Custom actions the sandbox can trigger
  events?: Partial<Record<DaemonEventType, DaemonEventConfig[]>>; // Event handlers - each event can have multiple daemon calls
}

export interface TelegramChatSettings {
  enabled?: boolean; // Enable/disable Telegram (default: true if botToken set)
  botToken: string; // Telegram Bot API token (from @BotFather)
  allowedChatIds?: string[]; // Only respond in these chat IDs (security)
}

export interface SlackChatSettings {
  enabled?: boolean; // Enable/disable Slack (default: true if tokens set)
  botToken: string; // Slack Bot Token (xoxb-...) for Web API calls
  appToken: string; // Slack App Token (xapp-...) for Socket Mode connection
  signingSecret: string; // Slack Signing Secret for verifying requests
  allowedChannelIds?: string[]; // Only respond in these channel IDs (security)
}

export interface DiscordChatSettings {
  enabled?: boolean; // Enable/disable Discord (default: true if botToken set)
  botToken: string; // Discord Bot Token (from Developer Portal)
  allowedGuildIds?: string[]; // Only respond in these guild/server IDs (security)
  allowedChannelIds?: string[]; // Only respond in these channel IDs (security)
}

/**
 * Chat responder types.
 * - llm: Send message to an LLM provider and return response
 * - claude-code: Run Claude Code CLI with the message as prompt
 * - cli: Execute a custom CLI command with the message
 */
export type ResponderType = "llm" | "claude-code" | "cli";

/**
 * Configuration for a single chat responder.
 * Responders handle incoming chat messages based on trigger patterns.
 */
export interface ResponderConfig {
  type: ResponderType; // How to process the message
  trigger?: string; // Trigger pattern: '@name' for mentions, 'keyword' for prefix. Omit for default responder.
  provider?: string; // LLM provider name (for type: 'llm'). References llmProviders config.
  systemPrompt?: string; // System prompt for LLM (supports {{project}} placeholder)
  command?: string; // CLI command (for type: 'cli'). Supports {{message}} placeholder.
  timeout?: number; // Timeout in milliseconds (default: 300000 for claude-code, 60000 for others)
  maxLength?: number; // Max response length to send back to chat (default: 2000)
}

/**
 * Named responders configuration.
 * The special name "default" handles messages that don't match any trigger.
 *
 * Example:
 * {
 *   "default": { "type": "llm", "provider": "anthropic", "systemPrompt": "You are a helpful assistant." },
 *   "qa": { "type": "llm", "trigger": "@qa", "provider": "anthropic", "systemPrompt": "Answer questions about {{project}}." },
 *   "code": { "type": "claude-code", "trigger": "@code" },
 *   "lint": { "type": "cli", "trigger": "!lint", "command": "npm run lint" }
 * }
 */
export type RespondersConfig = Record<string, ResponderConfig>;

export interface ChatConfig {
  enabled?: boolean; // Enable chat client integration
  provider?: "telegram" | "slack" | "discord"; // Chat provider
  telegram?: TelegramChatSettings; // Telegram-specific settings
  slack?: SlackChatSettings; // Slack-specific settings
  discord?: DiscordChatSettings; // Discord-specific settings
  responders?: RespondersConfig; // Chat responders for handling messages
}

export interface RalphConfig {
  language: string;
  checkCommand: string;
  testCommand: string;
  imageName?: string;
  notifyCommand?: string; // Deprecated - use notifications instead
  notifications?: NotificationsConfig;
  technologies?: string[];
  javaVersion?: number;
  cli?: CliConfig;
  cliProvider?: string;
  llmProviders?: LLMProvidersConfig; // Named LLM providers for chat responders
  docker?: {
    ports?: string[];
    volumes?: string[];
    environment?: Record<string, string>;
    git?: {
      name?: string;
      email?: string;
    };
    packages?: string[];
    buildCommands?: {
      root?: string[];
      node?: string[];
    };
    startCommand?: string;
    asciinema?: AsciinemaConfig;
    firewall?: {
      allowedDomains?: string[];
    };
    autoStart?: boolean; // Automatically restart container when Docker/Podman starts
    restartCount?: number; // Max restart attempts on failure (uses on-failure policy). 0 = no restart, >0 = max retries
  };
  claude?: {
    mcpServers?: Record<string, McpServerConfig>;
    skills?: SkillConfig[];
  };
  daemon?: DaemonConfig;
  chat?: ChatConfig;
}

export const DEFAULT_CLI_CONFIG: CliConfig = {
  command: "claude",
  args: [],
  promptArgs: ["-p"],
};

export function getCliConfig(config: RalphConfig): CliConfig {
  const cliConfig = config.cli ?? DEFAULT_CLI_CONFIG;

  // Look up promptArgs and modelArgs from cliProvider if available
  if (config.cliProvider) {
    const providers = getCliProviders();
    const provider = providers[config.cliProvider];

    const result = { ...cliConfig };

    // Use provider's promptArgs if not already set
    if (result.promptArgs === undefined && provider?.promptArgs !== undefined) {
      result.promptArgs = provider.promptArgs;
    }

    // Use provider's modelArgs if not already set
    if (result.modelArgs === undefined && provider?.modelArgs !== undefined) {
      result.modelArgs = provider.modelArgs;
    }

    // Use provider's fileArgs if not already set
    if (result.fileArgs === undefined && provider?.fileArgs !== undefined) {
      result.fileArgs = provider.fileArgs;
    }

    // Use provider's yoloArgs if not already set
    if (result.yoloArgs === undefined && provider?.yoloArgs !== undefined) {
      result.yoloArgs = provider.yoloArgs;
    }

    // Default promptArgs for backwards compatibility
    if (result.promptArgs === undefined) {
      result.promptArgs = ["-p"];
    }

    return result;
  }

  // Default to -p for backwards compatibility
  return { ...cliConfig, promptArgs: cliConfig.promptArgs ?? ["-p"] };
}

const RALPH_DIR = ".ralph";
const CONFIG_FILE = "config.json";
const PROMPT_FILE = "prompt.md";
const PRD_FILE = "prd.json";
const PROGRESS_FILE = "progress.txt";

export function getRalphDir(): string {
  return join(process.cwd(), RALPH_DIR);
}

export function loadConfig(): RalphConfig {
  const configPath = join(getRalphDir(), CONFIG_FILE);

  if (!existsSync(configPath)) {
    throw new Error(".ralph/config.json not found. Run 'ralph init' first.");
  }

  const content = readFileSync(configPath, "utf-8");
  return JSON.parse(content);
}

export function loadPrompt(): string {
  const promptPath = join(getRalphDir(), PROMPT_FILE);

  if (!existsSync(promptPath)) {
    throw new Error(".ralph/prompt.md not found. Run 'ralph init' first.");
  }

  return readFileSync(promptPath, "utf-8");
}

export function checkFilesExist(): void {
  const ralphDir = getRalphDir();

  if (!existsSync(ralphDir)) {
    throw new Error(".ralph/ directory not found. Run 'ralph init' first.");
  }

  const requiredFiles = [CONFIG_FILE, PROMPT_FILE, PRD_FILE, PROGRESS_FILE];

  for (const file of requiredFiles) {
    if (!existsSync(join(ralphDir, file))) {
      throw new Error(`.ralph/${file} not found. Run 'ralph init' first.`);
    }
  }
}

export function getPaths() {
  const ralphDir = getRalphDir();
  return {
    dir: ralphDir,
    config: join(ralphDir, CONFIG_FILE),
    prompt: join(ralphDir, PROMPT_FILE),
    prd: join(ralphDir, PRD_FILE),
    progress: join(ralphDir, PROGRESS_FILE),
  };
}

/**
 * Detects if we're running inside a container (Docker or Podman).
 * ralph run and once commands require container execution for security.
 */
export function isRunningInContainer(): boolean {
  // Check DEVCONTAINER env var (set by ralph docker setup)
  if (process.env.DEVCONTAINER === "true") {
    return true;
  }

  // Check for /.dockerenv file (Docker creates this)
  if (existsSync("/.dockerenv")) {
    return true;
  }

  // Check /proc/1/cgroup for container hints (works for Docker and Podman)
  try {
    const cgroup = readFileSync("/proc/1/cgroup", "utf-8");
    if (
      cgroup.includes("docker") ||
      cgroup.includes("podman") ||
      cgroup.includes("/lxc/") ||
      cgroup.includes("containerd")
    ) {
      return true;
    }
  } catch {
    // File doesn't exist or can't be read (not on Linux or not in container)
  }

  // Check for container environment variables set by various container runtimes
  if (process.env.container === "podman" || process.env.container === "docker") {
    return true;
  }

  return false;
}

/**
 * Require container execution. Exits with error if not in container.
 */
export function requireContainer(commandName: string): void {
  if (!isRunningInContainer()) {
    console.error(`Error: 'ralph ${commandName}' must be run inside a Docker/Podman container.`);
    console.error("");
    console.error(
      "For security, ralph executes AI agents only in isolated container environments.",
    );
    console.error("");
    console.error("To set up a container:");
    console.error("  ralph docker init    # Generate Docker configuration files");
    console.error("  ralph docker build   # Build the container image");
    console.error("  ralph docker run     # Run ralph inside the container");
    process.exit(1);
  }
}

/**
 * Default LLM provider configurations.
 * These are used when llmProviders is not specified in config.
 * API keys are resolved from environment variables at runtime.
 */
export const DEFAULT_LLM_PROVIDERS: LLMProvidersConfig = {
  anthropic: {
    type: "anthropic",
    model: "claude-sonnet-4-20250514",
    // apiKey resolved from ANTHROPIC_API_KEY env var at runtime
  },
  openai: {
    type: "openai",
    model: "gpt-4o",
    // apiKey resolved from OPENAI_API_KEY env var at runtime
  },
  ollama: {
    type: "ollama",
    model: "llama3",
    baseUrl: "http://localhost:11434",
  },
};

/**
 * Get the API key for an LLM provider.
 * First checks the provider config, then falls back to environment variables.
 */
export function getLLMProviderApiKey(provider: LLMProviderConfig): string | undefined {
  // Use explicit API key if provided
  if (provider.apiKey) {
    return provider.apiKey;
  }

  // Fall back to environment variables based on provider type
  switch (provider.type) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "ollama":
      // Ollama doesn't require an API key
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Get the base URL for an LLM provider.
 * Returns the configured baseUrl or the default for the provider type.
 */
export function getLLMProviderBaseUrl(provider: LLMProviderConfig): string {
  if (provider.baseUrl) {
    return provider.baseUrl;
  }

  // Default base URLs for each provider type
  switch (provider.type) {
    case "anthropic":
      return "https://api.anthropic.com";
    case "openai":
      return "https://api.openai.com/v1";
    case "ollama":
      return "http://localhost:11434";
    default:
      return "";
  }
}

/**
 * Get LLM providers from config, merging with defaults.
 * User-defined providers override defaults with the same name.
 */
export function getLLMProviders(config: RalphConfig): LLMProvidersConfig {
  return {
    ...DEFAULT_LLM_PROVIDERS,
    ...(config.llmProviders ?? {}),
  };
}
