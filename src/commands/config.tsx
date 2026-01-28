import { render, Box, Text } from "ink";
import React from "react";
import { loadConfig, RalphConfig, getPaths } from "../utils/config.js";
import { existsSync } from "fs";

// Placeholder Ink app component
function ConfigEditorApp({ config }: { config: RalphConfig }): React.ReactElement {
  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>ralph config</Text>
      <Text>TUI Config Editor (work in progress)</Text>
      <Box marginTop={1}>
        <Text dimColor>Language: </Text>
        <Text>{config.language}</Text>
      </Box>
      <Box>
        <Text dimColor>Check: </Text>
        <Text>{config.checkCommand}</Text>
      </Box>
      <Box>
        <Text dimColor>Test: </Text>
        <Text>{config.testCommand}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Ctrl+C to exit</Text>
      </Box>
    </Box>
  );
}

export async function config(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    showConfigHelp();
    return;
  }

  // Check if .ralph/config.json exists
  const paths = getPaths();
  if (!existsSync(paths.config)) {
    console.error("Error: .ralph/config.json not found. Run 'ralph init' first.");
    process.exit(1);
  }

  // Load configuration
  let configData: RalphConfig;
  try {
    configData = loadConfig();
  } catch (error) {
    console.error("Error loading config:", error instanceof Error ? error.message : "Unknown error");
    process.exit(1);
  }

  // Render Ink app
  const { waitUntilExit } = render(<ConfigEditorApp config={configData} />);
  await waitUntilExit();
}

function showConfigHelp(): void {
  const helpText = `
ralph config - Interactive TUI configuration editor

USAGE:
  ralph config          Open the TUI configuration editor
  ralph config help     Show this help message

DESCRIPTION:
  Opens an interactive terminal user interface for editing the .ralph/config.json
  configuration file. Navigate through sections, edit values, and save changes.

KEYBOARD SHORTCUTS:
  j/k         Navigate up/down
  Enter       Edit selected field
  Esc         Go back / Cancel edit
  S           Save changes
  Q           Quit (prompts to save if unsaved changes)
  ?           Show help panel

SECTIONS:
  Basic       Language, check command, test command
  Docker      Ports, volumes, environment, packages
  Daemon      Actions, socket path
  Claude      MCP servers, skills
  Chat        Telegram integration
  Notify      Notification settings
`;
  console.log(helpText.trim());
}
