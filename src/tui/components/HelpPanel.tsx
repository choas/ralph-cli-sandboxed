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
      { keys: "PgUp / PgDn", description: "Scroll page up/down" },
      { keys: "Enter", description: "Select / Edit" },
      { keys: "J", description: "Edit as JSON (complex fields)" },
      { keys: "Esc", description: "Go back / Cancel" },
    ],
  },
  {
    title: "Actions",
    shortcuts: [
      { keys: "S", description: "Save configuration" },
      { keys: "Q", description: "Quit editor" },
      { keys: "Tab", description: "Toggle JSON preview" },
      { keys: "p", description: "Open presets (Chat/Notifications)" },
      { keys: "?", description: "Toggle this help panel" },
    ],
  },
  {
    title: "JSON Editor",
    shortcuts: [
      { keys: "e / Enter", description: "Enter edit mode" },
      { keys: "s", description: "Save changes" },
      { keys: "c", description: "Copy to clipboard" },
      { keys: "f", description: "Format JSON" },
      { keys: "j/k", description: "Scroll preview" },
      { keys: "PgUp / PgDn", description: "Page scroll" },
      { keys: "Esc", description: "Cancel" },
    ],
  },
  {
    title: "Array/Object Editor",
    shortcuts: [
      { keys: "e / Enter", description: "Edit selected item" },
      { keys: "d / Delete", description: "Delete item/entry" },
      { keys: "Space / Tab", description: "Expand (objects)" },
      { keys: "J/K (Shift)", description: "Reorder (arrays)" },
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
