import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import YAML from "yaml";
import { getRalphDir } from "../utils/config.js";

interface PrdEntry {
  category: string;
  description: string;
  steps: string[];
  passes: boolean;
}

const PRD_JSON_FILE = "prd.json";
const PRD_YAML_FILE = "prd.yaml";
const PRD_BACKUP_SUFFIX = ".pre-yaml";

function getPrdJsonPath(): string {
  return join(getRalphDir(), PRD_JSON_FILE);
}

function getPrdYamlPath(): string {
  return join(getRalphDir(), PRD_YAML_FILE);
}

/**
 * Converts prd.json to prd.yaml format.
 * - Reads .ralph/prd.json
 * - Converts to YAML format
 * - Writes to .ralph/prd.yaml
 * - Renames original prd.json to prd.json.pre-yaml
 */
export async function prdConvert(args: string[]): Promise<void> {
  const force = args.includes("--force") || args.includes("-f");
  const dryRun = args.includes("--dry-run") || args.includes("-n");

  const jsonPath = getPrdJsonPath();
  const yamlPath = getPrdYamlPath();
  const backupPath = jsonPath + PRD_BACKUP_SUFFIX;

  // Check if prd.json exists
  if (!existsSync(jsonPath)) {
    console.error("Error: .ralph/prd.json not found.");
    console.error("Run 'ralph init' first to create a project.");
    process.exit(1);
  }

  // Check if prd.yaml already exists
  if (existsSync(yamlPath) && !force) {
    console.error("Error: .ralph/prd.yaml already exists.");
    console.error("Use --force to overwrite the existing YAML file.");
    process.exit(1);
  }

  // Check if backup already exists (previous conversion)
  if (existsSync(backupPath) && !force) {
    console.error("Error: .ralph/prd.json.pre-yaml already exists.");
    console.error("It appears a previous conversion was performed.");
    console.error("Use --force to overwrite existing files.");
    process.exit(1);
  }

  // Read and parse JSON
  let prdEntries: PrdEntry[];
  try {
    const jsonContent = readFileSync(jsonPath, "utf-8");
    prdEntries = JSON.parse(jsonContent);

    if (!Array.isArray(prdEntries)) {
      throw new Error("PRD content is not an array");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Error reading .ralph/prd.json: ${message}`);
    console.error("Run 'ralph fix-prd' to attempt repair.");
    process.exit(1);
  }

  // Convert to YAML
  const yamlContent = YAML.stringify(prdEntries, {
    indent: 2,
    lineWidth: 0, // Don't wrap lines
  });

  if (dryRun) {
    console.log("Dry run - no files will be modified.\n");
    console.log("Would convert .ralph/prd.json to .ralph/prd.yaml:\n");
    console.log("--- YAML Output ---");
    console.log(yamlContent);
    console.log("-------------------\n");
    console.log(`Entries: ${prdEntries.length}`);
    return;
  }

  // Write YAML file
  writeFileSync(yamlPath, yamlContent);
  console.log(`\x1b[32m✓\x1b[0m Created .ralph/prd.yaml`);

  // Rename original JSON to backup
  renameSync(jsonPath, backupPath);
  console.log(`\x1b[32m✓\x1b[0m Renamed .ralph/prd.json to .ralph/prd.json.pre-yaml`);

  // Success message
  console.log(`\n\x1b[32mConversion complete!\x1b[0m`);
  console.log(`  Converted ${prdEntries.length} PRD entries to YAML format.\n`);

  console.log("Next steps:");
  console.log("  1. Your PRD is now in .ralph/prd.yaml");
  console.log("  2. The original JSON is preserved as .ralph/prd.json.pre-yaml");
  console.log("  3. Ralph will automatically use the YAML file going forward");
  console.log("");
  console.log("To revert, simply rename the files back:");
  console.log("  mv .ralph/prd.json.pre-yaml .ralph/prd.json");
  console.log("  rm .ralph/prd.yaml");
}

function showHelp(): void {
  console.log("Usage: ralph prd convert [options]\n");
  console.log("Convert .ralph/prd.json to .ralph/prd.yaml format.\n");
  console.log("Options:");
  console.log("  --force, -f     Overwrite existing prd.yaml and backup files");
  console.log("  --dry-run, -n   Show what would be converted without making changes");
  console.log("  --help, -h      Show this help message\n");
  console.log("The original prd.json will be renamed to prd.json.pre-yaml as a backup.");
}

export async function convert(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    return;
  }

  await prdConvert(args);
}
