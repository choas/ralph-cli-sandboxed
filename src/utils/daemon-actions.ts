/**
 * Shared daemon actions utility.
 * Provides built-in actions that are available when the daemon is running.
 */

import type { RalphConfig } from "./config.js";

export interface DaemonAction {
  command: string;
  description?: string;
  ntfyUrl?: string;  // Special case for ntfy provider - curl target URL
}

/**
 * Check if Telegram is enabled (has token and not explicitly disabled).
 */
function isTelegramEnabled(config: RalphConfig): boolean {
  if (!config.chat?.telegram?.botToken) return false;
  if (config.chat.telegram.enabled === false) return false;
  return true;
}

/**
 * Check if Slack is enabled (has required tokens and not explicitly disabled).
 */
function isSlackEnabled(config: RalphConfig): boolean {
  if (!config.chat?.slack?.botToken) return false;
  if (!config.chat?.slack?.appToken) return false;
  if (!config.chat?.slack?.signingSecret) return false;
  if (config.chat.slack.enabled === false) return false;
  return true;
}

/**
 * Check if Discord is enabled (has token and not explicitly disabled).
 */
function isDiscordEnabled(config: RalphConfig): boolean {
  if (!config.chat?.discord?.botToken) return false;
  if (config.chat.discord.enabled === false) return false;
  return true;
}

/**
 * Default actions available to the sandbox.
 * These are built-in actions that the daemon provides.
 */
export function getDefaultActions(config: RalphConfig): Record<string, DaemonAction> {
  const actions: Record<string, DaemonAction> = {
    ping: {
      command: "echo pong",
      description: "Health check - responds with 'pong'",
    },
  };

  // Add notify action based on notifications config
  if (config.notifications?.provider === "ntfy" && config.notifications.ntfy?.topic) {
    const server = config.notifications.ntfy.server || "https://ntfy.sh";
    const topic = config.notifications.ntfy.topic;
    actions.notify = {
      command: "curl",  // Placeholder - ntfyUrl triggers special handling
      description: `Send notification via ntfy to ${topic}`,
      ntfyUrl: `${server}/${topic}`,
    };
  } else if (config.notifications?.provider === "command" && config.notifications.command) {
    actions.notify = {
      command: config.notifications.command,
      description: "Send notification to host",
    };
  } else if (config.notifyCommand) {
    // Fallback to deprecated notifyCommand
    actions.notify = {
      command: config.notifyCommand,
      description: "Send notification to host",
    };
  }

  // Add telegram_notify action if Telegram is enabled
  if (isTelegramEnabled(config)) {
    actions.telegram_notify = {
      command: "__telegram__",  // Special marker for Telegram handling
      description: "Send notification via Telegram",
    };
  }

  // Add slack_notify action if Slack is enabled
  if (isSlackEnabled(config)) {
    actions.slack_notify = {
      command: "__slack__",  // Special marker for Slack handling
      description: "Send notification via Slack",
    };
  }

  // Add discord_notify action if Discord is enabled
  if (isDiscordEnabled(config)) {
    actions.discord_notify = {
      command: "__discord__",  // Special marker for Discord handling
      description: "Send notification via Discord",
    };
  }

  // Add chat_status action for querying PRD status from container
  actions.chat_status = {
    command: "ralph prd status --json 2>/dev/null || echo '{}'",
    description: "Get PRD status as JSON",
  };

  // Add chat_add action for adding PRD tasks from container
  actions.chat_add = {
    command: "ralph add",
    description: "Add a new task to the PRD",
  };

  return actions;
}

/**
 * Get the names of all built-in actions for a given config.
 */
export function getBuiltInActionNames(config: RalphConfig): Set<string> {
  return new Set(Object.keys(getDefaultActions(config)));
}
