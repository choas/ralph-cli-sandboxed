import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { checkFilesExist, loadConfig, loadPrompt, getPaths, getCliConfig, CliConfig, requireContainer } from "../utils/config.js";
import { resolvePromptVariables } from "../templates/prompts.js";
import { validatePrd, smartMerge, readPrdFile, writePrd, expandPrdFileReferences, PrdEntry } from "../utils/prd-validator.js";

interface PrdItem {
  category: string;
  description: string;
  steps: string[];
  passes: boolean;
}

const CATEGORIES = ["ui", "feature", "bugfix", "setup", "development", "testing", "docs"];

/**
 * Creates a filtered PRD file containing only incomplete items (passes: false).
 * Optionally filters by category if specified.
 * Expands @{filepath} references to include file contents.
 * Returns the path to the temp file, or null if all items pass.
 */
function createFilteredPrd(prdPath: string, baseDir: string, category?: string): { tempPath: string; hasIncomplete: boolean } {
  const content = readFileSync(prdPath, "utf-8");
  const items: PrdItem[] = JSON.parse(content);

  let filteredItems = items.filter(item => item.passes === false);

  // Apply category filter if specified
  if (category) {
    filteredItems = filteredItems.filter(item => item.category === category);
  }

  // Expand @{filepath} references in description and steps
  const expandedItems = expandPrdFileReferences(filteredItems, baseDir);

  const tempPath = join(tmpdir(), `ralph-prd-filtered-${Date.now()}.json`);
  writeFileSync(tempPath, JSON.stringify(expandedItems, null, 2));

  return {
    tempPath,
    hasIncomplete: filteredItems.length > 0
  };
}

async function runIteration(prompt: string, paths: ReturnType<typeof getPaths>, sandboxed: boolean, filteredPrdPath: string, cliConfig: CliConfig, debug: boolean, model?: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    let output = "";

    // Build CLI arguments: config args + yolo args + model args + prompt args
    const cliArgs = [
      ...(cliConfig.args ?? []),
    ];

    // Only add yolo args when running in a container
    // Use yoloArgs from config if available, otherwise default to Claude's --dangerously-skip-permissions
    if (sandboxed) {
      const yoloArgs = cliConfig.yoloArgs ?? ["--dangerously-skip-permissions"];
      cliArgs.push(...yoloArgs);
    }

    // Add model args if model is specified
    if (model && cliConfig.modelArgs) {
      cliArgs.push(...cliConfig.modelArgs, model);
    }

    // Use the filtered PRD (only incomplete items) for the prompt
    // promptArgs specifies flags to use (e.g., ["-p"] for Claude, [] for positional)
    const promptArgs = cliConfig.promptArgs ?? ["-p"];
    const promptValue = `@${filteredPrdPath} @${paths.progress} ${prompt}`;
    cliArgs.push(...promptArgs, promptValue);

    if (debug) {
      console.log(`[debug] ${cliConfig.command} ${cliArgs.map(a => a.includes(" ") ? `"${a}"` : a).join(" ")}\n`);
    }

    const proc = spawn(
      cliConfig.command,
      cliArgs,
      {
        stdio: ["inherit", "pipe", "inherit"],
      }
    );

    proc.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;
      process.stdout.write(chunk);
    });

    proc.on("close", (code) => {
      resolve({ exitCode: code ?? 0, output });
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start ${cliConfig.command}: ${err.message}`));
    });
  });
}

/**
 * Sleep for the specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
function countPrdItems(prdPath: string, category?: string): { total: number; incomplete: number; complete: number } {
  const content = readFileSync(prdPath, "utf-8");
  const items: PrdItem[] = JSON.parse(content);

  let filteredItems = items;
  if (category) {
    filteredItems = items.filter(item => item.category === category);
  }

  const complete = filteredItems.filter(item => item.passes === true).length;
  const incomplete = filteredItems.filter(item => item.passes === false).length;

  return {
    total: filteredItems.length,
    complete,
    incomplete
  };
}

/**
 * Validates the PRD after an iteration and recovers if corrupted.
 * Uses the validPrd as the source of truth and merges passes flags from the current file.
 * Returns true if the PRD was corrupted and recovered.
 */
function validateAndRecoverPrd(prdPath: string, validPrd: PrdEntry[]): { recovered: boolean; itemsUpdated: number } {
  const parsed = readPrdFile(prdPath);

  // If we can't even parse the JSON, restore from valid copy
  if (!parsed) {
    console.log("\n\x1b[33mWarning: PRD corrupted (invalid JSON) - restored from memory.\x1b[0m");
    writePrd(prdPath, validPrd);
    return { recovered: true, itemsUpdated: 0 };
  }

  // Validate the structure
  const validation = validatePrd(parsed.content);

  if (validation.valid) {
    // PRD is valid, no recovery needed
    return { recovered: false, itemsUpdated: 0 };
  }

  // PRD is corrupted - use smart merge to extract passes flags
  console.log("\n\x1b[33mWarning: PRD format corrupted by LLM - recovering...\x1b[0m");

  const mergeResult = smartMerge(validPrd, parsed.content);

  // Write the valid structure back
  writePrd(prdPath, mergeResult.merged);

  if (mergeResult.itemsUpdated > 0) {
    console.log(`\x1b[32mRecovered: merged ${mergeResult.itemsUpdated} passes flag(s) into valid PRD structure.\x1b[0m`);
  } else {
    console.log("\x1b[32mRecovered: restored valid PRD structure.\x1b[0m");
  }

  if (mergeResult.warnings.length > 0) {
    mergeResult.warnings.forEach(w => console.log(`  \x1b[33m${w}\x1b[0m`));
  }

  return { recovered: true, itemsUpdated: mergeResult.itemsUpdated };
}

/**
 * Loads a valid copy of the PRD to keep in memory.
 * Returns the validated PRD entries.
 */
function loadValidPrd(prdPath: string): PrdEntry[] {
  const content = readFileSync(prdPath, "utf-8");
  return JSON.parse(content);
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
  const hasIterationArg = filteredArgs.length > 0 && !isNaN(parseInt(filteredArgs[0])) && parseInt(filteredArgs[0]) >= 1;
  const allMode = !loopMode && (allModeExplicit || !hasIterationArg);

  requireContainer("run");
  checkFilesExist();

  const config = loadConfig();
  const template = loadPrompt();
  const prompt = resolvePromptVariables(template, {
    language: config.language,
    checkCommand: config.checkCommand,
    testCommand: config.testCommand,
    technologies: config.technologies,
  });
  const paths = getPaths();
  const cliConfig = getCliConfig(config);

  // Calculate iteration limit: incomplete items + 3 (safety margin)
  // Loop mode has no limit, other modes are capped
  const initialCounts = countPrdItems(paths.prd, category);
  const maxIterations = initialCounts.incomplete + 3;

  let iterations: number;
  if (loopMode) {
    // Loop mode: no automatic limit
    iterations = parseInt(filteredArgs[0]) || Infinity;
  } else if (allMode) {
    // All mode: cap at maxIterations
    iterations = maxIterations;
  } else {
    // Explicit count: cap at maxIterations
    iterations = Math.min(parseInt(filteredArgs[0]), maxIterations);
  }

  // Container is required, so always run with skip-permissions
  const sandboxed = true;

  if (allMode) {
    const counts = countPrdItems(paths.prd, category);
    console.log("Starting ralph in --all mode (runs until all tasks complete)...");
    console.log(`PRD Status: ${counts.complete}/${counts.total} complete, ${counts.incomplete} remaining`);
    console.log(`Max iterations: ${maxIterations}`);
  } else if (loopMode) {
    console.log("Starting ralph in loop mode (runs until interrupted)...");
  } else {
    console.log(`Starting ${iterations} ralph iteration(s)... (max: ${maxIterations})`);
  }
  if (category) {
    console.log(`Filtering PRD items by category: ${category}`);
  }
  console.log();

  // Track temp file for cleanup
  let filteredPrdPath: string | null = null;

  const POLL_INTERVAL_MS = 30000; // 30 seconds between checks when waiting for new items
  const MAX_CONSECUTIVE_FAILURES = 3; // Stop after this many consecutive failures
  const startTime = Date.now();
  let consecutiveFailures = 0;
  let lastExitCode = 0;

  try {
    for (let i = 1; i <= iterations; i++) {
      console.log(`\n${"=".repeat(50)}`);
      if (allMode) {
        const counts = countPrdItems(paths.prd, category);
        console.log(`Iteration ${i} | Progress: ${counts.complete}/${counts.total} complete`);
      } else if (loopMode && iterations === Infinity) {
        console.log(`Iteration ${i}`);
      } else {
        console.log(`Iteration ${i} of ${iterations}`);
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
          // Decrement i so we don't skip an iteration count
          i--;
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
          break;
        }
      }

      const { exitCode, output } = await runIteration(prompt, paths, sandboxed, filteredPrdPath, cliConfig, debug, model);

      // Clean up temp file after each iteration
      try {
        unlinkSync(filteredPrdPath);
      } catch {
        // Ignore cleanup errors
      }
      filteredPrdPath = null;

      // Validate and recover PRD if the LLM corrupted it
      validateAndRecoverPrd(paths.prd, validPrd);

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
          console.error(`\nStopping: ${cliConfig.command} failed ${consecutiveFailures} times in a row with exit code ${exitCode}.`);
          console.error("This usually indicates a configuration error (e.g., missing API key).");
          console.error("Please check your CLI configuration and try again.");
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
          if (config.notifyCommand) {
            const [cmd, ...cmdArgs] = config.notifyCommand.split(" ");
            const notifyProc = spawn(cmd, [...cmdArgs, "Ralph: PRD Complete!"], { stdio: "ignore" });
            notifyProc.on("error", () => {
              // Notification command not available, ignore
            });
          }

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
  }

  const endTime = Date.now();
  const elapsed = formatElapsedTime(startTime, endTime);
  console.log(`\nRalph run finished in ${elapsed}.`);
}
