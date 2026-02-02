import { existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname, extname } from "path";
import YAML from "yaml";

export interface PrdEntry {
  category: string;
  description: string;
  steps: string[];
  passes: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  data?: PrdEntry[];
}

export interface MergeResult {
  merged: PrdEntry[];
  itemsUpdated: number;
  warnings: string[];
}

interface ExtractedItem {
  description: string;
  passes: boolean;
}

const VALID_CATEGORIES = ["ui", "feature", "bugfix", "setup", "development", "testing", "docs"];

/**
 * Validates that a PRD structure is correct.
 * Returns validation result with parsed data if valid.
 */
export function validatePrd(content: unknown): ValidationResult {
  const errors: string[] = [];

  // Must be an array
  if (!Array.isArray(content)) {
    errors.push("PRD must be a JSON array");
    return { valid: false, errors };
  }

  const data: PrdEntry[] = [];

  for (let i = 0; i < content.length; i++) {
    const item = content[i];
    const prefix = `Item ${i + 1}:`;

    if (typeof item !== "object" || item === null) {
      errors.push(`${prefix} must be an object`);
      continue;
    }

    const entry = item as Record<string, unknown>;

    // Check required fields
    if (typeof entry.category !== "string") {
      errors.push(`${prefix} missing or invalid 'category' field`);
    } else if (!VALID_CATEGORIES.includes(entry.category)) {
      errors.push(`${prefix} invalid category '${entry.category}'`);
    }

    if (typeof entry.description !== "string" || entry.description.length === 0) {
      errors.push(`${prefix} missing or invalid 'description' field`);
    }

    if (!Array.isArray(entry.steps)) {
      errors.push(`${prefix} missing or invalid 'steps' field (must be array)`);
    } else {
      for (let j = 0; j < entry.steps.length; j++) {
        if (typeof entry.steps[j] !== "string") {
          errors.push(`${prefix} step ${j + 1} must be a string`);
        }
      }
    }

    if (typeof entry.passes !== "boolean") {
      errors.push(`${prefix} missing or invalid 'passes' field (must be boolean)`);
    }

    // If no errors for this item, add to valid data
    if (errors.filter((e) => e.startsWith(prefix)).length === 0) {
      data.push({
        category: entry.category as string,
        description: entry.description as string,
        steps: entry.steps as string[],
        passes: entry.passes as boolean,
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], data };
}

/**
 * Extracts items marked as passing from a corrupted PRD structure.
 * Handles various malformed structures LLMs might create.
 */
export function extractPassingItems(corrupted: unknown): ExtractedItem[] {
  const items: ExtractedItem[] = [];

  // Handle null/undefined
  if (corrupted === null || corrupted === undefined) {
    return items;
  }

  // Handle direct array
  if (Array.isArray(corrupted)) {
    for (const item of corrupted) {
      const extracted = extractFromItem(item);
      if (extracted) {
        items.push(extracted);
      }
    }
    return items;
  }

  // Handle object with wrapped arrays
  if (typeof corrupted === "object") {
    const obj = corrupted as Record<string, unknown>;

    // Common wrapper keys LLMs might use
    const wrapperKeys = ["features", "items", "entries", "prd", "tasks", "requirements"];

    for (const key of wrapperKeys) {
      if (Array.isArray(obj[key])) {
        for (const item of obj[key]) {
          const extracted = extractFromItem(item);
          if (extracted) {
            items.push(extracted);
          }
        }
        return items;
      }
    }

    // Try to extract from object directly (in case it's a single item)
    const extracted = extractFromItem(obj);
    if (extracted) {
      items.push(extracted);
    }
  }

  return items;
}

/**
 * Extracts description and passes status from an item,
 * handling various field names LLMs might use.
 */
function extractFromItem(item: unknown): ExtractedItem | null {
  if (typeof item !== "object" || item === null) {
    return null;
  }

  const obj = item as Record<string, unknown>;

  // Find description - check various field names
  const descriptionFields = ["description", "desc", "name", "title", "task", "feature"];
  let description = "";

  for (const field of descriptionFields) {
    if (typeof obj[field] === "string" && obj[field]) {
      description = obj[field] as string;
      break;
    }
  }

  if (!description) {
    return null;
  }

  // Find passes status - check various field names and values
  const passesFields = [
    "passes",
    "pass",
    "passed",
    "done",
    "complete",
    "completed",
    "status",
    "finished",
  ];
  let passes = false;

  for (const field of passesFields) {
    const value = obj[field];

    if (typeof value === "boolean") {
      passes = value;
      break;
    }

    if (typeof value === "string") {
      const lower = value.toLowerCase();
      if (
        lower === "true" ||
        lower === "pass" ||
        lower === "passed" ||
        lower === "done" ||
        lower === "complete" ||
        lower === "completed" ||
        lower === "finished"
      ) {
        passes = true;
        break;
      }
    }
  }

  return { description, passes };
}

/**
 * Calculates similarity between two strings using Jaccard index on words.
 */
function similarity(a: string, b: string): number {
  const wordsA = new Set(
    a
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
  const wordsB = new Set(
    b
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

  if (wordsA.size === 0 || wordsB.size === 0) {
    return 0;
  }

  const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}

/**
 * Smart merge: applies passes flags from corrupted PRD to valid original.
 * Only updates items that were marked as passing in the corrupted version.
 */
export function smartMerge(original: PrdEntry[], corrupted: unknown): MergeResult {
  const passingItems = extractPassingItems(corrupted);
  const merged = original.map((entry) => ({ ...entry })); // Deep copy
  let updated = 0;
  const warnings: string[] = [];

  for (const item of passingItems) {
    if (!item.passes) continue;

    // Find matching original item by description similarity
    let bestMatch: PrdEntry | null = null;
    let bestScore = 0;

    for (const entry of merged) {
      // Exact substring match
      if (
        entry.description.includes(item.description) ||
        item.description.includes(entry.description)
      ) {
        bestMatch = entry;
        bestScore = 1;
        break;
      }

      // Similarity match
      const score = similarity(entry.description, item.description);
      if (score > bestScore && score > 0.5) {
        bestMatch = entry;
        bestScore = score;
      }
    }

    if (bestMatch && !bestMatch.passes) {
      bestMatch.passes = true;
      updated++;
    } else if (!bestMatch) {
      warnings.push(`Could not match item: "${item.description.substring(0, 50)}..."`);
    }
  }

  return { merged, itemsUpdated: updated, warnings };
}

/**
 * Attempts to recover a valid PRD from corrupted content.
 * Returns the recovered PRD entries or null if recovery failed.
 */
export function attemptRecovery(corrupted: unknown): PrdEntry[] | null {
  // Strategy 1: Unwrap from common wrapper objects
  if (typeof corrupted === "object" && corrupted !== null && !Array.isArray(corrupted)) {
    const obj = corrupted as Record<string, unknown>;
    const wrapperKeys = ["features", "items", "entries", "prd", "tasks", "requirements"];

    for (const key of wrapperKeys) {
      if (Array.isArray(obj[key])) {
        const result = attemptArrayRecovery(obj[key]);
        if (result) return result;
      }
    }
  }

  // Strategy 2: Direct array recovery with field mapping
  if (Array.isArray(corrupted)) {
    const result = attemptArrayRecovery(corrupted);
    if (result) return result;
  }

  return null;
}

/**
 * Attempts to recover PRD entries from an array with possibly renamed fields.
 */
function attemptArrayRecovery(items: unknown[]): PrdEntry[] | null {
  const recovered: PrdEntry[] = [];

  for (const item of items) {
    if (typeof item !== "object" || item === null) {
      return null; // Can't recover if items aren't objects
    }

    const obj = item as Record<string, unknown>;

    // Map fields to standard names
    const entry: Partial<PrdEntry> = {};

    // Category mapping
    const categoryFields = ["category", "cat", "type", "id"];
    for (const field of categoryFields) {
      if (typeof obj[field] === "string") {
        const value = obj[field] as string;
        if (VALID_CATEGORIES.includes(value)) {
          entry.category = value;
          break;
        }
      }
    }

    // Description mapping
    const descFields = ["description", "desc", "name", "title", "task", "feature"];
    for (const field of descFields) {
      if (typeof obj[field] === "string" && obj[field]) {
        entry.description = obj[field] as string;
        break;
      }
    }

    // Steps mapping
    const stepsFields = ["steps", "verification", "checks", "tasks"];
    for (const field of stepsFields) {
      if (Array.isArray(obj[field])) {
        const steps = (obj[field] as unknown[]).filter((s) => typeof s === "string") as string[];
        if (steps.length > 0) {
          entry.steps = steps;
          break;
        }
      }
    }

    // Passes mapping
    const passesFields = [
      "passes",
      "pass",
      "passed",
      "done",
      "complete",
      "completed",
      "status",
      "finished",
    ];
    for (const field of passesFields) {
      const value = obj[field];
      if (typeof value === "boolean") {
        entry.passes = value;
        break;
      }
      if (typeof value === "string") {
        const lower = value.toLowerCase();
        if (
          lower === "true" ||
          lower === "pass" ||
          lower === "passed" ||
          lower === "done" ||
          lower === "complete" ||
          lower === "completed" ||
          lower === "finished"
        ) {
          entry.passes = true;
          break;
        }
        if (
          lower === "false" ||
          lower === "fail" ||
          lower === "failed" ||
          lower === "pending" ||
          lower === "incomplete"
        ) {
          entry.passes = false;
          break;
        }
      }
    }

    // Check if we recovered all required fields
    if (!entry.category || !entry.description) {
      return null; // Missing critical fields
    }

    // Default missing optional fields
    if (!entry.steps) {
      entry.steps = ["Verify the feature works as expected"];
    }
    if (entry.passes === undefined) {
      entry.passes = false;
    }

    recovered.push(entry as PrdEntry);
  }

  return recovered.length > 0 ? recovered : null;
}

/**
 * Creates a timestamped backup of the PRD file.
 * Preserves the original file extension (.json or .yaml/.yml).
 * Returns the backup path.
 */
export function createBackup(prdPath: string): string {
  const content = readFileSync(prdPath, "utf-8");
  const dir = dirname(prdPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = extname(prdPath).toLowerCase();
  // Preserve original extension, default to .json if unknown
  const backupExt = ext === ".yaml" || ext === ".yml" ? ext : ".json";
  const backupPath = join(dir, `backup.prd.${timestamp}${backupExt}`);

  writeFileSync(backupPath, content);
  return backupPath;
}

/**
 * Finds the most recent backup file.
 * Searches for both .json and .yaml/.yml backup files.
 * Returns the path or null if no backups exist.
 */
export function findLatestBackup(prdPath: string): string | null {
  const dir = dirname(prdPath);

  if (!existsSync(dir)) {
    return null;
  }

  const files = readdirSync(dir);
  const backups = files
    .filter(
      (f) =>
        f.startsWith("backup.prd.") &&
        (f.endsWith(".json") || f.endsWith(".yaml") || f.endsWith(".yml")),
    )
    .sort()
    .reverse();

  if (backups.length === 0) {
    return null;
  }

  return join(dir, backups[0]);
}

/**
 * Creates a PRD template with a recovery entry that instructs the LLM to fix the PRD.
 * Uses @{filepath} syntax to include backup content when expanded.
 * @param backupPath - Absolute path to the backup file containing the corrupted PRD
 */
export function createTemplatePrd(backupPath?: string): PrdEntry[] {
  if (backupPath) {
    // Use absolute path in @{} reference to avoid path resolution issues
    const absolutePath = backupPath.startsWith("/") ? backupPath : join(process.cwd(), backupPath);

    return [
      {
        category: "setup",
        description: "Fix the PRD entries",
        steps: [
          `Recreate PRD entries based on this corrupted backup content:\n\n@{${absolutePath}}`,
          "Write valid entries to .ralph/prd.json with format: category (string), description (string), steps (array of strings), passes (boolean)",
        ],
        passes: false,
      },
    ];
  }

  return [
    {
      category: "setup",
      description: "Add PRD entries",
      steps: [
        "Add requirements using 'ralph add' or edit .ralph/prd.json directly",
        "Verify format: category (string), description (string), steps (array of strings), passes (boolean)",
      ],
      passes: false,
    },
  ];
}

/**
 * Reads and parses a YAML PRD file.
 * Returns the parsed content or null if it couldn't be parsed.
 */
export function readYamlPrdFile(prdPath: string): { content: unknown; raw: string } | null {
  try {
    const raw = readFileSync(prdPath, "utf-8");
    const content = YAML.parse(raw);
    return { content, raw };
  } catch {
    return null;
  }
}

/**
 * Reads and parses a PRD file, handling potential JSON/YAML errors.
 * Detects file format based on extension (.yaml/.yml uses YAML, .json uses JSON).
 * Returns the parsed content or null if it couldn't be parsed.
 */
export function readPrdFile(prdPath: string): { content: unknown; raw: string } | null {
  try {
    const raw = readFileSync(prdPath, "utf-8");
    const ext = extname(prdPath).toLowerCase();

    // Parse based on file extension
    let content: unknown;
    if (ext === ".yaml" || ext === ".yml") {
      content = YAML.parse(raw);
    } else {
      // Default to JSON for .json or any other extension
      content = JSON.parse(raw);
    }

    return { content, raw };
  } catch {
    return null;
  }
}

/**
 * Writes a PRD to file.
 */
export function writePrd(prdPath: string, entries: PrdEntry[]): void {
  writeFileSync(prdPath, JSON.stringify(entries, null, 2) + "\n");
}

/**
 * Expands @{filepath} patterns in a string with actual file contents.
 * Similar to curl's @ syntax for including file contents.
 * Paths are resolved relative to the .ralph directory.
 */
export function expandFileReferences(text: string, baseDir: string): string {
  // Match @{filepath} patterns
  const pattern = /@\{([^}]+)\}/g;

  return text.replace(pattern, (match, filepath) => {
    // Resolve path relative to baseDir (typically .ralph/)
    const fullPath = filepath.startsWith("/") ? filepath : join(baseDir, filepath);

    if (!existsSync(fullPath)) {
      return `[File not found: ${fullPath}]`;
    }

    try {
      const content = readFileSync(fullPath, "utf-8");
      return content;
    } catch {
      return `[Error reading: ${fullPath}]`;
    }
  });
}

/**
 * Expands file references in all string fields of PRD entries.
 * Returns a new array with expanded content.
 */
export function expandPrdFileReferences(entries: PrdEntry[], baseDir: string): PrdEntry[] {
  return entries.map((entry) => ({
    ...entry,
    description: expandFileReferences(entry.description, baseDir),
    steps: entry.steps.map((step) => expandFileReferences(step, baseDir)),
  }));
}
