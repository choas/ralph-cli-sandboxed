import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, appendFileSync, mkdirSync } from "fs";
import { extname, join } from "path";
import {
  checkFilesExist,
  loadConfig,
  loadPrompt,
  getPaths,
  getCliConfig,
  CliConfig,
  requireContainer,
  getPrdFiles,
} from "../utils/config.js";
import { resolvePromptVariables, getCliProviders, GEMINI_MD } from "../templates/prompts.js";
import {
  validatePrd,
  smartMerge,
  readPrdFile,
  writePrd,
  writePrdAuto,
  expandPrdFileReferences,
  PrdEntry,
} from "../utils/prd-validator.js";
import { getStreamJsonParser, StreamJsonParser } from "../utils/stream-json.js";
import { sendNotificationWithDaemonEvents, triggerDaemonEvents } from "../utils/notification.js";

/**
 * Stream JSON configuration for clean output display
 */
interface StreamJsonOptions {
  enabled: boolean;
  saveRawJson: boolean;
  outputDir: string;
  args: string[]; // Provider-specific stream-json args (e.g., ['--output-format', 'stream-json'])
  parser: StreamJsonParser; // Provider-specific stream-json parser
}

interface PrdItem {
  category: string;
  description: string;
  steps: string[];
  passes: boolean;
  branch?: string;
}

const CATEGORIES = ["ui", "feature", "bugfix", "setup", "development", "testing", "docs"];

/**
 * Creates a filtered PRD file containing only incomplete items (passes: false).
 * Optionally filters by category if specified.
 * Expands @{filepath} references to include file contents.
 * Returns the path to the temp file, or null if all items pass.
 */
function createFilteredPrd(
  prdPath: string,
  baseDir: string,
  category?: string,
): { tempPath: string; hasIncomplete: boolean } {
  // Use readPrdFile to handle both JSON and YAML formats
  const parsed = readPrdFile(prdPath);

  if (!parsed) {
    const ext = extname(prdPath).toLowerCase();
    const format = ext === ".yaml" || ext === ".yml" ? "YAML" : "JSON";
    console.error(`\x1b[31mError: PRD file contains invalid ${format}.\x1b[0m`);
    console.error("The file may have been corrupted by an LLM.\n");
    console.error("Run \x1b[36mralph fix-prd\x1b[0m to diagnose and repair the file.");
    process.exit(1);
  }

  if (!Array.isArray(parsed.content)) {
    console.error("\x1b[31mError: PRD is corrupted - expected an array of items.\x1b[0m");
    console.error("The file may have been modified incorrectly by an LLM.\n");
    console.error("Run \x1b[36mralph fix-prd\x1b[0m to diagnose and repair the file.");
    process.exit(1);
  }

  const items: PrdItem[] = parsed.content;
  let filteredItems = items.filter((item) => item.passes === false);

  // Apply category filter if specified
  if (category) {
    filteredItems = filteredItems.filter((item) => item.category === category);
  }

  // Expand @{filepath} references in description and steps
  const expandedItems = expandPrdFileReferences(filteredItems, baseDir);

  // Write to .ralph/prd-tasks.json so LLMs see a sensible path
  const tempPath = join(baseDir, "prd-tasks.json");
  writeFileSync(tempPath, JSON.stringify(expandedItems, null, 2));

  return {
    tempPath,
    hasIncomplete: filteredItems.length > 0,
  };
}

/**
 * Result of syncing tasks from prd-tasks.json to prd.json.
 */
interface SyncResult {
  count: number;
  taskNames: string[];
}

/**
 * Syncs passes flags from prd-tasks.json back to the main PRD file.
 * If the LLM marked any item as passes: true in prd-tasks.json,
 * find the matching item in the PRD and update it.
 * Returns the number of items synced and their names.
 */
function syncPassesFromTasks(tasksPath: string, prdPath: string): SyncResult {
  // Check if tasks file exists
  if (!existsSync(tasksPath)) {
    return { count: 0, taskNames: [] };
  }

  try {
    const tasksContent = readFileSync(tasksPath, "utf-8");
    const tasksParsed = JSON.parse(tasksContent);
    if (!Array.isArray(tasksParsed)) {
      console.warn("\x1b[33mWarning: prd-tasks.json is not a valid array - skipping sync.\x1b[0m");
      return { count: 0, taskNames: [] };
    }
    const tasks: PrdItem[] = tasksParsed;

    // Use readPrdFile to handle both JSON and YAML formats
    const prdParsed = readPrdFile(prdPath);
    if (!prdParsed) {
      const ext = extname(prdPath).toLowerCase();
      const format = ext === ".yaml" || ext === ".yml" ? "YAML" : "JSON";
      console.warn(`\x1b[33mWarning: PRD contains invalid ${format} - skipping sync.\x1b[0m`);
      console.warn("Run \x1b[36mralph fix-prd\x1b[0m after this session to repair.\n");
      return { count: 0, taskNames: [] };
    }
    if (!Array.isArray(prdParsed.content)) {
      console.warn("\x1b[33mWarning: PRD is corrupted - skipping sync.\x1b[0m");
      console.warn("Run \x1b[36mralph fix-prd\x1b[0m after this session to repair.\n");
      return { count: 0, taskNames: [] };
    }
    const prd: PrdItem[] = prdParsed.content;

    let synced = 0;
    const syncedTaskNames: string[] = [];

    // Find tasks that were marked as passing
    for (const task of tasks) {
      if (task.passes === true) {
        // Find matching item in prd by description
        const match = prd.find(
          (item) =>
            item.description === task.description ||
            item.description.includes(task.description) ||
            task.description.includes(item.description),
        );

        if (match && !match.passes) {
          match.passes = true;
          synced++;
          syncedTaskNames.push(task.description);
        }
      }
    }

    // Write back if any items were synced (using format-aware write)
    if (synced > 0) {
      writePrdAuto(prdPath, prd);
      const prdFileName = prdPath.split("/").pop() || "PRD";
      console.log(
        `\x1b[32mSynced ${synced} completed item(s) from prd-tasks.json to ${prdFileName}\x1b[0m`,
      );
    }

    return { count: synced, taskNames: syncedTaskNames };
  } catch {
    // Ignore errors - the validation step will handle any issues
    return { count: 0, taskNames: [] };
  }
}

async function runIteration(
  prompt: string,
  paths: ReturnType<typeof getPaths>,
  sandboxed: boolean,
  filteredPrdPath: string,
  cliConfig: CliConfig,
  debug: boolean,
  model?: string,
  streamJson?: StreamJsonOptions,
): Promise<{ exitCode: number; output: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let output = "";
    let stderrOutput = "";
    let jsonLogPath: string | undefined;
    let lineBuffer = ""; // Buffer for incomplete JSON lines

    // Build CLI arguments: config args + yolo args + model args + prompt args
    const cliArgs = [...(cliConfig.args ?? [])];

    // Only add yolo args when running in a container
    // Use yoloArgs from config if available, otherwise default to Claude's --dangerously-skip-permissions
    if (sandboxed) {
      const yoloArgs = cliConfig.yoloArgs ?? ["--dangerously-skip-permissions"];
      cliArgs.push(...yoloArgs);
    }

    // Add stream-json output format if enabled (using provider-specific args)
    if (streamJson?.enabled) {
      cliArgs.push(...streamJson.args);

      // Setup JSON log file if saving raw JSON
      if (streamJson.saveRawJson) {
        const outputDir = join(process.cwd(), streamJson.outputDir);
        if (!existsSync(outputDir)) {
          mkdirSync(outputDir, { recursive: true });
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        jsonLogPath = join(outputDir, `ralph-run-${timestamp}.jsonl`);
      }
    }

    // Add model args if model is specified
    if (model && cliConfig.modelArgs) {
      cliArgs.push(...cliConfig.modelArgs, model);
    }

    // Use the filtered PRD (only incomplete items) for the prompt
    // promptArgs specifies flags to use (e.g., ["-p"] for Claude, [] for positional)
    const promptArgs = cliConfig.promptArgs ?? ["-p"];

    // Build the prompt value based on whether fileArgs is configured
    // fileArgs (e.g., ["--read"] for Aider) means files are passed as separate arguments
    // Otherwise, use @file syntax embedded in the prompt (Claude Code style)
    let promptValue: string;
    if (cliConfig.fileArgs && cliConfig.fileArgs.length > 0) {
      // Add files as separate arguments (e.g., --read prd-tasks.json --read progress.txt)
      for (const fileArg of cliConfig.fileArgs) {
        cliArgs.push(fileArg, filteredPrdPath);
        cliArgs.push(fileArg, paths.progress);
      }
      promptValue = prompt;
    } else {
      // Use @file syntax embedded in the prompt
      promptValue = `@${filteredPrdPath} @${paths.progress} ${prompt}`;
    }
    cliArgs.push(...promptArgs, promptValue);

    if (debug) {
      console.log(
        `[debug] ${cliConfig.command} ${cliArgs.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}\n`,
      );
      if (jsonLogPath) {
        console.log(`[debug] Saving raw JSON to: ${jsonLogPath}\n`);
      }
    }

    const proc = spawn(cliConfig.command, cliArgs, {
      stdio: ["inherit", "pipe", "pipe"],
    });

    // Capture stderr for error detection (also pass through to console)
    proc.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderrOutput += chunk;
      process.stderr.write(chunk);
    });

    proc.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();

      if (streamJson?.enabled) {
        // Process stream-json output: parse JSON and display clean text
        lineBuffer += chunk;
        const lines = lineBuffer.split("\n");
        // Keep the last incomplete line in the buffer
        lineBuffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          // Check if this is a JSON line
          if (trimmedLine.startsWith("{")) {
            // Save raw JSON if enabled
            if (jsonLogPath) {
              try {
                appendFileSync(jsonLogPath, trimmedLine + "\n");
              } catch {
                // Ignore write errors
              }
            }

            // Parse and display clean text using provider-specific parser
            const text = streamJson.parser.parseStreamJsonLine(trimmedLine);
            if (text) {
              process.stdout.write(text);
              output += text; // Accumulate parsed text for completion detection
            }
          } else {
            // Non-JSON line - display as-is (might be status messages, errors, etc.)
            process.stdout.write(trimmedLine + "\n");
            output += trimmedLine + "\n";
          }
        }
      } else {
        // Standard output: pass through as-is
        output += chunk;
        process.stdout.write(chunk);
      }
    });

    proc.on("close", (code) => {
      // Process any remaining buffered content
      if (streamJson?.enabled && lineBuffer.trim()) {
        const trimmedLine = lineBuffer.trim();
        if (trimmedLine.startsWith("{")) {
          if (jsonLogPath) {
            try {
              appendFileSync(jsonLogPath, trimmedLine + "\n");
            } catch {
              // Ignore write errors
            }
          }
          const text = streamJson.parser.parseStreamJsonLine(trimmedLine);
          if (text) {
            process.stdout.write(text);
            output += text;
          }
        } else {
          // Non-JSON remaining content
          process.stdout.write(trimmedLine + "\n");
          output += trimmedLine + "\n";
        }
      }

      // Ensure final newline for clean output
      if (streamJson?.enabled) {
        process.stdout.write("\n");
      }

      resolve({ exitCode: code ?? 0, output, stderr: stderrOutput });
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start ${cliConfig.command}: ${err.message}`));
    });
  });
}

/**
 * Parses stderr for model not found errors and extracts suggestions.
 * Supports OpenCode's ProviderModelNotFoundError format.
 * Returns the first suggested model, or null if no suggestion found.
 */
function parseModelNotFoundError(stderr: string): { modelID: string; suggestion: string } | null {
  // Match OpenCode's error format:
  // modelID: "glm-free",
  // suggestions: [ "glm-4.7-free" ],
  const modelMatch = stderr.match(/modelID:\s*["']([^"']+)["']/);
  const suggestionsMatch = stderr.match(/suggestions:\s*\[\s*["']([^"']+)["']/);

  if (modelMatch && suggestionsMatch) {
    return {
      modelID: modelMatch[1],
      suggestion: suggestionsMatch[1],
    };
  }

  return null;
}

/**
 * Sleep for the specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Formats elapsed time in a human-readable format.
 * Returns a string like "1h 23m 45s" or "5m 30s" or "45s"
 */
function formatElapsedTime(startTime: number, endTime: number): string {
  const totalSeconds = Math.floor((endTime - startTime) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(" ");
}

/**
 * Counts total and incomplete items in the PRD.
 * Optionally filters by category if specified.
 */
function countPrdItems(
  prdPath: string,
  category?: string,
): { total: number; incomplete: number; complete: number } {
  // Use readPrdFile to handle both JSON and YAML formats
  const parsed = readPrdFile(prdPath);

  if (!parsed) {
    const ext = extname(prdPath).toLowerCase();
    const format = ext === ".yaml" || ext === ".yml" ? "YAML" : "JSON";
    console.error(`\x1b[31mError: PRD contains invalid ${format}.\x1b[0m`);
    console.error("The file may have been corrupted by an LLM.\n");
    console.error("Run \x1b[36mralph fix-prd\x1b[0m to diagnose and repair the file.");
    process.exit(1);
  }

  if (!Array.isArray(parsed.content)) {
    console.error("\x1b[31mError: PRD is corrupted - expected an array of items.\x1b[0m");
    console.error("The file may have been modified incorrectly by an LLM.\n");
    console.error("Run \x1b[36mralph fix-prd\x1b[0m to diagnose and repair the file.");
    process.exit(1);
  }

  const items: PrdItem[] = parsed.content;
  let filteredItems = items;
  if (category) {
    filteredItems = items.filter((item) => item.category === category);
  }

  const complete = filteredItems.filter((item) => item.passes === true).length;
  const incomplete = filteredItems.filter((item) => item.passes === false).length;

  return {
    total: filteredItems.length,
    complete,
    incomplete,
  };
}

/**
 * Validates the PRD after an iteration and recovers if corrupted.
 * Uses the validPrd as the source of truth and merges passes flags from the current file.
 * Also preserves any new items added during the iteration.
 * Returns true if the PRD was corrupted and recovered.
 */
function validateAndRecoverPrd(
  prdPath: string,
  validPrd: PrdEntry[],
): { recovered: boolean; itemsUpdated: number; newItemsPreserved: number } {
  const parsed = readPrdFile(prdPath);

  // Helper to find items in current that don't exist in validPrd
  const findNewItems = (currentItems: unknown[]): PrdEntry[] => {
    const validDescriptions = new Set(validPrd.map((item) => item.description));
    const newItems: PrdEntry[] = [];

    for (const item of currentItems) {
      if (
        item &&
        typeof item === "object" &&
        "description" in item &&
        typeof (item as { description: unknown }).description === "string" &&
        !validDescriptions.has((item as { description: string }).description)
      ) {
        // This is a new item - preserve it with safe defaults
        const typedItem = item as Record<string, unknown>;
        const newEntry: PrdEntry = {
          category:
            typeof typedItem.category === "string"
              ? (typedItem.category as "feature" | "bug" | "chore")
              : "feature",
          description: typedItem.description as string,
          steps: Array.isArray(typedItem.steps) ? (typedItem.steps as string[]) : [],
          passes: typedItem.passes === true,
        };
        if (typeof typedItem.branch === "string") {
          newEntry.branch = typedItem.branch;
        }
        newItems.push(newEntry);
      }
    }
    return newItems;
  };

  // Try to extract new items even from corrupted PRD
  let newItems: PrdEntry[] = [];
  if (parsed && Array.isArray(parsed.content)) {
    newItems = findNewItems(parsed.content);
  }

  // If we can't even parse the JSON, restore from valid copy (with new items if we found any)
  if (!parsed) {
    console.log("\n\x1b[33mWarning: PRD corrupted (invalid JSON) - restored from memory.\x1b[0m");
    const mergedPrd = [...validPrd, ...newItems];
    writePrd(prdPath, mergedPrd);
    if (newItems.length > 0) {
      console.log(`\x1b[32mPreserved ${newItems.length} newly-added item(s).\x1b[0m`);
    }
    return { recovered: true, itemsUpdated: 0, newItemsPreserved: newItems.length };
  }

  // Validate the structure
  const validation = validatePrd(parsed.content);

  if (validation.valid) {
    // PRD is valid, no recovery needed
    return { recovered: false, itemsUpdated: 0, newItemsPreserved: 0 };
  }

  // PRD is corrupted - use smart merge to extract passes flags
  console.log("\n\x1b[33mWarning: PRD format corrupted by LLM - recovering...\x1b[0m");

  const mergeResult = smartMerge(validPrd, parsed.content);

  // Add any newly-added items
  const mergedPrd = [...mergeResult.merged, ...newItems];

  // Write the valid structure back (with new items)
  writePrd(prdPath, mergedPrd);

  if (mergeResult.itemsUpdated > 0) {
    console.log(
      `\x1b[32mRecovered: merged ${mergeResult.itemsUpdated} passes flag(s) into valid PRD structure.\x1b[0m`,
    );
  } else {
    console.log("\x1b[32mRecovered: restored valid PRD structure.\x1b[0m");
  }

  if (newItems.length > 0) {
    console.log(`\x1b[32mPreserved ${newItems.length} newly-added item(s).\x1b[0m`);
  }

  if (mergeResult.warnings.length > 0) {
    mergeResult.warnings.forEach((w) => console.log(`  \x1b[33m${w}\x1b[0m`));
  }

  return { recovered: true, itemsUpdated: mergeResult.itemsUpdated, newItemsPreserved: newItems.length };
}

/**
 * Loads a valid copy of the PRD to keep in memory.
 * Returns the validated PRD entries.
 */
function loadValidPrd(prdPath: string): PrdEntry[] {
  // Use readPrdFile to handle both JSON and YAML formats
  const parsed = readPrdFile(prdPath);

  if (!parsed || !Array.isArray(parsed.content)) {
    const ext = extname(prdPath).toLowerCase();
    const format = ext === ".yaml" || ext === ".yml" ? "YAML" : "JSON";
    console.error(`\x1b[31mError: PRD contains invalid ${format}.\x1b[0m`);
    console.error("Run \x1b[36mralph fix-prd\x1b[0m to diagnose and repair the file.");
    process.exit(1);
  }

  return parsed.content;
}

export async function run(args: string[]): Promise<void> {
  // Parse flags
  let category: string | undefined;
  let model: string | undefined;
  let loopMode = false;
  let allModeExplicit = false;
  let debug = false;
  const filteredArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--category" || args[i] === "-c") {
      if (i + 1 < args.length) {
        category = args[i + 1];
        i++; // Skip the category value
      } else {
        console.error("Error: --category requires a value");
        console.error(`Valid categories: ${CATEGORIES.join(", ")}`);
        process.exit(1);
      }
    } else if (args[i] === "--model" || args[i] === "-m") {
      if (i + 1 < args.length) {
        model = args[i + 1];
        i++; // Skip the model value
      } else {
        console.error("Error: --model requires a value");
        process.exit(1);
      }
    } else if (args[i] === "--loop" || args[i] === "-l") {
      loopMode = true;
    } else if (args[i] === "--all" || args[i] === "-a") {
      allModeExplicit = true;
    } else if (args[i] === "--debug" || args[i] === "-d") {
      debug = true;
    } else {
      filteredArgs.push(args[i]);
    }
  }

  // Validate category if provided
  if (category && !CATEGORIES.includes(category)) {
    console.error(`Error: Invalid category "${category}"`);
    console.error(`Valid categories: ${CATEGORIES.join(", ")}`);
    process.exit(1);
  }

  // Determine the mode:
  // - If --loop is specified, use loop mode
  // - If a specific number of iterations is provided, use that
  // - Otherwise, default to --all mode (run until all tasks complete)
  const hasIterationArg =
    filteredArgs.length > 0 && !isNaN(parseInt(filteredArgs[0])) && parseInt(filteredArgs[0]) >= 1;
  const allMode = !loopMode && (allModeExplicit || !hasIterationArg);

  requireContainer("run");
  checkFilesExist();

  const config = loadConfig();

  // Generate GEMINI.md in project root when using Gemini CLI
  // Gemini CLI auto-reads this file for provider-specific instructions
  if (config.cliProvider === "gemini") {
    const geminiMdPath = join(process.cwd(), "GEMINI.md");
    if (!existsSync(geminiMdPath)) {
      writeFileSync(geminiMdPath, GEMINI_MD);
      console.log("Created GEMINI.md (Gemini CLI instructions)");
    }
  }

  const template = loadPrompt();
  const prompt = resolvePromptVariables(template, {
    language: config.language,
    checkCommand: config.checkCommand,
    testCommand: config.testCommand,
    technologies: config.technologies,
  });
  const paths = getPaths();
  const cliConfig = getCliConfig(config);

  // Check if stream-json output is enabled
  const streamJsonConfig = config.docker?.asciinema?.streamJson;
  // Get provider-specific streamJsonArgs, falling back to Claude's defaults
  const providers = getCliProviders();
  const providerConfig = config.cliProvider ? providers[config.cliProvider] : providers["claude"];
  // Only use provider's streamJsonArgs if defined, otherwise empty array (no special args)
  // This allows providers without JSON streaming to still have output displayed
  const streamJsonArgs = providerConfig?.streamJsonArgs ?? [];

  const streamJson: StreamJsonOptions | undefined = streamJsonConfig?.enabled
    ? {
        enabled: true,
        saveRawJson: streamJsonConfig.saveRawJson !== false, // default true
        outputDir: config.docker?.asciinema?.outputDir || ".recordings",
        args: streamJsonArgs,
        parser: getStreamJsonParser(config.cliProvider, debug),
      }
    : undefined;

  // Progress tracking: stop only if no tasks complete after N iterations
  const MAX_ITERATIONS_WITHOUT_PROGRESS = 3;

  // Get requested iteration count (may be adjusted dynamically)
  const requestedIterations = parseInt(filteredArgs[0]) || Infinity;

  // Container is required, so always run with skip-permissions
  const sandboxed = true;

  if (allMode) {
    const counts = countPrdItems(paths.prd, category);
    console.log("Starting ralph in --all mode (runs until all tasks complete)...");
    console.log(
      `PRD Status: ${counts.complete}/${counts.total} complete, ${counts.incomplete} remaining`,
    );
  } else if (loopMode) {
    console.log("Starting ralph in loop mode (runs until interrupted)...");
  } else {
    console.log(`Starting ralph iterations (requested: ${requestedIterations})...`);
  }
  if (category) {
    console.log(`Filtering PRD items by category: ${category}`);
  }
  if (streamJson?.enabled) {
    console.log("Stream JSON output enabled - displaying formatted Claude output");
    if (streamJson.saveRawJson) {
      console.log(`Raw JSON logs will be saved to: ${streamJson.outputDir}/`);
    }
  }
  console.log();

  // Track temp file for cleanup
  let filteredPrdPath: string | null = null;

  const POLL_INTERVAL_MS = 30000; // 30 seconds between checks when waiting for new items
  const MAX_CONSECUTIVE_FAILURES = 3; // Stop after this many consecutive failures
  const startTime = Date.now();
  let consecutiveFailures = 0;
  let lastExitCode = 0;
  let iterationCount = 0;

  // Progress tracking for --all mode
  // Progress = tasks completed OR new tasks added (allows ralph to expand the PRD)
  const initialCounts = countPrdItems(paths.prd, category);
  let lastCompletedCount = initialCounts.complete;
  let lastTotalCount = initialCounts.total;
  let iterationsWithoutProgress = 0;

  // Create PID file to prevent multiple concurrent runs
  const pidFilePath = join(paths.dir, "run.pid");

  // Check if another instance is already running
  if (existsSync(pidFilePath)) {
    try {
      const existingPid = parseInt(readFileSync(pidFilePath, "utf-8").trim(), 10);
      if (!isNaN(existingPid)) {
        try {
          process.kill(existingPid, 0); // Check if process exists
          console.error(
            `\x1b[31mError: Another ralph run is already running (PID ${existingPid})\x1b[0m`,
          );
          console.error("Use 'ralph stop' or '/stop' via Telegram to terminate it first.");
          process.exit(1);
        } catch {
          // Process doesn't exist, stale PID file - clean it up
          unlinkSync(pidFilePath);
        }
      }
    } catch {
      // Ignore errors reading PID file, proceed to overwrite
    }
  }

  // Write our PID file
  writeFileSync(pidFilePath, process.pid.toString());

  // Ensure PID file is cleaned up on exit
  const cleanupPidFile = () => {
    try {
      if (existsSync(pidFilePath)) {
        const storedPid = parseInt(readFileSync(pidFilePath, "utf-8").trim(), 10);
        // Only delete if it's our PID (in case another instance started)
        if (storedPid === process.pid) {
          unlinkSync(pidFilePath);
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  };

  // Register cleanup handlers for various exit scenarios
  process.on("exit", cleanupPidFile);
  process.on("SIGINT", () => {
    cleanupPidFile();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanupPidFile();
    process.exit(143);
  });

  try {
    while (true) {
      iterationCount++;

      const currentCounts = countPrdItems(paths.prd, category);

      // Check if we should stop (not in loop mode)
      if (!loopMode && !allMode) {
        if (iterationCount > requestedIterations) {
          break;
        }
      }

      console.log(`\n${"=".repeat(50)}`);
      if (allMode) {
        console.log(
          `Iteration ${iterationCount} | Progress: ${currentCounts.complete}/${currentCounts.total} complete`,
        );
      } else if (loopMode) {
        console.log(`Iteration ${iterationCount}`);
      } else {
        console.log(`Iteration ${iterationCount} of ${requestedIterations}`);
      }
      console.log(`${"=".repeat(50)}\n`);

      // Load a valid copy of the PRD before handing to the LLM
      const validPrd = loadValidPrd(paths.prd);

      // Create a fresh filtered PRD for each iteration (in case items were completed)
      const { tempPath, hasIncomplete } = createFilteredPrd(paths.prd, paths.dir, category);
      filteredPrdPath = tempPath;

      if (!hasIncomplete) {
        // Clean up temp file since we're not using it
        try {
          unlinkSync(filteredPrdPath);
        } catch {
          // Ignore cleanup errors
        }
        filteredPrdPath = null;

        if (loopMode) {
          // In loop mode, wait for new items instead of exiting
          console.log("\n" + "=".repeat(50));
          if (category) {
            console.log(`All "${category}" items complete. Waiting for new items...`);
          } else {
            console.log("All items complete. Waiting for new items...");
          }
          console.log(`(Checking every ${POLL_INTERVAL_MS / 1000} seconds. Press Ctrl+C to stop)`);
          console.log("=".repeat(50));

          // Poll for new items
          while (true) {
            await sleep(POLL_INTERVAL_MS);
            const { hasIncomplete: newItems } = createFilteredPrd(paths.prd, paths.dir, category);
            if (newItems) {
              console.log("\nNew incomplete item(s) detected! Resuming...");
              break;
            }
          }
          // Decrement so we don't count waiting as an iteration
          iterationCount--;
          continue;
        } else {
          console.log("\n" + "=".repeat(50));
          if (allMode) {
            const counts = countPrdItems(paths.prd, category);
            if (category) {
              console.log(`PRD COMPLETE - All "${category}" tasks finished!`);
            } else {
              console.log("PRD COMPLETE - All tasks finished!");
            }
            console.log(`Final Status: ${counts.complete}/${counts.total} complete`);
          } else if (category) {
            console.log(`PRD COMPLETE - All "${category}" features already implemented!`);
          } else {
            console.log("PRD COMPLETE - All features already implemented!");
          }
          console.log("=".repeat(50));

          // Send notification for PRD completion
          await sendNotificationWithDaemonEvents("prd_complete", undefined, {
            command: config.notifyCommand,
            debug,
            daemonConfig: config.daemon,
            chatConfig: config.chat,
          });

          break;
        }
      }

      let { exitCode, output, stderr } = await runIteration(
        prompt,
        paths,
        sandboxed,
        filteredPrdPath,
        cliConfig,
        debug,
        model,
        streamJson,
      );

      // Check for model not found error and retry with suggestion
      if (exitCode !== 0 && stderr) {
        const modelError = parseModelNotFoundError(stderr);
        if (modelError) {
          console.log(
            `\n\x1b[33mModel "${modelError.modelID}" not found. Retrying with suggested model "${modelError.suggestion}"...\x1b[0m`,
          );
          console.log(
            `\x1b[90mTip: Add "modelArgs": ["--model"], and use "ralph run --model ${modelError.suggestion}" or configure in config.json\x1b[0m\n`,
          );

          // Retry with the suggested model
          const retryResult = await runIteration(
            prompt,
            paths,
            sandboxed,
            filteredPrdPath,
            cliConfig,
            debug,
            modelError.suggestion,
            streamJson,
          );
          exitCode = retryResult.exitCode;
          output = retryResult.output;
          stderr = retryResult.stderr;
        }
      }

      // Sync any completed items from prd-tasks.json back to prd.json
      // This catches cases where the LLM updated prd-tasks.json instead of prd.json
      const syncResult = syncPassesFromTasks(filteredPrdPath, paths.prd);

      // Send task_complete notification for each completed task
      for (const taskName of syncResult.taskNames) {
        await sendNotificationWithDaemonEvents(
          "task_complete",
          `Ralph: Task complete - ${taskName}`,
          {
            command: config.notifyCommand,
            debug,
            daemonConfig: config.daemon,
            chatConfig: config.chat,
            taskName,
          },
        );
      }

      // Clean up temp file after each iteration
      try {
        unlinkSync(filteredPrdPath);
      } catch {
        // Ignore cleanup errors
      }
      filteredPrdPath = null;

      // Validate and recover PRD if the LLM corrupted it
      validateAndRecoverPrd(paths.prd, validPrd);

      // Track progress for --all mode: stop if no progress after N iterations
      // Progress = tasks completed OR new tasks added (allows ralph to expand the PRD)
      if (allMode) {
        const progressCounts = countPrdItems(paths.prd, category);
        const tasksCompleted = progressCounts.complete > lastCompletedCount;
        const tasksAdded = progressCounts.total > lastTotalCount;

        if (tasksCompleted || tasksAdded) {
          // Progress made - reset counter
          iterationsWithoutProgress = 0;
          lastCompletedCount = progressCounts.complete;
          lastTotalCount = progressCounts.total;
        } else {
          iterationsWithoutProgress++;
        }

        if (iterationsWithoutProgress >= MAX_ITERATIONS_WITHOUT_PROGRESS) {
          console.log(
            `\nStopping: no progress after ${MAX_ITERATIONS_WITHOUT_PROGRESS} consecutive iterations.`,
          );
          console.log(`(No tasks completed and no new tasks added)`);
          console.log(
            `Status: ${progressCounts.complete}/${progressCounts.total} complete, ${progressCounts.incomplete} remaining.`,
          );
          console.log("Check the PRD and task definitions for issues.");

          // Send notification about stopped run
          const stoppedMessage = `No progress after ${MAX_ITERATIONS_WITHOUT_PROGRESS} iterations. ${progressCounts.incomplete} tasks remaining.`;
          await sendNotificationWithDaemonEvents(
            "run_stopped",
            `Ralph: Run stopped - ${stoppedMessage}`,
            {
              command: config.notifyCommand,
              debug,
              daemonConfig: config.daemon,
              chatConfig: config.chat,
              errorMessage: stoppedMessage,
            },
          );

          break;
        }
      }

      if (exitCode !== 0) {
        console.error(`\n${cliConfig.command} exited with code ${exitCode}`);

        // Track consecutive failures to detect persistent errors (e.g., missing API key)
        if (exitCode === lastExitCode) {
          consecutiveFailures++;
        } else {
          consecutiveFailures = 1;
          lastExitCode = exitCode;
        }

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.error(
            `\nStopping: ${cliConfig.command} failed ${consecutiveFailures} times in a row with exit code ${exitCode}.`,
          );
          console.error("This usually indicates a configuration error (e.g., missing API key).");
          console.error("Please check your CLI configuration and try again.");

          // Send notification about error
          const errorMessage = `CLI failed ${consecutiveFailures} times with exit code ${exitCode}. Check configuration.`;
          await sendNotificationWithDaemonEvents("error", `Ralph: ${errorMessage}`, {
            command: config.notifyCommand,
            debug,
            daemonConfig: config.daemon,
            chatConfig: config.chat,
            errorMessage,
          });

          break;
        }

        console.log("Continuing to next iteration...");
      } else {
        // Reset failure tracking on success
        consecutiveFailures = 0;
        lastExitCode = 0;
      }

      // Check for completion signal
      if (output.includes("<promise>COMPLETE</promise>")) {
        if (loopMode) {
          // In loop mode, wait for new items instead of exiting
          console.log("\n" + "=".repeat(50));
          console.log("PRD iteration complete. Waiting for new items...");
          console.log(`(Checking every ${POLL_INTERVAL_MS / 1000} seconds. Press Ctrl+C to stop)`);
          console.log("=".repeat(50));

          // Poll for new items
          while (true) {
            await sleep(POLL_INTERVAL_MS);
            const { hasIncomplete: newItems } = createFilteredPrd(paths.prd, paths.dir, category);
            if (newItems) {
              console.log("\nNew incomplete item(s) detected! Resuming...");
              break;
            }
          }
          continue;
        } else {
          console.log("\n" + "=".repeat(50));
          if (allMode) {
            const counts = countPrdItems(paths.prd, category);
            console.log("PRD COMPLETE - All tasks finished!");
            console.log(`Final Status: ${counts.complete}/${counts.total} complete`);
          } else {
            console.log("PRD COMPLETE - All features implemented!");
          }
          console.log("=".repeat(50));

          // Send notification if configured
          await sendNotificationWithDaemonEvents("prd_complete", undefined, {
            command: config.notifyCommand,
            debug,
            daemonConfig: config.daemon,
            chatConfig: config.chat,
          });

          break;
        }
      }
    }
  } finally {
    // Clean up temp file if it still exists
    if (filteredPrdPath) {
      try {
        unlinkSync(filteredPrdPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    // Clean up PID file
    cleanupPidFile();
  }

  const endTime = Date.now();
  const elapsed = formatElapsedTime(startTime, endTime);
  console.log(`\nRalph run finished in ${elapsed}.`);
}
