import { existsSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import { getLanguages, generatePromptTemplate, DEFAULT_PRD, DEFAULT_PROGRESS, getCliProviders, getSkillsForLanguage, type LanguageConfig, type SkillDefinition } from "../templates/prompts.js";
import { type SkillConfig } from "../utils/config.js";
import { promptSelectWithArrows, promptConfirm, promptInput, promptMultiSelectWithArrows } from "../utils/prompt.js";
import { type CliConfig } from "../utils/config.js";
import { dockerInit } from "./docker.js";

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

export async function init(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const ralphDir = join(cwd, RALPH_DIR);
  const useDefaults = args.includes("-y") || args.includes("--yes");

  console.log("Initializing ralph in current directory...\n");

  // Check for existing .ralph directory
  if (existsSync(ralphDir)) {
    if (!useDefaults) {
      const reinit = await promptConfirm(".ralph/ directory already exists. Re-initialize?");
      if (!reinit) {
        console.log("Aborted.");
        return;
      }
    }
  } else {
    mkdirSync(ralphDir, { recursive: true });
    console.log(`Created ${RALPH_DIR}/`);
  }

  const CLI_PROVIDERS = getCliProviders();
  const LANGUAGES = getLanguages();

  let selectedCliProviderKey: string;
  let cliConfig: CliConfig;
  let selectedKey: string;
  let selectedTechnologies: string[] = [];
  let selectedSkills: SkillConfig[] = [];
  let checkCommand: string;
  let testCommand: string;

  if (useDefaults) {
    // Use defaults: Claude CLI + Node.js
    selectedCliProviderKey = "claude";
    const provider = CLI_PROVIDERS[selectedCliProviderKey];
    cliConfig = {
      command: provider.command,
      args: provider.defaultArgs,
      yoloArgs: provider.yoloArgs.length > 0 ? provider.yoloArgs : undefined,
      promptArgs: provider.promptArgs ?? [],
    };
    selectedKey = "node";
    const config = LANGUAGES[selectedKey];
    checkCommand = config.checkCommand;
    testCommand = config.testCommand;

    console.log(`Using defaults: ${CLI_PROVIDERS[selectedCliProviderKey].name} + ${LANGUAGES[selectedKey].name}`);
  } else {
    // Step 1: Select CLI provider (first)
    const providerKeys = Object.keys(CLI_PROVIDERS);
    const providerNames = providerKeys.map(k => `${CLI_PROVIDERS[k].name} - ${CLI_PROVIDERS[k].description}`);

    const selectedProviderName = await promptSelectWithArrows("Select your AI CLI provider:", providerNames);
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
      const customPromptArgsInput = await promptInput("Enter prompt arguments (e.g., -p for flag-based, leave empty for positional): ");
      const customPromptArgs = customPromptArgsInput.trim() ? customPromptArgsInput.trim().split(/\s+/) : [];

      cliConfig = {
        command: customCommand || "claude",
        args: customArgs,
        yoloArgs: customYoloArgs.length > 0 ? customYoloArgs : undefined,
        promptArgs: customPromptArgs,
      };
    } else {
      cliConfig = {
        command: selectedProvider.command,
        args: selectedProvider.defaultArgs,
        yoloArgs: selectedProvider.yoloArgs.length > 0 ? selectedProvider.yoloArgs : undefined,
        promptArgs: selectedProvider.promptArgs ?? [],
      };
    }

    console.log(`\nSelected CLI provider: ${CLI_PROVIDERS[selectedCliProviderKey].name}`);

    // Step 2: Select language (second)
    const languageKeys = Object.keys(LANGUAGES);
    const languageNames = languageKeys.map(k => `${LANGUAGES[k].name} - ${LANGUAGES[k].description}`);

    const selectedName = await promptSelectWithArrows("Select your project language/runtime:", languageNames);
    const selectedIndex = languageNames.indexOf(selectedName);
    selectedKey = languageKeys[selectedIndex];
    const config = LANGUAGES[selectedKey];

    console.log(`\nSelected language: ${config.name}`);

    // Step 3: Select technology stack if available (third)
    if (config.technologies && config.technologies.length > 0) {
      const techOptions = config.technologies.map(t => `${t.name} - ${t.description}`);
      const techNames = config.technologies.map(t => t.name);

      selectedTechnologies = await promptMultiSelectWithArrows(
        "Select your technology stack (optional):",
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

    // Step 4: Select skills if available for this language
    const availableSkills = getSkillsForLanguage(selectedKey);
    if (availableSkills.length > 0) {
      const skillOptions = availableSkills.map(s => `${s.name} - ${s.description}`);

      const selectedSkillNames = await promptMultiSelectWithArrows(
        "Select AI coding rules/skills to enable (optional):",
        skillOptions
      );

      // Convert selected display names to SkillConfig objects
      selectedSkills = selectedSkillNames.map(sel => {
        const idx = skillOptions.indexOf(sel);
        const skill = availableSkills[idx];
        return {
          name: skill.name,
          description: skill.description,
          instructions: skill.instructions,
          userInvocable: skill.userInvocable,
        };
      });

      if (selectedSkills.length > 0) {
        console.log(`\nSelected skills: ${selectedSkills.map(s => s.name).join(", ")}`);
      } else {
        console.log("\nNo skills selected.");
      }
    }

    // Allow custom commands for "none" language
    checkCommand = config.checkCommand;
    testCommand = config.testCommand;

    if (selectedKey === "none") {
      checkCommand = await promptInput("\nEnter your type/build check command: ") || checkCommand;
      testCommand = await promptInput("Enter your test command: ") || testCommand;
    }
  }

  const finalConfig: LanguageConfig = {
    ...LANGUAGES[selectedKey],
    checkCommand,
    testCommand,
  };

  // Generate image name from directory name
  const projectName = basename(cwd).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const imageName = `ralph-${projectName}`;

  // Write config file with all available options (defaults or empty values)
  const configData: Record<string, unknown> = {
    // Required fields
    language: selectedKey,
    checkCommand: finalConfig.checkCommand,
    testCommand: finalConfig.testCommand,
    imageName,

    // CLI configuration
    cli: cliConfig,
    cliProvider: selectedCliProviderKey,

    // Optional fields with defaults/empty values for discoverability
    notifyCommand: "",
    technologies: selectedTechnologies.length > 0 ? selectedTechnologies : [],
    javaVersion: selectedKey === "java" ? 21 : null,

    // Docker configuration options
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
    },

    // Claude-specific configuration (MCP servers and skills)
    claude: {
      mcpServers: {},
      skills: selectedSkills,
    },
  };

  const configPath = join(ralphDir, CONFIG_FILE);
  writeFileSync(configPath, JSON.stringify(configData, null, 2) + "\n");
  console.log(`\nCreated ${RALPH_DIR}/${CONFIG_FILE}`);

  // Write prompt file (ask if exists) - uses template with $variables
  const prompt = generatePromptTemplate();
  const promptPath = join(ralphDir, PROMPT_FILE);

  if (existsSync(promptPath) && !useDefaults) {
    const overwritePrompt = await promptConfirm(`${RALPH_DIR}/${PROMPT_FILE} already exists. Overwrite?`);
    if (overwritePrompt) {
      writeFileSync(promptPath, prompt + "\n");
      console.log(`Updated ${RALPH_DIR}/${PROMPT_FILE}`);
    } else {
      console.log(`Skipped ${RALPH_DIR}/${PROMPT_FILE}`);
    }
  } else {
    writeFileSync(promptPath, prompt + "\n");
    console.log(`${existsSync(promptPath) ? "Updated" : "Created"} ${RALPH_DIR}/${PROMPT_FILE}`);
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

  // Generate Docker files automatically
  await dockerInit(true);
  console.log("Created .ralph/docker/ files");

  console.log("\nRalph initialized successfully!");
  console.log("\nNext steps:");
  console.log("  1. Edit .ralph/prd.json to add your project requirements");
  console.log("  2. Run 'ralph docker run' to start (auto-builds image on first run)");
  console.log("\nSee .ralph/HOW-TO-WRITE-PRDs.md for guidance on writing PRDs");
  console.log("To regenerate Docker files: ralph docker init");
}
