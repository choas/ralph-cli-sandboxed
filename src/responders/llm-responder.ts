/**
 * LLM Responder - Sends messages to LLM providers and returns responses.
 * Used by chat clients to respond to messages matched by the responder matcher.
 */

import {
  ResponderConfig,
  getLLMProviders,
  loadConfig,
  RalphConfig,
  LLMProviderConfig,
} from "../utils/config.js";
import { createLLMClient, LLMClient, Message, ChatOptions } from "../utils/llm-client.js";
import { basename } from "path";

/**
 * Result of executing a responder.
 */
export interface ResponderResult {
  /** Whether the responder executed successfully */
  success: boolean;
  /** The response text (may be truncated) */
  response: string;
  /** Error message if success is false */
  error?: string;
  /** Whether the response was truncated */
  truncated?: boolean;
  /** Original response length before truncation */
  originalLength?: number;
}

/**
 * Options for executing an LLM responder.
 */
export interface LLMResponderOptions {
  /** Override the project name for {{project}} placeholder */
  projectName?: string;
  /** Override default max tokens */
  maxTokens?: number;
  /** Override default temperature */
  temperature?: number;
}

/**
 * Default max length for chat responses (characters).
 */
const DEFAULT_MAX_LENGTH = 2000;

/**
 * Default timeout for LLM requests (milliseconds).
 */
const DEFAULT_TIMEOUT = 60000;

/**
 * Replaces {{project}} placeholder in system prompt with actual project name.
 */
export function applyProjectPlaceholder(
  systemPrompt: string,
  projectName: string
): string {
  return systemPrompt.replace(/\{\{project\}\}/g, projectName);
}

/**
 * Gets the project name from the current working directory.
 */
export function getProjectName(): string {
  return basename(process.cwd());
}

/**
 * Truncates a response to the specified max length.
 * Adds a truncation indicator if the response was shortened.
 */
export function truncateResponse(
  response: string,
  maxLength: number
): { text: string; truncated: boolean; originalLength: number } {
  const originalLength = response.length;

  if (originalLength <= maxLength) {
    return { text: response, truncated: false, originalLength };
  }

  // Leave room for truncation indicator
  const indicator = "\n\n[...response truncated]";
  const truncatedLength = maxLength - indicator.length;

  if (truncatedLength <= 0) {
    return { text: "[response too long]", truncated: true, originalLength };
  }

  // Try to truncate at a sentence or word boundary
  let text = response.slice(0, truncatedLength);

  // Look for a good break point (sentence end, then word end)
  const sentenceEnd = text.lastIndexOf(". ");
  const paragraphEnd = text.lastIndexOf("\n\n");
  const wordEnd = text.lastIndexOf(" ");

  // Prefer paragraph, then sentence, then word boundary
  if (paragraphEnd > truncatedLength * 0.7) {
    text = text.slice(0, paragraphEnd);
  } else if (sentenceEnd > truncatedLength * 0.7) {
    text = text.slice(0, sentenceEnd + 1); // Include the period
  } else if (wordEnd > truncatedLength * 0.8) {
    text = text.slice(0, wordEnd);
  }

  return {
    text: text + indicator,
    truncated: true,
    originalLength,
  };
}

/**
 * Executes an LLM responder with the given message.
 *
 * @param message The user message to send to the LLM
 * @param responderConfig The responder configuration
 * @param config Optional Ralph config (loaded automatically if not provided)
 * @param options Optional execution options
 * @returns The responder result with response or error
 */
export async function executeLLMResponder(
  message: string,
  responderConfig: ResponderConfig,
  config?: RalphConfig,
  options?: LLMResponderOptions
): Promise<ResponderResult> {
  try {
    // Load config if not provided
    const ralphConfig = config ?? loadConfig();

    // Get LLM providers
    const providers = getLLMProviders(ralphConfig);

    // Get provider name from responder config (default to "anthropic")
    const providerName = responderConfig.provider ?? "anthropic";

    // Look up the provider
    const providerConfig = providers[providerName];
    if (!providerConfig) {
      return {
        success: false,
        response: "",
        error: `LLM provider "${providerName}" not found. Available providers: ${Object.keys(providers).join(", ")}`,
      };
    }

    // Create LLM client
    let client: LLMClient;
    try {
      client = createLLMClient(providerConfig);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        response: "",
        error: `Failed to create LLM client for "${providerName}": ${error}`,
      };
    }

    // Prepare system prompt with project placeholder
    const projectName = options?.projectName ?? getProjectName();
    let systemPrompt = responderConfig.systemPrompt;
    if (systemPrompt) {
      systemPrompt = applyProjectPlaceholder(systemPrompt, projectName);
    }

    // Prepare chat options
    const chatOptions: ChatOptions = {
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
    };

    // Prepare messages
    const messages: Message[] = [
      { role: "user", content: message },
    ];

    // Execute with timeout
    const timeout = responderConfig.timeout ?? DEFAULT_TIMEOUT;
    const responsePromise = client.chat(messages, systemPrompt, chatOptions);

    let response: string;
    try {
      response = await Promise.race([
        responsePromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("LLM request timed out")), timeout)
        ),
      ]);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        response: "",
        error: `LLM request failed: ${error}`,
      };
    }

    // Truncate response if needed
    const maxLength = responderConfig.maxLength ?? DEFAULT_MAX_LENGTH;
    const { text, truncated, originalLength } = truncateResponse(response, maxLength);

    return {
      success: true,
      response: text,
      truncated,
      originalLength: truncated ? originalLength : undefined,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      response: "",
      error: `Unexpected error: ${error}`,
    };
  }
}

/**
 * Creates a reusable LLM responder function with pre-loaded configuration.
 * This is useful for handling multiple messages without reloading config each time.
 *
 * @param responderConfig The responder configuration
 * @param config The Ralph configuration
 * @returns A function that executes the responder with a message
 */
export function createLLMResponder(
  responderConfig: ResponderConfig,
  config: RalphConfig
): (message: string, options?: LLMResponderOptions) => Promise<ResponderResult> {
  // Pre-load provider and client
  const providers = getLLMProviders(config);
  const providerName = responderConfig.provider ?? "anthropic";
  const providerConfig = providers[providerName];

  // Pre-create client if possible
  let client: LLMClient | null = null;
  let clientError: string | null = null;

  if (!providerConfig) {
    clientError = `LLM provider "${providerName}" not found. Available providers: ${Object.keys(providers).join(", ")}`;
  } else {
    try {
      client = createLLMClient(providerConfig);
    } catch (err) {
      clientError = `Failed to create LLM client for "${providerName}": ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return async (message: string, options?: LLMResponderOptions): Promise<ResponderResult> => {
    // Return cached error if client creation failed
    if (clientError || !client) {
      return {
        success: false,
        response: "",
        error: clientError ?? "LLM client not initialized",
      };
    }

    try {
      // Prepare system prompt with project placeholder
      const projectName = options?.projectName ?? getProjectName();
      let systemPrompt = responderConfig.systemPrompt;
      if (systemPrompt) {
        systemPrompt = applyProjectPlaceholder(systemPrompt, projectName);
      }

      // Prepare chat options
      const chatOptions: ChatOptions = {
        maxTokens: options?.maxTokens,
        temperature: options?.temperature,
      };

      // Prepare messages
      const messages: Message[] = [
        { role: "user", content: message },
      ];

      // Execute with timeout
      const timeout = responderConfig.timeout ?? DEFAULT_TIMEOUT;
      const responsePromise = client.chat(messages, systemPrompt, chatOptions);

      let response: string;
      try {
        response = await Promise.race([
          responsePromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("LLM request timed out")), timeout)
          ),
        ]);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          response: "",
          error: `LLM request failed: ${error}`,
        };
      }

      // Truncate response if needed
      const maxLength = responderConfig.maxLength ?? DEFAULT_MAX_LENGTH;
      const { text, truncated, originalLength } = truncateResponse(response, maxLength);

      return {
        success: true,
        response: text,
        truncated,
        originalLength: truncated ? originalLength : undefined,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        response: "",
        error: `Unexpected error: ${error}`,
      };
    }
  };
}

/**
 * Validates that a responder configuration is valid for LLM execution.
 *
 * @param responderConfig The responder configuration to validate
 * @param config The Ralph configuration for looking up providers
 * @returns An error message if invalid, or null if valid
 */
export function validateLLMResponder(
  responderConfig: ResponderConfig,
  config: RalphConfig
): string | null {
  if (responderConfig.type !== "llm") {
    return `Responder type is "${responderConfig.type}", expected "llm"`;
  }

  const providers = getLLMProviders(config);
  const providerName = responderConfig.provider ?? "anthropic";

  if (!providers[providerName]) {
    return `LLM provider "${providerName}" not found. Available providers: ${Object.keys(providers).join(", ")}`;
  }

  return null;
}
