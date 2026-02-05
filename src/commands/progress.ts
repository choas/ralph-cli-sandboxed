import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { extname, join } from "path";
import { getRalphDir, getPrdFiles } from "../utils/config.js";
import { DEFAULT_PRD_YAML } from "../templates/prompts.js";
import YAML from "yaml";

interface PrdEntry {
  category: string;
  description: string;
  steps: string[];
  passes: boolean;
}

const PRD_FILE_YAML = "prd.yaml";
const PRD_FILE_JSON = "prd.json";

function getPrdPath(): string {
  const prdFiles = getPrdFiles();
  if (prdFiles.primary) {
    return prdFiles.primary;
  }
  return join(getRalphDir(), PRD_FILE_JSON);
}

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
    return result ?? [];
  } catch {
    console.error(`Error parsing ${path}. Run 'ralph fix-prd' to attempt automatic repair.`);
    process.exit(1);
  }
}

function loadPrd(): PrdEntry[] {
  const prdFiles = getPrdFiles();

  if (prdFiles.none) {
    const ralphDir = getRalphDir();
    if (!existsSync(ralphDir)) {
      mkdirSync(ralphDir, { recursive: true });
    }
    const prdPath = join(ralphDir, PRD_FILE_YAML);
    writeFileSync(prdPath, DEFAULT_PRD_YAML);
    console.log(`Created ${prdPath}`);
    return parsePrdFile(prdPath);
  }

  const primary = parsePrdFile(prdFiles.primary!);

  if (prdFiles.both && prdFiles.secondary) {
    const secondary = parsePrdFile(prdFiles.secondary);
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

function progressSummarize(): void {
  const ralphDir = getRalphDir();
  const progressPath = join(ralphDir, "progress.txt");

  if (!existsSync(progressPath)) {
    console.error("No progress.txt found. Run 'ralph init' first.");
    process.exit(1);
  }

  const entry: PrdEntry = {
    category: "docs",
    description:
      "Summarize progress.txt: create a timestamped backup (e.g. progress-2024-01-15T10-30-00.txt) then rewrite progress.txt as a concise summary without losing any information",
    steps: [
      "Create a backup of .ralph/progress.txt with a timestamp in the filename (e.g. .ralph/progress-2024-01-15T10-30-00.txt)",
      "Rewrite .ralph/progress.txt as a concise summary that preserves all information but is shorter and better organized",
      "Verify the backup file exists and contains the original content",
      "Verify the new progress.txt contains all key information from the original",
    ],
    passes: false,
  };

  const prd = loadPrd();
  prd.push(entry);
  savePrd(prd);

  console.log(`Added PRD entry #${prd.length}: Summarize progress.txt`);
  console.log("Run 'ralph run' or 'ralph once' to execute the summarization.");
}

export async function progress(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "summarize":
      progressSummarize();
      break;
    default:
      console.error("Usage: ralph progress <summarize>");
      console.error("\nSubcommands:");
      console.error(
        "  summarize    Add a PRD entry to summarize and compact progress.txt",
      );
      process.exit(1);
  }
}
