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

// ─── getCliConfig ───────────────────────────────────────────────────

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

  it("preserves args and yoloArgs from custom cli config", () => {
    const config: RalphConfig = {
      language: "typescript",
      checkCommand: "npm run build",
      testCommand: "npm test",
      cli: {
        command: "aider",
        args: ["--yes", "--no-auto-commits"],
        yoloArgs: ["--auto-accept"],
        promptArgs: ["--message"],
      },
    };
    const result = getCliConfig(config);
    expect(result.args).toEqual(["--yes", "--no-auto-commits"]);
    expect(result.yoloArgs).toEqual(["--auto-accept"]);
  });

  it("preserves model and modelArgs from custom cli config", () => {
    const config: RalphConfig = {
      language: "typescript",
      checkCommand: "npm run build",
      testCommand: "npm test",
      cli: {
        command: "claude",
        model: "claude-opus-4-20250514",
        modelArgs: ["--model"],
        promptArgs: ["-p"],
      },
    };
    const result = getCliConfig(config);
    expect(result.model).toBe("claude-opus-4-20250514");
    expect(result.modelArgs).toEqual(["--model"]);
  });

  it("preserves fileArgs from custom cli config", () => {
    const config: RalphConfig = {
      language: "typescript",
      checkCommand: "npm run build",
      testCommand: "npm test",
      cli: {
        command: "aider",
        fileArgs: ["--read"],
        promptArgs: ["--message"],
      },
    };
    const result = getCliConfig(config);
    expect(result.fileArgs).toEqual(["--read"]);
  });

  it("uses cliProvider to fill in promptArgs when cli.promptArgs is undefined", () => {
    const config: RalphConfig = {
      language: "typescript",
      checkCommand: "npm run build",
      testCommand: "npm test",
      cliProvider: "claude",
      cli: { command: "claude" },
    };
    const result = getCliConfig(config);
    // Should pick up promptArgs from the claude provider
    expect(result.promptArgs).toBeDefined();
    expect(Array.isArray(result.promptArgs)).toBe(true);
  });

  it("does not override explicit cli.promptArgs with cliProvider", () => {
    const config: RalphConfig = {
      language: "typescript",
      checkCommand: "npm run build",
      testCommand: "npm test",
      cliProvider: "claude",
      cli: {
        command: "claude",
        promptArgs: ["--custom-prompt"],
      },
    };
    const result = getCliConfig(config);
    expect(result.promptArgs).toEqual(["--custom-prompt"]);
  });

  it("falls back to ['-p'] when cliProvider is set but provider not found", () => {
    const config: RalphConfig = {
      language: "typescript",
      checkCommand: "npm run build",
      testCommand: "npm test",
      cliProvider: "nonexistent-provider",
      cli: { command: "custom-cli" },
    };
    const result = getCliConfig(config);
    expect(result.promptArgs).toEqual(["-p"]);
  });

  it("returns a new object, not the same reference as DEFAULT_CLI_CONFIG", () => {
    const config: RalphConfig = {
      language: "typescript",
      checkCommand: "npm run build",
      testCommand: "npm test",
    };
    const result = getCliConfig(config);
    expect(result).not.toBe(DEFAULT_CLI_CONFIG);
  });

  it("handles empty cli object", () => {
    const config: RalphConfig = {
      language: "typescript",
      checkCommand: "npm run build",
      testCommand: "npm test",
      cli: {} as any,
    };
    const result = getCliConfig(config);
    expect(result.promptArgs).toEqual(["-p"]);
    expect(result.command).toBeUndefined();
  });
});

// ─── getLLMProviders ────────────────────────────────────────────────

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

  it("returns all three default providers with empty llmProviders", () => {
    const config: RalphConfig = {
      language: "typescript",
      checkCommand: "npm run build",
      testCommand: "npm test",
      llmProviders: {},
    };
    const result = getLLMProviders(config);
    expect(Object.keys(result)).toContain("anthropic");
    expect(Object.keys(result)).toContain("openai");
    expect(Object.keys(result)).toContain("ollama");
  });

  it("can add multiple custom providers at once", () => {
    const config: RalphConfig = {
      language: "typescript",
      checkCommand: "npm run build",
      testCommand: "npm test",
      llmProviders: {
        "my-gpt": { type: "openai", model: "gpt-4o-mini" },
        "my-claude": { type: "anthropic", model: "claude-haiku-4-5-20251001" },
        "local-llm": { type: "ollama", model: "codellama", baseUrl: "http://gpu-server:11434" },
      },
    };
    const result = getLLMProviders(config);
    expect(result["my-gpt"].model).toBe("gpt-4o-mini");
    expect(result["my-claude"].model).toBe("claude-haiku-4-5-20251001");
    expect(result["local-llm"].baseUrl).toBe("http://gpu-server:11434");
    // defaults still present
    expect(result.anthropic).toBeDefined();
  });

  it("override completely replaces a default provider (no deep merge)", () => {
    const config: RalphConfig = {
      language: "typescript",
      checkCommand: "npm run build",
      testCommand: "npm test",
      llmProviders: {
        ollama: {
          type: "ollama",
          model: "mistral",
          // no baseUrl set
        },
      },
    };
    const result = getLLMProviders(config);
    // The override replaces the whole object, so baseUrl from default is gone
    expect(result.ollama.model).toBe("mistral");
    expect(result.ollama.baseUrl).toBeUndefined();
  });
});

// ─── getLLMProviderApiKey ───────────────────────────────────────────

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

  it("returns undefined for anthropic when no env var set", () => {
    delete process.env.ANTHROPIC_API_KEY;
    const provider: LLMProviderConfig = {
      type: "anthropic",
      model: "claude-sonnet-4-20250514",
    };
    expect(getLLMProviderApiKey(provider)).toBeUndefined();
  });

  it("returns undefined for openai when no env var set", () => {
    delete process.env.OPENAI_API_KEY;
    const provider: LLMProviderConfig = {
      type: "openai",
      model: "gpt-4o",
    };
    expect(getLLMProviderApiKey(provider)).toBeUndefined();
  });

  it("returns undefined for unknown provider type", () => {
    const provider = {
      type: "unknown-provider" as any,
      model: "some-model",
    };
    expect(getLLMProviderApiKey(provider)).toBeUndefined();
  });

  it("explicit key takes precedence over env var", () => {
    process.env.ANTHROPIC_API_KEY = "sk-env";
    const provider: LLMProviderConfig = {
      type: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiKey: "sk-explicit-wins",
    };
    expect(getLLMProviderApiKey(provider)).toBe("sk-explicit-wins");
  });

  it("returns undefined for ollama even with explicit empty string", () => {
    const provider: LLMProviderConfig = {
      type: "ollama",
      model: "llama3",
      apiKey: "",
    };
    // empty string is falsy, so falls through to switch which returns undefined
    expect(getLLMProviderApiKey(provider)).toBeUndefined();
  });
});

// ─── getLLMProviderBaseUrl ──────────────────────────────────────────

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

  it("returns empty string for unknown provider type", () => {
    const provider = {
      type: "unknown" as any,
      model: "some-model",
    };
    expect(getLLMProviderBaseUrl(provider)).toBe("");
  });

  it("explicit baseUrl overrides default for openai", () => {
    const provider: LLMProviderConfig = {
      type: "openai",
      model: "gpt-4o",
      baseUrl: "https://my-proxy.example.com/v1",
    };
    expect(getLLMProviderBaseUrl(provider)).toBe("https://my-proxy.example.com/v1");
  });

  it("explicit baseUrl overrides default for ollama", () => {
    const provider: LLMProviderConfig = {
      type: "ollama",
      model: "llama3",
      baseUrl: "http://remote-gpu:11434",
    };
    expect(getLLMProviderBaseUrl(provider)).toBe("http://remote-gpu:11434");
  });
});

// ─── DEFAULT_LLM_PROVIDERS ─────────────────────────────────────────

describe("DEFAULT_LLM_PROVIDERS", () => {
  it("has anthropic, openai, and ollama providers", () => {
    expect(DEFAULT_LLM_PROVIDERS.anthropic.type).toBe("anthropic");
    expect(DEFAULT_LLM_PROVIDERS.openai.type).toBe("openai");
    expect(DEFAULT_LLM_PROVIDERS.ollama.type).toBe("ollama");
  });

  it("ollama has localhost baseUrl", () => {
    expect(DEFAULT_LLM_PROVIDERS.ollama.baseUrl).toBe("http://localhost:11434");
  });

  it("anthropic has a valid model name", () => {
    expect(DEFAULT_LLM_PROVIDERS.anthropic.model).toMatch(/^claude-/);
  });

  it("openai has a valid model name", () => {
    expect(DEFAULT_LLM_PROVIDERS.openai.model).toMatch(/^gpt-/);
  });

  it("no default providers have explicit API keys", () => {
    expect(DEFAULT_LLM_PROVIDERS.anthropic.apiKey).toBeUndefined();
    expect(DEFAULT_LLM_PROVIDERS.openai.apiKey).toBeUndefined();
    expect(DEFAULT_LLM_PROVIDERS.ollama.apiKey).toBeUndefined();
  });

  it("anthropic and openai have no explicit baseUrl (use runtime defaults)", () => {
    expect(DEFAULT_LLM_PROVIDERS.anthropic.baseUrl).toBeUndefined();
    expect(DEFAULT_LLM_PROVIDERS.openai.baseUrl).toBeUndefined();
  });

  it("has exactly three default providers", () => {
    expect(Object.keys(DEFAULT_LLM_PROVIDERS)).toHaveLength(3);
  });
});

// ─── DEFAULT_CLI_CONFIG ─────────────────────────────────────────────

describe("DEFAULT_CLI_CONFIG", () => {
  it("uses claude as default command", () => {
    expect(DEFAULT_CLI_CONFIG.command).toBe("claude");
    expect(DEFAULT_CLI_CONFIG.promptArgs).toEqual(["-p"]);
  });

  it("has empty args array", () => {
    expect(DEFAULT_CLI_CONFIG.args).toEqual([]);
  });

  it("has no yoloArgs by default", () => {
    expect(DEFAULT_CLI_CONFIG.yoloArgs).toBeUndefined();
  });

  it("has no model by default", () => {
    expect(DEFAULT_CLI_CONFIG.model).toBeUndefined();
  });
});
