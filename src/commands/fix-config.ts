import { existsSync, readFileSync, writeFileSync, copyFileSync } from "fs";
import { getPaths, type RalphConfig } from "../utils/config.js";
import { promptConfirm } from "../utils/prompt.js";
import { getLanguages, getCliProviders } from "../templates/prompts.js";

/**
 * Configuration sections that can be individually validated and recovered.
 */
const CONFIG_SECTIONS = [
  "language",
  "checkCommand",
  "testCommand",
  "imageName",
  "cli",
  "cliProvider",
  "notifyCommand",
  "notifications",
  "technologies",
  "javaVersion",
  "docker",
  "claude",
  "chat",
  "daemon",
] as const;

type ConfigSection = (typeof CONFIG_SECTIONS)[number];

interface RecoveryResult {
  recovered: ConfigSection[];
  reset: ConfigSection[];
  errors: string[];
}

/**
 * Attempts to parse JSON, returning the error position if parsing fails.
 */
function parseJsonWithError(content: string): {
  data?: unknown;
  error?: string;
  line?: number;
  column?: number;
} {
  try {
    return { data: JSON.parse(content) };
  } catch (err) {
    if (err instanceof SyntaxError) {
      const errorMsg = err.message;
      // Extract position from error message (e.g., "at position 123" or "at line 5 column 10")
      const posMatch = errorMsg.match(/at position (\d+)/);
      const lineColMatch = errorMsg.match(/at line (\d+) column (\d+)/);

      if (lineColMatch) {
        return {
          error: errorMsg,
          line: parseInt(lineColMatch[1], 10),
          column: parseInt(lineColMatch[2], 10),
        };
      } else if (posMatch) {
        const position = parseInt(posMatch[1], 10);
        const lines = content.substring(0, position).split("\n");
        return {
          error: errorMsg,
          line: lines.length,
          column: lines[lines.length - 1].length + 1,
        };
      }
      return { error: errorMsg };
    }
    return { error: String(err) };
  }
}

/**
 * Generates default config values (matching ralph init defaults).
 */
function getDefaultConfig(): RalphConfig {
  const LANGUAGES = getLanguages();
  const CLI_PROVIDERS = getCliProviders();
  const defaultLanguage = "node";
  const defaultProvider = CLI_PROVIDERS["claude"];
  const langConfig = LANGUAGES[defaultLanguage];

  return {
    language: defaultLanguage,
    checkCommand: langConfig.checkCommand,
    testCommand: langConfig.testCommand,
    imageName: "ralph-project",
    cli: {
      command: defaultProvider.command,
      args: defaultProvider.defaultArgs,
      yoloArgs: defaultProvider.yoloArgs.length > 0 ? defaultProvider.yoloArgs : undefined,
      promptArgs: defaultProvider.promptArgs ?? [],
    },
    cliProvider: "claude",
    notifyCommand: "",
    technologies: [],
    docker: {
      ports: [],
      volumes: [],
      environment: {},
      git: {
        name: "",
        email: "",
      },
      packages: [],
      buildCommands: {
        root: [],
        node: [],
      },
      startCommand: "",
      asciinema: {
        enabled: false,
        autoRecord: false,
        outputDir: ".recordings",
        streamJson: {
          enabled: false,
          saveRawJson: true,
        },
      },
      firewall: {
        allowedDomains: [],
      },
      autoStart: false,
      restartCount: 0,
    },
    claude: {
      mcpServers: {},
      skills: [],
    },
    chat: {
      enabled: false,
      provider: "telegram",
      telegram: {
        botToken: "",
        allowedChatIds: [],
      },
    },
    daemon: {
      actions: {},
      events: {},
    },
  };
}

/**
 * Validates a specific section of the config.
 */
function validateSection(section: ConfigSection, value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  switch (section) {
    case "language":
    case "checkCommand":
    case "testCommand":
    case "imageName":
    case "cliProvider":
    case "notifyCommand":
      return typeof value === "string";

    case "technologies":
      return Array.isArray(value) && value.every((item) => typeof item === "string");

    case "javaVersion":
      return value === null || typeof value === "number";

    case "cli":
      if (typeof value !== "object" || value === null) return false;
      const cli = value as Record<string, unknown>;
      return typeof cli.command === "string";

    case "notifications":
      if (typeof value !== "object" || value === null) return false;
      const notif = value as Record<string, unknown>;
      return typeof notif.provider === "string";

    case "docker":
    case "claude":
    case "chat":
    case "daemon":
      return typeof value === "object" && value !== null;

    default:
      return true;
  }
}

/**
 * Attempts to extract a value from potentially corrupt JSON using regex.
 * This is a best-effort approach for partially corrupt files.
 */
function extractSectionFromCorrupt(content: string, section: ConfigSection): unknown | undefined {
  // Try to find the section in the raw content
  const patterns: Record<string, RegExp> = {
    language: /"language"\s*:\s*"([^"]+)"/,
    checkCommand: /"checkCommand"\s*:\s*"([^"]+)"/,
    testCommand: /"testCommand"\s*:\s*"([^"]+)"/,
    imageName: /"imageName"\s*:\s*"([^"]+)"/,
    cliProvider: /"cliProvider"\s*:\s*"([^"]+)"/,
    notifyCommand: /"notifyCommand"\s*:\s*"([^"]*)"/,
  };

  const pattern = patterns[section];
  if (pattern) {
    const match = content.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

/**
 * Attempts to recover valid sections from a corrupt config.
 */
function recoverSections(
  corruptContent: string,
  parsedPartial: Record<string, unknown> | null,
): RecoveryResult {
  const defaultConfig = getDefaultConfig();
  const recoveredConfig: Record<string, unknown> = {};
  const result: RecoveryResult = {
    recovered: [],
    reset: [],
    errors: [],
  };

  for (const section of CONFIG_SECTIONS) {
    let value: unknown = undefined;
    let source = "default";

    // First, try to get from parsed partial (if JSON was partially valid)
    if (parsedPartial && section in parsedPartial) {
      value = parsedPartial[section];
      source = "parsed";
    }

    // If not found or invalid, try regex extraction for simple string fields
    if (
      (value === undefined || !validateSection(section, value)) &&
      typeof corruptContent === "string"
    ) {
      const extracted = extractSectionFromCorrupt(corruptContent, section);
      if (extracted !== undefined && validateSection(section, extracted)) {
        value = extracted;
        source = "extracted";
      }
    }

    // Validate the value
    if (validateSection(section, value)) {
      recoveredConfig[section] = value;
      result.recovered.push(section);
    } else {
      // Use default value
      recoveredConfig[section] = (defaultConfig as unknown as Record<string, unknown>)[section];
      result.reset.push(section);
    }
  }

  return result;
}

/**
 * Creates a backup of the config file.
 */
function createBackup(configPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = configPath.replace("config.json", `config.json.backup.${timestamp}`);
  copyFileSync(configPath, backupPath);
  return backupPath;
}

/**
 * Merges recovered sections into a valid config object.
 */
function buildRecoveredConfig(
  corruptContent: string,
  parsedPartial: Record<string, unknown> | null,
): { config: RalphConfig; result: RecoveryResult } {
  const defaultConfig = getDefaultConfig();
  const result: RecoveryResult = {
    recovered: [],
    reset: [],
    errors: [],
  };
  const config: Record<string, unknown> = {};

  for (const section of CONFIG_SECTIONS) {
    let value: unknown = undefined;

    // First, try to get from parsed partial
    if (parsedPartial && section in parsedPartial) {
      value = parsedPartial[section];
    }

    // If not found or invalid, try regex extraction
    if (value === undefined || !validateSection(section, value)) {
      const extracted = extractSectionFromCorrupt(corruptContent, section);
      if (extracted !== undefined && validateSection(section, extracted)) {
        value = extracted;
      }
    }

    // Validate and assign
    if (validateSection(section, value)) {
      config[section] = value;
      result.recovered.push(section);
    } else {
      config[section] = (defaultConfig as unknown as Record<string, unknown>)[section];
      result.reset.push(section);
    }
  }

  return { config: config as unknown as RalphConfig, result };
}

/**
 * Main fix-config command handler.
 */
export async function fixConfig(args: string[]): Promise<void> {
  const verifyOnly = args.includes("--verify") || args.includes("-v");
  const skipPrompt = args.includes("-y") || args.includes("--yes");
  const paths = getPaths();
  const configPath = paths.config;

  // Check if config file exists
  if (!existsSync(configPath)) {
    console.error("Error: .ralph/config.json not found. Run 'ralph init' first.");
    process.exit(1);
  }

  console.log("Checking config.json...\n");

  // Read the raw content
  const rawContent = readFileSync(configPath, "utf-8");

  // Attempt to parse the JSON
  const parseResult = parseJsonWithError(rawContent);

  if (parseResult.data) {
    // JSON is syntactically valid
    const config = parseResult.data as Record<string, unknown>;

    // Validate required fields
    const missingFields: string[] = [];
    if (typeof config.language !== "string") missingFields.push("language");
    if (typeof config.checkCommand !== "string") missingFields.push("checkCommand");
    if (typeof config.testCommand !== "string") missingFields.push("testCommand");

    if (missingFields.length === 0) {
      console.log("\x1b[32m✓ config.json is valid.\x1b[0m");
      return;
    }

    console.log("\x1b[33m⚠ config.json is missing required fields:\x1b[0m");
    missingFields.forEach((field) => console.log(`  - ${field}`));

    if (verifyOnly) {
      process.exit(1);
    }

    // Offer to fix missing fields
    if (!skipPrompt) {
      const confirm = await promptConfirm("\nFix missing fields with defaults?");
      if (!confirm) {
        console.log("Aborted.");
        return;
      }
    }

    // Create backup
    const backupPath = createBackup(configPath);
    console.log(`\nCreated backup: ${backupPath}`);

    // Merge with defaults
    const defaultConfig = getDefaultConfig();
    const fixedConfig = { ...defaultConfig, ...config };

    // Ensure required fields exist
    for (const field of missingFields) {
      (fixedConfig as unknown as Record<string, unknown>)[field] = (
        defaultConfig as unknown as Record<string, unknown>
      )[field];
    }

    writeFileSync(configPath, JSON.stringify(fixedConfig, null, 2) + "\n");
    console.log("\n\x1b[32m✓ config.json repaired.\x1b[0m");
    console.log(`  Added defaults for: ${missingFields.join(", ")}`);
    return;
  }

  // JSON parsing failed
  console.log("\x1b[31m✗ config.json contains invalid JSON.\x1b[0m");
  console.log(`  Error: ${parseResult.error}`);
  if (parseResult.line) {
    console.log(`  Location: line ${parseResult.line}, column ${parseResult.column || "?"}`);
  }

  if (verifyOnly) {
    process.exit(1);
  }

  // Attempt recovery
  console.log("\nAttempting to recover valid sections...\n");

  // Try to parse partially (some JSON parsers are more lenient)
  let parsedPartial: Record<string, unknown> | null = null;
  try {
    // Try JSON5-style parsing by removing trailing commas and comments
    const cleaned = rawContent
      .replace(/,\s*([\]}])/g, "$1") // Remove trailing commas
      .replace(/\/\/.*$/gm, "") // Remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, ""); // Remove multi-line comments
    parsedPartial = JSON.parse(cleaned);
  } catch {
    // Partial parsing failed, continue with regex extraction
  }

  const { config: recoveredConfig, result } = buildRecoveredConfig(rawContent, parsedPartial);

  // Report results
  console.log("Recovery analysis:");
  if (result.recovered.length > 0) {
    console.log(`\x1b[32m  Recoverable sections (${result.recovered.length}):\x1b[0m`);
    result.recovered.forEach((section) => console.log(`    ✓ ${section}`));
  }
  if (result.reset.length > 0) {
    console.log(`\x1b[33m  Reset to defaults (${result.reset.length}):\x1b[0m`);
    result.reset.forEach((section) => console.log(`    ⚠ ${section}`));
  }

  // Confirm before applying
  if (!skipPrompt) {
    console.log();
    const confirm = await promptConfirm("Apply these fixes?");
    if (!confirm) {
      console.log("Aborted.");
      return;
    }
  }

  // Create backup of corrupt file
  const backupPath = createBackup(configPath);
  console.log(`\nCreated backup: ${backupPath}`);

  // Write the recovered config
  writeFileSync(configPath, JSON.stringify(recoveredConfig, null, 2) + "\n");

  console.log("\n\x1b[32m✓ config.json repaired.\x1b[0m");
  console.log(`  Recovered: ${result.recovered.length} sections`);
  console.log(`  Reset to defaults: ${result.reset.length} sections`);
  console.log(`  Original backup: ${backupPath}`);
}
