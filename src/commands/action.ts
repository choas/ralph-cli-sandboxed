import { spawn } from "child_process";
import { existsSync } from "fs";
import { loadConfig, isRunningInContainer } from "../utils/config.js";
import {
  getMessagesPath,
  sendMessage,
  waitForResponse,
} from "../utils/message-queue.js";
import { getDefaultActions, getBuiltInActionNames, DaemonAction } from "../utils/daemon-actions.js";

/**
 * Execute an action from config.json - works both inside and outside containers.
 *
 * Inside container: Uses file-based message queue to communicate with host daemon
 * Outside container: Executes the command directly
 */
export async function action(args: string[]): Promise<void> {
  // Parse arguments
  let actionName: string | undefined;
  let actionArgs: string[] = [];
  let debug = false;
  let showList = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--debug" || arg === "-d") {
      debug = true;
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      return;
    } else if (arg === "--list" || arg === "-l") {
      showList = true;
    } else if (!arg.startsWith("-")) {
      if (!actionName) {
        actionName = arg;
      } else {
        // Collect remaining args as action arguments
        actionArgs = args.slice(i);
        break;
      }
    }
  }

  // Load config
  let config;
  try {
    config = loadConfig();
  } catch {
    console.error("Failed to load config. Run 'ralph init' first.");
    process.exit(1);
  }

  // Get built-in actions and configured actions
  const builtInActions = getDefaultActions(config);
  const builtInNames = getBuiltInActionNames(config);
  const configuredActions = config.daemon?.actions || {};

  // Merge: configured actions override built-in ones
  const allActions: Record<string, DaemonAction> = { ...builtInActions, ...configuredActions };
  const actionNames = Object.keys(allActions);

  // If --list, no action specified, or "help" action, show available actions
  if (showList || !actionName || actionName === "help") {
    if (actionNames.length === 0) {
      console.log("No actions available.");
      console.log("");
      console.log("Configure actions in .ralph/config.json:");
      console.log('  {');
      console.log('    "daemon": {');
      console.log('      "actions": {');
      console.log('        "build": {');
      console.log('          "command": "./scripts/build.sh",');
      console.log('          "description": "Build the project"');
      console.log('        }');
      console.log('      }');
      console.log('    }');
      console.log('  }');
    } else {
      console.log("Available actions:");
      console.log("");

      // Show built-in actions first
      const builtInList = actionNames.filter(name => builtInNames.has(name) && !configuredActions[name]);
      const customList = actionNames.filter(name => !builtInNames.has(name) || configuredActions[name]);

      for (const name of builtInList) {
        const action = allActions[name];
        const desc = action.description || action.command;
        console.log(`  ${name.padEnd(20)} ${desc} [built-in]`);
      }

      for (const name of customList) {
        const action = allActions[name];
        const desc = action.description || action.command;
        // Mark if this is a custom override of a built-in action
        const overrideMarker = builtInNames.has(name) ? " [override]" : "";
        console.log(`  ${name.padEnd(20)} ${desc}${overrideMarker}`);
      }

      console.log("");
      console.log("Run an action: ralph action <name> [args...]");
      console.log("");
      console.log("Note: Built-in actions require the daemon to be running.");
    }
    return;
  }

  // Validate action exists
  if (!allActions[actionName]) {
    console.error(`Unknown action: ${actionName}`);
    console.error("");
    if (actionNames.length > 0) {
      console.error(`Available actions: ${actionNames.join(", ")}`);
    } else {
      console.error("No actions available");
    }
    process.exit(1);
  }

  const actionConfig = allActions[actionName];
  const isBuiltIn = builtInNames.has(actionName) && !configuredActions[actionName];
  const inContainer = isRunningInContainer();

  if (debug) {
    console.log(`[action] Name: ${actionName}`);
    console.log(`[action] Args: ${actionArgs.join(" ") || "(none)"}`);
    console.log(`[action] Command: ${actionConfig.command}`);
    console.log(`[action] In container: ${inContainer}`);
    console.log(`[action] Is built-in: ${isBuiltIn}`);
  }

  if (inContainer) {
    // Inside container - use file-based message queue to execute on host
    await executeViaQueue(actionName, actionArgs, debug);
  } else if (isBuiltIn) {
    // Outside container, built-in action - also use message queue (daemon handles special actions)
    // Built-in actions like telegram_notify, slack_notify use special markers that only the daemon understands
    await executeViaQueue(actionName, actionArgs, debug);
  } else {
    // Outside container, custom action - execute directly
    await executeDirectly(actionConfig.command, actionArgs, debug);
  }
}

/**
 * Execute action via message queue (when running inside container).
 */
async function executeViaQueue(
  actionName: string,
  args: string[],
  debug: boolean
): Promise<void> {
  const messagesPath = getMessagesPath(true);

  if (!existsSync(messagesPath)) {
    const ralphDir = "/workspace/.ralph";
    if (!existsSync(ralphDir)) {
      console.error("Error: .ralph directory not mounted in container.");
      console.error("Make sure the container is started with 'ralph docker run'.");
      process.exit(1);
    }
  }

  // Send message via file queue
  const messageId = sendMessage(
    messagesPath,
    "sandbox",
    actionName,
    args.length > 0 ? args : undefined
  );

  if (debug) {
    console.log(`[action] Sent message: ${messageId}`);
  }

  console.log(`Executing action: ${actionName}`);
  console.log("Waiting for daemon response...");

  // Wait for response with longer timeout for actions that may take time
  const response = await waitForResponse(messagesPath, messageId, 60000);

  if (!response) {
    console.error("No response from daemon (timeout).");
    console.error("");
    console.error("Make sure the daemon is running on the host:");
    console.error("  ralph daemon start");
    process.exit(1);
  }

  if (debug) {
    console.log(`[action] Response: ${JSON.stringify(response)}`);
  }

  // Display output
  if (response.output) {
    console.log("");
    console.log(response.output);
  }

  if (response.success) {
    console.log("");
    console.log(`Action '${actionName}' completed successfully.`);
  } else {
    console.error("");
    console.error(`Action '${actionName}' failed: ${response.error || "Unknown error"}`);
    process.exit(1);
  }
}

/**
 * Execute action directly on host (when running outside container).
 */
async function executeDirectly(
  command: string,
  args: string[],
  debug: boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Build full command with arguments
    let fullCommand = command;
    if (args.length > 0) {
      fullCommand = `${command} ${args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(" ")}`;
    }

    if (debug) {
      console.log(`[action] Executing: ${fullCommand}`);
    }

    console.log(`Executing: ${fullCommand}`);
    console.log("");

    const proc = spawn(fullCommand, [], {
      stdio: ["inherit", "pipe", "pipe"],
      shell: true,
      cwd: process.cwd(),
    });

    // Stream stdout in real-time
    proc.stdout.on("data", (data) => {
      process.stdout.write(data);
    });

    // Stream stderr in real-time
    proc.stderr.on("data", (data) => {
      process.stderr.write(data);
    });

    proc.on("close", (code) => {
      if (code === 0) {
        console.log("");
        console.log("Action completed successfully.");
        resolve();
      } else {
        console.error("");
        console.error(`Action failed with exit code: ${code}`);
        process.exit(code || 1);
      }
    });

    proc.on("error", (err) => {
      console.error(`Failed to execute action: ${err.message}`);
      reject(err);
    });
  });
}

function showHelp(): void {
  console.log(`
ralph action - Execute host actions from config.json

USAGE:
  ralph action [name] [args...]    Execute an action
  ralph action --list              List available actions
  ralph action help                List available actions
  ralph action --help              Show this help

OPTIONS:
  -l, --list      List all configured actions
  -d, --debug     Show debug output
  -h, --help      Show this help message

DESCRIPTION:
  This command executes actions defined in the daemon.actions section of
  .ralph/config.json. When running inside a container, the action is
  executed on the host via the daemon. When running on the host directly,
  the action is executed locally.

  Actions are useful for triggering host operations like:
  - Building Xcode projects (requires host Xcode installation)
  - Running deployment scripts
  - Executing platform-specific tools not available in the container

CONFIGURATION:
  Define actions in .ralph/config.json:

  {
    "daemon": {
      "actions": {
        "build": {
          "command": "./scripts/build.sh",
          "description": "Build the project"
        },
        "deploy": {
          "command": "./scripts/deploy.sh --env staging",
          "description": "Deploy to staging"
        },
        "gen_xcode": {
          "command": "swift package generate-xcodeproj",
          "description": "Generate Xcode project from Swift package"
        }
      }
    }
  }

EXAMPLES:
  # List available actions
  ralph action --list
  ralph action help
  ralph action

  # Execute an action
  ralph action build
  ralph action deploy --env production
  ralph action gen_xcode

  # Execute with arguments
  ralph action build --release
  ralph action deploy staging

SETUP FOR CONTAINER USAGE:
  1. Define actions in .ralph/config.json
  2. Start the daemon on the host: ralph daemon start
  3. Run the container: ralph docker run
  4. From inside the container: ralph action build

NOTES:
  - Actions configured in daemon.actions are automatically available to the daemon
  - When in a container, the daemon must be running to process action requests
  - Actions have a 60-second timeout when executed via the daemon
  - Output is streamed in real-time when executing directly on host
`);
}
