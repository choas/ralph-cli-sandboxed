import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { LLMProvidersConfig, LLMProviderConfig, LLMProviderType } from "../../utils/config.js";

/**
 * Provider type options for dropdown.
 */
const PROVIDER_TYPES: LLMProviderType[] = ["anthropic", "openai", "ollama"];

/**
 * Default models for each provider type.
 */
const DEFAULT_MODELS: Record<LLMProviderType, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  ollama: "llama3",
};

/**
 * Model suggestions for each provider type.
 */
const MODEL_SUGGESTIONS: Record<LLMProviderType, string[]> = {
  anthropic: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-3-5-haiku-20241022"],
  openai: ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo", "o1-preview", "o1-mini"],
  ollama: ["llama3", "llama3.1", "mistral", "codellama", "mixtral", "phi"],
};

export interface LLMProvidersEditorProps {
  /** The label to display for this field */
  label: string;
  /** The current LLM providers config */
  providers: LLMProvidersConfig;
  /** Called when the user confirms the edit */
  onConfirm: (newProviders: LLMProvidersConfig) => void;
  /** Called when the user cancels the edit (Esc) */
  onCancel: () => void;
  /** Whether this editor has focus */
  isFocused?: boolean;
  /** Maximum height for the list (for scrolling) */
  maxHeight?: number;
}

type EditorMode =
  | "list"
  | "add-name"
  | "select-type"
  | "edit-model"
  | "edit-apikey"
  | "edit-baseurl"
  | "edit-provider";

interface EditingProvider {
  name: string;
  config: LLMProviderConfig;
  field?: "type" | "model" | "apiKey" | "baseUrl";
}

/**
 * LLMProvidersEditor component for editing LLM provider configurations.
 * Provides a user-friendly interface for adding, editing, and removing LLM providers.
 */
export function LLMProvidersEditor({
  label,
  providers,
  onConfirm,
  onCancel,
  isFocused = true,
  maxHeight = 15,
}: LLMProvidersEditorProps): React.ReactElement {
  const [editProviders, setEditProviders] = useState<LLMProvidersConfig>({ ...providers });
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [mode, setMode] = useState<EditorMode>("list");
  const [editText, setEditText] = useState("");
  const [editingProvider, setEditingProvider] = useState<EditingProvider | null>(null);
  const [typeIndex, setTypeIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Get sorted provider names
  const providerNames = useMemo(() => Object.keys(editProviders).sort(), [editProviders]);
  // Total options includes all providers plus "+ Add provider" option
  const totalOptions = providerNames.length + 1;

  // Calculate visible range for scrolling
  const visibleCount = Math.min(maxHeight - 6, totalOptions); // Reserve lines for header, footer, hints
  const visibleProviders = useMemo(() => {
    const endIndex = Math.min(scrollOffset + visibleCount, providerNames.length);
    return providerNames.slice(scrollOffset, endIndex);
  }, [scrollOffset, visibleCount, providerNames]);

  // Auto-scroll to keep highlighted item visible
  React.useEffect(() => {
    if (highlightedIndex < scrollOffset) {
      setScrollOffset(highlightedIndex);
    } else if (highlightedIndex >= scrollOffset + visibleCount) {
      setScrollOffset(Math.max(0, highlightedIndex - visibleCount + 1));
    }
  }, [highlightedIndex, scrollOffset, visibleCount]);

  // Navigation handlers
  const handleNavigateUp = useCallback(() => {
    setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : totalOptions - 1));
  }, [totalOptions]);

  const handleNavigateDown = useCallback(() => {
    setHighlightedIndex((prev) => (prev < totalOptions - 1 ? prev + 1 : 0));
  }, [totalOptions]);

  // Delete the highlighted provider
  const handleDelete = useCallback(() => {
    if (highlightedIndex < providerNames.length) {
      const nameToDelete = providerNames[highlightedIndex];
      const newProviders = { ...editProviders };
      delete newProviders[nameToDelete];
      setEditProviders(newProviders);
      // Adjust highlighted index if needed
      const newNames = Object.keys(newProviders);
      if (highlightedIndex >= newNames.length && newNames.length > 0) {
        setHighlightedIndex(newNames.length - 1);
      } else if (newNames.length === 0) {
        setHighlightedIndex(0);
      }
    }
  }, [highlightedIndex, providerNames, editProviders]);

  // Start editing or adding a provider
  const handleStartEdit = useCallback(() => {
    if (highlightedIndex < providerNames.length) {
      // Edit existing provider
      const name = providerNames[highlightedIndex];
      const config = editProviders[name];
      setEditingProvider({ name, config: { ...config } });
      setMode("edit-provider");
    } else {
      // Add new provider - start with name input
      setEditText("");
      setMode("add-name");
    }
  }, [highlightedIndex, providerNames, editProviders]);

  // Handle name submission when adding new provider
  const handleNameSubmit = useCallback(() => {
    const trimmedName = editText.trim();
    if (trimmedName) {
      // Check if name already exists
      if (editProviders[trimmedName]) {
        // Edit existing instead
        const config = editProviders[trimmedName];
        setEditingProvider({ name: trimmedName, config: { ...config } });
        setMode("edit-provider");
      } else {
        // Create new provider with default values
        setEditingProvider({
          name: trimmedName,
          config: {
            type: "anthropic",
            model: DEFAULT_MODELS.anthropic,
          },
        });
        setTypeIndex(0);
        setMode("select-type");
      }
    } else {
      setMode("list");
    }
    setEditText("");
  }, [editText, editProviders]);

  // Handle type selection
  const handleTypeSelect = useCallback(() => {
    if (editingProvider) {
      const selectedType = PROVIDER_TYPES[typeIndex];
      setEditingProvider({
        ...editingProvider,
        config: {
          ...editingProvider.config,
          type: selectedType,
          model: DEFAULT_MODELS[selectedType],
        },
      });
      setEditText(DEFAULT_MODELS[selectedType]);
      setMode("edit-model");
    }
  }, [editingProvider, typeIndex]);

  // Handle model submission
  const handleModelSubmit = useCallback(() => {
    if (editingProvider) {
      const trimmedModel = editText.trim() || DEFAULT_MODELS[editingProvider.config.type];
      setEditingProvider({
        ...editingProvider,
        config: {
          ...editingProvider.config,
          model: trimmedModel,
        },
      });
      // For ollama, skip API key and go to baseUrl
      if (editingProvider.config.type === "ollama") {
        setEditText(editingProvider.config.baseUrl || "http://localhost:11434");
        setMode("edit-baseurl");
      } else {
        setEditText(editingProvider.config.apiKey || "");
        setMode("edit-apikey");
      }
    }
  }, [editingProvider, editText]);

  // Handle API key submission
  const handleApiKeySubmit = useCallback(() => {
    if (editingProvider) {
      const apiKey = editText.trim() || undefined;
      setEditingProvider({
        ...editingProvider,
        config: {
          ...editingProvider.config,
          apiKey,
        },
      });
      setEditText(editingProvider.config.baseUrl || "");
      setMode("edit-baseurl");
    }
  }, [editingProvider, editText]);

  // Handle base URL submission and save provider
  const handleBaseUrlSubmit = useCallback(() => {
    if (editingProvider) {
      const baseUrl = editText.trim() || undefined;
      const newProviders = {
        ...editProviders,
        [editingProvider.name]: {
          ...editingProvider.config,
          baseUrl,
        },
      };
      // Clean up undefined values
      if (!newProviders[editingProvider.name].apiKey) {
        delete newProviders[editingProvider.name].apiKey;
      }
      if (!newProviders[editingProvider.name].baseUrl) {
        delete newProviders[editingProvider.name].baseUrl;
      }
      setEditProviders(newProviders);
      setEditingProvider(null);
      setMode("list");
      setEditText("");

      // Update highlighted index to the new/edited provider
      const sortedNames = Object.keys(newProviders).sort();
      const newIndex = sortedNames.indexOf(editingProvider.name);
      if (newIndex >= 0) {
        setHighlightedIndex(newIndex);
      }
    }
  }, [editingProvider, editText, editProviders]);

  // Cancel editing
  const handleCancel = useCallback(() => {
    setMode("list");
    setEditText("");
    setEditingProvider(null);
  }, []);

  // Handle keyboard input for list mode
  useInput(
    (input, key) => {
      if (!isFocused || mode !== "list") return;

      if (input === "j" || key.downArrow) {
        handleNavigateDown();
      } else if (input === "k" || key.upArrow) {
        handleNavigateUp();
      } else if (key.return || input === "e") {
        handleStartEdit();
      } else if (input === "d" || key.delete) {
        handleDelete();
      } else if (key.escape) {
        onCancel();
      } else if (input === "s" || input === "S") {
        onConfirm(editProviders);
      }
    },
    { isActive: isFocused && mode === "list" },
  );

  // Handle keyboard input for type selection
  useInput(
    (input, key) => {
      if (!isFocused || mode !== "select-type") return;

      if (input === "j" || key.downArrow) {
        setTypeIndex((prev) => (prev < PROVIDER_TYPES.length - 1 ? prev + 1 : 0));
      } else if (input === "k" || key.upArrow) {
        setTypeIndex((prev) => (prev > 0 ? prev - 1 : PROVIDER_TYPES.length - 1));
      } else if (key.return) {
        handleTypeSelect();
      } else if (key.escape) {
        handleCancel();
      }
    },
    { isActive: isFocused && mode === "select-type" },
  );

  // Handle keyboard input for text editing modes
  useInput(
    (_input, key) => {
      if (
        !isFocused ||
        mode === "list" ||
        mode === "select-type" ||
        mode === "edit-provider"
      )
        return;

      if (key.escape) {
        handleCancel();
      }
    },
    {
      isActive:
        isFocused &&
        mode !== "list" &&
        mode !== "select-type" &&
        mode !== "edit-provider",
    },
  );

  // Handle keyboard input for edit-provider mode (viewing a provider)
  useInput(
    (input, key) => {
      if (!isFocused || mode !== "edit-provider" || !editingProvider) return;

      if (key.escape) {
        handleCancel();
      } else if (input === "t" || input === "T") {
        // Edit type
        setTypeIndex(PROVIDER_TYPES.indexOf(editingProvider.config.type));
        setMode("select-type");
      } else if (input === "m" || input === "M") {
        // Edit model
        setEditText(editingProvider.config.model);
        setMode("edit-model");
      } else if (input === "a" || input === "A") {
        // Edit API key
        setEditText(editingProvider.config.apiKey || "");
        setMode("edit-apikey");
      } else if (input === "b" || input === "B") {
        // Edit base URL
        setEditText(editingProvider.config.baseUrl || "");
        setMode("edit-baseurl");
      } else if (input === "s" || input === "S") {
        // Save and close
        const newProviders = {
          ...editProviders,
          [editingProvider.name]: { ...editingProvider.config },
        };
        // Clean up undefined values
        if (!newProviders[editingProvider.name].apiKey) {
          delete newProviders[editingProvider.name].apiKey;
        }
        if (!newProviders[editingProvider.name].baseUrl) {
          delete newProviders[editingProvider.name].baseUrl;
        }
        setEditProviders(newProviders);
        setEditingProvider(null);
        setMode("list");
      }
    },
    { isActive: isFocused && mode === "edit-provider" },
  );

  // Render type selection mode
  if (mode === "select-type") {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Select Provider Type
          </Text>
          {editingProvider && <Text dimColor> for "{editingProvider.name}"</Text>}
        </Box>

        {PROVIDER_TYPES.map((type, index) => {
          const isHighlighted = index === typeIndex;
          return (
            <Box key={type}>
              <Text color={isHighlighted ? "cyan" : undefined}>
                {isHighlighted ? "▸ " : "  "}
              </Text>
              <Text bold={isHighlighted} color={isHighlighted ? "cyan" : undefined} inverse={isHighlighted}>
                {type}
              </Text>
              <Text dimColor> - {type === "anthropic" ? "Claude models" : type === "openai" ? "GPT models" : "Local models"}</Text>
            </Box>
          );
        })}

        <Box marginTop={1}>
          <Text dimColor>j/k: navigate | Enter: select | Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  // Render name input mode
  if (mode === "add-name") {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Add New LLM Provider
          </Text>
        </Box>

        <Box>
          <Text dimColor>Name: </Text>
          <TextInput
            value={editText}
            onChange={setEditText}
            onSubmit={handleNameSubmit}
            focus={isFocused}
            placeholder="e.g., claude, gpt4, local"
          />
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Common names: anthropic, openai, ollama, claude, gpt4, local</Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Enter: next | Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  // Render model input mode
  if (mode === "edit-model" && editingProvider) {
    const suggestions = MODEL_SUGGESTIONS[editingProvider.config.type] || [];
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Enter Model Name
          </Text>
          <Text dimColor> for {editingProvider.config.type}</Text>
        </Box>

        <Box>
          <Text dimColor>Model: </Text>
          <TextInput
            value={editText}
            onChange={setEditText}
            onSubmit={handleModelSubmit}
            focus={isFocused}
          />
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Suggested models:</Text>
          {suggestions.slice(0, 4).map((model) => (
            <Box key={model} marginLeft={2}>
              <Text color="gray">{model}</Text>
            </Box>
          ))}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Enter: next | Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  // Render API key input mode
  if (mode === "edit-apikey" && editingProvider) {
    const envVar = editingProvider.config.type === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Enter API Key
          </Text>
          <Text dimColor> (optional)</Text>
        </Box>

        <Box marginBottom={1}>
          <Text dimColor>Leave empty to use {envVar} environment variable</Text>
        </Box>

        <Box>
          <Text dimColor>API Key: </Text>
          <TextInput
            value={editText}
            onChange={setEditText}
            onSubmit={handleApiKeySubmit}
            focus={isFocused}
            mask="*"
          />
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Enter: next | Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  // Render base URL input mode
  if (mode === "edit-baseurl" && editingProvider) {
    const defaultUrl = editingProvider.config.type === "ollama" ? "http://localhost:11434" : "";
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Enter Base URL
          </Text>
          <Text dimColor> (optional)</Text>
        </Box>

        {editingProvider.config.type === "ollama" && (
          <Box marginBottom={1}>
            <Text dimColor>Default: {defaultUrl}</Text>
          </Box>
        )}

        {editingProvider.config.type === "openai" && (
          <Box marginBottom={1}>
            <Text dimColor>Use custom URL for OpenAI-compatible APIs</Text>
          </Box>
        )}

        <Box>
          <Text dimColor>Base URL: </Text>
          <TextInput
            value={editText}
            onChange={setEditText}
            onSubmit={handleBaseUrlSubmit}
            focus={isFocused}
            placeholder={defaultUrl || "Leave empty for default"}
          />
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Enter: save provider | Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  // Render edit-provider mode (viewing/editing a single provider)
  if (mode === "edit-provider" && editingProvider) {
    const config = editingProvider.config;
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Edit Provider: {editingProvider.name}
          </Text>
        </Box>

        <Box>
          <Text color="yellow">[T] Type: </Text>
          <Text>{config.type}</Text>
        </Box>

        <Box>
          <Text color="yellow">[M] Model: </Text>
          <Text>{config.model}</Text>
        </Box>

        <Box>
          <Text color="yellow">[A] API Key: </Text>
          <Text dimColor>{config.apiKey ? "********" : "(uses env var)"}</Text>
        </Box>

        <Box>
          <Text color="yellow">[B] Base URL: </Text>
          <Text dimColor>{config.baseUrl || "(default)"}</Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>T/M/A/B: edit field | S: save | Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  // Calculate scroll indicators
  const canScrollUp = scrollOffset > 0;
  const canScrollDown = scrollOffset + visibleCount < providerNames.length;
  const hasOverflow = providerNames.length > visibleCount;

  // Render list mode
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {label}
        </Text>
        <Text dimColor> ({providerNames.length} providers)</Text>
      </Box>

      {/* Up scroll indicator */}
      {hasOverflow && (
        <Box>
          <Text color={canScrollUp ? "cyan" : "gray"} dimColor={!canScrollUp}>
            {canScrollUp ? "  ▲ more" : ""}
          </Text>
        </Box>
      )}

      {/* Provider list */}
      {providerNames.length === 0 ? (
        <Box marginBottom={1}>
          <Text dimColor italic>
            No LLM providers configured
          </Text>
        </Box>
      ) : (
        visibleProviders.map((name) => {
          const actualIndex = providerNames.indexOf(name);
          const isHighlighted = actualIndex === highlightedIndex;
          const config = editProviders[name];

          return (
            <Box key={name} flexDirection="column">
              <Box>
                <Text color={isHighlighted ? "cyan" : undefined}>
                  {isHighlighted ? "▸ " : "  "}
                </Text>
                <Text bold={isHighlighted} color={isHighlighted ? "cyan" : "yellow"} inverse={isHighlighted}>
                  {name}
                </Text>
                <Text dimColor>: </Text>
                <Text color="magenta">{config.type}</Text>
                <Text dimColor> / </Text>
                <Text>{config.model}</Text>
              </Box>
            </Box>
          );
        })
      )}

      {/* Down scroll indicator */}
      {hasOverflow && (
        <Box>
          <Text color={canScrollDown ? "cyan" : "gray"} dimColor={!canScrollDown}>
            {canScrollDown ? "  ▼ more" : ""}
          </Text>
        </Box>
      )}

      {/* Add provider option */}
      <Box>
        <Text color={highlightedIndex === providerNames.length ? "green" : undefined}>
          {highlightedIndex === providerNames.length ? "▸ " : "  "}
        </Text>
        <Text
          bold={highlightedIndex === providerNames.length}
          color={highlightedIndex === providerNames.length ? "green" : "gray"}
          inverse={highlightedIndex === providerNames.length}
        >
          + Add provider
        </Text>
      </Box>

      {/* Help text */}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>j/k: navigate | Enter/e: edit | d: delete</Text>
        <Text dimColor>s: save all | Esc: cancel</Text>
      </Box>
    </Box>
  );
}

export default LLMProvidersEditor;
