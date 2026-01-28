import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

export interface ArrayEditorProps {
  /** The label to display for this array field */
  label: string;
  /** The current array items */
  items: string[];
  /** Called when the user confirms the edit (Enter) */
  onConfirm: (newItems: string[]) => void;
  /** Called when the user cancels the edit (Esc) */
  onCancel: () => void;
  /** Whether this editor has focus */
  isFocused?: boolean;
}

type EditorMode = "list" | "add" | "edit";

/**
 * ArrayEditor component for editing arrays of strings.
 * Shows numbered list with edit/delete options.
 * Supports adding new items and reordering with move up/down keys.
 */
export function ArrayEditor({
  label,
  items,
  onConfirm,
  onCancel,
  isFocused = true,
}: ArrayEditorProps): React.ReactElement {
  const [editItems, setEditItems] = useState<string[]>([...items]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [mode, setMode] = useState<EditorMode>("list");
  const [editText, setEditText] = useState("");
  const [editingIndex, setEditingIndex] = useState(-1);

  // Total items including "+ Add item" option
  const totalOptions = editItems.length + 1;

  // Navigation handlers
  const handleNavigateUp = useCallback(() => {
    setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : totalOptions - 1));
  }, [totalOptions]);

  const handleNavigateDown = useCallback(() => {
    setHighlightedIndex((prev) => (prev < totalOptions - 1 ? prev + 1 : 0));
  }, [totalOptions]);

  // Move item up in the list
  const handleMoveUp = useCallback(() => {
    if (highlightedIndex > 0 && highlightedIndex < editItems.length) {
      const newItems = [...editItems];
      const temp = newItems[highlightedIndex - 1];
      newItems[highlightedIndex - 1] = newItems[highlightedIndex];
      newItems[highlightedIndex] = temp;
      setEditItems(newItems);
      setHighlightedIndex(highlightedIndex - 1);
    }
  }, [highlightedIndex, editItems]);

  // Move item down in the list
  const handleMoveDown = useCallback(() => {
    if (highlightedIndex < editItems.length - 1) {
      const newItems = [...editItems];
      const temp = newItems[highlightedIndex + 1];
      newItems[highlightedIndex + 1] = newItems[highlightedIndex];
      newItems[highlightedIndex] = temp;
      setEditItems(newItems);
      setHighlightedIndex(highlightedIndex + 1);
    }
  }, [highlightedIndex, editItems]);

  // Delete the highlighted item
  const handleDelete = useCallback(() => {
    if (highlightedIndex < editItems.length) {
      const newItems = editItems.filter((_, i) => i !== highlightedIndex);
      setEditItems(newItems);
      // Adjust highlighted index if needed
      if (highlightedIndex >= newItems.length && newItems.length > 0) {
        setHighlightedIndex(newItems.length - 1);
      } else if (newItems.length === 0) {
        setHighlightedIndex(0);
      }
    }
  }, [highlightedIndex, editItems]);

  // Start editing an item
  const handleStartEdit = useCallback(() => {
    if (highlightedIndex < editItems.length) {
      setEditText(editItems[highlightedIndex]);
      setEditingIndex(highlightedIndex);
      setMode("edit");
    } else {
      // Add new item
      setEditText("");
      setMode("add");
    }
  }, [highlightedIndex, editItems]);

  // Confirm edit/add
  const handleTextSubmit = useCallback(() => {
    const trimmedText = editText.trim();
    if (trimmedText) {
      if (mode === "add") {
        setEditItems([...editItems, trimmedText]);
        setHighlightedIndex(editItems.length);
      } else if (mode === "edit") {
        const newItems = [...editItems];
        newItems[editingIndex] = trimmedText;
        setEditItems(newItems);
      }
    }
    setMode("list");
    setEditText("");
    setEditingIndex(-1);
  }, [editText, mode, editItems, editingIndex]);

  // Cancel edit/add
  const handleTextCancel = useCallback(() => {
    setMode("list");
    setEditText("");
    setEditingIndex(-1);
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
      } else if (key.return || input === "e") {
        // Enter or 'e' to edit/add
        handleStartEdit();
      } else if (input === "d" || key.delete) {
        // 'd' or Delete to remove
        handleDelete();
      } else if (input === "K" || (key.shift && key.upArrow)) {
        // Shift+K or Shift+Up to move up
        handleMoveUp();
      } else if (input === "J" || (key.shift && key.downArrow)) {
        // Shift+J or Shift+Down to move down
        handleMoveDown();
      } else if (key.escape) {
        onCancel();
      } else if (input === "s" || input === "S") {
        // 's' to save and confirm
        onConfirm(editItems);
      }
    },
    { isActive: isFocused && mode === "list" }
  );

  // Handle keyboard input for text editing mode
  useInput(
    (_input, key) => {
      if (!isFocused || mode === "list") return;

      if (key.escape) {
        handleTextCancel();
      }
    },
    { isActive: isFocused && mode !== "list" }
  );

  // Render text input mode (add or edit)
  if (mode === "add" || mode === "edit") {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        {/* Header */}
        <Box marginBottom={1}>
          <Text bold color="cyan">
            {mode === "add" ? "Add New Item" : `Edit Item ${editingIndex + 1}`}
          </Text>
        </Box>

        {/* Input field */}
        <Box>
          <Text dimColor>{">"} </Text>
          <TextInput
            value={editText}
            onChange={setEditText}
            onSubmit={handleTextSubmit}
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
        <Text dimColor> ({editItems.length} items)</Text>
      </Box>

      {/* Items list */}
      {editItems.length === 0 ? (
        <Box marginBottom={1}>
          <Text dimColor italic>No items</Text>
        </Box>
      ) : (
        editItems.map((item, index) => {
          const isHighlighted = index === highlightedIndex;

          return (
            <Box key={`item-${index}`}>
              {/* Selection indicator */}
              <Text color={isHighlighted ? "cyan" : undefined}>
                {isHighlighted ? "▸ " : "  "}
              </Text>
              {/* Item number */}
              <Text dimColor>{String(index + 1).padStart(2, " ")}. </Text>
              {/* Item value */}
              <Text
                bold={isHighlighted}
                color={isHighlighted ? "cyan" : undefined}
                inverse={isHighlighted}
              >
                {item}
              </Text>
            </Box>
          );
        })
      )}

      {/* Add item option */}
      <Box>
        <Text color={highlightedIndex === editItems.length ? "green" : undefined}>
          {highlightedIndex === editItems.length ? "▸ " : "  "}
        </Text>
        <Text
          bold={highlightedIndex === editItems.length}
          color={highlightedIndex === editItems.length ? "green" : "gray"}
          inverse={highlightedIndex === editItems.length}
        >
          + Add item
        </Text>
      </Box>

      {/* Help text */}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>j/k: navigate | Enter/e: edit | d: delete</Text>
        <Text dimColor>J/K: reorder | s: save | Esc: cancel</Text>
      </Box>
    </Box>
  );
}

export default ArrayEditor;
