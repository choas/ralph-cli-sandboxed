import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

export interface StringEditorProps {
  /** The label to display for this field */
  label: string;
  /** The current value of the string */
  value: string;
  /** Called when the user confirms the edit (Enter) */
  onConfirm: (newValue: string) => void;
  /** Called when the user cancels the edit (Esc) */
  onCancel: () => void;
  /** Optional placeholder text */
  placeholder?: string;
  /** Whether this editor has focus */
  isFocused?: boolean;
}

/**
 * StringEditor component provides an inline text editor for string fields.
 * Uses ink-text-input for text editing with Enter to confirm and Esc to cancel.
 */
export function StringEditor({
  label,
  value,
  onConfirm,
  onCancel,
  placeholder = "",
  isFocused = true,
}: StringEditorProps): React.ReactElement {
  const [editValue, setEditValue] = useState(value);

  // Handle text input changes
  const handleChange = useCallback((newValue: string) => {
    setEditValue(newValue);
  }, []);

  // Handle submit (Enter key in TextInput)
  const handleSubmit = useCallback(() => {
    onConfirm(editValue);
  }, [editValue, onConfirm]);

  // Handle keyboard input for Esc key
  useInput(
    (_input, key) => {
      if (!isFocused) return;

      if (key.escape) {
        onCancel();
      }
    },
    { isActive: isFocused }
  );

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">Edit: {label}</Text>
      </Box>

      {/* Input field */}
      <Box>
        <Text dimColor>{">"} </Text>
        <TextInput
          value={editValue}
          onChange={handleChange}
          onSubmit={handleSubmit}
          placeholder={placeholder}
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

export default StringEditor;
