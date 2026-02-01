import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { RalphConfig } from "../../utils/config.js";
import { CONFIG_SECTIONS } from "./SectionNav.js";
import { getValueAtPath } from "./EditorPanel.js";

/**
 * Token types for JSON syntax highlighting.
 */
type TokenType = "key" | "string" | "number" | "boolean" | "null" | "bracket" | "colon" | "comma";

/**
 * A token in the highlighted JSON output.
 */
interface Token {
  type: TokenType;
  value: string;
}

/**
 * A line of highlighted JSON tokens.
 */
interface HighlightedLine {
  tokens: Token[];
  indent: number;
}

/**
 * Get the color for a token type.
 */
function getTokenColor(type: TokenType): string | undefined {
  switch (type) {
    case "key":
      return "cyan";
    case "string":
      return "green";
    case "number":
      return "yellow";
    case "boolean":
      return "magenta";
    case "null":
      return "gray";
    case "bracket":
      return undefined; // default color
    case "colon":
      return "gray";
    case "comma":
      return "gray";
    default:
      return undefined;
  }
}

/**
 * Parse JSON string into highlighted tokens.
 * Returns an array of lines, each containing tokens with type information.
 */
function highlightJson(jsonString: string): HighlightedLine[] {
  const lines: HighlightedLine[] = [];
  const rawLines = jsonString.split("\n");

  for (const line of rawLines) {
    const tokens: Token[] = [];
    let remaining = line;
    let indent = 0;

    // Count leading spaces for indent
    const leadingSpaces = line.match(/^(\s*)/);
    if (leadingSpaces) {
      indent = leadingSpaces[1].length;
      remaining = line.slice(indent);
    }

    // Tokenize the line
    while (remaining.length > 0) {
      // Skip whitespace
      const wsMatch = remaining.match(/^(\s+)/);
      if (wsMatch) {
        remaining = remaining.slice(wsMatch[1].length);
        continue;
      }

      // Match key (quoted string followed by colon)
      const keyMatch = remaining.match(/^"([^"\\]|\\.)*"(?=\s*:)/);
      if (keyMatch) {
        tokens.push({ type: "key", value: keyMatch[0] });
        remaining = remaining.slice(keyMatch[0].length);
        continue;
      }

      // Match string value
      const stringMatch = remaining.match(/^"([^"\\]|\\.)*"/);
      if (stringMatch) {
        tokens.push({ type: "string", value: stringMatch[0] });
        remaining = remaining.slice(stringMatch[0].length);
        continue;
      }

      // Match number
      const numberMatch = remaining.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/);
      if (numberMatch) {
        tokens.push({ type: "number", value: numberMatch[0] });
        remaining = remaining.slice(numberMatch[0].length);
        continue;
      }

      // Match boolean
      const boolMatch = remaining.match(/^(true|false)/);
      if (boolMatch) {
        tokens.push({ type: "boolean", value: boolMatch[0] });
        remaining = remaining.slice(boolMatch[0].length);
        continue;
      }

      // Match null
      const nullMatch = remaining.match(/^null/);
      if (nullMatch) {
        tokens.push({ type: "null", value: nullMatch[0] });
        remaining = remaining.slice(nullMatch[0].length);
        continue;
      }

      // Match brackets
      const bracketMatch = remaining.match(/^[\[\]{}]/);
      if (bracketMatch) {
        tokens.push({ type: "bracket", value: bracketMatch[0] });
        remaining = remaining.slice(1);
        continue;
      }

      // Match colon
      if (remaining.startsWith(":")) {
        tokens.push({ type: "colon", value: ":" });
        remaining = remaining.slice(1);
        continue;
      }

      // Match comma
      if (remaining.startsWith(",")) {
        tokens.push({ type: "comma", value: "," });
        remaining = remaining.slice(1);
        continue;
      }

      // Unknown character - add as-is
      tokens.push({ type: "bracket", value: remaining[0] });
      remaining = remaining.slice(1);
    }

    lines.push({ tokens, indent });
  }

  return lines;
}

/**
 * Render a single highlighted line.
 */
function HighlightedLineComponent({ line }: { line: HighlightedLine }): React.ReactElement {
  return (
    <Box>
      {/* Indentation */}
      <Text>{" ".repeat(line.indent)}</Text>
      {/* Tokens */}
      {line.tokens.map((token, index) => (
        <Text key={index} color={getTokenColor(token.type)}>
          {token.value}
        </Text>
      ))}
    </Box>
  );
}

export interface PreviewProps {
  /** The current configuration */
  config: RalphConfig | null;
  /** Currently selected section ID */
  selectedSection: string;
  /** Whether the preview panel is visible */
  visible?: boolean;
  /** Maximum height for the preview (lines) */
  maxHeight?: number;
}

/**
 * Preview component displays the current section's config as syntax-highlighted JSON.
 * Updates live as edits are made.
 */
export function Preview({
  config,
  selectedSection,
  visible = true,
  maxHeight = 20,
}: PreviewProps): React.ReactElement | null {
  // Don't render if not visible
  if (!visible) {
    return null;
  }

  // Get the current section's data
  const sectionData = useMemo(() => {
    if (!config) return null;

    const section = CONFIG_SECTIONS.find((s) => s.id === selectedSection);
    if (!section) return null;

    // Build an object with just the section's fields
    const data: Record<string, unknown> = {};

    for (const fieldPath of section.fields) {
      const value = getValueAtPath(config, fieldPath);
      if (value !== undefined) {
        // Store with the full path for clarity
        const parts = fieldPath.split(".");
        let current: Record<string, unknown> = data;

        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          if (!current[part]) {
            current[part] = {};
          }
          current = current[part] as Record<string, unknown>;
        }

        current[parts[parts.length - 1]] = value;
      }
    }

    return data;
  }, [config, selectedSection]);

  // Generate highlighted JSON
  const highlightedLines = useMemo(() => {
    if (!sectionData) return [];

    try {
      const jsonString = JSON.stringify(sectionData, null, 2);
      return highlightJson(jsonString);
    } catch {
      return [];
    }
  }, [sectionData]);

  // Limit lines if needed
  const displayLines = useMemo(() => {
    if (highlightedLines.length <= maxHeight) {
      return highlightedLines;
    }
    // Show first (maxHeight - 1) lines plus a "..." indicator
    return highlightedLines.slice(0, maxHeight - 1);
  }, [highlightedLines, maxHeight]);

  const isOverflowing = highlightedLines.length > maxHeight;

  // Get section info for header
  const currentSection = useMemo(() => {
    return CONFIG_SECTIONS.find((s) => s.id === selectedSection);
  }, [selectedSection]);

  if (!config || !sectionData || Object.keys(sectionData).length === 0) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} width={40}>
        <Box marginBottom={1}>
          <Text bold color="yellow">
            JSON Preview
          </Text>
        </Box>
        <Text dimColor>No data to preview</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} width={40}>
      {/* Header */}
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold color="yellow">
          JSON Preview
        </Text>
        <Text dimColor>{currentSection?.label || selectedSection}</Text>
      </Box>

      {/* Highlighted JSON */}
      <Box flexDirection="column">
        {displayLines.map((line, index) => (
          <HighlightedLineComponent key={index} line={line} />
        ))}
        {isOverflowing && (
          <Text dimColor> ... ({highlightedLines.length - maxHeight + 1} more lines)</Text>
        )}
      </Box>

      {/* Footer hint */}
      <Box marginTop={1}>
        <Text dimColor>[Tab] to hide</Text>
      </Box>
    </Box>
  );
}

export default Preview;
