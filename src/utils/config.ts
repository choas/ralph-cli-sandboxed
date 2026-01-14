import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface RalphConfig {
  language: string;
  checkCommand: string;
  testCommand: string;
  imageName?: string;
  notifyCommand?: string;
  technologies?: string[];
  javaVersion?: number;
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
