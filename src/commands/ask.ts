import { loadConfig, ResponderConfig } from "../utils/config.js";
import {
  loadResponderPresets,
  presetToResponderConfig,
} from "../utils/responder-presets.js";
import { executeLLMResponder } from "../responders/llm-responder.js";
import { executeClaudeCodeResponder } from "../responders/claude-code-responder.js";
import { executeCLIResponder } from "../responders/cli-responder.js";

/**
 * Large maxLength override for CLI usage — users want the full response.
 */
const CLI_MAX_LENGTH = 100_000;

/**
 * ralph ask <preset> <message...>
 *
 * Run a responder preset from the CLI and print the result to stdout.
 */
export async function ask(args: string[]): Promise<void> {
  // Handle flags before positional args
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    showHelp();
    return;
  }

  if (args[0] === "--list" || args[0] === "-l") {
    listPresets();
    return;
  }

  const name = args[0];
  const message = args.slice(1).join(" ");

  if (!message) {
    console.error(`Error: No message provided.`);
    console.error(`Usage: ralph ask <preset> <message...>`);
    process.exit(1);
  }

  // Resolve responder config: config responders first, then built-in presets
  const { responderConfig, source } = resolveResponder(name);

  if (!responderConfig) {
    console.error(`Error: Unknown responder "${name}".`);
    console.error(`Run 'ralph ask --list' to see available presets.`);
    process.exit(1);
  }

  // Override maxLength for CLI (no truncation)
  const config: ResponderConfig = { ...responderConfig, maxLength: CLI_MAX_LENGTH };

  if (source === "config") {
    // Config responders may need ralph config for LLM providers
  }

  // Execute based on type
  const result = await executeResponder(config, message);

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  console.log(result.response);
}

function resolveResponder(
  name: string,
): { responderConfig: ResponderConfig | null; source: "config" | "preset" } {
  // 1. Check config responders first (user overrides)
  try {
    const ralphConfig = loadConfig();
    const responders = ralphConfig.chat?.responders;
    if (responders && responders[name]) {
      return { responderConfig: responders[name], source: "config" };
    }
  } catch {
    // Config not loaded — fall through to presets
  }

  // 2. Check built-in presets
  const presetsConfig = loadResponderPresets();
  const preset = presetsConfig.presets[name];
  if (preset) {
    return { responderConfig: presetToResponderConfig(preset), source: "preset" };
  }

  return { responderConfig: null, source: "preset" };
}

async function executeResponder(
  config: ResponderConfig,
  message: string,
): Promise<{ success: boolean; response: string; error?: string }> {
  switch (config.type) {
    case "llm":
      return executeLLMResponder(message, config, undefined, {
        responderName: "ask",
      });

    case "claude-code":
      return executeClaudeCodeResponder(message, config, {
        maxLength: config.maxLength,
      });

    case "cli":
      return executeCLIResponder(message, config, {
        maxLength: config.maxLength,
      });

    default:
      return {
        success: false,
        response: "",
        error: `Unsupported responder type: ${config.type}`,
      };
  }
}

function listPresets(): void {
  const presetsConfig = loadResponderPresets();

  console.log("Built-in presets:");
  for (const [id, preset] of Object.entries(presetsConfig.presets)) {
    console.log(`  ${id.padEnd(12)} ${preset.type.padEnd(14)} ${preset.description}`);
  }

  // Show config responders if available
  try {
    const ralphConfig = loadConfig();
    const responders = ralphConfig.chat?.responders;
    if (responders && Object.keys(responders).length > 0) {
      console.log("\nConfigured responders:");
      for (const [name, cfg] of Object.entries(responders)) {
        console.log(`  ${name.padEnd(12)} ${cfg.type.padEnd(14)} (from config.json)`);
      }
    }
  } catch {
    // No config — skip
  }
}

function showHelp(): void {
  console.log(`
ralph ask - Run a responder preset from the CLI

USAGE:
  ralph ask <preset> <message...>
  ralph ask --list
  ralph ask --help

OPTIONS:
  -l, --list    List available presets and configured responders
  -h, --help    Show this help message

DESCRIPTION:
  Runs a responder preset (or custom responder from config) and prints
  the result to stdout. This lets you use responder presets without
  needing a chat provider set up.

  Lookup priority: config responders first, then built-in presets.

EXAMPLES:
  ralph ask qa "What does the config loader do?"
  ralph ask reviewer diff
  ralph ask architect "Should we split this into microservices?"
  ralph ask explain src/utils/config.ts
  ralph ask code "Add a --verbose flag to the run command"
  ralph ask --list
`.trimEnd());
}
