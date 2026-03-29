import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getCliConfig,
  getLLMProviders,
  getLLMProviderApiKey,
  getLLMProviderBaseUrl,
  DEFAULT_LLM_PROVIDERS,
  DEFAULT_CLI_CONFIG,
  type RalphConfig,
  type LLMProviderConfig,
} from "./config.js";

describe("getCliConfig", () => {
  it("returns default CLI config when none specified", () => {
    const config: RalphConfig = {
      language: "typescript",
      checkCommand: "npm run build",
      testCommand: "npm test",
    };
    const result = getCliConfig(config);
    expect(result.command).toBe("claude");
    expect(result.promptArgs).toEqual(["-p"]);
  });

  it("returns custom CLI config from config", () => {
    const config: RalphConfig = {
      language: "typescript",
      checkCommand: "npm run build",
      testCommand: "npm test",
      cli: {
        command: "aider",
        args: ["--yes"],
        promptArgs: ["--message"],
      },
    };
    const result = getCliConfig(config);
    expect(result.command).toBe("aider");
    expect(result.promptArgs).toEqual(["--message"]);
  });

  it("defaults promptArgs to ['-p'] when not set", () => {
    const config: RalphConfig = {
      language: "typescript",
      checkCommand: "npm run build",
      testCommand: "npm test",
      cli: { command: "custom-cli" },
    };
    const result = getCliConfig(config);
    expect(result.promptArgs).toEqual(["-p"]);
  });
});

describe("getLLMProviders", () => {
  it("returns default providers when none configured", () => {
    const config: RalphConfig = {
      language: "typescript",
      checkCommand: "npm run build",
      testCommand: "npm test",
    };
    const result = getLLMProviders(config);
    expect(result.anthropic).toBeDefined();
    expect(result.openai).toBeDefined();
    expect(result.ollama).toBeDefined();
  });

  it("merges custom providers with defaults", () => {
    const config: RalphConfig = {
      language: "typescript",
      checkCommand: "npm run build",
      testCommand: "npm test",
      llmProviders: {
        custom: {
          type: "openai",
          model: "gpt-4-turbo",
          apiKey: "sk-test",
        },
      },
    };
    const result = getLLMProviders(config);
    expect(result.custom).toBeDefined();
    expect(result.custom.model).toBe("gpt-4-turbo");
    // Defaults still present
    expect(result.anthropic).toBeDefined();
  });

  it("allows overriding default providers", () => {
    const config: RalphConfig = {
      language: "typescript",
      checkCommand: "npm run build",
      testCommand: "npm test",
      llmProviders: {
        anthropic: {
          type: "anthropic",
          model: "claude-opus-4-20250514",
          apiKey: "sk-custom",
        },
      },
    };
    const result = getLLMProviders(config);
    expect(result.anthropic.model).toBe("claude-opus-4-20250514");
    expect(result.anthropic.apiKey).toBe("sk-custom");
  });
});

describe("getLLMProviderApiKey", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns explicit API key when set", () => {
    const provider: LLMProviderConfig = {
      type: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiKey: "sk-explicit",
    };
    expect(getLLMProviderApiKey(provider)).toBe("sk-explicit");
  });

  it("falls back to ANTHROPIC_API_KEY env var", () => {
    process.env.ANTHROPIC_API_KEY = "sk-env-anthropic";
    const provider: LLMProviderConfig = {
      type: "anthropic",
      model: "claude-sonnet-4-20250514",
    };
    expect(getLLMProviderApiKey(provider)).toBe("sk-env-anthropic");
  });

  it("falls back to OPENAI_API_KEY env var", () => {
    process.env.OPENAI_API_KEY = "sk-env-openai";
    const provider: LLMProviderConfig = {
      type: "openai",
      model: "gpt-4o",
    };
    expect(getLLMProviderApiKey(provider)).toBe("sk-env-openai");
  });

  it("returns undefined for ollama", () => {
    const provider: LLMProviderConfig = {
      type: "ollama",
      model: "llama3",
    };
    expect(getLLMProviderApiKey(provider)).toBeUndefined();
  });
});

describe("getLLMProviderBaseUrl", () => {
  it("returns explicit baseUrl when set", () => {
    const provider: LLMProviderConfig = {
      type: "anthropic",
      model: "claude-sonnet-4-20250514",
      baseUrl: "https://custom.api.com",
    };
    expect(getLLMProviderBaseUrl(provider)).toBe("https://custom.api.com");
  });

  it("returns default URL for anthropic", () => {
    const provider: LLMProviderConfig = {
      type: "anthropic",
      model: "claude-sonnet-4-20250514",
    };
    expect(getLLMProviderBaseUrl(provider)).toBe("https://api.anthropic.com");
  });

  it("returns default URL for openai", () => {
    const provider: LLMProviderConfig = {
      type: "openai",
      model: "gpt-4o",
    };
    expect(getLLMProviderBaseUrl(provider)).toBe("https://api.openai.com/v1");
  });

  it("returns default URL for ollama", () => {
    const provider: LLMProviderConfig = {
      type: "ollama",
      model: "llama3",
    };
    expect(getLLMProviderBaseUrl(provider)).toBe("http://localhost:11434");
  });
});

describe("DEFAULT_LLM_PROVIDERS", () => {
  it("has anthropic, openai, and ollama providers", () => {
    expect(DEFAULT_LLM_PROVIDERS.anthropic.type).toBe("anthropic");
    expect(DEFAULT_LLM_PROVIDERS.openai.type).toBe("openai");
    expect(DEFAULT_LLM_PROVIDERS.ollama.type).toBe("ollama");
  });

  it("ollama has localhost baseUrl", () => {
    expect(DEFAULT_LLM_PROVIDERS.ollama.baseUrl).toBe("http://localhost:11434");
  });
});

describe("DEFAULT_CLI_CONFIG", () => {
  it("uses claude as default command", () => {
    expect(DEFAULT_CLI_CONFIG.command).toBe("claude");
    expect(DEFAULT_CLI_CONFIG.promptArgs).toEqual(["-p"]);
  });
});
