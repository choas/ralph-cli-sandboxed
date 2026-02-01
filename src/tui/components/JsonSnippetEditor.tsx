import React, { useState, useCallback, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

export interface JsonSnippetEditorProps {
  /** The label to display for this field */
  label: string;
  /** The current JSON value (will be stringified for editing) */
  value: unknown;
  /** Called when the user confirms the edit */
  onConfirm: (newValue: unknown) => void;
  /** Called when the user cancels the edit (Esc) */
  onCancel: () => void;
  /** Whether this editor has focus */
  isFocused?: boolean;
  /** Maximum height for the content area (for scrolling) */
  maxHeight?: number;
  /** Maximum width for the preview (terminal columns) */
  maxWidth?: number;
}

type EditorMode = "view" | "edit";

interface JsonParseError {
  message: string;
  line?: number;
  column?: number;
}

/**
 * Parse JSON with detailed error information including line and column.
 */
function parseJsonWithLineInfo(jsonStr: string): { value?: unknown; error?: JsonParseError } {
  try {
    const value = JSON.parse(jsonStr);
    return { value };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid JSON";

    // Try to extract line/column from error message
    // Format: "... at position N" or "... at line X column Y"
    const posMatch = message.match(/at position (\d+)/);
    const lineColMatch = message.match(/at line (\d+) column (\d+)/);

    if (lineColMatch) {
      return {
        error: {
          message: message.replace(/at line \d+ column \d+/, "").trim(),
          line: parseInt(lineColMatch[1], 10),
          column: parseInt(lineColMatch[2], 10),
        },
      };
    }

    if (posMatch) {
      const position = parseInt(posMatch[1], 10);
      // Calculate line and column from position
      const lines = jsonStr.substring(0, position).split("\n");
      const line = lines.length;
      const column = lines[lines.length - 1].length + 1;

      return {
        error: {
          message: message.replace(/at position \d+/, "").trim(),
          line,
          column,
        },
      };
    }

    return { error: { message } };
  }
}

/**
 * Format JSON with indentation for display.
 */
function formatJson(value: unknown): string {
  if (value === undefined) {
    return "null";
  }
  return JSON.stringify(value, null, 2);
}

/**
 * Validate JSON structure against known config schemas.
 * Returns warnings for common issues.
 */
function validateJsonStructure(value: unknown, label: string): string[] {
  const warnings: string[] = [];

  if (value === null || value === undefined) {
    return warnings;
  }

  // MCP Servers validation
  if (label.toLowerCase().includes("mcp") && typeof value === "object" && !Array.isArray(value)) {
    const servers = value as Record<string, unknown>;
    for (const [name, config] of Object.entries(servers)) {
      if (typeof config !== "object" || config === null) {
        warnings.push(`Server "${name}": expected object with command field`);
        continue;
      }
      const serverConfig = config as Record<string, unknown>;
      if (!serverConfig.command || typeof serverConfig.command !== "string") {
        warnings.push(`Server "${name}": missing or invalid "command" field`);
      }
      if (serverConfig.args && !Array.isArray(serverConfig.args)) {
        warnings.push(`Server "${name}": "args" should be an array`);
      }
      if (
        serverConfig.env &&
        (typeof serverConfig.env !== "object" || Array.isArray(serverConfig.env))
      ) {
        warnings.push(`Server "${name}": "env" should be an object`);
      }
    }
  }

  // Daemon Actions validation
  if (
    label.toLowerCase().includes("action") &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const actions = value as Record<string, unknown>;
    for (const [name, config] of Object.entries(actions)) {
      if (typeof config !== "object" || config === null) {
        warnings.push(`Action "${name}": expected object with command field`);
        continue;
      }
      const actionConfig = config as Record<string, unknown>;
      if (!actionConfig.command || typeof actionConfig.command !== "string") {
        warnings.push(`Action "${name}": missing or invalid "command" field`);
      }
    }
  }

  // Skills validation
  if (label.toLowerCase().includes("skill") && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const skill = value[i];
      if (typeof skill !== "object" || skill === null) {
        warnings.push(`Skill [${i}]: expected object`);
        continue;
      }
      const skillConfig = skill as Record<string, unknown>;
      if (!skillConfig.name || typeof skillConfig.name !== "string") {
        warnings.push(`Skill [${i}]: missing or invalid "name" field`);
      }
      if (!skillConfig.description || typeof skillConfig.description !== "string") {
        warnings.push(`Skill [${i}]: missing or invalid "description" field`);
      }
      if (!skillConfig.instructions || typeof skillConfig.instructions !== "string") {
        warnings.push(`Skill [${i}]: missing or invalid "instructions" field`);
      }
    }
  }

  // Daemon Events validation
  if (label.toLowerCase().includes("event") && typeof value === "object" && !Array.isArray(value)) {
    const validEventTypes = ["task_complete", "ralph_complete", "iteration_complete", "error"];
    const events = value as Record<string, unknown>;
    for (const [eventType, handlers] of Object.entries(events)) {
      if (!validEventTypes.includes(eventType)) {
        warnings.push(`Unknown event type: "${eventType}". Valid: ${validEventTypes.join(", ")}`);
      }
      if (!Array.isArray(handlers)) {
        warnings.push(`Event "${eventType}": handlers should be an array`);
        continue;
      }
      for (let i = 0; i < handlers.length; i++) {
        const handler = handlers[i];
        if (typeof handler !== "object" || handler === null) {
          warnings.push(`Event "${eventType}"[${i}]: expected object`);
          continue;
        }
        const eventConfig = handler as Record<string, unknown>;
        if (!eventConfig.action || typeof eventConfig.action !== "string") {
          warnings.push(`Event "${eventType}"[${i}]: missing or invalid "action" field`);
        }
      }
    }
  }

  return warnings;
}

/**
 * Truncate a JSON string value if it's too long.
 * Keeps the quotes and adds "..." before the closing quote.
 */
function truncateJsonString(str: string, maxLen: number): string {
  // str includes the surrounding quotes, so we need to account for that
  if (str.length <= maxLen) {
    return str;
  }
  // Truncate the content (excluding quotes) and add ellipsis
  // Leave room for the ellipsis (3 chars) and closing quote
  const truncated = str.slice(0, maxLen - 4) + '..."';
  return truncated;
}

/**
 * Simple syntax highlighting for JSON preview.
 */
function highlightJson(json: string, maxLines: number, maxLineWidth = 60): React.ReactElement[] {
  const lines = json.split("\n");
  const displayLines = lines.slice(0, maxLines);
  const hasMore = lines.length > maxLines;

  const elements: React.ReactElement[] = [];

  // Calculate max string length based on available width (account for line number, indentation)
  const maxStringLen = Math.max(20, Math.min(50, maxLineWidth - 15));

  for (let i = 0; i < displayLines.length; i++) {
    const line = displayLines[i];
    const lineNum = String(i + 1).padStart(3, " ");

    // Simple tokenization for highlighting
    const tokens: React.ReactElement[] = [];
    let remaining = line;
    let tokenKey = 0;
    let lineLength = 0;
    const effectiveMaxWidth = maxLineWidth - 6; // Account for line number prefix "123 "

    while (remaining.length > 0 && lineLength < effectiveMaxWidth) {
      // Match string (key or value)
      const stringMatch = remaining.match(/^("(?:[^"\\]|\\.)*")/);
      if (stringMatch) {
        let str = stringMatch[1];
        // Check if this is a key (followed by :)
        const afterStr = remaining.slice(str.length).trim();
        const isKey = afterStr.startsWith(":");

        // Truncate long string values (not keys)
        if (!isKey && str.length > maxStringLen) {
          str = truncateJsonString(str, maxStringLen);
        }

        tokens.push(
          <Text key={tokenKey++} color={isKey ? "cyan" : "green"}>
            {str}
          </Text>,
        );
        lineLength += str.length;
        remaining = remaining.slice(stringMatch[1].length);
        continue;
      }

      // Match number
      const numMatch = remaining.match(/^(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/);
      if (numMatch) {
        tokens.push(
          <Text key={tokenKey++} color="yellow">
            {numMatch[1]}
          </Text>,
        );
        lineLength += numMatch[1].length;
        remaining = remaining.slice(numMatch[1].length);
        continue;
      }

      // Match boolean or null
      const boolNullMatch = remaining.match(/^(true|false|null)/);
      if (boolNullMatch) {
        tokens.push(
          <Text key={tokenKey++} color="magenta">
            {boolNullMatch[1]}
          </Text>,
        );
        lineLength += boolNullMatch[1].length;
        remaining = remaining.slice(boolNullMatch[1].length);
        continue;
      }

      // Match whitespace or punctuation
      const otherMatch = remaining.match(/^([\s{}[\]:,]+)/);
      if (otherMatch) {
        tokens.push(
          <Text key={tokenKey++} dimColor>
            {otherMatch[1]}
          </Text>,
        );
        lineLength += otherMatch[1].length;
        remaining = remaining.slice(otherMatch[1].length);
        continue;
      }

      // Fallback: single character
      tokens.push(<Text key={tokenKey++}>{remaining[0]}</Text>);
      lineLength += 1;
      remaining = remaining.slice(1);
    }

    // If line was truncated due to length
    if (remaining.length > 0) {
      tokens.push(
        <Text key={tokenKey++} dimColor>
          ...
        </Text>,
      );
    }

    elements.push(
      <Box key={i}>
        <Text dimColor>{lineNum} </Text>
        {tokens}
      </Box>,
    );
  }

  if (hasMore) {
    elements.push(
      <Box key="more">
        <Text dimColor> ... ({lines.length - maxLines} more lines)</Text>
      </Box>,
    );
  }

  return elements;
}

/**
 * JsonSnippetEditor component for editing complex nested JSON sections.
 * Supports copy/paste and live JSON validation with syntax highlighting.
 * Used for MCP servers, actions, skills, and other complex configs.
 */
export function JsonSnippetEditor({
  label,
  value,
  onConfirm,
  onCancel,
  isFocused = true,
  maxHeight = 15,
  maxWidth = 80,
}: JsonSnippetEditorProps): React.ReactElement {
  // Format the value as JSON for editing
  const initialJson = useMemo(() => formatJson(value), [value]);

  const [mode, setMode] = useState<EditorMode>("view");
  const [editText, setEditText] = useState(initialJson);
  const [parseError, setParseError] = useState<JsonParseError | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [copied, setCopied] = useState(false);

  // Validate JSON as user types
  useEffect(() => {
    const result = parseJsonWithLineInfo(editText);
    if (result.error) {
      setParseError(result.error);
      setWarnings([]);
    } else {
      setParseError(null);
      const structureWarnings = validateJsonStructure(result.value, label);
      setWarnings(structureWarnings);
    }
  }, [editText, label]);

  // Reset edit text when value changes externally
  useEffect(() => {
    const newJson = formatJson(value);
    if (mode === "view") {
      setEditText(newJson);
    }
  }, [value, mode]);

  // Calculate content lines for scrolling
  const contentLines = useMemo(() => {
    return editText.split("\n").length;
  }, [editText]);

  // Max visible lines for preview (accounting for header, errors, footer)
  const previewMaxLines = Math.max(3, maxHeight - 6);

  // Handle saving
  const handleSave = useCallback(() => {
    const result = parseJsonWithLineInfo(editText);
    if (result.error) {
      // Cannot save with parse errors
      return;
    }
    onConfirm(result.value);
  }, [editText, onConfirm]);

  // Handle entering edit mode
  const handleEdit = useCallback(() => {
    setMode("edit");
  }, []);

  // Handle canceling edit
  const handleCancelEdit = useCallback(() => {
    setEditText(initialJson);
    setMode("view");
    setParseError(null);
    setWarnings([]);
  }, [initialJson]);

  // Handle copying to clipboard
  const handleCopy = useCallback(() => {
    // Use process.stdout.write with OSC 52 escape sequence for clipboard
    // This works in most modern terminals
    const base64 = Buffer.from(editText).toString("base64");
    process.stdout.write(`\x1b]52;c;${base64}\x07`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [editText]);

  // Handle formatting JSON
  const handleFormat = useCallback(() => {
    const result = parseJsonWithLineInfo(editText);
    if (!result.error && result.value !== undefined) {
      setEditText(formatJson(result.value));
    }
  }, [editText]);

  // Scroll handlers
  const handleScrollUp = useCallback(() => {
    setScrollOffset((prev) => Math.max(0, prev - 1));
  }, []);

  const handleScrollDown = useCallback(() => {
    setScrollOffset((prev) => Math.min(contentLines - previewMaxLines, prev + 1));
  }, [contentLines, previewMaxLines]);

  const handlePageUp = useCallback(() => {
    setScrollOffset((prev) => Math.max(0, prev - previewMaxLines));
  }, [previewMaxLines]);

  const handlePageDown = useCallback(() => {
    setScrollOffset((prev) => Math.min(contentLines - previewMaxLines, prev + previewMaxLines));
  }, [contentLines, previewMaxLines]);

  // Handle keyboard input for view mode
  useInput(
    (input, key) => {
      if (!isFocused || mode !== "view") return;

      if (key.return || input === "e") {
        handleEdit();
      } else if (input === "s" || input === "S") {
        handleSave();
      } else if (key.escape) {
        onCancel();
      } else if (input === "c" || input === "C") {
        handleCopy();
      } else if (input === "f" || input === "F") {
        handleFormat();
      } else if (input === "j" || key.downArrow) {
        handleScrollDown();
      } else if (input === "k" || key.upArrow) {
        handleScrollUp();
      } else if (key.pageUp) {
        handlePageUp();
      } else if (key.pageDown) {
        handlePageDown();
      }
    },
    { isActive: isFocused && mode === "view" },
  );

  // Handle keyboard input for edit mode
  useInput(
    (_input, key) => {
      if (!isFocused || mode !== "edit") return;

      if (key.escape) {
        handleCancelEdit();
      }
    },
    { isActive: isFocused && mode === "edit" },
  );

  // Count errors and warnings for status bar
  const errorCount = parseError ? 1 : 0;
  const warningCount = warnings.length;

  // Render edit mode with text input
  if (mode === "edit") {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        {/* Header */}
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Edit JSON: {label}
          </Text>
        </Box>

        {/* Input field */}
        <Box>
          <Text dimColor>{">"} </Text>
          <TextInput
            value={editText}
            onChange={setEditText}
            onSubmit={handleSave}
            focus={isFocused}
          />
        </Box>

        {/* Parse error */}
        {parseError && (
          <Box marginTop={1} flexDirection="column">
            <Text color="red" bold>
              Syntax Error:
            </Text>
            <Text color="red">
              {parseError.line && parseError.column
                ? `Line ${parseError.line}, Column ${parseError.column}: `
                : ""}
              {parseError.message}
            </Text>
          </Box>
        )}

        {/* Status bar */}
        <Box marginTop={1}>
          {errorCount > 0 ? (
            <Text color="red">
              {errorCount} error{errorCount > 1 ? "s" : ""}
            </Text>
          ) : warningCount > 0 ? (
            <Text color="yellow">
              {warningCount} warning{warningCount > 1 ? "s" : ""}
            </Text>
          ) : (
            <Text color="green">Valid JSON</Text>
          )}
        </Box>

        {/* Help text */}
        <Box marginTop={1}>
          <Text dimColor>Enter: save (if valid) | Esc: cancel</Text>
        </Box>
        <Box>
          <Text dimColor>Tip: Paste multi-line JSON, then press Enter</Text>
        </Box>
      </Box>
    );
  }

  // Render view mode with syntax-highlighted preview
  // Account for border (2) and padding (2) when calculating preview width
  const previewWidth = Math.max(40, maxWidth - 4);
  const previewLines = highlightJson(editText, previewMaxLines, previewWidth);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold color="cyan">
          Edit as JSON: {label}
        </Text>
        {copied && <Text color="green"> Copied!</Text>}
      </Box>

      {/* JSON Preview with syntax highlighting */}
      <Box flexDirection="column" marginBottom={1}>
        {previewLines}
      </Box>

      {/* Validation status bar */}
      <Box marginBottom={1} flexDirection="column">
        {parseError ? (
          <Box>
            <Text color="red" bold>
              Error:{" "}
              {parseError.line && parseError.column
                ? `Line ${parseError.line}:${parseError.column} - `
                : ""}
              {parseError.message}
            </Text>
          </Box>
        ) : warningCount > 0 ? (
          <Box flexDirection="column">
            <Text color="yellow" bold>
              {warningCount} warning{warningCount > 1 ? "s" : ""}:
            </Text>
            {warnings.slice(0, 3).map((w, i) => (
              <Text key={i} color="yellow" dimColor>
                {" "}
                - {w}
              </Text>
            ))}
            {warningCount > 3 && <Text dimColor> ... and {warningCount - 3} more</Text>}
          </Box>
        ) : (
          <Text color="green">Valid JSON</Text>
        )}
      </Box>

      {/* Help text */}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>e/Enter: edit | s: save | c: copy | f: format</Text>
        <Text dimColor>j/k: scroll | PgUp/Dn: page | Esc: cancel</Text>
      </Box>
    </Box>
  );
}

export default JsonSnippetEditor;
