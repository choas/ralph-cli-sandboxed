import React, { useState, useCallback, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

export interface ObjectEditorProps {
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
  /** Maximum height for the entries list (for scrolling) */
  maxHeight?: number;
}

type EditorMode = "list" | "add-key" | "add-value" | "edit-value";

/**
 * ObjectEditor component for editing key-value pairs.
 * Used for environment variables, mcpServers, actions, and similar objects.
 * Shows keys with expandable values, supports adding and deleting entries.
 * Supports scrolling for long lists with Page Up/Down.
 */
export function ObjectEditor({
  label,
  entries,
  onConfirm,
  onCancel,
  isFocused = true,
  maxHeight = 10,
}: ObjectEditorProps): React.ReactElement {
  const [editEntries, setEditEntries] = useState<Record<string, string>>({ ...entries });
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [mode, setMode] = useState<EditorMode>("list");
  const [editText, setEditText] = useState("");
  const [newKey, setNewKey] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // Get sorted keys for consistent ordering
  const keys = Object.keys(editEntries).sort();
  // Total options includes all keys plus "+ Add entry" option
  const totalOptions = keys.length + 1;

  // Auto-scroll to keep highlighted item visible
  useEffect(() => {
    if (highlightedIndex < scrollOffset) {
      setScrollOffset(highlightedIndex);
    } else if (highlightedIndex >= scrollOffset + maxHeight) {
      setScrollOffset(highlightedIndex - maxHeight + 1);
    }
  }, [highlightedIndex, scrollOffset, maxHeight]);

  // Navigation handlers
  const handleNavigateUp = useCallback(() => {
    setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : totalOptions - 1));
  }, [totalOptions]);

  const handleNavigateDown = useCallback(() => {
    setHighlightedIndex((prev) => (prev < totalOptions - 1 ? prev + 1 : 0));
  }, [totalOptions]);

  const handlePageUp = useCallback(() => {
    const newIndex = Math.max(0, highlightedIndex - maxHeight);
    setHighlightedIndex(newIndex);
  }, [highlightedIndex, maxHeight]);

  const handlePageDown = useCallback(() => {
    const newIndex = Math.min(totalOptions - 1, highlightedIndex + maxHeight);
    setHighlightedIndex(newIndex);
  }, [highlightedIndex, maxHeight, totalOptions]);

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
    } else {
      // Add new entry - start with key input
      setEditText("");
      setNewKey("");
      setMode("add-key");
    }
  }, [highlightedIndex, keys, editEntries]);

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

  // Handle keyboard input for list mode
  useInput(
    (input, key) => {
      if (!isFocused || mode !== "list") return;

      // j/k or arrow keys for navigation
      if (input === "j" || key.downArrow) {
        handleNavigateDown();
      } else if (input === "k" || key.upArrow) {
        handleNavigateUp();
      } else if (key.pageUp) {
        handlePageUp();
      } else if (key.pageDown) {
        handlePageDown();
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
    { isActive: isFocused && mode === "list" }
  );

  // Handle keyboard input for text editing modes
  useInput(
    (_input, key) => {
      if (!isFocused || mode === "list") return;

      if (key.escape) {
        handleTextCancel();
      }
    },
    { isActive: isFocused && mode !== "list" }
  );

  // Calculate visible items based on scroll offset
  const visibleItems = useMemo(() => {
    const allKeys = [...keys, "__add_entry__"];
    const endIndex = Math.min(scrollOffset + maxHeight, allKeys.length);
    return allKeys.slice(scrollOffset, endIndex);
  }, [keys, scrollOffset, maxHeight]);

  // Check if we have overflow
  const canScrollUp = scrollOffset > 0;
  const canScrollDown = scrollOffset + maxHeight < totalOptions;
  const hasOverflow = totalOptions > maxHeight;

  // Render key input mode
  if (mode === "add-key") {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        {/* Header */}
        <Box marginBottom={1}>
          <Text bold color="cyan">Add New Entry - Enter Key</Text>
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

        {/* Help text */}
        <Box marginTop={1}>
          <Text dimColor>Enter: next | Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  // Render value input mode (for add or edit)
  if (mode === "add-value" || mode === "edit-value") {
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

  // Render list mode
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">Edit: {label}</Text>
        <Text dimColor> ({keys.length} entries)</Text>
        {hasOverflow && (
          <Text dimColor> [{highlightedIndex + 1}/{totalOptions}]</Text>
        )}
      </Box>

      {/* Up scroll indicator */}
      {hasOverflow && (
        <Box>
          <Text color={canScrollUp ? "cyan" : "gray"} dimColor={!canScrollUp}>
            {canScrollUp ? "  ▲ more" : ""}
          </Text>
        </Box>
      )}

      {/* Visible entries list */}
      {keys.length === 0 && scrollOffset === 0 ? (
        <Box marginBottom={1}>
          <Text dimColor italic>No entries</Text>
        </Box>
      ) : (
        visibleItems.map((key, visibleIndex) => {
          // Check if this is the "Add entry" option
          if (key === "__add_entry__") {
            const actualIndex = keys.length;
            const isHighlighted = actualIndex === highlightedIndex;

            return (
              <Box key="add-entry">
                <Text color={isHighlighted ? "green" : undefined}>
                  {isHighlighted ? "▸ " : "  "}
                </Text>
                <Text dimColor>{"  "}</Text>
                <Text
                  bold={isHighlighted}
                  color={isHighlighted ? "green" : "gray"}
                  inverse={isHighlighted}
                >
                  + Add entry
                </Text>
              </Box>
            );
          }

          // Regular entry
          const actualIndex = scrollOffset + visibleIndex;
          const isHighlighted = actualIndex === highlightedIndex;
          const isExpanded = expandedKeys.has(key);
          const value = editEntries[key];

          return (
            <Box key={`entry-${key}`} flexDirection="column">
              <Box>
                {/* Selection indicator */}
                <Text color={isHighlighted ? "cyan" : undefined}>
                  {isHighlighted ? "▸ " : "  "}
                </Text>
                {/* Expand indicator */}
                <Text dimColor>
                  {isExpanded ? "▼ " : "▶ "}
                </Text>
                {/* Key name */}
                <Text
                  bold={isHighlighted}
                  color={isHighlighted ? "cyan" : "yellow"}
                  inverse={isHighlighted}
                >
                  {key}
                </Text>
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

      {/* Down scroll indicator */}
      {hasOverflow && (
        <Box>
          <Text color={canScrollDown ? "cyan" : "gray"} dimColor={!canScrollDown}>
            {canScrollDown ? "  ▼ more" : ""}
          </Text>
        </Box>
      )}

      {/* Help text */}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>j/k: navigate | Tab/Space: expand | Enter/e: edit</Text>
        <Text dimColor>d: delete | s: save | Esc: cancel{hasOverflow && " | PgUp/Dn: scroll"}</Text>
      </Box>
    </Box>
  );
}

export default ObjectEditor;
