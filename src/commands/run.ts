import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { checkFilesExist, loadConfig, loadPrompt, getPaths } from "../utils/config.js";
import { resolvePromptVariables } from "../templates/prompts.js";

/**
 * Detects if we're running inside a container (Docker or Podman).
 * This is used to determine whether to pass --dangerously-skip-permissions to claude.
 */
function isRunningInContainer(): boolean {
  // Check DEVCONTAINER env var (set by ralph docker setup)
  if (process.env.DEVCONTAINER === "true") {
    return true;
  }

  // Check for /.dockerenv file (Docker creates this)
  if (existsSync("/.dockerenv")) {
    return true;
  }

  // Check /proc/1/cgroup for container hints (works for Docker and Podman)
  try {
    const cgroup = readFileSync("/proc/1/cgroup", "utf-8");
    if (cgroup.includes("docker") || cgroup.includes("podman") || cgroup.includes("/lxc/") || cgroup.includes("containerd")) {
      return true;
    }
  } catch {
    // File doesn't exist or can't be read (not on Linux or not in container)
  }

  // Check for container environment variables set by various container runtimes
  if (process.env.container === "podman" || process.env.container === "docker") {
    return true;
  }

  return false;
}

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
 * Returns the path to the temp file, or null if all items pass.
 */
function createFilteredPrd(prdPath: string, category?: string): { tempPath: string; hasIncomplete: boolean } {
  const content = readFileSync(prdPath, "utf-8");
  const items: PrdItem[] = JSON.parse(content);

  let filteredItems = items.filter(item => item.passes === false);

  // Apply category filter if specified
  if (category) {
    filteredItems = filteredItems.filter(item => item.category === category);
  }

  const tempPath = join(tmpdir(), `ralph-prd-filtered-${Date.now()}.json`);
  writeFileSync(tempPath, JSON.stringify(filteredItems, null, 2));

  return {
    tempPath,
    hasIncomplete: filteredItems.length > 0
  };
}

async function runIteration(prompt: string, paths: ReturnType<typeof getPaths>, sandboxed: boolean, filteredPrdPath: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    let output = "";

    // Build claude arguments
    const claudeArgs = ["--permission-mode", "acceptEdits"];

    // Only add --dangerously-skip-permissions when running in a container
    if (sandboxed) {
      claudeArgs.push("--dangerously-skip-permissions");
    }

    // Use the filtered PRD (only incomplete items) for the prompt
    claudeArgs.push("-p", `@${filteredPrdPath} @${paths.progress} ${prompt}`);

    const proc = spawn(
      "claude",
      claudeArgs,
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
      reject(new Error(`Failed to start claude: ${err.message}`));
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

export async function run(args: string[]): Promise<void> {
  // Parse flags
  let category: string | undefined;
  let loopMode = false;
  let allMode = false;
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
    } else if (args[i] === "--loop" || args[i] === "-l") {
      loopMode = true;
    } else if (args[i] === "--all" || args[i] === "-a") {
      allMode = true;
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

  // In loop mode or all mode, iterations argument is optional (defaults to unlimited)
  const iterations = (loopMode || allMode) ? (parseInt(filteredArgs[0]) || Infinity) : parseInt(filteredArgs[0]);

  if (!loopMode && !allMode && (!iterations || iterations < 1 || isNaN(iterations))) {
    console.error("Usage: ralph run <iterations> [--category <category>]");
    console.error("       ralph run --loop [--category <category>]");
    console.error("       ralph run --all [--category <category>]");
    console.error("  <iterations> must be a positive integer");
    console.error(`  <category> must be one of: ${CATEGORIES.join(", ")}`);
    process.exit(1);
  }

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

  // Check if we're running in a sandboxed container environment
  const sandboxed = isRunningInContainer();

  if (allMode) {
    const counts = countPrdItems(paths.prd, category);
    console.log("Starting ralph in --all mode (runs until all tasks complete)...");
    console.log(`PRD Status: ${counts.complete}/${counts.total} complete, ${counts.incomplete} remaining`);
  } else if (loopMode) {
    console.log("Starting ralph in loop mode (runs until interrupted)...");
  } else {
    console.log(`Starting ${iterations} ralph iteration(s)...`);
  }
  if (category) {
    console.log(`Filtering PRD items by category: ${category}`);
  }
  console.log();
  if (sandboxed) {
    console.log("Detected container environment - running with --dangerously-skip-permissions\n");
  }

  // Track temp file for cleanup
  let filteredPrdPath: string | null = null;

  const POLL_INTERVAL_MS = 30000; // 30 seconds between checks when waiting for new items
  const startTime = Date.now();

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

      // Create a fresh filtered PRD for each iteration (in case items were completed)
      const { tempPath, hasIncomplete } = createFilteredPrd(paths.prd, category);
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
            const { hasIncomplete: newItems } = createFilteredPrd(paths.prd, category);
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

      const { exitCode, output } = await runIteration(prompt, paths, sandboxed, filteredPrdPath);

      // Clean up temp file after each iteration
      try {
        unlinkSync(filteredPrdPath);
      } catch {
        // Ignore cleanup errors
      }
      filteredPrdPath = null;

      if (exitCode !== 0) {
        console.error(`\nClaude exited with code ${exitCode}`);
        console.log("Continuing to next iteration...");
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
            const { hasIncomplete: newItems } = createFilteredPrd(paths.prd, category);
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
