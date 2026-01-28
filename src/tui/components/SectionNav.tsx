import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";

/**
 * Configuration section definition for navigation tree.
 */
export interface ConfigSection {
  id: string;
  label: string;
  icon?: string;
  fields: string[];  // Field paths within this section (e.g., ["language", "checkCommand"])
}

/**
 * Default sections for ralph configuration.
 * Each section groups related configuration fields.
 */
export const CONFIG_SECTIONS: ConfigSection[] = [
  {
    id: "basic",
    label: "Basic",
    icon: "⚙",
    fields: ["language", "checkCommand", "testCommand", "imageName", "technologies", "javaVersion"],
  },
  {
    id: "docker",
    label: "Docker",
    icon: "🐳",
    fields: ["docker.ports", "docker.volumes", "docker.environment", "docker.packages", "docker.git", "docker.buildCommands", "docker.startCommand", "docker.firewall", "docker.autoStart", "docker.restartCount"],
  },
  {
    id: "daemon",
    label: "Daemon",
    icon: "👹",
    fields: ["daemon.enabled", "daemon.actions", "daemon.events"],
  },
  {
    id: "claude",
    label: "Claude",
    icon: "🤖",
    fields: ["claude.mcpServers", "claude.skills"],
  },
  {
    id: "chat",
    label: "Chat",
    icon: "💬",
    fields: ["chat.enabled", "chat.provider", "chat.telegram"],
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: "🔔",
    fields: ["notifications.provider", "notifications.ntfy", "notifications.command", "notifyCommand"],
  },
];

export interface SectionNavProps {
  /** Currently selected section ID */
  selectedSection: string;
  /** Callback when section is selected */
  onSelectSection: (sectionId: string) => void;
  /** Whether this component has focus for keyboard input */
  isFocused?: boolean;
}

/**
 * SectionNav component provides a vertical navigation menu for config sections.
 * Supports j/k keyboard navigation and Enter to select.
 */
export function SectionNav({
  selectedSection,
  onSelectSection,
  isFocused = true,
}: SectionNavProps): React.ReactElement {
  const [highlightedIndex, setHighlightedIndex] = useState(() => {
    const idx = CONFIG_SECTIONS.findIndex((s) => s.id === selectedSection);
    return idx >= 0 ? idx : 0;
  });

  // Sync highlighted index when selectedSection changes externally
  useEffect(() => {
    const idx = CONFIG_SECTIONS.findIndex((s) => s.id === selectedSection);
    if (idx >= 0) {
      setHighlightedIndex(idx);
    }
  }, [selectedSection]);

  const handleNavigateUp = useCallback(() => {
    setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : CONFIG_SECTIONS.length - 1));
  }, []);

  const handleNavigateDown = useCallback(() => {
    setHighlightedIndex((prev) => (prev < CONFIG_SECTIONS.length - 1 ? prev + 1 : 0));
  }, []);

  const handleSelect = useCallback(() => {
    const section = CONFIG_SECTIONS[highlightedIndex];
    if (section) {
      onSelectSection(section.id);
    }
  }, [highlightedIndex, onSelectSection]);

  // Handle keyboard input
  useInput(
    (input, key) => {
      if (!isFocused) return;

      // j/k or arrow keys for navigation
      if (input === "j" || key.downArrow) {
        handleNavigateDown();
      } else if (input === "k" || key.upArrow) {
        handleNavigateUp();
      } else if (key.return) {
        handleSelect();
      }
    },
    { isActive: isFocused }
  );

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Sections
        </Text>
      </Box>
      {CONFIG_SECTIONS.map((section, index) => {
        const isHighlighted = index === highlightedIndex;
        const isSelected = section.id === selectedSection;

        return (
          <Box key={section.id}>
            {/* Selection indicator */}
            <Text color={isHighlighted ? "cyan" : undefined}>
              {isHighlighted ? "▸ " : "  "}
            </Text>
            {/* Section label */}
            <Text
              bold={isSelected}
              color={isHighlighted ? "cyan" : isSelected ? "green" : undefined}
              inverse={isHighlighted}
            >
              {section.label}
            </Text>
          </Box>
        );
      })}
      {/* Navigation hints */}
      <Box marginTop={1}>
        <Text dimColor>j/k: navigate</Text>
      </Box>
      <Box>
        <Text dimColor>Enter: select</Text>
      </Box>
    </Box>
  );
}

export default SectionNav;
