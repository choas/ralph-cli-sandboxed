/**
 * Configuration presets for the config editor.
 * Provides quick setup templates for common integrations.
 */

import type {
  RalphConfig,
  NotificationProviderConfig,
  TelegramChatSettings,
  SlackChatSettings,
  DiscordChatSettings,
} from "../../utils/config.js";

/**
 * A preset defines default values for a specific integration.
 */
export interface ConfigPreset {
  id: string;
  name: string;
  description: string;
  /** Category this preset belongs to (e.g., "chat", "notifications") */
  category: "chat" | "notifications";
  /** Fields to apply from this preset (dot-notation paths to values) */
  fields: Record<string, unknown>;
}

/**
 * Chat provider presets for quick setup.
 */
export const CHAT_PRESETS: ConfigPreset[] = [
  {
    id: "telegram",
    name: "Telegram",
    description: "Telegram Bot API for chat control",
    category: "chat",
    fields: {
      "chat.enabled": true,
      "chat.provider": "telegram",
      "chat.telegram": {
        enabled: true,
        botToken: "",
        allowedChatIds: [],
      } satisfies TelegramChatSettings,
    },
  },
  {
    id: "slack",
    name: "Slack",
    description: "Slack App for chat control via Socket Mode",
    category: "chat",
    fields: {
      "chat.enabled": true,
      "chat.provider": "slack",
      "chat.slack": {
        enabled: true,
        botToken: "", // xoxb-... from OAuth & Permissions
        appToken: "", // xapp-... from Basic Information > App-Level Tokens
        signingSecret: "", // From Basic Information > App Credentials
        allowedChannelIds: [],
      } satisfies SlackChatSettings,
    },
  },
  {
    id: "discord",
    name: "Discord",
    description: "Discord Bot for chat control via Discord Gateway",
    category: "chat",
    fields: {
      "chat.enabled": true,
      "chat.provider": "discord",
      "chat.discord": {
        enabled: true,
        botToken: "", // Bot token from Discord Developer Portal > Bot > Token
        allowedGuildIds: [], // Server/guild IDs to restrict access (optional)
        allowedChannelIds: [], // Channel IDs to restrict access (optional)
      } satisfies DiscordChatSettings,
    },
  },
];

/**
 * Notification provider presets for quick setup.
 */
export const NOTIFICATION_PRESETS: ConfigPreset[] = [
  {
    id: "ntfy",
    name: "ntfy",
    description: "Simple HTTP-based pub-sub notifications",
    category: "notifications",
    fields: {
      "notifications.provider": "ntfy",
      "notifications.ntfy": {
        topic: "",
        server: "https://ntfy.sh",
      } satisfies NotificationProviderConfig,
    },
  },
  {
    id: "pushover",
    name: "Pushover",
    description: "Real-time notifications to iOS, Android, and Desktop",
    category: "notifications",
    fields: {
      "notifications.provider": "pushover",
      "notifications.pushover": {
        user: "",
        token: "",
      } satisfies NotificationProviderConfig,
    },
  },
  {
    id: "gotify",
    name: "Gotify",
    description: "Self-hosted push notification server",
    category: "notifications",
    fields: {
      "notifications.provider": "gotify",
      "notifications.gotify": {
        server: "",
        token: "",
      } satisfies NotificationProviderConfig,
    },
  },
  {
    id: "command",
    name: "Custom Command",
    description: "Execute a custom shell command for notifications",
    category: "notifications",
    fields: {
      "notifications.provider": "command",
      "notifications.command": "",
    },
  },
];

/**
 * All available presets grouped by category.
 */
export const ALL_PRESETS: ConfigPreset[] = [...CHAT_PRESETS, ...NOTIFICATION_PRESETS];

/**
 * Get presets for a specific category.
 */
export function getPresetsForCategory(category: "chat" | "notifications"): ConfigPreset[] {
  return ALL_PRESETS.filter((preset) => preset.category === category);
}

/**
 * Get presets available for a specific config section.
 * Maps section IDs to preset categories.
 */
export function getPresetsForSection(sectionId: string): ConfigPreset[] {
  switch (sectionId) {
    case "chat":
      return CHAT_PRESETS;
    case "notifications":
      return NOTIFICATION_PRESETS;
    default:
      return [];
  }
}

/**
 * Check if a section has available presets.
 */
export function sectionHasPresets(sectionId: string): boolean {
  return getPresetsForSection(sectionId).length > 0;
}

/**
 * Apply a preset to a config object (immutably).
 * Returns a new config with the preset fields applied.
 */
export function applyPreset(config: RalphConfig, preset: ConfigPreset): RalphConfig {
  const result = JSON.parse(JSON.stringify(config)) as RalphConfig;

  for (const [path, value] of Object.entries(preset.fields)) {
    setValueAtPath(result as unknown as Record<string, unknown>, path, value);
  }

  return result;
}

/**
 * Set a value at a dot-notation path in an object (mutates the object).
 */
function setValueAtPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1];
  current[lastPart] = value;
}

/**
 * Detect if a preset is currently active based on config values.
 * Returns the preset ID if detected, or null if no preset matches.
 */
export function detectActivePreset(config: RalphConfig, sectionId: string): string | null {
  const presets = getPresetsForSection(sectionId);

  for (const preset of presets) {
    // Check if the key distinguishing field matches
    const mainField = Object.keys(preset.fields)[0];
    const mainValue = getValueAtPath(config, mainField);
    const presetValue = preset.fields[mainField];

    if (mainValue === presetValue) {
      return preset.id;
    }
  }

  return null;
}

/**
 * Get a value at a dot-notation path from an object.
 */
function getValueAtPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}
