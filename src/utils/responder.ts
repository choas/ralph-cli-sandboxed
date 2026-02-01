/**
 * Responder matching and routing for chat messages.
 * Matches incoming messages to configured responders based on trigger patterns.
 */

import { ResponderConfig, RespondersConfig } from "./config.js";

/**
 * Result of matching a message to a responder.
 */
export interface ResponderMatch {
  /** The matched responder name (key in responders config) */
  name: string;
  /** The matched responder configuration */
  responder: ResponderConfig;
  /** The remaining message after removing the trigger (the arguments to pass to the responder) */
  args: string;
}

/**
 * ResponderMatcher handles routing chat messages to the appropriate responder
 * based on configured trigger patterns.
 *
 * Trigger patterns:
 * - "@name" triggers: Match when message starts with @name (e.g., "@qa", "@code", "@review")
 * - "keyword" triggers: Match when message starts with the keyword (e.g., "!lint", "help")
 * - No trigger (default): Matches any message that doesn't match other triggers
 *
 * The special "default" responder handles messages that don't match any trigger.
 */
export class ResponderMatcher {
  private responders: Map<string, ResponderConfig>;
  private mentionTriggers: Map<string, string>; // trigger -> responder name
  private keywordTriggers: Map<string, string>; // trigger -> responder name
  private defaultResponderName: string | null;

  /**
   * Create a new ResponderMatcher with the given responder configurations.
   * @param responders The responders configuration (name -> config map)
   */
  constructor(responders: RespondersConfig) {
    this.responders = new Map();
    this.mentionTriggers = new Map();
    this.keywordTriggers = new Map();
    this.defaultResponderName = null;

    // Process responders and categorize triggers
    for (const [name, config] of Object.entries(responders)) {
      this.responders.set(name, config);

      // Check for default responder (no trigger or name is "default")
      if (!config.trigger || name === "default") {
        this.defaultResponderName = name;
        continue;
      }

      const trigger = config.trigger.trim();

      // @mention triggers (e.g., "@qa", "@code")
      if (trigger.startsWith("@")) {
        this.mentionTriggers.set(trigger.toLowerCase(), name);
      } else {
        // Keyword triggers (e.g., "!lint", "help")
        this.keywordTriggers.set(trigger.toLowerCase(), name);
      }
    }
  }

  /**
   * Match a message to a responder based on trigger patterns.
   *
   * @param message The incoming message text
   * @returns The matched responder and remaining args, or null if no match and no default
   */
  matchResponder(message: string): ResponderMatch | null {
    const trimmed = message.trim();
    if (!trimmed) {
      return this.getDefaultMatch("");
    }

    // Try to match @mention triggers first (highest priority)
    const mentionMatch = this.matchMentionTrigger(trimmed);
    if (mentionMatch) {
      return mentionMatch;
    }

    // Try to match keyword triggers
    const keywordMatch = this.matchKeywordTrigger(trimmed);
    if (keywordMatch) {
      return keywordMatch;
    }

    // Fall back to default responder
    return this.getDefaultMatch(trimmed);
  }

  /**
   * Match @mention triggers at the start of a message.
   * Handles variations like "@qa", "@qa ", "@qa: ", etc.
   */
  private matchMentionTrigger(message: string): ResponderMatch | null {
    // Check if message starts with @
    if (!message.startsWith("@")) {
      return null;
    }

    // Extract the mention (everything from @ until whitespace or punctuation)
    const mentionMatch = message.match(/^(@\w+)/i);
    if (!mentionMatch) {
      return null;
    }

    const mention = mentionMatch[1].toLowerCase();
    const responderName = this.mentionTriggers.get(mention);

    if (!responderName) {
      return null;
    }

    const responder = this.responders.get(responderName);
    if (!responder) {
      return null;
    }

    // Extract the remaining message after the trigger
    // Handle optional separators like ":" or just whitespace
    const args = this.extractArgsAfterTrigger(message, mention.length);

    return {
      name: responderName,
      responder,
      args,
    };
  }

  /**
   * Match keyword triggers at the start of a message.
   */
  private matchKeywordTrigger(message: string): ResponderMatch | null {
    const lowerMessage = message.toLowerCase();

    // Check each keyword trigger
    for (const [trigger, responderName] of this.keywordTriggers) {
      // Match if message starts with the trigger followed by whitespace or end of message
      if (
        lowerMessage === trigger ||
        lowerMessage.startsWith(trigger + " ") ||
        lowerMessage.startsWith(trigger + ":") ||
        lowerMessage.startsWith(trigger + "\n")
      ) {
        const responder = this.responders.get(responderName);
        if (!responder) {
          continue;
        }

        const args = this.extractArgsAfterTrigger(message, trigger.length);

        return {
          name: responderName,
          responder,
          args,
        };
      }
    }

    return null;
  }

  /**
   * Extract the remaining message after a trigger, handling common separators.
   */
  private extractArgsAfterTrigger(message: string, triggerLength: number): string {
    let remaining = message.slice(triggerLength);

    // Remove leading separator if present (: or whitespace)
    remaining = remaining.replace(/^[:]\s*/, "");
    remaining = remaining.replace(/^\s+/, "");

    return remaining.trim();
  }

  /**
   * Get the default responder match, or null if no default is configured.
   */
  private getDefaultMatch(args: string): ResponderMatch | null {
    if (!this.defaultResponderName) {
      return null;
    }

    const responder = this.responders.get(this.defaultResponderName);
    if (!responder) {
      return null;
    }

    return {
      name: this.defaultResponderName,
      responder,
      args,
    };
  }

  /**
   * Get all configured responder names.
   */
  getResponderNames(): string[] {
    return Array.from(this.responders.keys());
  }

  /**
   * Get a specific responder by name.
   */
  getResponder(name: string): ResponderConfig | undefined {
    return this.responders.get(name);
  }

  /**
   * Check if a default responder is configured.
   */
  hasDefaultResponder(): boolean {
    return this.defaultResponderName !== null;
  }

  /**
   * Get the default responder name if configured.
   */
  getDefaultResponderName(): string | null {
    return this.defaultResponderName;
  }
}

/**
 * Convenience function to match a message against a responders config.
 * Creates a ResponderMatcher and performs the match in one call.
 *
 * @param message The message to match
 * @param responders The responders configuration
 * @returns The match result or null
 */
export function matchResponder(
  message: string,
  responders: RespondersConfig
): ResponderMatch | null {
  const matcher = new ResponderMatcher(responders);
  return matcher.matchResponder(message);
}
