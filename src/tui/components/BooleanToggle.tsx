import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";

export interface BooleanToggleProps {
  /** The label to display for this field */
  label: string;
  /** The current value of the boolean */
  value: boolean;
  /** Called when the user confirms the edit (Enter) */
  onConfirm: (newValue: boolean) => void;
  /** Called when the user cancels the edit (Esc) */
  onCancel: () => void;
  /** Whether this editor has focus */
  isFocused?: boolean;
}

/**
 * BooleanToggle component provides a toggle UI for boolean fields.
 * Space or arrow keys to toggle, Enter to confirm, Esc to cancel.
 */
export function BooleanToggle({
  label,
  value,
  onConfirm,
  onCancel,
  isFocused = true,
}: BooleanToggleProps): React.ReactElement {
  const [editValue, setEditValue] = useState(value);

  // Toggle the value
  const handleToggle = useCallback(() => {
    setEditValue((prev) => !prev);
  }, []);

  // Confirm the value
  const handleConfirm = useCallback(() => {
    onConfirm(editValue);
  }, [editValue, onConfirm]);

  // Handle keyboard input
  useInput(
    (input, key) => {
      if (!isFocused) return;

      // Space, left/right arrows, or 't'/'f' to toggle
      if (input === " " || key.leftArrow || key.rightArrow || input === "t" || input === "f") {
        if (input === "t") {
          setEditValue(true);
        } else if (input === "f") {
          setEditValue(false);
        } else {
          handleToggle();
        }
      } else if (key.return) {
        handleConfirm();
      } else if (key.escape) {
        onCancel();
      }
    },
    { isActive: isFocused },
  );

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Edit: {label}
        </Text>
      </Box>

      {/* Toggle UI */}
      <Box>
        <Text dimColor>{">"} </Text>
        {/* False option */}
        <Box marginRight={2}>
          <Text color={!editValue ? "red" : undefined} bold={!editValue} inverse={!editValue}>
            {!editValue ? " ● " : " ○ "}
          </Text>
          <Text color={!editValue ? "red" : "gray"} bold={!editValue}>
            false
          </Text>
        </Box>
        {/* True option */}
        <Box>
          <Text color={editValue ? "green" : undefined} bold={editValue} inverse={editValue}>
            {editValue ? " ● " : " ○ "}
          </Text>
          <Text color={editValue ? "green" : "gray"} bold={editValue}>
            true
          </Text>
        </Box>
      </Box>

      {/* Help text */}
      <Box marginTop={1}>
        <Text dimColor>Space/←/→: toggle | t/f: set | Enter: confirm | Esc: cancel</Text>
      </Box>
    </Box>
  );
}

export default BooleanToggle;
