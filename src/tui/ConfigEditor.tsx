import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useConfig } from "./hooks/useConfig.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { SectionNav, CONFIG_SECTIONS } from "./components/SectionNav.js";
import { EditorPanel, getValueAtPath, inferFieldType } from "./components/EditorPanel.js";
import { StringEditor } from "./components/StringEditor.js";
import { BooleanToggle } from "./components/BooleanToggle.js";
import { ArrayEditor } from "./components/ArrayEditor.js";
import { ObjectEditor } from "./components/ObjectEditor.js";
import { KeyValueEditor } from "./components/KeyValueEditor.js";
import { JsonSnippetEditor } from "./components/JsonSnippetEditor.js";
import { Preview } from "./components/Preview.js";
import { HelpPanel } from "./components/HelpPanel.js";
import { PresetSelector } from "./components/PresetSelector.js";
import type { RalphConfig } from "../utils/config.js";
import { validateConfig, type ValidationError } from "./utils/validation.js";
import { sectionHasPresets, applyPreset, type ConfigPreset } from "./utils/presets.js";

/**
 * Focus state for the two-panel layout.
 */
type FocusPane = "nav" | "editor" | "field-editor" | "preset-selector";

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
  const terminalSize = useTerminalSize();
  const {
    config,
    loading,
    error,
    hasChanges,
    saveConfig,
    updateConfig,
  } = useConfig();

  // Calculate available height for scrollable content
  // Reserve lines for: header (2), status message (1), footer (2), borders (2)
  const availableHeight = Math.max(8, terminalSize.rows - 7);
  // Nav panel gets slightly less height for its content
  const navMaxHeight = Math.max(4, availableHeight - 4);
  // Editor panel gets full available height
  const editorMaxHeight = Math.max(6, availableHeight - 2);

  // Navigation state
  const [selectedSection, setSelectedSection] = useState("basic");
  const [selectedField, setSelectedField] = useState<string | undefined>(undefined);
  const [focusPane, setFocusPane] = useState<FocusPane>("nav");

  // Preview panel visibility
  const [previewVisible, setPreviewVisible] = useState(true);

  // Help panel visibility
  const [helpVisible, setHelpVisible] = useState(false);

  // JSON edit mode - when true, use JsonSnippetEditor for complex fields
  const [jsonEditMode, setJsonEditMode] = useState(false);

  // Status message for feedback
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Track which sections have shown preset selector (to avoid repeat prompts)
  const [visitedSections, setVisitedSections] = useState<Set<string>>(new Set(["basic"]));

  // Validation errors
  const validationErrors = useMemo((): ValidationError[] => {
    if (!config) return [];
    return validateConfig(config).errors;
  }, [config]);

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

    // Check if this section has presets and hasn't been visited yet
    if (sectionHasPresets(sectionId) && !visitedSections.has(sectionId)) {
      setFocusPane("preset-selector");
    } else {
      setFocusPane("editor");
    }
  }, [visitedSections]);

  // Handle preset selection
  const handleSelectPreset = useCallback((preset: ConfigPreset) => {
    if (!config) return;

    // Apply the preset to the config
    updateConfig((currentConfig: RalphConfig) => {
      return applyPreset(currentConfig, preset);
    });

    // Mark section as visited
    setVisitedSections((prev) => new Set([...prev, selectedSection]));

    // Show status message
    setStatusMessage(`Applied "${preset.name}" preset`);
    setTimeout(() => setStatusMessage(null), 2000);

    // Move to editor
    setFocusPane("editor");
  }, [config, updateConfig, selectedSection]);

  // Handle skipping preset selection
  const handleSkipPreset = useCallback(() => {
    // Mark section as visited
    setVisitedSections((prev) => new Set([...prev, selectedSection]));
    setFocusPane("editor");
  }, [selectedSection]);

  // Handle canceling preset selection (go back to nav)
  const handleCancelPreset = useCallback(() => {
    setFocusPane("nav");
  }, []);

  // Handle field selection
  const handleSelectField = useCallback((fieldPath: string, useJsonEditor = false) => {
    setSelectedField(fieldPath);
    setJsonEditMode(useJsonEditor);
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
    setJsonEditMode(false);
    setFocusPane("editor");
    setStatusMessage("Field updated");
    setTimeout(() => setStatusMessage(null), 2000);
  }, [selectedField, updateConfig]);

  // Handle field edit cancel
  const handleFieldCancel = useCallback(() => {
    setSelectedField(undefined);
    setJsonEditMode(false);
    setFocusPane("editor");
  }, []);

  // Handle save
  const handleSave = useCallback(() => {
    // Validate before saving
    if (!config) {
      setStatusMessage("No configuration to save");
      setTimeout(() => setStatusMessage(null), 2000);
      return;
    }

    const validation = validateConfig(config);
    if (!validation.valid) {
      const errorCount = validation.errors.length;
      setStatusMessage(`Validation failed: ${errorCount} error${errorCount > 1 ? "s" : ""} found`);
      setTimeout(() => setStatusMessage(null), 3000);
      return;
    }

    const success = saveConfig();
    if (success) {
      setStatusMessage("Configuration saved!");
    } else {
      setStatusMessage("Failed to save configuration");
    }
    setTimeout(() => setStatusMessage(null), 2000);
  }, [saveConfig, config]);

  // Handle quit
  const handleQuit = useCallback(() => {
    exit();
  }, [exit]);

  // Toggle preview visibility
  const togglePreview = useCallback(() => {
    setPreviewVisible((prev) => !prev);
  }, []);

  // Toggle help visibility
  const toggleHelp = useCallback(() => {
    setHelpVisible((prev) => !prev);
  }, []);

  // Global keyboard shortcuts (S for Save, Q for Quit, Tab for preview toggle, ? for help)
  useInput(
    (input, key) => {
      // Only handle global shortcuts when not in field editor or preset selector
      if (focusPane === "field-editor" || focusPane === "preset-selector") return;

      // ? key toggles help panel (takes priority when help is visible)
      if (input === "?") {
        toggleHelp();
        return;
      }

      // When help panel is visible, don't process other shortcuts
      if (helpVisible) return;

      if (input.toUpperCase() === "S") {
        handleSave();
      } else if (input.toUpperCase() === "Q") {
        handleQuit();
      } else if (key.tab) {
        // Tab to toggle JSON preview visibility
        togglePreview();
      } else if (input === "l" || key.rightArrow) {
        // l or right arrow to move focus to editor
        if (focusPane === "nav") {
          setFocusPane("editor");
        }
      } else if (input === "h" || key.leftArrow) {
        // h or left arrow to move focus to nav
        if (focusPane === "editor") {
          setFocusPane("nav");
        }
      } else if (input === "p") {
        // p to open preset selector if available for current section
        if (focusPane === "editor" && sectionHasPresets(selectedSection)) {
          setFocusPane("preset-selector");
        }
      }
    },
    { isActive: focusPane !== "field-editor" && focusPane !== "preset-selector" }
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

    // Use JsonSnippetEditor for complex fields when J key was pressed or for certain field types
    if (jsonEditMode) {
      return (
        <JsonSnippetEditor
          label={currentFieldLabel}
          value={currentFieldValue}
          onConfirm={handleFieldConfirm}
          onCancel={handleFieldCancel}
          isFocused={true}
          maxHeight={editorMaxHeight}
          maxWidth={terminalSize.columns}
        />
      );
    }

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
            maxHeight={editorMaxHeight}
          />
        );
      case "object":
        // Handle object type - flatten to string key-value pairs
        const objValue = (currentFieldValue || {}) as Record<string, unknown>;
        const stringEntries: Record<string, string> = {};
        for (const [k, v] of Object.entries(objValue)) {
          stringEntries[k] = typeof v === "string" ? v : JSON.stringify(v);
        }

        // Check if this is a notification provider config field
        const isNotificationProvider = selectedField &&
          (selectedField === "notifications.ntfy" ||
           selectedField === "notifications.pushover" ||
           selectedField === "notifications.gotify");

        // Check if this is a chat provider config field
        const isChatProvider = selectedField &&
          (selectedField === "chat.slack" ||
           selectedField === "chat.telegram");

        if (isNotificationProvider || isChatProvider) {
          // Extract provider name from field path
          const providerName = selectedField.split(".").pop() || "";
          return (
            <KeyValueEditor
              label={currentFieldLabel}
              entries={stringEntries}
              providerName={providerName}
              onConfirm={(entries) => {
                // Parse back array values (like allowedChatIds, allowedChannelIds)
                const parsedEntries: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(entries)) {
                  // Check if this looks like a JSON array or object
                  if (v.startsWith("[") || v.startsWith("{")) {
                    try {
                      parsedEntries[k] = JSON.parse(v);
                    } catch {
                      parsedEntries[k] = v;
                    }
                  } else if (v === "true" || v === "false") {
                    // Parse boolean values
                    parsedEntries[k] = v === "true";
                  } else {
                    parsedEntries[k] = v;
                  }
                }
                handleFieldConfirm(parsedEntries);
              }}
              onCancel={handleFieldCancel}
              isFocused={true}
            />
          );
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
            maxHeight={editorMaxHeight}
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
      {/* Help panel overlay */}
      {helpVisible && (
        <HelpPanel visible={helpVisible} onClose={toggleHelp} />
      )}

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
          <Text dimColor> | </Text>
          <Text dimColor>[?] Help</Text>
        </Box>
      </Box>

      {/* Status message */}
      {statusMessage && (
        <Box marginBottom={1}>
          <Text color={statusMessage.includes("Failed") || statusMessage.includes("Validation") ? "red" : "green"}>
            {statusMessage}
          </Text>
        </Box>
      )}

      {/* Two-panel layout or overlay views */}
      {focusPane === "field-editor" ? (
        <Box>
          {renderFieldEditor()}
        </Box>
      ) : focusPane === "preset-selector" ? (
        <Box>
          <PresetSelector
            sectionId={selectedSection}
            config={config}
            onSelectPreset={handleSelectPreset}
            onSkip={handleSkipPreset}
            onCancel={handleCancelPreset}
            isFocused={true}
          />
        </Box>
      ) : (
        <Box>
          {/* Left panel: Section navigation */}
          <Box width={20}>
            <SectionNav
              selectedSection={selectedSection}
              onSelectSection={handleSelectSection}
              isFocused={focusPane === "nav"}
              maxHeight={navMaxHeight}
            />
          </Box>

          {/* Middle panel: Editor panel */}
          <Box flexGrow={1}>
            <EditorPanel
              config={config}
              selectedSection={selectedSection}
              selectedField={selectedField}
              onSelectField={handleSelectField}
              onBack={handleBack}
              isFocused={focusPane === "editor"}
              validationErrors={validationErrors}
              maxHeight={editorMaxHeight}
            />
          </Box>

          {/* Right panel: JSON Preview (toggle with Tab) */}
          <Preview
            config={config}
            selectedSection={selectedSection}
            visible={previewVisible}
          />
        </Box>
      )}

      {/* Footer with keyboard hints */}
      <Box marginTop={1}>
        <Text dimColor>
          {focusPane === "nav" && "j/k: navigate | Enter: select | l/→: editor | Tab: toggle preview"}
          {focusPane === "editor" && "j/k: navigate | Enter: edit | J: JSON | h/←: nav | Tab: preview | p: presets"}
          {focusPane === "field-editor" && "Follow editor hints"}
          {focusPane === "preset-selector" && "j/k: navigate | Enter: select | Esc: back"}
        </Text>
      </Box>
    </Box>
  );
}

export default ConfigEditor;
