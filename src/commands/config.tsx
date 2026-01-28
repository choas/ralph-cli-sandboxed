import { render } from "ink";
import React from "react";
import { getPaths } from "../utils/config.js";
import { existsSync } from "fs";
import { ConfigEditor } from "../tui/ConfigEditor.js";

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

  // Render Ink app with ConfigEditor
  const { waitUntilExit } = render(<ConfigEditor />);
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
