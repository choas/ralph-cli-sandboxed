import React from "react";
import { Box, Text, useInput } from "ink";

/**
 * Keyboard shortcut definition.
 */
interface Shortcut {
  keys: string;
  description: string;
}

/**
 * Group of related shortcuts.
 */
interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

/**
 * All keyboard shortcuts organized by category.
 */
const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: "j / ↓", description: "Move down" },
      { keys: "k / ↑", description: "Move up" },
      { keys: "h / ←", description: "Move to nav panel" },
      { keys: "l / →", description: "Move to editor panel" },
      { keys: "Enter", description: "Select / Edit" },
      { keys: "Esc", description: "Go back / Cancel" },
    ],
  },
  {
    title: "Actions",
    shortcuts: [
      { keys: "S", description: "Save configuration" },
      { keys: "Q", description: "Quit editor" },
      { keys: "Tab", description: "Toggle JSON preview" },
      { keys: "?", description: "Toggle this help panel" },
    ],
  },
  {
    title: "Array Editor",
    shortcuts: [
      { keys: "e / Enter", description: "Edit selected item" },
      { keys: "d / Delete", description: "Delete selected item" },
      { keys: "J (Shift+j)", description: "Move item down" },
      { keys: "K (Shift+k)", description: "Move item up" },
      { keys: "s", description: "Save changes" },
    ],
  },
  {
    title: "Object Editor",
    shortcuts: [
      { keys: "Space / Tab", description: "Expand/collapse value" },
      { keys: "e / Enter", description: "Edit key-value pair" },
      { keys: "d / Delete", description: "Delete entry" },
      { keys: "s", description: "Save changes" },
    ],
  },
];

export interface HelpPanelProps {
  /** Whether the help panel is visible */
  visible: boolean;
  /** Callback to close the help panel */
  onClose: () => void;
}

/**
 * HelpPanel displays all keyboard shortcuts for the config editor.
 * Toggle with the ? key.
 */
export function HelpPanel({
  visible,
  onClose,
}: HelpPanelProps): React.ReactElement | null {
  // Handle keyboard input to close help
  useInput(
    (input, key) => {
      if (input === "?" || key.escape) {
        onClose();
      }
    },
    { isActive: visible }
  );

  if (!visible) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      {/* Header */}
      <Box marginBottom={1} justifyContent="center">
        <Text bold color="cyan">
          Keyboard Shortcuts
        </Text>
      </Box>

      {/* Shortcut groups */}
      <Box flexDirection="row" gap={4}>
        {SHORTCUT_GROUPS.map((group, groupIndex) => (
          <Box key={groupIndex} flexDirection="column" marginRight={2}>
            <Text bold color="yellow" underline>
              {group.title}
            </Text>
            <Box marginTop={1} flexDirection="column">
              {group.shortcuts.map((shortcut, index) => (
                <Box key={index}>
                  <Box width={16}>
                    <Text color="green">{shortcut.keys}</Text>
                  </Box>
                  <Text>{shortcut.description}</Text>
                </Box>
              ))}
            </Box>
          </Box>
        ))}
      </Box>

      {/* Footer */}
      <Box marginTop={1} justifyContent="center">
        <Text dimColor>Press ? or Esc to close</Text>
      </Box>
    </Box>
  );
}

export default HelpPanel;
