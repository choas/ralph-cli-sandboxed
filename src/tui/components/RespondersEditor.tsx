import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { RespondersConfig, ResponderConfig, ResponderType } from "../../utils/config.js";

/**
 * Responder type options for dropdown.
 */
const RESPONDER_TYPES: ResponderType[] = ["llm", "claude-code", "cli"];

/**
 * Type descriptions for display.
 */
const TYPE_DESCRIPTIONS: Record<ResponderType, string> = {
  llm: "LLM provider",
  "claude-code": "Claude Code agent",
  cli: "CLI command",
};

/**
 * Default timeouts by responder type.
 */
const DEFAULT_TIMEOUTS: Record<ResponderType, number> = {
  llm: 60000,
  "claude-code": 300000,
  cli: 60000,
};

/**
 * Suggested responder names/presets.
 */
const SUGGESTED_NAMES = ["default", "qa", "reviewer", "code", "lint"];

export interface RespondersEditorProps {
  /** The label to display for this field */
  label: string;
  /** The current responders config */
  responders: RespondersConfig;
  /** Called when the user confirms the edit */
  onConfirm: (newResponders: RespondersConfig) => void;
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
  | "edit-responder"
  | "edit-trigger"
  | "edit-provider"
  | "edit-system"
  | "edit-command"
  | "edit-timeout"
  | "edit-maxlength";

interface EditingResponder {
  name: string;
  config: ResponderConfig;
}

/**
 * RespondersEditor component for editing chat responder configurations.
 * Provides a user-friendly interface for adding, editing, and removing responders.
 */
export function RespondersEditor({
  label,
  responders,
  onConfirm,
  onCancel,
  isFocused = true,
  maxHeight = 15,
}: RespondersEditorProps): React.ReactElement {
  const [editResponders, setEditResponders] = useState<RespondersConfig>({ ...responders });
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [mode, setMode] = useState<EditorMode>("list");
  const [editText, setEditText] = useState("");
  const [editingResponder, setEditingResponder] = useState<EditingResponder | null>(null);
  const [typeIndex, setTypeIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Get sorted responder names
  const responderNames = useMemo(() => Object.keys(editResponders).sort(), [editResponders]);
  // Total options includes all responders plus "+ Add responder" option
  const totalOptions = responderNames.length + 1;

  // Calculate visible range for scrolling
  const visibleCount = Math.min(maxHeight - 6, totalOptions); // Reserve lines for header, footer, hints
  const visibleResponders = useMemo(() => {
    const endIndex = Math.min(scrollOffset + visibleCount, responderNames.length);
    return responderNames.slice(scrollOffset, endIndex);
  }, [scrollOffset, visibleCount, responderNames]);

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

  // Delete the highlighted responder
  const handleDelete = useCallback(() => {
    if (highlightedIndex < responderNames.length) {
      const nameToDelete = responderNames[highlightedIndex];
      const newResponders = { ...editResponders };
      delete newResponders[nameToDelete];
      setEditResponders(newResponders);
      // Adjust highlighted index if needed
      const newNames = Object.keys(newResponders);
      if (highlightedIndex >= newNames.length && newNames.length > 0) {
        setHighlightedIndex(newNames.length - 1);
      } else if (newNames.length === 0) {
        setHighlightedIndex(0);
      }
    }
  }, [highlightedIndex, responderNames, editResponders]);

  // Start editing or adding a responder
  const handleStartEdit = useCallback(() => {
    if (highlightedIndex < responderNames.length) {
      // Edit existing responder
      const name = responderNames[highlightedIndex];
      const config = editResponders[name];
      setEditingResponder({ name, config: { ...config } });
      setMode("edit-responder");
    } else {
      // Add new responder - start with name input
      setEditText("");
      setMode("add-name");
    }
  }, [highlightedIndex, responderNames, editResponders]);

  // Handle name submission when adding new responder
  const handleNameSubmit = useCallback(() => {
    const trimmedName = editText.trim();
    if (trimmedName) {
      // Check if name already exists
      if (editResponders[trimmedName]) {
        // Edit existing instead
        const config = editResponders[trimmedName];
        setEditingResponder({ name: trimmedName, config: { ...config } });
        setMode("edit-responder");
      } else {
        // Create new responder with default values
        const defaultTrigger = trimmedName === "default" ? undefined : `@${trimmedName}`;
        setEditingResponder({
          name: trimmedName,
          config: {
            type: "llm",
            trigger: defaultTrigger,
          },
        });
        setTypeIndex(0);
        setMode("select-type");
      }
    } else {
      setMode("list");
    }
    setEditText("");
  }, [editText, editResponders]);

  // Handle type selection
  const handleTypeSelect = useCallback(() => {
    if (editingResponder) {
      const selectedType = RESPONDER_TYPES[typeIndex];
      setEditingResponder({
        ...editingResponder,
        config: {
          ...editingResponder.config,
          type: selectedType,
          timeout: DEFAULT_TIMEOUTS[selectedType],
          maxLength: 2000,
        },
      });
      setMode("edit-responder");
    }
  }, [editingResponder, typeIndex]);

  // Save current editing responder
  const saveEditingResponder = useCallback(() => {
    if (editingResponder) {
      const newResponders = {
        ...editResponders,
        [editingResponder.name]: { ...editingResponder.config },
      };
      // Clean up undefined values
      const config = newResponders[editingResponder.name];
      if (!config.trigger) delete config.trigger;
      if (!config.provider) delete config.provider;
      if (!config.systemPrompt) delete config.systemPrompt;
      if (!config.command) delete config.command;
      if (!config.timeout) delete config.timeout;
      if (!config.maxLength) delete config.maxLength;

      setEditResponders(newResponders);
      setEditingResponder(null);
      setMode("list");
      setEditText("");

      // Update highlighted index to the new/edited responder
      const sortedNames = Object.keys(newResponders).sort();
      const newIndex = sortedNames.indexOf(editingResponder.name);
      if (newIndex >= 0) {
        setHighlightedIndex(newIndex);
      }
    }
  }, [editingResponder, editResponders]);

  // Cancel editing
  const handleCancel = useCallback(() => {
    setMode("list");
    setEditText("");
    setEditingResponder(null);
  }, []);

  // Handle text field submission
  const handleTextSubmit = useCallback(() => {
    if (!editingResponder) return;

    const trimmedValue = editText.trim();

    switch (mode) {
      case "edit-trigger":
        setEditingResponder({
          ...editingResponder,
          config: {
            ...editingResponder.config,
            trigger: trimmedValue || undefined,
          },
        });
        break;
      case "edit-provider":
        setEditingResponder({
          ...editingResponder,
          config: {
            ...editingResponder.config,
            provider: trimmedValue || undefined,
          },
        });
        break;
      case "edit-system":
        setEditingResponder({
          ...editingResponder,
          config: {
            ...editingResponder.config,
            systemPrompt: trimmedValue || undefined,
          },
        });
        break;
      case "edit-command":
        setEditingResponder({
          ...editingResponder,
          config: {
            ...editingResponder.config,
            command: trimmedValue || undefined,
          },
        });
        break;
      case "edit-timeout":
        setEditingResponder({
          ...editingResponder,
          config: {
            ...editingResponder.config,
            timeout: trimmedValue ? parseInt(trimmedValue, 10) || undefined : undefined,
          },
        });
        break;
      case "edit-maxlength":
        setEditingResponder({
          ...editingResponder,
          config: {
            ...editingResponder.config,
            maxLength: trimmedValue ? parseInt(trimmedValue, 10) || undefined : undefined,
          },
        });
        break;
    }

    setMode("edit-responder");
    setEditText("");
  }, [editingResponder, editText, mode]);

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
        onConfirm(editResponders);
      }
    },
    { isActive: isFocused && mode === "list" },
  );

  // Handle keyboard input for type selection
  useInput(
    (input, key) => {
      if (!isFocused || mode !== "select-type") return;

      if (input === "j" || key.downArrow) {
        setTypeIndex((prev) => (prev < RESPONDER_TYPES.length - 1 ? prev + 1 : 0));
      } else if (input === "k" || key.upArrow) {
        setTypeIndex((prev) => (prev > 0 ? prev - 1 : RESPONDER_TYPES.length - 1));
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
      const textModes: EditorMode[] = [
        "add-name",
        "edit-trigger",
        "edit-provider",
        "edit-system",
        "edit-command",
        "edit-timeout",
        "edit-maxlength",
      ];
      if (!isFocused || !textModes.includes(mode)) return;

      if (key.escape) {
        if (mode === "add-name") {
          handleCancel();
        } else {
          setMode("edit-responder");
          setEditText("");
        }
      }
    },
    {
      isActive:
        isFocused &&
        [
          "add-name",
          "edit-trigger",
          "edit-provider",
          "edit-system",
          "edit-command",
          "edit-timeout",
          "edit-maxlength",
        ].includes(mode),
    },
  );

  // Handle keyboard input for edit-responder mode (viewing a responder)
  useInput(
    (input, key) => {
      if (!isFocused || mode !== "edit-responder" || !editingResponder) return;

      if (key.escape) {
        handleCancel();
      } else if (input === "t" || input === "T") {
        // Edit type
        setTypeIndex(RESPONDER_TYPES.indexOf(editingResponder.config.type));
        setMode("select-type");
      } else if (input === "g" || input === "G") {
        // Edit trigger
        setEditText(editingResponder.config.trigger || "");
        setMode("edit-trigger");
      } else if (input === "p" || input === "P") {
        // Edit provider (only for llm type)
        if (editingResponder.config.type === "llm") {
          setEditText(editingResponder.config.provider || "");
          setMode("edit-provider");
        }
      } else if (input === "y" || input === "Y") {
        // Edit system prompt (only for llm type)
        if (editingResponder.config.type === "llm") {
          setEditText(editingResponder.config.systemPrompt || "");
          setMode("edit-system");
        }
      } else if (input === "c" || input === "C") {
        // Edit command (only for cli type)
        if (editingResponder.config.type === "cli") {
          setEditText(editingResponder.config.command || "");
          setMode("edit-command");
        }
      } else if (input === "o" || input === "O") {
        // Edit timeout
        setEditText(editingResponder.config.timeout?.toString() || "");
        setMode("edit-timeout");
      } else if (input === "l" || input === "L") {
        // Edit max length
        setEditText(editingResponder.config.maxLength?.toString() || "");
        setMode("edit-maxlength");
      } else if (input === "s" || input === "S") {
        // Save and close
        saveEditingResponder();
      }
    },
    { isActive: isFocused && mode === "edit-responder" },
  );

  // Render type selection mode
  if (mode === "select-type") {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Select Responder Type
          </Text>
          {editingResponder && <Text dimColor> for "{editingResponder.name}"</Text>}
        </Box>

        {RESPONDER_TYPES.map((type, index) => {
          const isHighlighted = index === typeIndex;
          return (
            <Box key={type}>
              <Text color={isHighlighted ? "cyan" : undefined}>
                {isHighlighted ? "▸ " : "  "}
              </Text>
              <Text bold={isHighlighted} color={isHighlighted ? "cyan" : undefined} inverse={isHighlighted}>
                {type}
              </Text>
              <Text dimColor> - {TYPE_DESCRIPTIONS[type]}</Text>
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
            Add New Responder
          </Text>
        </Box>

        <Box>
          <Text dimColor>Name: </Text>
          <TextInput
            value={editText}
            onChange={setEditText}
            onSubmit={handleNameSubmit}
            focus={isFocused}
            placeholder="e.g., qa, reviewer, code"
          />
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Suggested: {SUGGESTED_NAMES.join(", ")}</Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Enter: next | Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  // Render trigger input mode
  if (mode === "edit-trigger" && editingResponder) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Edit Trigger Pattern
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text dimColor>Use @name for mentions, leave empty for default handler</Text>
        </Box>

        <Box>
          <Text dimColor>Trigger: </Text>
          <TextInput
            value={editText}
            onChange={setEditText}
            onSubmit={handleTextSubmit}
            focus={isFocused}
            placeholder="e.g., @qa, @review (or empty for default)"
          />
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Enter: save | Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  // Render provider input mode
  if (mode === "edit-provider" && editingResponder) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Edit LLM Provider
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text dimColor>Name from llmProviders config (e.g., anthropic, openai)</Text>
        </Box>

        <Box>
          <Text dimColor>Provider: </Text>
          <TextInput
            value={editText}
            onChange={setEditText}
            onSubmit={handleTextSubmit}
            focus={isFocused}
            placeholder="e.g., anthropic"
          />
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Enter: save | Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  // Render system prompt input mode
  if (mode === "edit-system" && editingResponder) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Edit System Prompt
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text dimColor>Supports {"{{project}}"} placeholder for project context</Text>
        </Box>

        <Box>
          <Text dimColor>System: </Text>
          <TextInput
            value={editText}
            onChange={setEditText}
            onSubmit={handleTextSubmit}
            focus={isFocused}
            placeholder="You are a helpful assistant..."
          />
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Enter: save | Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  // Render command input mode
  if (mode === "edit-command" && editingResponder) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Edit CLI Command
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text dimColor>Supports {"{{message}}"} placeholder for the user message</Text>
        </Box>

        <Box>
          <Text dimColor>Command: </Text>
          <TextInput
            value={editText}
            onChange={setEditText}
            onSubmit={handleTextSubmit}
            focus={isFocused}
            placeholder="e.g., npm run lint"
          />
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Enter: save | Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  // Render timeout input mode
  if (mode === "edit-timeout" && editingResponder) {
    const defaultTimeout = DEFAULT_TIMEOUTS[editingResponder.config.type];
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Edit Timeout
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text dimColor>Timeout in milliseconds (default: {defaultTimeout})</Text>
        </Box>

        <Box>
          <Text dimColor>Timeout: </Text>
          <TextInput
            value={editText}
            onChange={setEditText}
            onSubmit={handleTextSubmit}
            focus={isFocused}
            placeholder={defaultTimeout.toString()}
          />
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Enter: save | Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  // Render max length input mode
  if (mode === "edit-maxlength" && editingResponder) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Edit Max Response Length
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text dimColor>Maximum characters to send back to chat (default: 2000)</Text>
        </Box>

        <Box>
          <Text dimColor>Max Length: </Text>
          <TextInput
            value={editText}
            onChange={setEditText}
            onSubmit={handleTextSubmit}
            focus={isFocused}
            placeholder="2000"
          />
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Enter: save | Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  // Render edit-responder mode (viewing/editing a single responder)
  if (mode === "edit-responder" && editingResponder) {
    const config = editingResponder.config;
    const isLLM = config.type === "llm";
    const isCLI = config.type === "cli";

    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Edit Responder: {editingResponder.name}
          </Text>
        </Box>

        <Box>
          <Text color="yellow">[T] Type: </Text>
          <Text>{config.type}</Text>
        </Box>

        <Box>
          <Text color="yellow">[G] Trigger: </Text>
          <Text dimColor={!config.trigger}>{config.trigger || "(default handler)"}</Text>
        </Box>

        {isLLM && (
          <>
            <Box>
              <Text color="yellow">[P] Provider: </Text>
              <Text dimColor={!config.provider}>{config.provider || "(not set)"}</Text>
            </Box>
            <Box>
              <Text color="yellow">[Y] System: </Text>
              <Text dimColor={!config.systemPrompt}>
                {config.systemPrompt
                  ? config.systemPrompt.length > 40
                    ? config.systemPrompt.substring(0, 40) + "..."
                    : config.systemPrompt
                  : "(not set)"}
              </Text>
            </Box>
          </>
        )}

        {isCLI && (
          <Box>
            <Text color="yellow">[C] Command: </Text>
            <Text dimColor={!config.command}>{config.command || "(not set)"}</Text>
          </Box>
        )}

        <Box>
          <Text color="yellow">[O] Timeout: </Text>
          <Text dimColor={!config.timeout}>{config.timeout || DEFAULT_TIMEOUTS[config.type]}ms</Text>
        </Box>

        <Box>
          <Text color="yellow">[L] Max Length: </Text>
          <Text dimColor={!config.maxLength}>{config.maxLength || 2000}</Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            [T]ype [G]trigger{isLLM ? " [P]rovider [Y]system" : ""}{isCLI ? " [C]ommand" : ""} [O]timeout [L]ength
          </Text>
          <Text dimColor>S: save | Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  // Calculate scroll indicators
  const canScrollUp = scrollOffset > 0;
  const canScrollDown = scrollOffset + visibleCount < responderNames.length;
  const hasOverflow = responderNames.length > visibleCount;

  // Render list mode
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {label}
        </Text>
        <Text dimColor> ({responderNames.length} responders)</Text>
      </Box>

      {/* Up scroll indicator */}
      {hasOverflow && (
        <Box>
          <Text color={canScrollUp ? "cyan" : "gray"} dimColor={!canScrollUp}>
            {canScrollUp ? "  ▲ more" : ""}
          </Text>
        </Box>
      )}

      {/* Responder list */}
      {responderNames.length === 0 ? (
        <Box marginBottom={1}>
          <Text dimColor italic>
            No responders configured
          </Text>
        </Box>
      ) : (
        visibleResponders.map((name) => {
          const actualIndex = responderNames.indexOf(name);
          const isHighlighted = actualIndex === highlightedIndex;
          const config = editResponders[name];

          // Format display: type abbreviation and trigger
          const typeAbbrev = config.type === "claude-code" ? "claude" : config.type;
          const trigger = config.trigger || "(default)";

          return (
            <Box key={name}>
              <Text color={isHighlighted ? "cyan" : undefined}>
                {isHighlighted ? "▸ " : "  "}
              </Text>
              <Text bold={isHighlighted} color={isHighlighted ? "cyan" : "yellow"} inverse={isHighlighted}>
                {name.padEnd(12)}
              </Text>
              <Text color="magenta">{typeAbbrev.padEnd(8)}</Text>
              <Text dimColor>{trigger}</Text>
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

      {/* Add responder option */}
      <Box>
        <Text color={highlightedIndex === responderNames.length ? "green" : undefined}>
          {highlightedIndex === responderNames.length ? "▸ " : "  "}
        </Text>
        <Text
          bold={highlightedIndex === responderNames.length}
          color={highlightedIndex === responderNames.length ? "green" : "gray"}
          inverse={highlightedIndex === responderNames.length}
        >
          + Add responder
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

export default RespondersEditor;
