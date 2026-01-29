import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { ConfigPreset } from "../utils/presets.js";
import { getPresetsForSection, detectActivePreset } from "../utils/presets.js";
import type { RalphConfig } from "../../utils/config.js";

export interface PresetSelectorProps {
  /** The section ID to show presets for */
  sectionId: string;
  /** Current configuration (to detect active preset) */
  config: RalphConfig;
  /** Called when a preset is selected */
  onSelectPreset: (preset: ConfigPreset) => void;
  /** Called when user skips preset selection */
  onSkip: () => void;
  /** Called when user cancels */
  onCancel: () => void;
  /** Whether this component has focus */
  isFocused?: boolean;
}

/**
 * PresetSelector component displays available presets for a config section.
 * Allows the user to quickly apply a preset template or skip to manual editing.
 */
export function PresetSelector({
  sectionId,
  config,
  onSelectPreset,
  onSkip,
  onCancel,
  isFocused = true,
}: PresetSelectorProps): React.ReactElement {
  const presets = useMemo(() => getPresetsForSection(sectionId), [sectionId]);
  const activePresetId = useMemo(() => detectActivePreset(config, sectionId), [config, sectionId]);

  // Include "Skip" option at the end
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const totalOptions = presets.length + 1; // +1 for "Skip" option

  // Navigation handlers
  const handleNavigateUp = useCallback(() => {
    setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : totalOptions - 1));
  }, [totalOptions]);

  const handleNavigateDown = useCallback(() => {
    setHighlightedIndex((prev) => (prev < totalOptions - 1 ? prev + 1 : 0));
  }, [totalOptions]);

  const handleSelect = useCallback(() => {
    if (highlightedIndex < presets.length) {
      const preset = presets[highlightedIndex];
      onSelectPreset(preset);
    } else {
      // Skip option selected
      onSkip();
    }
  }, [highlightedIndex, presets, onSelectPreset, onSkip]);

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
      } else if (key.escape) {
        onCancel();
      }
    },
    { isActive: isFocused }
  );

  // Get section title for display
  const sectionTitle = sectionId.charAt(0).toUpperCase() + sectionId.slice(1);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">Use Preset: {sectionTitle}</Text>
      </Box>

      {/* Description */}
      <Box marginBottom={1}>
        <Text dimColor>
          Select a preset to auto-fill common settings, or skip to configure manually.
        </Text>
      </Box>

      {/* Preset options */}
      {presets.map((preset, index) => {
        const isHighlighted = index === highlightedIndex;
        const isActive = preset.id === activePresetId;

        return (
          <Box key={preset.id} flexDirection="column">
            <Box>
              {/* Selection indicator */}
              <Text color={isHighlighted ? "cyan" : undefined}>
                {isHighlighted ? "▸ " : "  "}
              </Text>
              {/* Preset name */}
              <Text
                bold={isHighlighted}
                color={isHighlighted ? "cyan" : isActive ? "green" : undefined}
                inverse={isHighlighted}
              >
                {preset.name}
              </Text>
              {/* Active indicator */}
              {isActive && <Text color="green"> (active)</Text>}
            </Box>
            {/* Description - shown below the name */}
            <Box marginLeft={4}>
              <Text dimColor>{preset.description}</Text>
            </Box>
          </Box>
        );
      })}

      {/* Skip option */}
      <Box marginTop={1}>
        <Text color={highlightedIndex === presets.length ? "cyan" : undefined}>
          {highlightedIndex === presets.length ? "▸ " : "  "}
        </Text>
        <Text
          bold={highlightedIndex === presets.length}
          color={highlightedIndex === presets.length ? "yellow" : "gray"}
          inverse={highlightedIndex === presets.length}
        >
          Skip - Configure manually
        </Text>
      </Box>

      {/* Navigation hints */}
      <Box marginTop={1}>
        <Text dimColor>j/k: navigate | Enter: select | Esc: back</Text>
      </Box>
    </Box>
  );
}

export default PresetSelector;
