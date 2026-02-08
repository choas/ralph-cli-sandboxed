import { spawn, execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, appendFileSync, mkdirSync, copyFileSync } from "fs";
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
  saveBranchState,
  loadBranchState,
  clearBranchState,
  getProjectName,
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
 * Converts a branch name to a worktree directory name, prefixed with the project name.
 * e.g., "feat/login" -> "myproject_feat-login"
 * The project prefix avoids conflicts when multiple projects share the same worktrees directory.
 */
function branchToWorktreeName(branch: string): string {
  const projectName = getProjectName();
  return `${projectName}_${branch.replace(/\//g, "-")}`;
}

/**
 * Checks if the git repository has at least one commit (valid HEAD).
 * Returns false for empty repos or repos without any commits.
 */
function repoHasCommits(): boolean {
  try {
    execSync("git rev-parse HEAD", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Groups PRD items by branch field.
 * Returns a Map where:
 * - key is the branch name (or "" for items without a branch)
 * - value is an array of PrdItem for that branch
 * Only includes items that are incomplete (passes: false).
 */
function groupItemsByBranch(items: PrdItem[]): Map<string, PrdItem[]> {
  const groups = new Map<string, PrdItem[]>();

  for (const item of items) {
    if (item.passes) continue; // Skip completed items

    const key = item.branch || "";
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }

  return groups;
}

/**
 * Creates or reuses a git worktree for the given branch.
 * The worktree is created at /worktrees/<project>_<branch-dir-name>.
 * If the branch doesn't exist, it's created from the current HEAD.
 * Returns the absolute path to the worktree directory.
 */
function ensureWorktree(branch: string, worktreesBase: string): string {
  const dirName = branchToWorktreeName(branch);
  const worktreePath = join(worktreesBase, dirName);

  if (existsSync(worktreePath)) {
    console.log(`\x1b[90m[ralph] Reusing worktree for branch "${branch}" at ${worktreePath}\x1b[0m`);
    return worktreePath;
  }

  console.log(`\x1b[90m[ralph] Creating worktree for branch "${branch}" at ${worktreePath}\x1b[0m`);

  // Check if the branch already exists
  let branchExists = false;
  try {
    execSync(`git rev-parse --verify "${branch}"`, { stdio: "pipe" });
    branchExists = true;
  } catch {
    // Branch doesn't exist yet
  }

  try {
    if (branchExists) {
      execSync(`git worktree add "${worktreePath}" "${branch}"`, { stdio: "pipe" });
    } else {
      // Create new branch from current HEAD
      execSync(`git worktree add -b "${branch}" "${worktreePath}"`, { stdio: "pipe" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to create worktree for branch "${branch}": ${message}`);
  }

  return worktreePath;
}

/**
 * Sets up the .ralph/ directory in a worktree with branch-specific files.
 * - Creates .ralph/ directory
 * - Writes a filtered prd-tasks.json containing only items for this branch
 * - Creates or reuses progress.txt
 * - Copies prompt.md from the workspace
 */
function setupWorktreeRalphDir(
  worktreePath: string,
  branchItems: PrdItem[],
  workspacePaths: ReturnType<typeof getPaths>,
): { ralphDir: string; prdTasksPath: string; progressPath: string } {
  const ralphDir = join(worktreePath, ".ralph");
  const prdTasksPath = join(ralphDir, "prd-tasks.json");
  const progressPath = join(ralphDir, "progress.txt");
  const promptPath = join(ralphDir, "prompt.md");

  // Create .ralph/ directory if it doesn't exist
  if (!existsSync(ralphDir)) {
    mkdirSync(ralphDir, { recursive: true });
  }

  // Write filtered prd-tasks.json for this branch
  // Expand @{filepath} references relative to the workspace .ralph/ dir
  const expandedItems = expandPrdFileReferences(branchItems, workspacePaths.dir);
  writeFileSync(prdTasksPath, JSON.stringify(expandedItems, null, 2));

  // Create progress.txt if it doesn't exist (preserve existing one for resume)
  if (!existsSync(progressPath)) {
    writeFileSync(progressPath, "# Progress Log\n\n");
  }

  // Copy prompt.md from workspace
  if (existsSync(workspacePaths.prompt)) {
    copyFileSync(workspacePaths.prompt, promptPath);
  }

  return { ralphDir, prdTasksPath, progressPath };
}

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
    console.log("\nNote: PRD corrupted (invalid JSON) - restored from memory.");
    const mergedPrd = [...validPrd, ...newItems];
    writePrd(prdPath, mergedPrd);
    if (newItems.length > 0) {
      console.log(`Preserved ${newItems.length} newly-added item(s).`);
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
  console.log("\nNote: PRD format corrupted by LLM - recovering...");

  const mergeResult = smartMerge(validPrd, parsed.content);

  // Add any newly-added items
  const mergedPrd = [...mergeResult.merged, ...newItems];

  // Write the valid structure back (with new items)
  writePrd(prdPath, mergedPrd);

  if (mergeResult.itemsUpdated > 0) {
    console.log(
      `Recovered: merged ${mergeResult.itemsUpdated} passes flag(s) into valid PRD structure.`,
    );
  } else {
    console.log("Recovered: restored valid PRD structure.");
  }

  if (newItems.length > 0) {
    console.log(`Preserved ${newItems.length} newly-added item(s).`);
  }

  if (mergeResult.warnings.length > 0) {
    mergeResult.warnings.forEach((w) => console.log(`  ${w}`));
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

  // Detect if worktrees are available (/worktrees exists and is mounted)
  const worktreesBase = "/worktrees";
  const worktreesAvailable = existsSync(worktreesBase);
  const workspaceCwd = process.cwd();

  // Check for existing branch state from a previous interrupted run
  const resumedBranchState = loadBranchState();
  if (resumedBranchState) {
    const resumeDir = join(worktreesBase, branchToWorktreeName(resumedBranchState.currentBranch));
    if (existsSync(resumeDir)) {
      console.log(
        `\x1b[90m[ralph] Resuming work on branch "${resumedBranchState.currentBranch}" (worktree: ${resumeDir})\x1b[0m`,
      );
    } else {
      console.log(
        `\x1b[90m[ralph] Resuming work on branch "${resumedBranchState.currentBranch}"\x1b[0m`,
      );
    }
  }

  /**
   * Runs a single iteration in the given working directory.
   * Handles: cwd switch, running CLI, syncing results, cwd restore.
   * Returns the iteration result for flow control.
   */
  async function runIterationInDir(
    iterPaths: ReturnType<typeof getPaths>,
    iterFilteredPrdPath: string,
    iterValidPrd: PrdEntry[],
    targetDir: string,
    branchLabel?: string,
  ): Promise<{ exitCode: number; output: string; stderr: string; syncResult: SyncResult }> {
    // Change to target directory
    if (targetDir !== workspaceCwd) {
      process.chdir(targetDir);
      if (branchLabel) {
        console.log(`\x1b[90m[ralph] Working in worktree: ${targetDir} (branch: ${branchLabel})\x1b[0m`);
      }
    }

    try {
      let { exitCode, output, stderr } = await runIteration(
        prompt,
        iterPaths,
        sandboxed,
        iterFilteredPrdPath,
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

          const retryResult = await runIteration(
            prompt,
            iterPaths,
            sandboxed,
            iterFilteredPrdPath,
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

      // Sync completed items from worktree's prd-tasks.json back to master PRD
      const syncResult = syncPassesFromTasks(iterFilteredPrdPath, paths.prd);

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

      // Clean up temp file after iteration
      try {
        unlinkSync(iterFilteredPrdPath);
      } catch {
        // Ignore cleanup errors
      }

      return { exitCode, output, stderr, syncResult };
    } finally {
      // Always restore working directory
      if (targetDir !== workspaceCwd) {
        process.chdir(workspaceCwd);
        console.log(`\x1b[90m[ralph] Switched back to ${workspaceCwd}\x1b[0m`);
      }
    }
  }

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

      // Read all items and group by branch
      const prdContent = readPrdFile(paths.prd)?.content;
      const allItems: PrdItem[] = Array.isArray(prdContent) ? prdContent : [];
      let itemsForIteration = allItems.filter((item) => !item.passes);
      if (category) {
        itemsForIteration = itemsForIteration.filter((item) => item.category === category);
      }
      const branchGroups = groupItemsByBranch(itemsForIteration);

      // Check if there are any incomplete items
      if (branchGroups.size === 0) {
        if (loopMode) {
          console.log("\n" + "=".repeat(50));
          if (category) {
            console.log(`All "${category}" items complete. Waiting for new items...`);
          } else {
            console.log("All items complete. Waiting for new items...");
          }
          console.log(`(Checking every ${POLL_INTERVAL_MS / 1000} seconds. Press Ctrl+C to stop)`);
          console.log("=".repeat(50));

          while (true) {
            await sleep(POLL_INTERVAL_MS);
            const { hasIncomplete: newItems } = createFilteredPrd(paths.prd, paths.dir, category);
            if (newItems) {
              console.log("\nNew incomplete item(s) detected! Resuming...");
              break;
            }
          }
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

          await sendNotificationWithDaemonEvents("prd_complete", undefined, {
            command: config.notifyCommand,
            debug,
            daemonConfig: config.daemon,
            chatConfig: config.chat,
          });

          break;
        }
      }

      let iterExitCode = 0;
      let iterOutput = "";
      let iterSterr = "";
      let iterSyncTotal = 0;

      // Get the base branch for branch state tracking
      let baseBranch = "main";
      const hasCommits = repoHasCommits();
      if (hasCommits) {
        try {
          baseBranch = execSync("git -C /workspace rev-parse --abbrev-ref HEAD", {
            encoding: "utf-8",
          }).trim();
        } catch {
          // Default to "main"
        }
      }

      // Merge items tagged with the base branch into the no-branch group,
      // so they run in /workspace instead of creating a worktree.
      const baseBranchItems = branchGroups.get(baseBranch);
      if (baseBranchItems && baseBranchItems.length > 0) {
        const noBranch = branchGroups.get("") || [];
        branchGroups.set("", [...noBranch, ...baseBranchItems]);
        branchGroups.delete(baseBranch);
      }

      // Find the first incomplete item to determine which group to process.
      // If resuming from a previous interruption, prioritize the resumed branch.
      let targetBranch: string;
      if (resumedBranchState) {
        targetBranch = resumedBranchState.currentBranch;
        // If resumed branch is the base branch, treat as no-branch
        if (targetBranch === baseBranch) {
          targetBranch = "";
          clearBranchState();
        }
      } else {
        const firstIncomplete = itemsForIteration.find((item) => !item.passes);
        targetBranch = firstIncomplete?.branch || "";
        // If the target matches the base branch, treat as no-branch
        if (targetBranch === baseBranch) {
          targetBranch = "";
        }
      }

      if (targetBranch !== "" && worktreesAvailable && hasCommits) {
        // Process this one branch group in its worktree
        const branchItems = branchGroups.get(targetBranch) || [];

        if (branchItems.length === 0) {
          // Resumed branch has no remaining items — clear state and fall through
          clearBranchState();
        } else {
          console.log(`\n\x1b[36m--- Branch group: ${targetBranch} (${branchItems.length} item(s)) ---\x1b[0m`);

          // Save active branch state to config for resume after interruption
          saveBranchState(baseBranch, targetBranch);

          // Create or reuse the worktree
          let worktreePath: string;
          try {
            worktreePath = ensureWorktree(targetBranch, worktreesBase);
          } catch (err) {
            console.error(`\x1b[31mError creating worktree for "${targetBranch}": ${err instanceof Error ? err.message : err}\x1b[0m`);
            clearBranchState();
            continue;
          }

          // Set up .ralph/ in the worktree with branch-specific files
          const worktreeSetup = setupWorktreeRalphDir(worktreePath, branchItems, paths);

          // Create paths object for the worktree
          const worktreePaths = {
            ...paths,
            dir: worktreeSetup.ralphDir,
            progress: worktreeSetup.progressPath,
          };

          const result = await runIterationInDir(
            worktreePaths,
            worktreeSetup.prdTasksPath,
            validPrd,
            worktreePath,
            targetBranch,
          );

          // Clear branch state after this branch group completes
          clearBranchState();

          iterExitCode = result.exitCode;
          iterOutput = result.output;
          iterSterr = result.stderr;
          iterSyncTotal += result.syncResult.count;
        }
      } else if (targetBranch !== "" && !worktreesAvailable) {
        // Branch items found but worktrees not available — warn and process no-branch items instead
        console.warn(
          `\x1b[33mWarning: PRD items tagged with branch "${targetBranch}" found, but /worktrees is not mounted.\x1b[0m`,
        );
        console.warn(
          `\x1b[33mConfigure docker.worktreesPath in .ralph/config.json and rebuild the container.\x1b[0m`,
        );
        const branchItems = branchGroups.get(targetBranch) || [];
        console.warn(`\x1b[33mSkipping ${branchItems.length} branch item(s).\x1b[0m\n`);
      } else if (targetBranch !== "" && !hasCommits) {
        // Branch items found but no commits — warn and process no-branch items instead
        console.warn(
          `\x1b[33mWarning: PRD items tagged with branch "${targetBranch}" found, but the repository has no commits.\x1b[0m`,
        );
        console.warn(
          `\x1b[33mCreate an initial commit before using branch-based PRD items.\x1b[0m`,
        );
        const branchItems = branchGroups.get(targetBranch) || [];
        console.warn(`\x1b[33mSkipping ${branchItems.length} branch item(s).\x1b[0m\n`);
      }

      // Process no-branch items in /workspace (when target is no-branch, or branch was skipped)
      if (targetBranch === "" || (!worktreesAvailable && targetBranch !== "") || (!hasCommits && targetBranch !== "")) {
        const noBranchItems = branchGroups.get("") || [];
        if (noBranchItems.length > 0) {
          const hasBranches = [...branchGroups.keys()].some((key) => key !== "");
          if (hasBranches) {
            console.log(`\n\x1b[36m--- No-branch items (${noBranchItems.length} item(s)) ---\x1b[0m`);
          }

          // Create filtered PRD for no-branch items only (or all items if no branches exist)
          const { tempPath } = createFilteredPrd(paths.prd, paths.dir, category);
          filteredPrdPath = tempPath;

          // If there are branch groups, rewrite prd-tasks.json to only include no-branch items
          if (hasBranches) {
            const expandedNoBranch = expandPrdFileReferences(noBranchItems, paths.dir);
            writeFileSync(filteredPrdPath, JSON.stringify(expandedNoBranch, null, 2));
          }

          const result = await runIterationInDir(
            paths,
            filteredPrdPath,
            validPrd,
            workspaceCwd,
          );
          filteredPrdPath = null;

          iterExitCode = result.exitCode;
          iterOutput = result.output;
          iterSterr = result.stderr;
          iterSyncTotal += result.syncResult.count;
        }
      }

      // Validate and recover PRD if the LLM corrupted it
      validateAndRecoverPrd(paths.prd, validPrd);

      // Track progress for --all mode: stop if no progress after N iterations
      if (allMode) {
        const progressCounts = countPrdItems(paths.prd, category);
        const tasksCompleted = progressCounts.complete > lastCompletedCount;
        const tasksAdded = progressCounts.total > lastTotalCount;

        if (tasksCompleted || tasksAdded) {
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

      if (iterExitCode !== 0) {
        console.error(`\n${cliConfig.command} exited with code ${iterExitCode}`);

        if (iterExitCode === lastExitCode) {
          consecutiveFailures++;
        } else {
          consecutiveFailures = 1;
          lastExitCode = iterExitCode;
        }

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.error(
            `\nStopping: ${cliConfig.command} failed ${consecutiveFailures} times in a row with exit code ${iterExitCode}.`,
          );
          console.error("This usually indicates a configuration error (e.g., missing API key).");
          console.error("Please check your CLI configuration and try again.");

          const errorMessage = `CLI failed ${consecutiveFailures} times with exit code ${iterExitCode}. Check configuration.`;
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
        consecutiveFailures = 0;
        lastExitCode = 0;
      }

      // Check for completion signal from the LLM.
      // The LLM only sees a subset of items (branch group or no-branch group),
      // so its COMPLETE signal means "this group is done", not "all PRD items are done".
      // We must verify the full PRD before treating this as a global completion.
      if (iterOutput.includes("<promise>COMPLETE</promise>")) {
        const fullCounts = countPrdItems(paths.prd, category);
        if (fullCounts.incomplete > 0) {
          // There are still incomplete items in other groups — continue the loop
          if (debug) {
            console.log(
              `\n\x1b[90m[ralph] LLM signalled COMPLETE for current group, but ${fullCounts.incomplete} item(s) remain. Continuing...\x1b[0m`,
            );
          }
        } else if (loopMode) {
          console.log("\n" + "=".repeat(50));
          console.log("PRD iteration complete. Waiting for new items...");
          console.log(`(Checking every ${POLL_INTERVAL_MS / 1000} seconds. Press Ctrl+C to stop)`);
          console.log("=".repeat(50));

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
            console.log("PRD COMPLETE - All tasks finished!");
            console.log(`Final Status: ${fullCounts.complete}/${fullCounts.total} complete`);
          } else {
            console.log("PRD COMPLETE - All features implemented!");
          }
          console.log("=".repeat(50));

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
