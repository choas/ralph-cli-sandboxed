import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface TechnologyStack {
  name: string;
  description: string;
}

export interface DockerConfig {
  install: string;
  version?: number | string;
  versionConfigurable?: boolean;
  gradleVersion?: string;
  kotlinVersion?: string;
}

export interface LanguageConfigJson {
  name: string;
  description: string;
  checkCommand: string;
  testCommand: string;
  docker?: DockerConfig;
  technologies?: TechnologyStack[];
}

export interface LanguageConfig {
  name: string;
  checkCommand: string;
  testCommand: string;
  description: string;
  technologies?: TechnologyStack[];
}

interface LanguagesJson {
  languages: Record<string, LanguageConfigJson>;
}

// Load languages from JSON config file
function loadLanguagesConfig(): LanguagesJson {
  // In development: src/config/languages.json
  // In production: dist/config/languages.json
  const configPath = join(__dirname, "..", "config", "languages.json");
  const content = readFileSync(configPath, "utf-8");
  return JSON.parse(content);
}

// Convert JSON config to the legacy format for compatibility
function convertToLanguageConfig(config: LanguageConfigJson): LanguageConfig {
  return {
    name: config.name,
    checkCommand: config.checkCommand,
    testCommand: config.testCommand,
    description: config.description,
    technologies: config.technologies,
  };
}

// Lazy-load languages to avoid issues at import time
let _languagesCache: Record<string, LanguageConfig> | null = null;
let _languagesJsonCache: LanguagesJson | null = null;

export function getLanguagesJson(): LanguagesJson {
  if (!_languagesJsonCache) {
    _languagesJsonCache = loadLanguagesConfig();
  }
  return _languagesJsonCache;
}

export function getLanguages(): Record<string, LanguageConfig> {
  if (!_languagesCache) {
    const json = getLanguagesJson();
    _languagesCache = {};
    for (const [key, config] of Object.entries(json.languages)) {
      _languagesCache[key] = convertToLanguageConfig(config);
    }
  }
  return _languagesCache;
}

// Export for backwards compatibility
export const LANGUAGES: Record<string, LanguageConfig> = new Proxy({} as Record<string, LanguageConfig>, {
  get(_target, prop: string) {
    return getLanguages()[prop];
  },
  ownKeys() {
    return Object.keys(getLanguages());
  },
  getOwnPropertyDescriptor(_target, prop: string) {
    const languages = getLanguages();
    if (prop in languages) {
      return { enumerable: true, configurable: true, value: languages[prop] };
    }
    return undefined;
  },
});

// Generate the prompt template with $variables (stored in prompt.md)
export function generatePromptTemplate(): string {
  return `You are an AI developer working on this project. Your task is to implement features from the PRD.

TECHNOLOGY STACK:
- Language/Runtime: $language
- Technologies: $technologies

INSTRUCTIONS:
1. Read the @.ralph/prd.json file to find the highest priority feature that has "passes": false
2. Implement that feature completely
3. Verify your changes work by running:
   - Type/build check: $checkCommand
   - Tests: $testCommand
4. Update the PRD entry to set "passes": true once verified
5. Append a brief note about what you did to @.ralph/progress.txt
6. Create a git commit with a descriptive message for this feature
7. Only work on ONE feature per execution

IMPORTANT:
- Focus on a single feature at a time
- Ensure all checks pass before marking complete
- Write clear commit messages
- If the PRD is fully complete (all items pass), output: <promise>COMPLETE</promise>

Now, read the PRD and begin working on the highest priority incomplete feature.`;
}

// Resolve template variables using config values
export function resolvePromptVariables(template: string, config: {
  language: string;
  checkCommand: string;
  testCommand: string;
  technologies?: string[];
}): string {
  const languageConfig = LANGUAGES[config.language];
  const languageName = languageConfig?.name || config.language;
  const technologies = config.technologies?.length ? config.technologies.join(", ") : "(none specified)";

  return template
    .replace(/\$language/g, languageName)
    .replace(/\$technologies/g, technologies)
    .replace(/\$checkCommand/g, config.checkCommand)
    .replace(/\$testCommand/g, config.testCommand);
}

// Legacy function for backwards compatibility - generates fully resolved prompt
export function generatePrompt(config: LanguageConfig, technologies?: string[]): string {
  const template = generatePromptTemplate();
  return resolvePromptVariables(template, {
    language: Object.keys(LANGUAGES).find(k => LANGUAGES[k].name === config.name) || "none",
    checkCommand: config.checkCommand,
    testCommand: config.testCommand,
    technologies,
  });
}

export const DEFAULT_PRD = `[
  {
    "category": "setup",
    "description": "Example: Project builds successfully",
    "steps": [
      "Run the build command",
      "Verify no errors occur"
    ],
    "passes": false
  }
]`;

export const DEFAULT_PROGRESS = `# Progress Log\n`;
