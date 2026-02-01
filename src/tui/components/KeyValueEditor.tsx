import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

/**
 * Provider-specific hint configuration.
 * Shows common keys and their descriptions based on the notification provider.
 */
export interface ProviderHint {
  key: string;
  description: string;
  required?: boolean;
}

/**
 * Built-in hints for known notification providers.
 */
export const PROVIDER_HINTS: Record<string, ProviderHint[]> = {
  ntfy: [
    { key: "topic", description: "ntfy topic name", required: true },
    { key: "server", description: "ntfy server URL (default: https://ntfy.sh)" },
    { key: "priority", description: "Message priority (1-5)" },
    { key: "tags", description: "Comma-separated tags/emojis" },
  ],
  pushover: [
    { key: "user", description: "Pushover user key", required: true },
    { key: "token", description: "Pushover app token", required: true },
    { key: "device", description: "Target device name" },
    { key: "priority", description: "Message priority (-2 to 2)" },
    { key: "sound", description: "Notification sound name" },
  ],
  gotify: [
    { key: "server", description: "Gotify server URL", required: true },
    { key: "token", description: "Gotify app token", required: true },
    { key: "priority", description: "Message priority (0-10)" },
  ],
  // Chat provider hints
  slack: [
    {
      key: "botToken",
      description: "Slack Bot Token (xoxb-...) from OAuth & Permissions",
      required: true,
    },
    {
      key: "appToken",
      description: "Slack App Token (xapp-...) from Basic Information > App-Level Tokens",
      required: true,
    },
    {
      key: "signingSecret",
      description: "Slack Signing Secret from Basic Information > App Credentials",
      required: true,
    },
    { key: "allowedChannelIds", description: "Only respond in these channel IDs (security)" },
    { key: "enabled", description: "Enable/disable Slack integration" },
  ],
  telegram: [
    { key: "botToken", description: "Telegram Bot API token from @BotFather", required: true },
    { key: "allowedChatIds", description: "Only respond in these chat IDs (security)" },
    { key: "enabled", description: "Enable/disable Telegram integration" },
  ],
  discord: [
    {
      key: "botToken",
      description: "Discord Bot Token from Developer Portal > Bot > Token",
      required: true,
    },
    { key: "allowedGuildIds", description: "Only respond in these server/guild IDs (security)" },
    { key: "allowedChannelIds", description: "Only respond in these channel IDs (security)" },
    { key: "enabled", description: "Enable/disable Discord integration" },
  ],
  // LLM provider hints
  anthropic: [
    { key: "type", description: "Provider type (anthropic)", required: true },
    {
      key: "model",
      description: "Model name (e.g., claude-sonnet-4-20250514, claude-opus-4-20250514)",
      required: true,
    },
    { key: "apiKey", description: "API key (defaults to ANTHROPIC_API_KEY env var)" },
    { key: "baseUrl", description: "Custom API base URL (optional)" },
  ],
  openai: [
    { key: "type", description: "Provider type (openai)", required: true },
    { key: "model", description: "Model name (e.g., gpt-4o, gpt-4-turbo, gpt-3.5-turbo)", required: true },
    { key: "apiKey", description: "API key (defaults to OPENAI_API_KEY env var)" },
    { key: "baseUrl", description: "Custom API base URL (for OpenAI-compatible services)" },
  ],
  ollama: [
    { key: "type", description: "Provider type (ollama)", required: true },
    { key: "model", description: "Model name (e.g., llama3, mistral, codellama)", required: true },
    { key: "baseUrl", description: "Ollama server URL (default: http://localhost:11434)" },
  ],
  // Generic LLM provider hint for unknown providers
  llmprovider: [
    { key: "type", description: "Provider type (anthropic, openai, or ollama)", required: true },
    { key: "model", description: "Model name", required: true },
    { key: "apiKey", description: "API key (optional, uses env var if not set)" },
    { key: "baseUrl", description: "Custom API base URL (optional)" },
  ],
};

export interface KeyValueEditorProps {
  /** The label to display for this object field */
  label: string;
  /** The current object entries as key-value pairs */
  entries: Record<string, string>;
  /** Called when the user confirms the edit */
  onConfirm: (newEntries: Record<string, string>) => void;
  /** Called when the user cancels the edit (Esc) */
  onCancel: () => void;
  /** Whether this editor has focus */
  isFocused?: boolean;
  /** Provider name for showing hints (e.g., "ntfy", "pushover", "gotify") */
  providerName?: string;
}

type EditorMode = "list" | "add-key" | "add-value" | "edit-value" | "select-hint";

/**
 * KeyValueEditor component for editing key-value pairs with provider-specific hints.
 * Enhanced version of ObjectEditor with support for common key suggestions.
 */
export function KeyValueEditor({
  label,
  entries,
  onConfirm,
  onCancel,
  isFocused = true,
  providerName,
}: KeyValueEditorProps): React.ReactElement {
  const [editEntries, setEditEntries] = useState<Record<string, string>>({ ...entries });
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [mode, setMode] = useState<EditorMode>("list");
  const [editText, setEditText] = useState("");
  const [newKey, setNewKey] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [hintIndex, setHintIndex] = useState(0);

  // Get hints for the current provider
  const providerHints = useMemo(() => {
    if (!providerName) return [];
    return PROVIDER_HINTS[providerName] || [];
  }, [providerName]);

  // Get hints that are not already in entries
  const availableHints = useMemo(() => {
    return providerHints.filter((hint) => !(hint.key in editEntries));
  }, [providerHints, editEntries]);

  // Get sorted keys for consistent ordering
  const keys = Object.keys(editEntries).sort();
  // Total options includes all keys plus "+ Add entry" option (and "+ Add from hints" if available)
  const hasHints = availableHints.length > 0;
  const totalOptions = keys.length + (hasHints ? 2 : 1);

  // Navigation handlers
  const handleNavigateUp = useCallback(() => {
    setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : totalOptions - 1));
  }, [totalOptions]);

  const handleNavigateDown = useCallback(() => {
    setHighlightedIndex((prev) => (prev < totalOptions - 1 ? prev + 1 : 0));
  }, [totalOptions]);

  // Toggle expansion of a key to show its value
  const handleToggleExpand = useCallback(() => {
    if (highlightedIndex < keys.length) {
      const key = keys[highlightedIndex];
      setExpandedKeys((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(key)) {
          newSet.delete(key);
        } else {
          newSet.add(key);
        }
        return newSet;
      });
    }
  }, [highlightedIndex, keys]);

  // Delete the highlighted entry
  const handleDelete = useCallback(() => {
    if (highlightedIndex < keys.length) {
      const keyToDelete = keys[highlightedIndex];
      const newEntries = { ...editEntries };
      delete newEntries[keyToDelete];
      setEditEntries(newEntries);
      // Remove from expanded set if present
      setExpandedKeys((prev) => {
        const newSet = new Set(prev);
        newSet.delete(keyToDelete);
        return newSet;
      });
      // Adjust highlighted index if needed
      const newKeys = Object.keys(newEntries);
      if (highlightedIndex >= newKeys.length && newKeys.length > 0) {
        setHighlightedIndex(newKeys.length - 1);
      } else if (newKeys.length === 0) {
        setHighlightedIndex(0);
      }
    }
  }, [highlightedIndex, keys, editEntries]);

  // Start editing a value
  const handleStartEdit = useCallback(() => {
    if (highlightedIndex < keys.length) {
      const key = keys[highlightedIndex];
      setEditText(editEntries[key] || "");
      setNewKey(key);
      setMode("edit-value");
    } else if (hasHints && highlightedIndex === keys.length) {
      // "+ Add from hints" option
      setHintIndex(0);
      setMode("select-hint");
    } else {
      // "+ Add entry" option - start with key input
      setEditText("");
      setNewKey("");
      setMode("add-key");
    }
  }, [highlightedIndex, keys, editEntries, hasHints]);

  // Confirm key input when adding
  const handleKeySubmit = useCallback(() => {
    const trimmedKey = editText.trim();
    if (trimmedKey) {
      // Check if key already exists
      if (editEntries[trimmedKey] !== undefined) {
        // Edit existing key instead
        setNewKey(trimmedKey);
        setEditText(editEntries[trimmedKey]);
        setMode("edit-value");
      } else {
        setNewKey(trimmedKey);
        setEditText("");
        setMode("add-value");
      }
    } else {
      // Empty key - cancel
      setMode("list");
      setEditText("");
    }
  }, [editText, editEntries]);

  // Confirm value input
  const handleValueSubmit = useCallback(() => {
    const trimmedValue = editText.trim();
    if (newKey) {
      const newEntries = { ...editEntries };
      newEntries[newKey] = trimmedValue;
      setEditEntries(newEntries);
      // Update highlighted index to the new/edited key
      const sortedKeys = Object.keys(newEntries).sort();
      const newIndex = sortedKeys.indexOf(newKey);
      if (newIndex >= 0) {
        setHighlightedIndex(newIndex);
      }
    }
    setMode("list");
    setEditText("");
    setNewKey("");
  }, [editText, newKey, editEntries]);

  // Cancel text input
  const handleTextCancel = useCallback(() => {
    setMode("list");
    setEditText("");
    setNewKey("");
  }, []);

  // Handle hint selection
  const handleSelectHint = useCallback(() => {
    if (availableHints.length > 0 && hintIndex < availableHints.length) {
      const hint = availableHints[hintIndex];
      setNewKey(hint.key);
      setEditText("");
      setMode("add-value");
    }
  }, [availableHints, hintIndex]);

  // Handle keyboard input for list mode
  useInput(
    (input, key) => {
      if (!isFocused || mode !== "list") return;

      // j/k or arrow keys for navigation
      if (input === "j" || key.downArrow) {
        handleNavigateDown();
      } else if (input === "k" || key.upArrow) {
        handleNavigateUp();
      } else if (key.return || input === "e") {
        // Enter or 'e' to edit/add
        handleStartEdit();
      } else if (input === "d" || key.delete) {
        // 'd' or Delete to remove
        handleDelete();
      } else if (key.tab || input === " ") {
        // Tab or Space to expand/collapse value
        handleToggleExpand();
      } else if (key.escape) {
        onCancel();
      } else if (input === "s" || input === "S") {
        // 's' to save and confirm
        onConfirm(editEntries);
      }
    },
    { isActive: isFocused && mode === "list" },
  );

  // Handle keyboard input for hint selection mode
  useInput(
    (input, key) => {
      if (!isFocused || mode !== "select-hint") return;

      if (input === "j" || key.downArrow) {
        setHintIndex((prev) => (prev < availableHints.length - 1 ? prev + 1 : 0));
      } else if (input === "k" || key.upArrow) {
        setHintIndex((prev) => (prev > 0 ? prev - 1 : availableHints.length - 1));
      } else if (key.return) {
        handleSelectHint();
      } else if (key.escape) {
        setMode("list");
      }
    },
    { isActive: isFocused && mode === "select-hint" },
  );

  // Handle keyboard input for text editing modes
  useInput(
    (_input, key) => {
      if (!isFocused || mode === "list" || mode === "select-hint") return;

      if (key.escape) {
        handleTextCancel();
      }
    },
    { isActive: isFocused && mode !== "list" && mode !== "select-hint" },
  );

  // Render hint selection mode
  if (mode === "select-hint") {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        {/* Header */}
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Select a Common Key
          </Text>
          {providerName && <Text dimColor> ({providerName})</Text>}
        </Box>

        {/* Hint list */}
        {availableHints.map((hint, index) => {
          const isHighlighted = index === hintIndex;
          return (
            <Box key={hint.key}>
              <Text color={isHighlighted ? "cyan" : undefined}>{isHighlighted ? "▸ " : "  "}</Text>
              <Text
                bold={isHighlighted}
                color={hint.required ? "yellow" : isHighlighted ? "cyan" : undefined}
                inverse={isHighlighted}
              >
                {hint.key}
              </Text>
              {hint.required && <Text color="red"> *</Text>}
              <Text dimColor> - {hint.description}</Text>
            </Box>
          );
        })}

        {/* Help text */}
        <Box marginTop={1}>
          <Text dimColor>j/k: navigate | Enter: select | Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  // Render key input mode
  if (mode === "add-key") {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        {/* Header */}
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Add New Entry - Enter Key
          </Text>
        </Box>

        {/* Input field */}
        <Box>
          <Text dimColor>Key: </Text>
          <TextInput
            value={editText}
            onChange={setEditText}
            onSubmit={handleKeySubmit}
            focus={isFocused}
          />
        </Box>

        {/* Provider hints */}
        {availableHints.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Common keys for {providerName}:</Text>
            {availableHints.slice(0, 4).map((hint) => (
              <Box key={hint.key} marginLeft={2}>
                <Text color={hint.required ? "yellow" : "gray"}>
                  {hint.key}
                  {hint.required && " *"}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        {/* Help text */}
        <Box marginTop={1}>
          <Text dimColor>Enter: next | Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  // Render value input mode (for add or edit)
  if (mode === "add-value" || mode === "edit-value") {
    // Find hint description for the current key
    const currentHint = providerHints.find((h) => h.key === newKey);

    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        {/* Header */}
        <Box marginBottom={1}>
          <Text bold color="cyan">
            {mode === "add-value" ? "Add New Entry - Enter Value" : `Edit Value for "${newKey}"`}
          </Text>
        </Box>

        {/* Show key if adding */}
        {mode === "add-value" && (
          <Box marginBottom={1}>
            <Text dimColor>Key: </Text>
            <Text color="yellow">{newKey}</Text>
            {currentHint && currentHint.required && <Text color="red"> (required)</Text>}
          </Box>
        )}

        {/* Hint description if available */}
        {currentHint && (
          <Box marginBottom={1}>
            <Text dimColor>{currentHint.description}</Text>
          </Box>
        )}

        {/* Input field */}
        <Box>
          <Text dimColor>Value: </Text>
          <TextInput
            value={editText}
            onChange={setEditText}
            onSubmit={handleValueSubmit}
            focus={isFocused}
          />
        </Box>

        {/* Help text */}
        <Box marginTop={1}>
          <Text dimColor>Enter: confirm | Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  // Check for missing required keys
  const missingRequired = providerHints.filter((h) => h.required && !(h.key in editEntries));

  // Render list mode
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Edit: {label}
        </Text>
        <Text dimColor> ({keys.length} entries)</Text>
        {providerName && <Text dimColor> - {providerName}</Text>}
      </Box>

      {/* Missing required keys warning */}
      {missingRequired.length > 0 && (
        <Box marginBottom={1}>
          <Text color="yellow">⚠ Missing required: </Text>
          <Text color="yellow">{missingRequired.map((h) => h.key).join(", ")}</Text>
        </Box>
      )}

      {/* Entries list */}
      {keys.length === 0 ? (
        <Box marginBottom={1}>
          <Text dimColor italic>
            No entries
          </Text>
        </Box>
      ) : (
        keys.map((key, index) => {
          const isHighlighted = index === highlightedIndex;
          const isExpanded = expandedKeys.has(key);
          const value = editEntries[key];
          const hint = providerHints.find((h) => h.key === key);

          return (
            <Box key={`entry-${key}`} flexDirection="column">
              <Box>
                {/* Selection indicator */}
                <Text color={isHighlighted ? "cyan" : undefined}>
                  {isHighlighted ? "▸ " : "  "}
                </Text>
                {/* Expand indicator */}
                <Text dimColor>{isExpanded ? "▼ " : "▶ "}</Text>
                {/* Key name */}
                <Text
                  bold={isHighlighted}
                  color={isHighlighted ? "cyan" : hint?.required ? "yellow" : "yellow"}
                  inverse={isHighlighted}
                >
                  {key}
                </Text>
                {hint?.required && <Text color="red"> *</Text>}
                {/* Collapsed value preview */}
                {!isExpanded && (
                  <>
                    <Text dimColor>: </Text>
                    <Text dimColor>
                      {value.length > 30 ? value.substring(0, 30) + "..." : value}
                    </Text>
                  </>
                )}
              </Box>
              {/* Expanded value */}
              {isExpanded && (
                <Box marginLeft={6}>
                  <Text color="green">{value || "(empty)"}</Text>
                </Box>
              )}
            </Box>
          );
        })
      )}

      {/* Add from hints option (if hints available) */}
      {hasHints && (
        <Box>
          <Text color={highlightedIndex === keys.length ? "green" : undefined}>
            {highlightedIndex === keys.length ? "▸ " : "  "}
          </Text>
          <Text dimColor>{"  "}</Text>
          <Text
            bold={highlightedIndex === keys.length}
            color={highlightedIndex === keys.length ? "green" : "gray"}
            inverse={highlightedIndex === keys.length}
          >
            + Add from hints
          </Text>
        </Box>
      )}

      {/* Add entry option */}
      <Box>
        <Text
          color={
            highlightedIndex === (hasHints ? keys.length + 1 : keys.length) ? "green" : undefined
          }
        >
          {highlightedIndex === (hasHints ? keys.length + 1 : keys.length) ? "▸ " : "  "}
        </Text>
        <Text dimColor>{"  "}</Text>
        <Text
          bold={highlightedIndex === (hasHints ? keys.length + 1 : keys.length)}
          color={highlightedIndex === (hasHints ? keys.length + 1 : keys.length) ? "green" : "gray"}
          inverse={highlightedIndex === (hasHints ? keys.length + 1 : keys.length)}
        >
          + Add custom entry
        </Text>
      </Box>

      {/* Help text */}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>j/k: navigate | Tab/Space: expand | Enter/e: edit</Text>
        <Text dimColor>d: delete | s: save | Esc: cancel</Text>
      </Box>
    </Box>
  );
}

export default KeyValueEditor;
