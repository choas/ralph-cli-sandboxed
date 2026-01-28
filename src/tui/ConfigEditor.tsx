import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useConfig } from "./hooks/useConfig.js";
import { SectionNav, CONFIG_SECTIONS } from "./components/SectionNav.js";
import { EditorPanel, getValueAtPath, inferFieldType } from "./components/EditorPanel.js";
import { StringEditor } from "./components/StringEditor.js";
import { BooleanToggle } from "./components/BooleanToggle.js";
import { ArrayEditor } from "./components/ArrayEditor.js";
import { ObjectEditor } from "./components/ObjectEditor.js";
import type { RalphConfig } from "../utils/config.js";

/**
 * Focus state for the two-panel layout.
 */
type FocusPane = "nav" | "editor" | "field-editor";

/**
 * Set a value at a dot-notation path in an object (immutably).
 */
function setValueAtPath<T extends object>(obj: T, path: string, value: unknown): T {
  const parts = path.split(".");
  const result = JSON.parse(JSON.stringify(obj)) as T;

  let current: Record<string, unknown> = result as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1];
  current[lastPart] = value;

  return result;
}

/**
 * ConfigEditor is the main TUI application component.
 * It provides a two-panel layout with section navigation and field editing.
 */
export function ConfigEditor(): React.ReactElement {
  const { exit } = useApp();
  const {
    config,
    loading,
    error,
    hasChanges,
    saveConfig,
    updateConfig,
  } = useConfig();

  // Navigation state
  const [selectedSection, setSelectedSection] = useState("basic");
  const [selectedField, setSelectedField] = useState<string | undefined>(undefined);
  const [focusPane, setFocusPane] = useState<FocusPane>("nav");

  // Status message for feedback
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Get the current field value and type for the field editor
  const currentFieldValue = useMemo(() => {
    if (!config || !selectedField) return undefined;
    return getValueAtPath(config, selectedField);
  }, [config, selectedField]);

  const currentFieldType = useMemo(() => {
    return inferFieldType(currentFieldValue);
  }, [currentFieldValue]);

  // Get the label for the current field
  const currentFieldLabel = useMemo(() => {
    if (!selectedField) return "";
    const parts = selectedField.split(".");
    const lastPart = parts[parts.length - 1];
    return lastPart
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  }, [selectedField]);

  // Handle section selection
  const handleSelectSection = useCallback((sectionId: string) => {
    setSelectedSection(sectionId);
    setSelectedField(undefined);
    setFocusPane("editor");
  }, []);

  // Handle field selection
  const handleSelectField = useCallback((fieldPath: string) => {
    setSelectedField(fieldPath);
    setFocusPane("field-editor");
  }, []);

  // Handle going back from editor to nav
  const handleBack = useCallback(() => {
    if (focusPane === "field-editor") {
      setSelectedField(undefined);
      setFocusPane("editor");
    } else if (focusPane === "editor") {
      setFocusPane("nav");
    }
  }, [focusPane]);

  // Handle field value confirmation
  const handleFieldConfirm = useCallback((newValue: unknown) => {
    if (!selectedField) return;

    updateConfig((currentConfig: RalphConfig) => {
      return setValueAtPath(currentConfig, selectedField, newValue);
    });

    setSelectedField(undefined);
    setFocusPane("editor");
    setStatusMessage("Field updated");
    setTimeout(() => setStatusMessage(null), 2000);
  }, [selectedField, updateConfig]);

  // Handle field edit cancel
  const handleFieldCancel = useCallback(() => {
    setSelectedField(undefined);
    setFocusPane("editor");
  }, []);

  // Handle save
  const handleSave = useCallback(() => {
    const success = saveConfig();
    if (success) {
      setStatusMessage("Configuration saved!");
    } else {
      setStatusMessage("Failed to save configuration");
    }
    setTimeout(() => setStatusMessage(null), 2000);
  }, [saveConfig]);

  // Handle quit
  const handleQuit = useCallback(() => {
    exit();
  }, [exit]);

  // Global keyboard shortcuts (S for Save, Q for Quit)
  useInput(
    (input, key) => {
      // Only handle global shortcuts when not in field editor
      if (focusPane === "field-editor") return;

      if (input.toUpperCase() === "S") {
        handleSave();
      } else if (input.toUpperCase() === "Q") {
        handleQuit();
      } else if (key.tab) {
        // Tab to switch between nav and editor panes
        setFocusPane((prev) => (prev === "nav" ? "editor" : "nav"));
      }
    },
    { isActive: focusPane !== "field-editor" }
  );

  // Render loading state
  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>ralph config</Text>
        <Text dimColor>Loading configuration...</Text>
      </Box>
    );
  }

  // Render error state
  if (error || !config) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>ralph config</Text>
        <Text color="red">Error: {error || "Failed to load configuration"}</Text>
        <Box marginTop={1}>
          <Text dimColor>Press Q to quit</Text>
        </Box>
      </Box>
    );
  }

  // Render field editor overlay if a field is selected
  const renderFieldEditor = () => {
    if (!selectedField || focusPane !== "field-editor") return null;

    switch (currentFieldType) {
      case "string":
        return (
          <StringEditor
            label={currentFieldLabel}
            value={(currentFieldValue as string) || ""}
            onConfirm={handleFieldConfirm}
            onCancel={handleFieldCancel}
            isFocused={true}
          />
        );
      case "boolean":
        return (
          <BooleanToggle
            label={currentFieldLabel}
            value={currentFieldValue as boolean}
            onConfirm={handleFieldConfirm}
            onCancel={handleFieldCancel}
            isFocused={true}
          />
        );
      case "number":
        return (
          <StringEditor
            label={currentFieldLabel}
            value={String(currentFieldValue || "")}
            onConfirm={(val) => handleFieldConfirm(Number(val) || 0)}
            onCancel={handleFieldCancel}
            isFocused={true}
            placeholder="Enter a number"
          />
        );
      case "array":
        return (
          <ArrayEditor
            label={currentFieldLabel}
            items={(currentFieldValue as string[]) || []}
            onConfirm={handleFieldConfirm}
            onCancel={handleFieldCancel}
            isFocused={true}
          />
        );
      case "object":
        // Handle object type - flatten to string key-value pairs
        const objValue = (currentFieldValue || {}) as Record<string, unknown>;
        const stringEntries: Record<string, string> = {};
        for (const [k, v] of Object.entries(objValue)) {
          stringEntries[k] = typeof v === "string" ? v : JSON.stringify(v);
        }
        return (
          <ObjectEditor
            label={currentFieldLabel}
            entries={stringEntries}
            onConfirm={(entries) => {
              // Try to parse JSON values back if they look like objects
              const parsedEntries: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(entries)) {
                try {
                  if (v.startsWith("{") || v.startsWith("[")) {
                    parsedEntries[k] = JSON.parse(v);
                  } else {
                    parsedEntries[k] = v;
                  }
                } catch {
                  parsedEntries[k] = v;
                }
              }
              handleFieldConfirm(parsedEntries);
            }}
            onCancel={handleFieldCancel}
            isFocused={true}
          />
        );
      default:
        // Unknown type - use string editor
        return (
          <StringEditor
            label={currentFieldLabel}
            value={String(currentFieldValue || "")}
            onConfirm={handleFieldConfirm}
            onCancel={handleFieldCancel}
            isFocused={true}
          />
        );
    }
  };

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1} justifyContent="space-between">
        <Box>
          <Text color="cyan" bold>ralph config</Text>
          {hasChanges && <Text color="yellow"> (unsaved changes)</Text>}
        </Box>
        <Box>
          <Text dimColor>[S] Save</Text>
          <Text dimColor> | </Text>
          <Text dimColor>[Q] Quit</Text>
        </Box>
      </Box>

      {/* Status message */}
      {statusMessage && (
        <Box marginBottom={1}>
          <Text color={statusMessage.includes("Failed") ? "red" : "green"}>
            {statusMessage}
          </Text>
        </Box>
      )}

      {/* Two-panel layout or field editor overlay */}
      {focusPane === "field-editor" ? (
        <Box>
          {renderFieldEditor()}
        </Box>
      ) : (
        <Box>
          {/* Left panel: Section navigation */}
          <Box width={20}>
            <SectionNav
              selectedSection={selectedSection}
              onSelectSection={handleSelectSection}
              isFocused={focusPane === "nav"}
            />
          </Box>

          {/* Right panel: Editor panel */}
          <Box flexGrow={1}>
            <EditorPanel
              config={config}
              selectedSection={selectedSection}
              selectedField={selectedField}
              onSelectField={handleSelectField}
              onBack={handleBack}
              isFocused={focusPane === "editor"}
            />
          </Box>
        </Box>
      )}

      {/* Footer with keyboard hints */}
      <Box marginTop={1}>
        <Text dimColor>
          {focusPane === "nav" && "j/k: navigate | Enter: select section | Tab: switch pane"}
          {focusPane === "editor" && "j/k: navigate | Enter: edit | Esc: back | Tab: switch pane"}
          {focusPane === "field-editor" && "Follow editor hints"}
        </Text>
      </Box>
    </Box>
  );
}

export default ConfigEditor;
