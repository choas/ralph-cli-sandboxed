import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { extname, join } from "path";
import { promptInput, promptSelect } from "../utils/prompt.js";
import { getRalphDir, getPrdFiles } from "../utils/config.js";
import { convert as prdConvert } from "./prd-convert.js";
import { DEFAULT_PRD_YAML } from "../templates/prompts.js";
import YAML from "yaml";

interface PrdEntry {
  category: string;
  description: string;
  steps: string[];
  passes: boolean;
}

const PRD_FILE_JSON = "prd.json";
const PRD_FILE_YAML = "prd.yaml";
const CATEGORIES = ["ui", "feature", "bugfix", "setup", "development", "testing", "docs"];

// Track whether we've shown the migration notice in this session
let migrationNoticeShown = false;

function getPrdPath(): string {
  const prdFiles = getPrdFiles();
  if (prdFiles.primary) {
    return prdFiles.primary;
  }
  // Fallback to json path for backwards compatibility
  return join(getRalphDir(), PRD_FILE_JSON);
}

/**
 * Parses a PRD file based on its extension.
 * Supports both JSON and YAML formats.
 * Returns empty array if file is empty or parses to null.
 */
function parsePrdFile(path: string): PrdEntry[] {
  const content = readFileSync(path, "utf-8");
  const ext = extname(path).toLowerCase();

  try {
    let result: PrdEntry[] | null;
    if (ext === ".yaml" || ext === ".yml") {
      result = YAML.parse(content);
    } else {
      result = JSON.parse(content);
    }
    // Handle empty files or null content
    return result ?? [];
  } catch (err) {
    const format = ext === ".yaml" || ext === ".yml" ? "YAML" : "JSON";
    const message = err instanceof Error ? err.message : `Invalid ${format}`;
    console.error(`Error parsing ${path}: ${message}`);
    console.error("");
    console.error("Common issues:");
    if (format === "JSON") {
      console.error("  - Trailing comma before ] or }");
      console.error("  - Missing comma between entries");
      console.error("  - Unescaped quotes in strings");
    } else {
      console.error("  - Incorrect indentation");
      console.error("  - Missing colons after keys");
      console.error("  - Unquoted special characters");
    }
    console.error("");
    console.error("Run 'ralph fix-prd' to attempt automatic repair.");
    process.exit(1);
  }
}

/**
 * Loads PRD entries from prd.yaml and/or prd.json.
 * - If neither exists, creates prd.yaml with default content
 * - If both exist, merges them (no deduplication)
 * - If only prd.json exists, shows migration notice
 * - If only prd.yaml exists, uses it (happy path)
 */
function loadPrd(): PrdEntry[] {
  const prdFiles = getPrdFiles();

  if (prdFiles.none) {
    // Create .ralph directory if it doesn't exist
    const ralphDir = getRalphDir();
    if (!existsSync(ralphDir)) {
      mkdirSync(ralphDir, { recursive: true });
    }
    // Create default prd.yaml
    const prdPath = join(ralphDir, PRD_FILE_YAML);
    writeFileSync(prdPath, DEFAULT_PRD_YAML);
    console.log(`Created ${prdPath}`);
    return parsePrdFile(prdPath);
  }

  // If only JSON exists, show migration notice (once per session)
  if (prdFiles.jsonOnly && !migrationNoticeShown) {
    console.log("\x1b[33mNote: Consider migrating to YAML format with 'ralph prd convert'\x1b[0m");
    console.log("");
    migrationNoticeShown = true;
  }

  // Load primary file
  const primary = parsePrdFile(prdFiles.primary!);

  // If both files exist, merge them
  if (prdFiles.both && prdFiles.secondary) {
    const secondary = parsePrdFile(prdFiles.secondary);
    // Merge without deduplication - primary (YAML) first, then secondary (JSON)
    return [...primary, ...secondary];
  }

  return primary;
}

function savePrd(entries: PrdEntry[]): void {
  const path = getPrdPath();
  const ext = extname(path).toLowerCase();

  if (ext === ".yaml" || ext === ".yml") {
    writeFileSync(path, YAML.stringify(entries));
  } else {
    writeFileSync(path, JSON.stringify(entries, null, 2) + "\n");
  }
}

export async function prdAdd(): Promise<void> {
  console.log("Add new PRD entry\n");

  const category = await promptSelect("Select category:", CATEGORIES);
  const description = await promptInput("\nDescription: ");

  if (!description) {
    console.error("Description is required.");
    process.exit(1);
  }

  console.log("\nEnter verification steps (empty line to finish):");
  const steps: string[] = [];
  let stepNum = 1;

  while (true) {
    const step = await promptInput(`  Step ${stepNum}: `);
    if (!step) break;
    steps.push(step);
    stepNum++;
  }

  if (steps.length === 0) {
    steps.push("Verify the feature works as expected");
  }

  const entry: PrdEntry = {
    category,
    description,
    steps,
    passes: false,
  };

  const prd = loadPrd();
  prd.push(entry);
  savePrd(prd);

  console.log(`\nAdded entry #${prd.length}: "${description}"`);
}

export function prdList(category?: string, passesFilter?: boolean): void {
  const prd = loadPrd();

  if (prd.length === 0) {
    console.log("No PRD entries found.");
    return;
  }

  // Build filtered list, preserving original indices
  let filteredPrd = prd.map((entry, i) => ({ entry, originalIndex: i }));

  // Filter by category if specified
  if (category) {
    filteredPrd = filteredPrd.filter(({ entry }) => entry.category === category);
  }

  // Filter by passes status if specified
  if (passesFilter !== undefined) {
    filteredPrd = filteredPrd.filter(({ entry }) => entry.passes === passesFilter);
  }

  if (filteredPrd.length === 0) {
    const filters: string[] = [];
    if (category) filters.push(`category "${category}"`);
    if (passesFilter === true) filters.push("passes=true");
    if (passesFilter === false) filters.push("passes=false");
    console.log(`No PRD entries found matching: ${filters.join(", ")}.`);
    return;
  }

  // Build header
  const filters: string[] = [];
  if (category) filters.push(`category: ${category}`);
  if (passesFilter === true) filters.push("passing only");
  if (passesFilter === false) filters.push("incomplete only");

  if (filters.length > 0) {
    console.log(`\nPRD Entries (${filters.join(", ")}):\n`);
  } else {
    console.log("\nPRD Entries:\n");
  }

  filteredPrd.forEach(({ entry, originalIndex }) => {
    const statusEmoji = entry.passes ? "✅" : "○";
    console.log(`  ${originalIndex + 1}. ${statusEmoji} [${entry.category}] ${entry.description}`);
    entry.steps.forEach((step, j) => {
      console.log(`       ${j + 1}. ${step}`);
    });
    console.log();
  });
}

export function prdStatus(headOnly: boolean = false): void {
  const prd = loadPrd();

  if (prd.length === 0) {
    console.log("No PRD entries found.");
    return;
  }

  const passing = prd.filter((e) => e.passes).length;
  const total = prd.length;
  const percentage = Math.round((passing / total) * 100);

  console.log(`\nPRD Status: ${passing}/${total} passing (${percentage}%)\n`);

  // Progress bar
  const barWidth = 30;
  const filled = Math.round((passing / total) * barWidth);
  const bar = "\x1b[32m" + "\u2588".repeat(filled) + "\x1b[0m" + "\u2591".repeat(barWidth - filled);
  console.log(`  [${bar}]\n`);

  // By category
  const byCategory: Record<string, { pass: number; total: number }> = {};

  prd.forEach((entry) => {
    if (!byCategory[entry.category]) {
      byCategory[entry.category] = { pass: 0, total: 0 };
    }
    byCategory[entry.category].total++;
    if (entry.passes) byCategory[entry.category].pass++;
  });

  console.log("  By category:");
  Object.entries(byCategory).forEach(([cat, stats]) => {
    console.log(`    ${cat}: ${stats.pass}/${stats.total}`);
  });

  if (passing === total) {
    console.log("\n  \x1b[32m\u2713 All requirements complete!\x1b[0m");
  } else if (!headOnly) {
    const remaining = prd.filter((e) => !e.passes);
    console.log(`\n  Remaining (${remaining.length}):`);
    remaining.forEach((entry) => {
      console.log(`    - [${entry.category}] ${entry.description}`);
    });
  }
}

export function prdToggle(args: string[]): void {
  const arg = args[0];

  // Check for --all flag
  if (arg === "--all" || arg === "-a") {
    const prd = loadPrd();

    if (prd.length === 0) {
      console.log("No PRD entries to toggle.");
      return;
    }

    prd.forEach((entry) => {
      entry.passes = !entry.passes;
    });
    savePrd(prd);

    console.log(`Toggled all ${prd.length} PRD entries.`);
    return;
  }

  // Parse all numeric arguments
  const indices: number[] = [];
  for (const a of args) {
    const index = parseInt(a);
    if (!index || isNaN(index)) {
      console.error("Usage: ralph prd toggle <number> [number2] [number3] ...");
      console.error("       ralph prd toggle --all");
      process.exit(1);
    }
    indices.push(index);
  }

  if (indices.length === 0) {
    console.error("Usage: ralph prd toggle <number> [number2] [number3] ...");
    console.error("       ralph prd toggle --all");
    process.exit(1);
  }

  const prd = loadPrd();

  // Validate all indices
  for (const index of indices) {
    if (index < 1 || index > prd.length) {
      console.error(`Invalid entry number: ${index}. Must be 1-${prd.length}`);
      process.exit(1);
    }
  }

  // Toggle each entry
  for (const index of indices) {
    const entry = prd[index - 1];
    entry.passes = !entry.passes;
    const statusText = entry.passes ? "PASSING" : "NOT PASSING";
    console.log(`Entry #${index} "${entry.description}" is now ${statusText}`);
  }

  savePrd(prd);
}

export function prdClean(): void {
  const prd = loadPrd();

  const originalLength = prd.length;
  const filtered = prd.filter((entry) => !entry.passes);

  if (filtered.length === originalLength) {
    console.log("No passing entries to clean.");
    return;
  }

  const removed = originalLength - filtered.length;
  savePrd(filtered);

  console.log(`Removed ${removed} passing ${removed === 1 ? "entry" : "entries"}.`);
  console.log(`${filtered.length} ${filtered.length === 1 ? "entry" : "entries"} remaining.`);
}

export function parseListArgs(args: string[]): { category?: string; passesFilter?: boolean } {
  let category: string | undefined;
  let passesFilter: boolean | undefined;

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
    } else if (args[i] === "--passes" || args[i] === "--passed") {
      passesFilter = true;
    } else if (
      args[i] === "--no-passes" ||
      args[i] === "--no-passed" ||
      args[i] === "--not-passed" ||
      args[i] === "--not-passes"
    ) {
      passesFilter = false;
    }
  }

  // Validate category if provided
  if (category && !CATEGORIES.includes(category)) {
    console.error(`Error: Invalid category "${category}"`);
    console.error(`Valid categories: ${CATEGORIES.join(", ")}`);
    process.exit(1);
  }

  return { category, passesFilter };
}

export async function prd(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "add":
      await prdAdd();
      break;
    case "list": {
      const { category, passesFilter } = parseListArgs(args.slice(1));
      prdList(category, passesFilter);
      break;
    }
    case "status": {
      const headOnly = args.slice(1).includes("--head");
      prdStatus(headOnly);
      break;
    }
    case "toggle":
      prdToggle(args.slice(1));
      break;
    case "clean":
      prdClean();
      break;
    case "convert":
      await prdConvert(args.slice(1));
      break;
    default:
      console.error("Usage: ralph prd <add|list|status|toggle|clean|convert>");
      console.error("\nSubcommands:");
      console.error("  add                         Add a new PRD entry");
      console.error("  list [options]              List all PRD entries");
      console.error("  status [--head]             Show completion status");
      console.error(
        "  toggle <n> ...              Toggle passes status for entry n (accepts multiple)",
      );
      console.error("  toggle --all                Toggle all PRD entries");
      console.error("  clean                       Remove all passing entries from the PRD");
      console.error("  convert [options]           Convert prd.json to prd.yaml format");
      console.error("\nList options:");
      console.error("  --category, -c <cat>        Filter by category");
      console.error("  --passes                    Show only completed items");
      console.error("  --no-passes                 Show only incomplete items");
      console.error("  --stats                     Show statistics instead of entries");
      console.error("\nConvert options:");
      console.error("  --force, -f                 Overwrite existing files");
      console.error("  --dry-run, -n               Preview without making changes");
      console.error(`\nValid categories: ${CATEGORIES.join(", ")}`);
      process.exit(1);
  }
}
