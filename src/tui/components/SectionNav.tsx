import React, { useState, useCallback, useEffect, useMemo } from "react";
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
    fields: ["chat.enabled", "chat.provider", "chat.telegram", "chat.slack"],
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: "🔔",
    fields: ["notifications.provider", "notifications.ntfy", "notifications.pushover", "notifications.gotify", "notifications.command", "notifyCommand"],
  },
];

export interface SectionNavProps {
  /** Currently selected section ID */
  selectedSection: string;
  /** Callback when section is selected */
  onSelectSection: (sectionId: string) => void;
  /** Whether this component has focus for keyboard input */
  isFocused?: boolean;
  /** Maximum height for the navigation list (for scrolling) */
  maxHeight?: number;
}

/**
 * SectionNav component provides a vertical navigation menu for config sections.
 * Supports j/k keyboard navigation, Enter to select, and Page Up/Down for scrolling.
 */
export function SectionNav({
  selectedSection,
  onSelectSection,
  isFocused = true,
  maxHeight = 10,
}: SectionNavProps): React.ReactElement {
  const [highlightedIndex, setHighlightedIndex] = useState(() => {
    const idx = CONFIG_SECTIONS.findIndex((s) => s.id === selectedSection);
    return idx >= 0 ? idx : 0;
  });
  const [scrollOffset, setScrollOffset] = useState(0);

  const totalSections = CONFIG_SECTIONS.length;

  // Sync highlighted index when selectedSection changes externally
  useEffect(() => {
    const idx = CONFIG_SECTIONS.findIndex((s) => s.id === selectedSection);
    if (idx >= 0) {
      setHighlightedIndex(idx);
    }
  }, [selectedSection]);

  // Auto-scroll to keep highlighted item visible
  useEffect(() => {
    if (highlightedIndex < scrollOffset) {
      setScrollOffset(highlightedIndex);
    } else if (highlightedIndex >= scrollOffset + maxHeight) {
      setScrollOffset(highlightedIndex - maxHeight + 1);
    }
  }, [highlightedIndex, scrollOffset, maxHeight]);

  const handleNavigateUp = useCallback(() => {
    setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : totalSections - 1));
  }, [totalSections]);

  const handleNavigateDown = useCallback(() => {
    setHighlightedIndex((prev) => (prev < totalSections - 1 ? prev + 1 : 0));
  }, [totalSections]);

  const handlePageUp = useCallback(() => {
    const newIndex = Math.max(0, highlightedIndex - maxHeight);
    setHighlightedIndex(newIndex);
  }, [highlightedIndex, maxHeight]);

  const handlePageDown = useCallback(() => {
    const newIndex = Math.min(totalSections - 1, highlightedIndex + maxHeight);
    setHighlightedIndex(newIndex);
  }, [highlightedIndex, maxHeight, totalSections]);

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
      } else if (key.pageUp) {
        handlePageUp();
      } else if (key.pageDown) {
        handlePageDown();
      } else if (key.return) {
        handleSelect();
      }
    },
    { isActive: isFocused }
  );

  // Calculate visible sections based on scroll offset
  const visibleSections = useMemo(() => {
    const endIndex = Math.min(scrollOffset + maxHeight, totalSections);
    return CONFIG_SECTIONS.slice(scrollOffset, endIndex);
  }, [scrollOffset, maxHeight, totalSections]);

  // Check if we have overflow
  const canScrollUp = scrollOffset > 0;
  const canScrollDown = scrollOffset + maxHeight < totalSections;
  const hasOverflow = totalSections > maxHeight;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Sections
        </Text>
      </Box>

      {/* Up scroll indicator */}
      {hasOverflow && (
        <Box>
          <Text color={canScrollUp ? "cyan" : "gray"} dimColor={!canScrollUp}>
            {canScrollUp ? "  ▲ more" : ""}
          </Text>
        </Box>
      )}

      {/* Visible sections */}
      {visibleSections.map((section) => {
        const actualIndex = CONFIG_SECTIONS.findIndex((s) => s.id === section.id);
        const isHighlighted = actualIndex === highlightedIndex;
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

      {/* Down scroll indicator */}
      {hasOverflow && (
        <Box>
          <Text color={canScrollDown ? "cyan" : "gray"} dimColor={!canScrollDown}>
            {canScrollDown ? "  ▼ more" : ""}
          </Text>
        </Box>
      )}

      {/* Navigation hints */}
      <Box marginTop={1}>
        <Text dimColor>j/k: navigate</Text>
      </Box>
      <Box>
        <Text dimColor>Enter: select</Text>
      </Box>
      {hasOverflow && (
        <Box>
          <Text dimColor>PgUp/Dn: scroll</Text>
        </Box>
      )}
    </Box>
  );
}

export default SectionNav;
