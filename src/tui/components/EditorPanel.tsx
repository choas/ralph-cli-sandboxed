import React, { useState, useCallback, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { RalphConfig } from "../../utils/config.js";
import { CONFIG_SECTIONS, type ConfigSection } from "./SectionNav.js";
import type { ValidationError } from "../utils/validation.js";
import { getFieldErrors, hasFieldError } from "../utils/validation.js";

/**
 * Field types for determining which editor to render.
 */
export type FieldType = "string" | "boolean" | "number" | "array" | "object" | "unknown";

/**
 * Field schema describes a configuration field for editing.
 */
export interface FieldSchema {
  path: string;           // Dot-notation path (e.g., "docker.ports")
  label: string;          // Human-readable label
  type: FieldType;        // Type of field
  description?: string;   // Optional description
  required?: boolean;     // Whether field is required
}

/**
 * Get the value at a dot-notation path from an object.
 */
export function getValueAtPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Determine the type of a field based on its current value.
 */
export function inferFieldType(value: unknown): FieldType {
  if (value === null || value === undefined) {
    return "unknown";
  }
  if (typeof value === "string") {
    return "string";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "number") {
    return "number";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "object") {
    return "object";
  }
  return "unknown";
}

/**
 * Get the display value for a field.
 */
function getDisplayValue(value: unknown, type: FieldType): string {
  if (value === undefined || value === null) {
    return "(not set)";
  }

  switch (type) {
    case "string":
      return value as string || "(empty)";
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return String(value);
    case "array":
      const arr = value as unknown[];
      return `[${arr.length} items]`;
    case "object":
      const keys = Object.keys(value as object);
      return `{${keys.length} keys}`;
    default:
      return String(value);
  }
}

/**
 * Convert a field path to a human-readable label.
 */
function pathToLabel(path: string): string {
  const parts = path.split(".");
  const lastPart = parts[parts.length - 1];
  // Convert camelCase to Title Case with spaces
  return lastPart
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

export interface EditorPanelProps {
  /** The current configuration */
  config: RalphConfig | null;
  /** Currently selected section ID */
  selectedSection: string;
  /** Currently selected field path (for nested editing) */
  selectedField?: string;
  /** Callback when a field is selected for editing (useJsonEditor=true for J shortcut) */
  onSelectField: (fieldPath: string, useJsonEditor?: boolean) => void;
  /** Callback when navigating back (Esc) */
  onBack: () => void;
  /** Whether this component has focus for keyboard input */
  isFocused?: boolean;
  /** Validation errors to display inline */
  validationErrors?: ValidationError[];
  /** Maximum height for the fields list (for scrolling) */
  maxHeight?: number;
}

/**
 * EditorPanel component displays fields for the selected config section.
 * It shows a breadcrumb of the current path and lists editable fields.
 * Supports scrolling for long content with Page Up/Down and scroll indicators.
 */
export function EditorPanel({
  config,
  selectedSection,
  selectedField,
  onSelectField,
  onBack,
  isFocused = true,
  validationErrors = [],
  maxHeight = 12,
}: EditorPanelProps): React.ReactElement {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Get the current section definition
  const currentSection = useMemo(() => {
    return CONFIG_SECTIONS.find((s) => s.id === selectedSection);
  }, [selectedSection]);

  // Build field schemas from section definition
  const fields = useMemo((): FieldSchema[] => {
    if (!currentSection || !config) {
      return [];
    }

    return currentSection.fields.map((fieldPath) => {
      const value = getValueAtPath(config, fieldPath);
      const type = inferFieldType(value);

      return {
        path: fieldPath,
        label: pathToLabel(fieldPath),
        type,
      };
    });
  }, [currentSection, config]);

  const totalFields = fields.length;

  // Reset highlighted index and scroll when section changes
  useEffect(() => {
    setHighlightedIndex(0);
    setScrollOffset(0);
  }, [selectedSection]);

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
    setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : totalFields - 1));
  }, [totalFields]);

  const handleNavigateDown = useCallback(() => {
    setHighlightedIndex((prev) => (prev < totalFields - 1 ? prev + 1 : 0));
  }, [totalFields]);

  const handlePageUp = useCallback(() => {
    const newIndex = Math.max(0, highlightedIndex - maxHeight);
    setHighlightedIndex(newIndex);
  }, [highlightedIndex, maxHeight]);

  const handlePageDown = useCallback(() => {
    const newIndex = Math.min(totalFields - 1, highlightedIndex + maxHeight);
    setHighlightedIndex(newIndex);
  }, [highlightedIndex, maxHeight, totalFields]);

  const handleSelect = useCallback(() => {
    const field = fields[highlightedIndex];
    if (field) {
      onSelectField(field.path, false);
    }
  }, [highlightedIndex, fields, onSelectField]);

  // Handle selecting field with JSON editor
  const handleSelectJson = useCallback(() => {
    const field = fields[highlightedIndex];
    if (field) {
      // JSON editor is useful for arrays, objects, and unknown types
      const isComplexType = field.type === "array" || field.type === "object" || field.type === "unknown";
      onSelectField(field.path, isComplexType);
    }
  }, [highlightedIndex, fields, onSelectField]);

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
      } else if (input === "J") {
        // J (uppercase) to edit as JSON
        handleSelectJson();
      } else if (key.escape) {
        onBack();
      }
    },
    { isActive: isFocused }
  );

  // Build breadcrumb path
  const breadcrumb = useMemo(() => {
    const parts = [currentSection?.label || selectedSection];
    if (selectedField) {
      // Add nested path components
      const fieldParts = selectedField.split(".");
      // Skip the first part if it matches section (e.g., "docker" in "docker.ports")
      const startIdx = fieldParts[0] === selectedSection ? 1 : 0;
      for (let i = startIdx; i < fieldParts.length; i++) {
        parts.push(pathToLabel(fieldParts[i]));
      }
    }
    return parts.join(" > ");
  }, [currentSection, selectedSection, selectedField]);

  // Calculate visible fields based on scroll offset
  const visibleFields = useMemo(() => {
    const endIndex = Math.min(scrollOffset + maxHeight, totalFields);
    return fields.slice(scrollOffset, endIndex);
  }, [fields, scrollOffset, maxHeight, totalFields]);

  // Check if we have overflow
  const canScrollUp = scrollOffset > 0;
  const canScrollDown = scrollOffset + maxHeight < totalFields;
  const hasOverflow = totalFields > maxHeight;

  // Render loading state
  if (!config) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} flexGrow={1}>
        <Text dimColor>Loading configuration...</Text>
      </Box>
    );
  }

  // Render empty section
  if (!currentSection || fields.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} flexGrow={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">{breadcrumb}</Text>
        </Box>
        <Text dimColor>No fields in this section</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} flexGrow={1}>
      {/* Breadcrumb */}
      <Box marginBottom={1}>
        <Text bold color="cyan">{breadcrumb}</Text>
        {hasOverflow && (
          <Text dimColor> ({highlightedIndex + 1}/{totalFields})</Text>
        )}
      </Box>

      {/* Up scroll indicator */}
      {hasOverflow && (
        <Box>
          <Text color={canScrollUp ? "cyan" : "gray"} dimColor={!canScrollUp}>
            {canScrollUp ? "▲ more" : ""}
          </Text>
        </Box>
      )}

      {/* Visible fields list */}
      {visibleFields.map((field) => {
        const actualIndex = fields.findIndex((f) => f.path === field.path);
        const isHighlighted = actualIndex === highlightedIndex;
        const value = getValueAtPath(config, field.path);
        const displayValue = getDisplayValue(value, field.type);
        const fieldHasError = hasFieldError(validationErrors, field.path);
        const fieldErrors = getFieldErrors(validationErrors, field.path);

        // Color based on field type, but red if there's an error
        const typeColor = fieldHasError ? "red"
          : field.type === "array" ? "yellow"
          : field.type === "object" ? "magenta"
          : field.type === "boolean" ? "blue"
          : undefined;

        return (
          <Box key={field.path} flexDirection="column">
            <Box>
              {/* Selection indicator */}
              <Text color={isHighlighted ? "cyan" : fieldHasError ? "red" : undefined}>
                {isHighlighted ? "▸ " : fieldHasError ? "✗ " : "  "}
              </Text>
              {/* Field label */}
              <Text
                bold={isHighlighted}
                color={fieldHasError ? "red" : isHighlighted ? "cyan" : undefined}
                inverse={isHighlighted}
              >
                {field.label}
              </Text>
              <Text dimColor>: </Text>
              {/* Field value */}
              <Text color={typeColor} dimColor={value === undefined || value === null}>
                {displayValue}
              </Text>
              {/* Type indicator for complex types */}
              {(field.type === "array" || field.type === "object") && (
                <Text dimColor> →</Text>
              )}
            </Box>
            {/* Validation error message */}
            {fieldHasError && fieldErrors.length > 0 && (
              <Box marginLeft={4}>
                <Text color="red" dimColor>
                  {fieldErrors[0].message}
                </Text>
              </Box>
            )}
          </Box>
        );
      })}

      {/* Down scroll indicator */}
      {hasOverflow && (
        <Box>
          <Text color={canScrollDown ? "cyan" : "gray"} dimColor={!canScrollDown}>
            {canScrollDown ? "▼ more" : ""}
          </Text>
        </Box>
      )}

      {/* Navigation hints */}
      <Box marginTop={1}>
        <Text dimColor>
          j/k: navigate | Enter: edit | J: edit as JSON
          {hasOverflow && " | PgUp/Dn: scroll"} | Esc: back
        </Text>
      </Box>
    </Box>
  );
}

export default EditorPanel;
