import { existsSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import { getLanguages, generatePromptTemplate, DEFAULT_PRD, DEFAULT_PROGRESS, getCliProviders, type LanguageConfig, type TechnologyStack, type CliProviderConfig } from "../templates/prompts.js";
import { promptSelect, promptConfirm, promptInput, promptMultiSelect } from "../utils/prompt.js";
import { DEFAULT_CLI_CONFIG, type CliConfig } from "../utils/config.js";

// Get package root directory (works for both dev and installed package)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, "..", "..");  // dist/commands -> dist -> package root

const RALPH_DIR = ".ralph";
const CONFIG_FILE = "config.json";
const PROMPT_FILE = "prompt.md";
const PRD_FILE = "prd.json";
const PROGRESS_FILE = "progress.txt";
const PRD_GUIDE_FILE = "HOW-TO-WRITE-PRDs.md";

function hasFlag(args: string[], ...flags: string[]): boolean {
  return args.some(arg => flags.includes(arg));
}

export async function init(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const ralphDir = join(cwd, RALPH_DIR);
  const showTechStack = hasFlag(args, "--tech-stack", "-t");
  const showCliSelection = hasFlag(args, "--cli", "-c");

  console.log("Initializing ralph in current directory...\n");

  // Check for existing .ralph directory
  if (existsSync(ralphDir)) {
    const reinit = await promptConfirm(".ralph/ directory already exists. Re-initialize?");
    if (!reinit) {
      console.log("Aborted.");
      return;
    }
  } else {
    mkdirSync(ralphDir, { recursive: true });
    console.log(`Created ${RALPH_DIR}/`);
  }

  // Select language
  const LANGUAGES = getLanguages();
  const languageKeys = Object.keys(LANGUAGES);
  const languageNames = languageKeys.map(k => `${LANGUAGES[k].name} - ${LANGUAGES[k].description}`);

  const selectedName = await promptSelect("Select your project language/runtime:", languageNames);
  const selectedIndex = languageNames.indexOf(selectedName);
  const selectedKey = languageKeys[selectedIndex];
  const config = LANGUAGES[selectedKey];

  // Select technology stack if available (only when --tech-stack flag is provided)
  let selectedTechnologies: string[] = [];

  if (showTechStack && config.technologies && config.technologies.length > 0) {
    const techOptions = config.technologies.map(t => `${t.name} - ${t.description}`);
    const techNames = config.technologies.map(t => t.name);

    selectedTechnologies = await promptMultiSelect(
      "Select your technology stack (select multiple or add custom):",
      techOptions
    );

    // Convert display names back to just technology names for predefined options
    selectedTechnologies = selectedTechnologies.map(sel => {
      const idx = techOptions.indexOf(sel);
      return idx >= 0 ? techNames[idx] : sel;
    });

    if (selectedTechnologies.length > 0) {
      console.log(`\nSelected technologies: ${selectedTechnologies.join(", ")}`);
    } else {
      console.log("\nNo technologies selected.");
    }
  }

  // Allow custom commands
  let checkCommand = config.checkCommand;
  let testCommand = config.testCommand;

  if (selectedKey === "none") {
    checkCommand = await promptInput("\nEnter your type/build check command: ") || checkCommand;
    testCommand = await promptInput("Enter your test command: ") || testCommand;
  }

  const finalConfig: LanguageConfig = {
    ...config,
    checkCommand,
    testCommand,
  };

  // Select CLI provider if --cli flag is provided
  let cliConfig: CliConfig = DEFAULT_CLI_CONFIG;
  let selectedCliProviderKey = "claude"; // Default to claude

  if (showCliSelection) {
    const CLI_PROVIDERS = getCliProviders();
    const providerKeys = Object.keys(CLI_PROVIDERS);
    const providerNames = providerKeys.map(k => `${CLI_PROVIDERS[k].name} - ${CLI_PROVIDERS[k].description}`);

    const selectedProviderName = await promptSelect("Select your AI CLI provider:", providerNames);
    const selectedProviderIndex = providerNames.indexOf(selectedProviderName);
    selectedCliProviderKey = providerKeys[selectedProviderIndex];
    const selectedProvider = CLI_PROVIDERS[selectedCliProviderKey];

    // Handle custom CLI provider
    if (selectedCliProviderKey === "custom") {
      const customCommand = await promptInput("\nEnter your CLI command: ");
      const customArgsInput = await promptInput("Enter default arguments (space-separated): ");
      const customArgs = customArgsInput.trim() ? customArgsInput.trim().split(/\s+/) : [];
      const customYoloArgsInput = await promptInput("Enter yolo/auto-approve arguments (space-separated): ");
      const customYoloArgs = customYoloArgsInput.trim() ? customYoloArgsInput.trim().split(/\s+/) : [];

      cliConfig = {
        command: customCommand || "claude",
        args: customArgs,
        yoloArgs: customYoloArgs.length > 0 ? customYoloArgs : undefined,
      };
    } else {
      cliConfig = {
        command: selectedProvider.command,
        args: selectedProvider.defaultArgs,
        yoloArgs: selectedProvider.yoloArgs.length > 0 ? selectedProvider.yoloArgs : undefined,
      };
    }

    console.log(`\nSelected CLI provider: ${CLI_PROVIDERS[selectedCliProviderKey].name}`);
  }

  // Generate image name from directory name
  const projectName = basename(cwd).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const imageName = `ralph-${projectName}`;

  // Write config file
  const configData: Record<string, unknown> = {
    language: selectedKey,
    checkCommand: finalConfig.checkCommand,
    testCommand: finalConfig.testCommand,
    imageName,
    cli: cliConfig,
    cliProvider: selectedCliProviderKey,
  };

  // Add technologies if any were selected
  if (selectedTechnologies.length > 0) {
    configData.technologies = selectedTechnologies;
  }

  const configPath = join(ralphDir, CONFIG_FILE);
  writeFileSync(configPath, JSON.stringify(configData, null, 2) + "\n");
  console.log(`\nCreated ${RALPH_DIR}/${CONFIG_FILE}`);

  // Write prompt file (ask if exists) - uses template with $variables
  const prompt = generatePromptTemplate();
  const promptPath = join(ralphDir, PROMPT_FILE);

  if (existsSync(promptPath)) {
    const overwritePrompt = await promptConfirm(`${RALPH_DIR}/${PROMPT_FILE} already exists. Overwrite?`);
    if (overwritePrompt) {
      writeFileSync(promptPath, prompt + "\n");
      console.log(`Updated ${RALPH_DIR}/${PROMPT_FILE}`);
    } else {
      console.log(`Skipped ${RALPH_DIR}/${PROMPT_FILE}`);
    }
  } else {
    writeFileSync(promptPath, prompt + "\n");
    console.log(`Created ${RALPH_DIR}/${PROMPT_FILE}`);
  }

  // Create PRD if not exists
  const prdPath = join(ralphDir, PRD_FILE);
  if (!existsSync(prdPath)) {
    writeFileSync(prdPath, DEFAULT_PRD + "\n");
    console.log(`Created ${RALPH_DIR}/${PRD_FILE}`);
  } else {
    console.log(`Skipped ${RALPH_DIR}/${PRD_FILE} (already exists)`);
  }

  // Create progress file if not exists
  const progressPath = join(ralphDir, PROGRESS_FILE);
  if (!existsSync(progressPath)) {
    writeFileSync(progressPath, DEFAULT_PROGRESS);
    console.log(`Created ${RALPH_DIR}/${PROGRESS_FILE}`);
  } else {
    console.log(`Skipped ${RALPH_DIR}/${PROGRESS_FILE} (already exists)`);
  }

  // Copy PRD guide file from package if not exists
  const prdGuidePath = join(ralphDir, PRD_GUIDE_FILE);
  if (!existsSync(prdGuidePath)) {
    const sourcePath = join(PACKAGE_ROOT, "docs", PRD_GUIDE_FILE);
    if (existsSync(sourcePath)) {
      copyFileSync(sourcePath, prdGuidePath);
      console.log(`Created ${RALPH_DIR}/${PRD_GUIDE_FILE}`);
    }
  } else {
    console.log(`Skipped ${RALPH_DIR}/${PRD_GUIDE_FILE} (already exists)`);
  }

  console.log("\nRalph initialized successfully!");
  console.log("\nNext steps:");
  console.log("  1. Read .ralph/HOW-TO-WRITE-PRDs.md for guidance on writing PRDs");
  console.log("  2. Edit .ralph/prd.json to add your project requirements");
  console.log("  3. Run 'ralph docker init' to generate Docker configuration");
  console.log("  4. Run 'ralph docker build' to build the container");
  console.log("  5. Run 'ralph docker run' to start ralph in the container");
}
