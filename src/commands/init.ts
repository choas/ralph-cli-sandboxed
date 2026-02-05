import { existsSync, writeFileSync, mkdirSync, copyFileSync, chmodSync } from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import {
  getLanguages,
  generatePromptTemplate,
  DEFAULT_PRD_YAML,
  DEFAULT_PROGRESS,
  getCliProviders,
  getSkillsForLanguage,
  type LanguageConfig,
  type SkillDefinition,
} from "../templates/prompts.js";
import {
  generateGenXcodeScript,
  hasSwiftUI,
  hasFastlane,
  generateFastfile,
  generateAppfile,
  generateFastlaneReadmeSection,
} from "../templates/macos-scripts.js";
import { type SkillConfig, type RespondersConfig } from "../utils/config.js";
import {
  promptSelectWithArrows,
  promptConfirm,
  promptInput,
  promptMultiSelectWithArrows,
} from "../utils/prompt.js";
import { type CliConfig } from "../utils/config.js";
import { dockerInit } from "./docker.js";
import {
  getBundleDisplayOptions,
  displayOptionToBundleId,
  bundleToRespondersConfig,
  getPresetDisplayOptions,
  displayOptionToPresetId,
  presetsToRespondersConfig,
} from "../utils/responder-presets.js";

// Get package root directory (works for both dev and installed package)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, "..", ".."); // dist/commands -> dist -> package root

const RALPH_DIR = ".ralph";
const CONFIG_FILE = "config.json";
const PROMPT_FILE = "prompt.md";
const PRD_FILE = "prd.yaml";
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
  let selectedResponders: RespondersConfig = {};
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

    console.log(
      `Using defaults: ${CLI_PROVIDERS[selectedCliProviderKey].name} + ${LANGUAGES[selectedKey].name}`,
    );
  } else {
    // Step 1: Select CLI provider (first)
    const providerKeys = Object.keys(CLI_PROVIDERS);
    const providerNames = providerKeys.map(
      (k) => `${CLI_PROVIDERS[k].name} - ${CLI_PROVIDERS[k].description}`,
    );

    const selectedProviderName = await promptSelectWithArrows(
      "Select your AI CLI provider:",
      providerNames,
    );
    const selectedProviderIndex = providerNames.indexOf(selectedProviderName);
    selectedCliProviderKey = providerKeys[selectedProviderIndex];
    const selectedProvider = CLI_PROVIDERS[selectedCliProviderKey];

    // Handle custom CLI provider
    if (selectedCliProviderKey === "custom") {
      const customCommand = await promptInput("\nEnter your CLI command: ");
      const customArgsInput = await promptInput("Enter default arguments (space-separated): ");
      const customArgs = customArgsInput.trim() ? customArgsInput.trim().split(/\s+/) : [];
      const customYoloArgsInput = await promptInput(
        "Enter yolo/auto-approve arguments (space-separated): ",
      );
      const customYoloArgs = customYoloArgsInput.trim()
        ? customYoloArgsInput.trim().split(/\s+/)
        : [];
      const customPromptArgsInput = await promptInput(
        "Enter prompt arguments (e.g., -p for flag-based, leave empty for positional): ",
      );
      const customPromptArgs = customPromptArgsInput.trim()
        ? customPromptArgsInput.trim().split(/\s+/)
        : [];

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
    const languageNames = languageKeys.map(
      (k) => `${LANGUAGES[k].name} - ${LANGUAGES[k].description}`,
    );

    const selectedName = await promptSelectWithArrows(
      "Select your project language/runtime:",
      languageNames,
    );
    const selectedIndex = languageNames.indexOf(selectedName);
    selectedKey = languageKeys[selectedIndex];
    const config = LANGUAGES[selectedKey];

    console.log(`\nSelected language: ${config.name}`);

    // Step 3: Select technology stack if available (third)
    if (config.technologies && config.technologies.length > 0) {
      const techOptions = config.technologies.map((t) => `${t.name} - ${t.description}`);
      const techNames = config.technologies.map((t) => t.name);

      selectedTechnologies = await promptMultiSelectWithArrows(
        "Select your technology stack (optional):",
        techOptions,
      );

      // Convert display names back to just technology names for predefined options
      selectedTechnologies = selectedTechnologies.map((sel) => {
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
      const skillOptions = availableSkills.map((s) => `${s.name} - ${s.description}`);

      const selectedSkillNames = await promptMultiSelectWithArrows(
        "Select AI coding rules/skills to enable (optional):",
        skillOptions,
      );

      // Convert selected display names to SkillConfig objects
      selectedSkills = selectedSkillNames.map((sel) => {
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
        console.log(`\nSelected skills: ${selectedSkills.map((s) => s.name).join(", ")}`);
      } else {
        console.log("\nNo skills selected.");
      }
    }

    // Step 5: Select chat responder presets (optional)
    const setupResponders = await promptConfirm(
      "\nWould you like to set up chat responders?",
      false,
    );
    if (setupResponders) {
      // First, ask if they want a bundle or individual presets
      const selectionType = await promptSelectWithArrows(
        "How would you like to configure responders?",
        [
          "Use a preset bundle (recommended)",
          "Select individual presets",
          "Skip - configure later",
        ],
      );

      if (selectionType === "Use a preset bundle (recommended)") {
        const bundleOptions = getBundleDisplayOptions();
        const selectedBundle = await promptSelectWithArrows(
          "Select a responder bundle:",
          bundleOptions,
        );
        const bundleId = displayOptionToBundleId(selectedBundle);
        if (bundleId) {
          selectedResponders = bundleToRespondersConfig(bundleId);
          console.log(
            `\nConfigured responders from bundle: ${Object.keys(selectedResponders).join(", ")}`,
          );
        }
      } else if (selectionType === "Select individual presets") {
        const presetOptions = getPresetDisplayOptions();
        const selectedPresets = await promptMultiSelectWithArrows(
          "Select responder presets to enable:",
          presetOptions,
        );

        // Convert display options back to preset IDs
        const presetIds = selectedPresets
          .map(displayOptionToPresetId)
          .filter((id): id is string => id !== undefined);

        if (presetIds.length > 0) {
          selectedResponders = presetsToRespondersConfig(presetIds);
          console.log(`\nConfigured responders: ${Object.keys(selectedResponders).join(", ")}`);
        }
      } else {
        console.log("\nSkipping responders - you can configure them later in config.json");
      }
    }

    // Allow custom commands for "none" language
    checkCommand = config.checkCommand;
    testCommand = config.testCommand;

    if (selectedKey === "none") {
      checkCommand = (await promptInput("\nEnter your type/build check command: ")) || checkCommand;
      testCommand = (await promptInput("Enter your test command: ")) || testCommand;
    }
  }

  const finalConfig: LanguageConfig = {
    ...LANGUAGES[selectedKey],
    checkCommand,
    testCommand,
  };

  // Generate image name from directory name
  const projectName = basename(cwd)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-");
  const imageName = `ralph-${projectName}`;

  // Generate macOS development actions for Swift + SwiftUI projects
  const macOsActions: Record<string, { command: string; description: string }> = {};
  if (selectedKey === "swift" && hasSwiftUI(selectedTechnologies)) {
    macOsActions.gen_xcode = {
      command: "./scripts/gen_xcode.sh",
      description: "Generate Xcode project from Swift package",
    };
    macOsActions.build = {
      command: "xcodebuild -project *.xcodeproj -scheme * -configuration Debug build",
      description: "Build the Xcode project in Debug mode",
    };
    macOsActions.test = {
      command: "xcodebuild -project *.xcodeproj -scheme * test",
      description: "Run tests via xcodebuild",
    };

    // Add Fastlane actions if Fastlane technology is selected
    if (hasFastlane(selectedTechnologies)) {
      macOsActions.fastlane_init = {
        command: "cd scripts/fastlane && fastlane init",
        description: "Initialize Fastlane credentials (interactive)",
      };
      macOsActions.fastlane_beta = {
        command: "cd scripts/fastlane && fastlane beta",
        description: "Deploy beta build via Fastlane",
      };
      macOsActions.fastlane_release = {
        command: "cd scripts/fastlane && fastlane release",
        description: "Deploy release build via Fastlane",
      };
    }
  }

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

    // LLM providers for chat responders (empty by default, uses defaults from env vars)
    // Example:
    // llmProviders: {
    //   "claude": { type: "anthropic", model: "claude-sonnet-4-20250514" },
    //   "gpt4": { type: "openai", model: "gpt-4o" },
    //   "local": { type: "ollama", model: "llama3", baseUrl: "http://localhost:11434" }
    // }
    llmProviders: {},

    // Optional fields with defaults/empty values for discoverability
    notifyCommand: "",
    technologies: [selectedKey, ...selectedTechnologies],
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
      autoStart: false,
      restartCount: 0,
      worktreesPath: "",
    },

    // Claude-specific configuration (MCP servers and skills)
    claude: {
      mcpServers: {},
      skills: selectedSkills,
    },

    // Chat client configuration (e.g., Telegram)
    chat: {
      enabled: false,
      provider: "telegram",
      telegram: {
        botToken: "",
        allowedChatIds: [],
      },
      // Chat responders - handle incoming messages based on triggers
      // Special "default" responder handles messages that don't match any trigger
      // Trigger patterns: "@name" for mentions, "keyword" for prefix matching
      // Use "ralph init" to select from preset bundles, or configure manually:
      // responders: {
      //   "default": { type: "llm", provider: "anthropic", systemPrompt: "You are a helpful assistant for {{project}}." },
      //   "qa": { type: "llm", trigger: "@qa", provider: "anthropic", systemPrompt: "Answer questions about the codebase." },
      //   "code": { type: "claude-code", trigger: "@code" },
      //   "lint": { type: "cli", trigger: "!lint", command: "npm run lint" }
      // }
      responders: selectedResponders,
    },

    // Daemon configuration for sandbox-to-host communication
    daemon: {
      actions: macOsActions,
      // Event handlers - each event can trigger multiple daemon actions
      // Available events: task_complete, ralph_complete, iteration_complete, error
      events: {
        // Example: notify after each task completes
        // task_complete: [{ action: "notify", message: "Task complete: {{task}}" }],
        // Example: notify when ralph finishes all work
        // ralph_complete: [{ action: "notify", message: "Ralph finished!" }],
      },
    },
  };

  const configPath = join(ralphDir, CONFIG_FILE);
  writeFileSync(configPath, JSON.stringify(configData, null, 2) + "\n");
  console.log(`\nCreated ${RALPH_DIR}/${CONFIG_FILE}`);

  // Write prompt file (ask if exists) - uses template with $variables
  const prompt = generatePromptTemplate();
  const promptPath = join(ralphDir, PROMPT_FILE);

  if (existsSync(promptPath) && !useDefaults) {
    const overwritePrompt = await promptConfirm(
      `${RALPH_DIR}/${PROMPT_FILE} already exists. Overwrite?`,
    );
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

  // Create PRD if not exists (check for both yaml and json)
  const prdPath = join(ralphDir, PRD_FILE);
  const prdJsonPath = join(ralphDir, "prd.json");
  if (!existsSync(prdPath) && !existsSync(prdJsonPath)) {
    writeFileSync(prdPath, DEFAULT_PRD_YAML);
    console.log(`Created ${RALPH_DIR}/${PRD_FILE}`);
  } else {
    console.log(`Skipped ${RALPH_DIR}/${PRD_FILE} (PRD already exists)`);
  }

  // Create progress file if not exists
  const progressPath = join(ralphDir, PROGRESS_FILE);
  if (!existsSync(progressPath)) {
    writeFileSync(progressPath, DEFAULT_PROGRESS);
    console.log(`Created ${RALPH_DIR}/${PROGRESS_FILE}`);
  } else {
    console.log(`Skipped ${RALPH_DIR}/${PROGRESS_FILE} (already exists)`);
  }

  // Create .gitignore if not exists (protects secrets like API tokens)
  const gitignorePath = join(ralphDir, ".gitignore");
  if (!existsSync(gitignorePath)) {
    const gitignoreContent = `# Ralph CLI - Ignore sensitive and runtime files
# config.json may contain API tokens (Telegram, etc.)
config.json

# Runtime state files
messages.json
chat-state.json

# Service logs
daemon.log
chat.log

# Docker build artifacts
docker/.config-hash
`;
    writeFileSync(gitignorePath, gitignoreContent);
    console.log(`Created ${RALPH_DIR}/.gitignore`);
  } else {
    console.log(`Skipped ${RALPH_DIR}/.gitignore (already exists)`);
  }

  // Generate macOS/Swift development scripts if Swift + SwiftUI selected
  if (selectedKey === "swift" && hasSwiftUI(selectedTechnologies)) {
    const scriptsDir = join(cwd, "scripts");
    const genXcodePath = join(scriptsDir, "gen_xcode.sh");

    if (!existsSync(scriptsDir)) {
      mkdirSync(scriptsDir, { recursive: true });
      console.log("Created scripts/");
    }

    // Use a clean project name (PascalCase) for the Swift project
    const swiftProjectName =
      basename(cwd)
        .replace(/[^a-zA-Z0-9]+/g, " ")
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join("") || "App";

    if (!existsSync(genXcodePath)) {
      writeFileSync(genXcodePath, generateGenXcodeScript(swiftProjectName));
      chmodSync(genXcodePath, 0o755);
      console.log("Created scripts/gen_xcode.sh");
    } else {
      console.log("Skipped scripts/gen_xcode.sh (already exists)");
    }

    // Generate Fastlane configuration if Fastlane technology is selected
    if (hasFastlane(selectedTechnologies)) {
      const fastlaneDir = join(scriptsDir, "fastlane");
      const fastfilePath = join(fastlaneDir, "Fastfile");
      const appfilePath = join(fastlaneDir, "Appfile");
      const readmePath = join(fastlaneDir, "README.md");

      if (!existsSync(fastlaneDir)) {
        mkdirSync(fastlaneDir, { recursive: true });
        console.log("Created scripts/fastlane/");
      }

      if (!existsSync(fastfilePath)) {
        writeFileSync(fastfilePath, generateFastfile(swiftProjectName));
        console.log("Created scripts/fastlane/Fastfile");
      } else {
        console.log("Skipped scripts/fastlane/Fastfile (already exists)");
      }

      if (!existsSync(appfilePath)) {
        writeFileSync(appfilePath, generateAppfile(swiftProjectName));
        console.log("Created scripts/fastlane/Appfile");
      } else {
        console.log("Skipped scripts/fastlane/Appfile (already exists)");
      }

      if (!existsSync(readmePath)) {
        writeFileSync(readmePath, generateFastlaneReadmeSection(swiftProjectName));
        console.log("Created scripts/fastlane/README.md");
      } else {
        console.log("Skipped scripts/fastlane/README.md (already exists)");
      }
    }
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
  console.log("  1. Edit .ralph/prd.yaml to add your project requirements");
  console.log("  2. Run 'ralph docker run' to start (auto-builds image on first run)");
  console.log("\nSee .ralph/HOW-TO-WRITE-PRDs.md for guidance on writing PRDs");
  console.log("To regenerate Docker files: ralph docker init");
}
