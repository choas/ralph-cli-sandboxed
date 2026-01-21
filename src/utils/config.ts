import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getCliProviders } from "../templates/prompts.js";

export interface CliConfig {
  command: string;
  args?: string[];
  yoloArgs?: string[];
  promptArgs?: string[];
  modelArgs?: string[];
}

export interface RalphConfig {
  language: string;
  checkCommand: string;
  testCommand: string;
  imageName?: string;
  notifyCommand?: string;
  technologies?: string[];
  javaVersion?: number;
  cli?: CliConfig;
  cliProvider?: string;
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
  };
}

export const DEFAULT_CLI_CONFIG: CliConfig = {
  command: "claude",
  args: ["--permission-mode", "acceptEdits"],
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
    if (cgroup.includes("docker") || cgroup.includes("podman") || cgroup.includes("/lxc/") || cgroup.includes("containerd")) {
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
    console.error("For security, ralph executes AI agents only in isolated container environments.");
    console.error("");
    console.error("To set up a container:");
    console.error("  ralph docker init    # Generate Docker configuration files");
    console.error("  ralph docker build   # Build the container image");
    console.error("  ralph docker run     # Run ralph inside the container");
    process.exit(1);
  }
}
