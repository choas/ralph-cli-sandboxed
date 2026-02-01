/**
 * LLM Client abstraction layer for communicating with different LLM providers.
 * This provides a unified interface for Anthropic, OpenAI, and Ollama.
 */

import {
  LLMProviderConfig,
  getLLMProviderApiKey,
  getLLMProviderBaseUrl,
} from "./config.js";

/**
 * A single message in a conversation.
 */
export interface Message {
  /** The role of the message sender */
  role: "user" | "assistant" | "system";
  /** The text content of the message */
  content: string;
}

/**
 * Options for LLM chat requests.
 */
export interface ChatOptions {
  /** Maximum tokens to generate in the response */
  maxTokens?: number;
  /** Temperature for response randomness (0-1) */
  temperature?: number;
  /** Stop sequences to end generation */
  stopSequences?: string[];
}

/**
 * Abstract interface for LLM clients.
 * Implementations handle provider-specific API calls.
 */
export interface LLMClient {
  /** The provider type (anthropic, openai, ollama) */
  readonly providerType: string;

  /**
   * Send a chat message to the LLM and get a response.
   * @param messages Array of conversation messages
   * @param systemPrompt Optional system prompt to set context
   * @param options Optional generation parameters
   * @returns The assistant's response text
   */
  chat(
    messages: Message[],
    systemPrompt?: string,
    options?: ChatOptions
  ): Promise<string>;
}

/**
 * Default chat options used when not specified.
 */
const DEFAULT_CHAT_OPTIONS: ChatOptions = {
  maxTokens: 4096,
  temperature: 0.7,
};

/**
 * Anthropic Claude client implementation.
 * Uses the @anthropic-ai/sdk package.
 */
export class AnthropicClient implements LLMClient {
  readonly providerType = "anthropic";
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: LLMProviderConfig) {
    const apiKey = getLLMProviderApiKey(config);
    if (!apiKey) {
      throw new Error(
        "Anthropic API key not found. Set ANTHROPIC_API_KEY environment variable or provide apiKey in config."
      );
    }
    this.apiKey = apiKey;
    this.model = config.model;
    this.baseUrl = getLLMProviderBaseUrl(config);
  }

  async chat(
    messages: Message[],
    systemPrompt?: string,
    options?: ChatOptions
  ): Promise<string> {
    const opts = { ...DEFAULT_CHAT_OPTIONS, ...options };

    // Dynamic import to avoid requiring the SDK if not used
    const Anthropic = await import("@anthropic-ai/sdk").then(
      (m) => m.default || m.Anthropic
    );

    const client = new Anthropic({
      apiKey: this.apiKey,
      baseURL: this.baseUrl !== "https://api.anthropic.com" ? this.baseUrl : undefined,
    });

    // Filter out system messages - Anthropic uses a separate system parameter
    const chatMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    // Combine any system messages from the messages array with the systemPrompt
    const systemMessages = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content);
    const fullSystemPrompt = systemPrompt
      ? [systemPrompt, ...systemMessages].join("\n\n")
      : systemMessages.length > 0
      ? systemMessages.join("\n\n")
      : undefined;

    const response = await client.messages.create({
      model: this.model,
      max_tokens: opts.maxTokens ?? 4096,
      ...(opts.temperature !== undefined && { temperature: opts.temperature }),
      ...(opts.stopSequences && { stop_sequences: opts.stopSequences }),
      ...(fullSystemPrompt && { system: fullSystemPrompt }),
      messages: chatMessages,
    });

    // Extract text content from the response
    const textContent = response.content.find((block) => block.type === "text");
    return textContent ? (textContent as { type: "text"; text: string }).text : "";
  }
}

/**
 * OpenAI GPT client implementation.
 * Uses the openai package.
 */
export class OpenAIClient implements LLMClient {
  readonly providerType = "openai";
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: LLMProviderConfig) {
    const apiKey = getLLMProviderApiKey(config);
    if (!apiKey) {
      throw new Error(
        "OpenAI API key not found. Set OPENAI_API_KEY environment variable or provide apiKey in config."
      );
    }
    this.apiKey = apiKey;
    this.model = config.model;
    this.baseUrl = getLLMProviderBaseUrl(config);
  }

  async chat(
    messages: Message[],
    systemPrompt?: string,
    options?: ChatOptions
  ): Promise<string> {
    const opts = { ...DEFAULT_CHAT_OPTIONS, ...options };

    // Dynamic import to avoid requiring the SDK if not used
    const OpenAI = await import("openai").then((m) => m.default || m.OpenAI);

    const client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
    });

    // Build messages array with system prompt first if provided
    const chatMessages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }> = [];

    if (systemPrompt) {
      chatMessages.push({ role: "system", content: systemPrompt });
    }

    // Add all messages, including any system messages from the input
    for (const msg of messages) {
      chatMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    const response = await client.chat.completions.create({
      model: this.model,
      max_tokens: opts.maxTokens,
      ...(opts.temperature !== undefined && { temperature: opts.temperature }),
      ...(opts.stopSequences && { stop: opts.stopSequences }),
      messages: chatMessages,
    });

    return response.choices[0]?.message?.content ?? "";
  }
}

/**
 * Ollama client implementation.
 * Uses fetch to communicate with the local Ollama API.
 */
export class OllamaClient implements LLMClient {
  readonly providerType = "ollama";
  private model: string;
  private baseUrl: string;

  constructor(config: LLMProviderConfig) {
    this.model = config.model;
    this.baseUrl = getLLMProviderBaseUrl(config);
  }

  async chat(
    messages: Message[],
    systemPrompt?: string,
    options?: ChatOptions
  ): Promise<string> {
    const opts = { ...DEFAULT_CHAT_OPTIONS, ...options };

    // Build messages array with system prompt first if provided
    const chatMessages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }> = [];

    if (systemPrompt) {
      chatMessages.push({ role: "system", content: systemPrompt });
    }

    // Add all messages
    for (const msg of messages) {
      chatMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: chatMessages,
        stream: false,
        options: {
          ...(opts.temperature !== undefined && {
            temperature: opts.temperature,
          }),
          ...(opts.maxTokens !== undefined && { num_predict: opts.maxTokens }),
          ...(opts.stopSequences && { stop: opts.stopSequences }),
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      message?: { content?: string };
      error?: string;
    };

    if (data.error) {
      throw new Error(`Ollama error: ${data.error}`);
    }

    return data.message?.content ?? "";
  }
}

/**
 * Factory function to create an LLM client based on provider configuration.
 * @param providerConfig The LLM provider configuration
 * @returns An LLMClient instance for the specified provider
 */
export function createLLMClient(providerConfig: LLMProviderConfig): LLMClient {
  switch (providerConfig.type) {
    case "anthropic":
      return new AnthropicClient(providerConfig);
    case "openai":
      return new OpenAIClient(providerConfig);
    case "ollama":
      return new OllamaClient(providerConfig);
    default:
      throw new Error(`Unknown LLM provider type: ${providerConfig.type}`);
  }
}
