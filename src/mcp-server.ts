#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, extname, join } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import YAML from "yaml";
import { getRalphDir, getPrdFiles } from "./utils/config.js";
import { DEFAULT_PRD_YAML } from "./templates/prompts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PrdEntry {
  category: string;
  description: string;
  steps: string[];
  passes: boolean;
  branch?: string;
}

const CATEGORIES = ["ui", "feature", "bugfix", "setup", "development", "testing", "docs"] as const;

const PRD_FILE_JSON = "prd.json";
const PRD_FILE_YAML = "prd.yaml";

/**
 * Returns the path to the primary PRD file (MCP-safe version).
 */
function getPrdPath(): string {
  const prdFiles = getPrdFiles();
  if (prdFiles.primary) {
    return prdFiles.primary;
  }
  return join(getRalphDir(), PRD_FILE_JSON);
}

/**
 * Saves PRD entries to disk, auto-detecting format from file extension.
 */
function savePrd(entries: PrdEntry[]): void {
  const path = getPrdPath();
  const ext = extname(path).toLowerCase();

  if (ext === ".yaml" || ext === ".yml") {
    writeFileSync(path, YAML.stringify(entries));
  } else {
    writeFileSync(path, JSON.stringify(entries, null, 2) + "\n");
  }
}

function getVersion(): string {
  const packagePath = join(__dirname, "..", "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf-8"));
  return packageJson.version;
}

/**
 * Parses a PRD file based on its extension (MCP-safe version that throws instead of process.exit).
 */
function parsePrdFile(path: string): PrdEntry[] {
  const content = readFileSync(path, "utf-8");
  const ext = extname(path).toLowerCase();

  let result: PrdEntry[] | null;
  if (ext === ".yaml" || ext === ".yml") {
    result = YAML.parse(content);
  } else {
    result = JSON.parse(content);
  }

  if (result == null) return [];
  if (!Array.isArray(result)) {
    throw new Error(`${path} does not contain an array`);
  }
  return result;
}

/**
 * Loads PRD entries (MCP-safe version that throws instead of process.exit).
 */
function loadPrd(): PrdEntry[] {
  const prdFiles = getPrdFiles();

  if (prdFiles.none) {
    const ralphDir = getRalphDir();
    if (!existsSync(ralphDir)) {
      mkdirSync(ralphDir, { recursive: true });
    }
    const prdPath = join(ralphDir, "prd.yaml");
    writeFileSync(prdPath, DEFAULT_PRD_YAML);
    return parsePrdFile(prdPath);
  }

  if (!prdFiles.primary) {
    throw new Error("No PRD file found. Run `ralph init` to create one.");
  }

  const primary = parsePrdFile(prdFiles.primary);

  if (prdFiles.both && prdFiles.secondary) {
    const secondary = parsePrdFile(prdFiles.secondary);
    return [...primary, ...secondary];
  }

  return primary;
}

const server = new McpServer({
  name: "ralph-mcp",
  version: getVersion(),
});

// ralph_prd_list tool
server.tool(
  "ralph_prd_list",
  "List PRD entries with optional category and status filters",
  {
    category: z.enum(["ui", "feature", "bugfix", "setup", "development", "testing", "docs"]).optional().describe("Filter by category"),
    status: z.enum(["all", "passing", "failing"]).optional().describe("Filter by status: all (default), passing, or failing"),
  },
  async ({ category, status }) => {
    try {
      const prd = loadPrd();

      let filtered = prd.map((entry, i) => ({ ...entry, index: i + 1 }));

      if (category) {
        filtered = filtered.filter((entry) => entry.category === category);
      }

      if (status === "passing") {
        filtered = filtered.filter((entry) => entry.passes);
      } else if (status === "failing") {
        filtered = filtered.filter((entry) => !entry.passes);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(filtered, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error loading PRD: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ralph_prd_add tool
server.tool(
  "ralph_prd_add",
  "Add a new PRD entry with category, description, and verification steps",
  {
    category: z.enum(["ui", "feature", "bugfix", "setup", "development", "testing", "docs"]).describe("Category for the new entry"),
    description: z.string().min(1).describe("Description of the requirement"),
    steps: z.array(z.string().min(1)).min(1).describe("Verification steps to check if requirement is met"),
    branch: z.string().optional().describe("Git branch associated with this entry"),
  },
  async ({ category, description, steps, branch }) => {
    try {
      const entry: PrdEntry = {
        category,
        description,
        steps,
        passes: false,
      };
      if (branch) {
        entry.branch = branch;
      }

      const prd = loadPrd();
      prd.push(entry);
      savePrd(prd);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { message: `Added entry #${prd.length}: "${description}"`, entry: { ...entry, index: prd.length } },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error adding PRD entry: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ralph_prd_status tool
server.tool(
  "ralph_prd_status",
  "Get PRD completion status with counts, percentage, per-category breakdown, and remaining items",
  {},
  async () => {
    try {
      const prd = loadPrd();

      if (prd.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ passing: 0, total: 0, percentage: 0, categories: {}, remaining: [] }, null, 2),
            },
          ],
        };
      }

      const passing = prd.filter((e) => e.passes).length;
      const total = prd.length;
      const percentage = Math.round((passing / total) * 100);

      const categories: Record<string, { passing: number; total: number }> = {};
      prd.forEach((entry) => {
        if (!categories[entry.category]) {
          categories[entry.category] = { passing: 0, total: 0 };
        }
        categories[entry.category].total++;
        if (entry.passes) categories[entry.category].passing++;
      });

      const remaining = prd
        .map((entry, i) => ({ index: i + 1, category: entry.category, description: entry.description }))
        .filter((_, i) => !prd[i].passes);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ passing, total, percentage, categories, remaining }, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error loading PRD: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ralph_prd_toggle tool
server.tool(
  "ralph_prd_toggle",
  "Toggle completion status (passes) for PRD entries by 1-based index",
  {
    indices: z.array(z.number().int().min(1)).min(1).describe("1-based indices of PRD entries to toggle"),
  },
  async ({ indices }) => {
    try {
      const prd = loadPrd();

      // Validate all indices are in range
      for (const index of indices) {
        if (index > prd.length) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Invalid entry number: ${index}. Must be 1-${prd.length}`,
              },
            ],
            isError: true,
          };
        }
      }

      // Deduplicate and sort
      const uniqueIndices = [...new Set(indices)].sort((a, b) => a - b);

      const toggled = uniqueIndices.map((index) => {
        const entry = prd[index - 1];
        entry.passes = !entry.passes;
        return {
          index,
          description: entry.description,
          passes: entry.passes,
        };
      });

      savePrd(prd);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ message: `Toggled ${toggled.length} entry/entries`, toggled }, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error toggling PRD entries: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
