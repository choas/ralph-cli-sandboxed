import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { checkFilesExist, loadConfig, loadPrompt, getPaths, getCliConfig, CliConfig, requireContainer, RalphConfig } from "../utils/config.js";
import { resolvePromptVariables, getCliProviders } from "../templates/prompts.js";
import { validatePrd, smartMerge, readPrdFile, writePrd, expandPrdFileReferences, PrdEntry } from "../utils/prd-validator.js";

/**
 * Stream JSON configuration for clean output display
 */
interface StreamJsonOptions {
  enabled: boolean;
  saveRawJson: boolean;
  outputDir: string;
  args: string[];  // Provider-specific stream-json args (e.g., ['--output-format', 'stream-json'])
}

/**
 * Parses a stream-json line and extracts displayable text.
 * Formats output similar to Claude Code's normal terminal display.
 */
function parseStreamJsonLine(line: string, debug: boolean = false): string {
  try {
    const json = JSON.parse(line);

    if (debug && json.type) {
      process.stderr.write(`[stream-json] type: ${json.type}\n`);
    }

    // Handle Claude Code CLI stream-json events
    const type = json.type;

    switch (type) {
      // === Text Content ===
      case "content_block_delta":
        // Incremental text updates - the main streaming content
        if (json.delta?.type === "text_delta") {
          return json.delta.text || "";
        }
        // Tool input being streamed
        if (json.delta?.type === "input_json_delta") {
          return ""; // Don't show partial JSON, wait for complete tool call
        }
        return json.delta?.text || "";

      case "text":
        return json.text || "";

      // === Tool Use ===
      case "content_block_start":
        if (json.content_block?.type === "tool_use") {
          const toolName = json.content_block?.name || "unknown";
          return `\n── Tool: ${toolName} ──\n`;
        }
        if (json.content_block?.type === "text") {
          return json.content_block?.text || "";
        }
        return "";

      case "content_block_stop":
        // End of a content block - add newline after tool use
        return "";

      // === Tool Results ===
      case "tool_result":
        const toolOutput = json.content || json.output || "";
        const truncated = typeof toolOutput === "string" && toolOutput.length > 500
          ? toolOutput.substring(0, 500) + "... (truncated)"
          : toolOutput;
        return `\n── Tool Result ──\n${typeof truncated === "string" ? truncated : JSON.stringify(truncated, null, 2)}\n`;

      // === Assistant Messages ===
      case "assistant":
        const contents = json.message?.content || json.content || [];
        let output = "";
        for (const block of contents) {
          if (block.type === "text") {
            output += block.text || "";
          } else if (block.type === "tool_use") {
            output += `\n── Tool: ${block.name} ──\n`;
            if (block.input) {
              output += JSON.stringify(block.input, null, 2) + "\n";
            }
          }
        }
        return output;

      case "message_start":
        // Beginning of a new message
        return "\n";

      case "message_delta":
        // Message completion info (stop_reason, usage)
        if (json.delta?.stop_reason) {
          return `\n[${json.delta.stop_reason}]\n`;
        }
        return "";

      case "message_stop":
        return "\n";

      // === System/User Events ===
      case "system":
        if (json.message) {
          return `[System] ${json.message}\n`;
        }
        return "";

      case "user":
        // User message echo - usually not needed to display
        return "";

      // === Results and Errors ===
      case "result":
        if (json.result !== undefined) {
          return `\n── Result ──\n${JSON.stringify(json.result, null, 2)}\n`;
        }
        return "";

      case "error":
        const errMsg = json.error?.message || JSON.stringify(json.error);
        return `\n[Error] ${errMsg}\n`;

      // === File Operations (Claude Code specific) ===
      case "file_edit":
      case "file_write":
        const filePath = json.path || json.file || "unknown";
        return `\n── Writing: ${filePath} ──\n`;

      case "file_read":
        const readPath = json.path || json.file || "unknown";
        return `── Reading: ${readPath} ──\n`;

      case "bash":
      case "command":
        const cmd = json.command || json.content || "";
        return `\n── Running: ${cmd} ──\n`;

      case "bash_output":
      case "command_output":
        const cmdOutput = json.output || json.content || "";
        return cmdOutput + "\n";

      // === Gemini CLI Events ===
      case "initialization":
        // Gemini initialization event - contains model info
        if (json.model) {
          return `[Gemini: ${json.model}]\n`;
        }
        return "";

      case "messages":
        // Gemini messages event - contains conversation messages
        if (Array.isArray(json.messages)) {
          let messagesOutput = "";
          for (const msg of json.messages) {
            if (msg.role === "assistant" || msg.role === "model") {
              if (typeof msg.content === "string") {
                messagesOutput += msg.content;
              } else if (Array.isArray(msg.content)) {
                for (const part of msg.content) {
                  if (part.type === "text") {
                    messagesOutput += part.text || "";
                  }
                }
              }
            }
          }
          return messagesOutput;
        }
        return "";

      case "tools":
        // Gemini tools event - tool calls and results
        if (Array.isArray(json.tools)) {
          let toolsOutput = "";
          for (const tool of json.tools) {
            if (tool.name) {
              toolsOutput += `\n── Tool: ${tool.name} ──\n`;
            }
            if (tool.input) {
              toolsOutput += JSON.stringify(tool.input, null, 2) + "\n";
            }
            if (tool.output || tool.result) {
              const toolResult = tool.output || tool.result;
              const truncatedResult = typeof toolResult === "string" && toolResult.length > 500
                ? toolResult.substring(0, 500) + "... (truncated)"
                : toolResult;
              toolsOutput += `── Tool Result ──\n${typeof truncatedResult === "string" ? truncatedResult : JSON.stringify(truncatedResult, null, 2)}\n`;
            }
          }
          return toolsOutput;
        }
        return "";

      case "turn_complete":
        // Gemini turn complete event
        return "\n";

      case "response":
        // Gemini response event - may contain final response text
        if (json.text) {
          return json.text;
        }
        if (json.content && typeof json.content === "string") {
          return json.content;
        }
        return "";

      // === OpenCode CLI Events ===
      case "step_start":
        // OpenCode step start event - indicates beginning of a new step
        if (json.step || json.name) {
          return `\n── Step: ${json.step || json.name} ──\n`;
        }
        return "\n";

      case "step_end":
        // OpenCode step end event
        return "";

      case "tool":
      case "tool_call":
        // OpenCode tool call event
        if (json.name || json.tool) {
          let toolOutput = `\n── Tool: ${json.name || json.tool} ──\n`;
          if (json.input || json.args || json.arguments) {
            const toolInput = json.input || json.args || json.arguments;
            toolOutput += typeof toolInput === "string"
              ? toolInput + "\n"
              : JSON.stringify(toolInput, null, 2) + "\n";
          }
          return toolOutput;
        }
        return "";

      case "tool_response":
        // OpenCode tool response event
        const toolRespOutput = json.output || json.result || json.content || "";
        const truncatedResp = typeof toolRespOutput === "string" && toolRespOutput.length > 500
          ? toolRespOutput.substring(0, 500) + "... (truncated)"
          : toolRespOutput;
        return `── Tool Result ──\n${typeof truncatedResp === "string" ? truncatedResp : JSON.stringify(truncatedResp, null, 2)}\n`;

      case "assistant_message":
      case "model_response":
        // OpenCode assistant/model response event
        if (json.content && typeof json.content === "string") {
          return json.content;
        }
        if (json.text) {
          return json.text;
        }
        if (Array.isArray(json.content)) {
          let msgOutput = "";
          for (const part of json.content) {
            if (typeof part === "string") {
              msgOutput += part;
            } else if (part.type === "text") {
              msgOutput += part.text || "";
            }
          }
          return msgOutput;
        }
        return "";

      case "thinking":
      case "reasoning":
        // OpenCode thinking/reasoning event - show thinking process
        if (json.content || json.text) {
          return `[Thinking] ${json.content || json.text}\n`;
        }
        return "";

      case "done":
      case "complete":
        // OpenCode completion event
        return "\n";

      // === Codex CLI Events ===
      case "thread.started":
        // Codex thread started event - contains thread_id
        if (json.thread_id) {
          return `[Codex: thread ${json.thread_id}]\n`;
        }
        return "";

      case "turn.started":
        // Codex turn started event
        return "\n";

      case "turn.completed":
        // Codex turn completed event - contains usage info
        if (json.usage) {
          const usage = json.usage;
          return `\n[Turn complete: ${usage.input_tokens || 0} input, ${usage.output_tokens || 0} output tokens]\n`;
        }
        return "\n";

      case "turn.failed":
        // Codex turn failed event
        if (json.error || json.message) {
          return `\n[Turn failed] ${json.error || json.message}\n`;
        }
        return "\n[Turn failed]\n";

      case "item.started":
        // Codex item started event - action begins
        if (json.item) {
          const item = json.item;
          if (item.type === "command_execution" && item.command) {
            return `\n── Running: ${item.command} ──\n`;
          }
          if (item.type === "file_change" || item.type === "file_edit") {
            const filePath = item.path || item.file || "unknown";
            return `\n── Writing: ${filePath} ──\n`;
          }
          if (item.type === "file_read") {
            const filePath = item.path || item.file || "unknown";
            return `── Reading: ${filePath} ──\n`;
          }
          if (item.type === "mcp_tool_call" || item.type === "tool_call") {
            const toolName = item.name || item.tool || "unknown";
            return `\n── Tool: ${toolName} ──\n`;
          }
          if (item.type === "web_search") {
            const query = item.query || "";
            return `\n── Web search: ${query} ──\n`;
          }
          if (item.type === "plan_update") {
            return `\n── Plan update ──\n`;
          }
        }
        return "";

      case "item.completed":
        // Codex item completed event - action finished
        if (json.item) {
          const item = json.item;
          if (item.type === "agent_message" && item.text) {
            return item.text;
          }
          if (item.type === "command_execution" && item.output) {
            const cmdOutput = item.output;
            const truncatedOutput = typeof cmdOutput === "string" && cmdOutput.length > 500
              ? cmdOutput.substring(0, 500) + "... (truncated)"
              : cmdOutput;
            return `${truncatedOutput}\n`;
          }
          if (item.type === "reasoning" && item.text) {
            return `[Thinking] ${item.text}\n`;
          }
          if (item.text) {
            return item.text;
          }
        }
        return "";

      case "item.failed":
        // Codex item failed event
        if (json.item) {
          const item = json.item;
          const errMsg = item.error || item.message || "Unknown error";
          return `\n[Item failed: ${item.type || "unknown"}] ${errMsg}\n`;
        }
        return "";

      default:
        // Fallback: check for common text fields
        if (json.text) return json.text;
        if (json.content && typeof json.content === "string") return json.content;
        if (json.message && typeof json.message === "string") return json.message;
        if (json.output && typeof json.output === "string") return json.output;

        if (debug) {
          process.stderr.write(`[stream-json] unhandled type: ${type}, keys: ${Object.keys(json).join(", ")}\n`);
        }
        return "";
    }
  } catch (e) {
    // Not valid JSON
    if (debug) {
      process.stderr.write(`[stream-json] parse error: ${e}\n`);
    }
    return "";
  }
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

  // Write to .ralph/prd-tasks.json so LLMs see a sensible path
  const tempPath = join(baseDir, "prd-tasks.json");
  writeFileSync(tempPath, JSON.stringify(expandedItems, null, 2));

  return {
    tempPath,
    hasIncomplete: filteredItems.length > 0
  };
}

/**
 * Syncs passes flags from prd-tasks.json back to prd.json.
 * If the LLM marked any item as passes: true in prd-tasks.json,
 * find the matching item in prd.json and update it.
 * Returns the number of items synced.
 */
function syncPassesFromTasks(tasksPath: string, prdPath: string): number {
  // Check if tasks file exists
  if (!existsSync(tasksPath)) {
    return 0;
  }

  try {
    const tasksContent = readFileSync(tasksPath, "utf-8");
    const tasks: PrdItem[] = JSON.parse(tasksContent);

    const prdContent = readFileSync(prdPath, "utf-8");
    const prd: PrdItem[] = JSON.parse(prdContent);

    let synced = 0;

    // Find tasks that were marked as passing
    for (const task of tasks) {
      if (task.passes === true) {
        // Find matching item in prd by description
        const match = prd.find(item =>
          item.description === task.description ||
          item.description.includes(task.description) ||
          task.description.includes(item.description)
        );

        if (match && !match.passes) {
          match.passes = true;
          synced++;
        }
      }
    }

    // Write back if any items were synced
    if (synced > 0) {
      writeFileSync(prdPath, JSON.stringify(prd, null, 2) + "\n");
      console.log(`\x1b[32mSynced ${synced} completed item(s) from prd-tasks.json to prd.json\x1b[0m`);
    }

    return synced;
  } catch {
    // Ignore errors - the validation step will handle any issues
    return 0;
  }
}

async function runIteration(prompt: string, paths: ReturnType<typeof getPaths>, sandboxed: boolean, filteredPrdPath: string, cliConfig: CliConfig, debug: boolean, model?: string, streamJson?: StreamJsonOptions): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    let output = "";
    let jsonLogPath: string | undefined;
    let lineBuffer = ""; // Buffer for incomplete JSON lines

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
    const promptValue = `@${filteredPrdPath} @${paths.progress} ${prompt}`;
    cliArgs.push(...promptArgs, promptValue);

    if (debug) {
      console.log(`[debug] ${cliConfig.command} ${cliArgs.map(a => a.includes(" ") ? `"${a}"` : a).join(" ")}\n`);
      if (jsonLogPath) {
        console.log(`[debug] Saving raw JSON to: ${jsonLogPath}\n`);
      }
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

            // Parse and display clean text
            const text = parseStreamJsonLine(trimmedLine, debug);
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
          const text = parseStreamJsonLine(trimmedLine, debug);
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

  // Check if stream-json output is enabled
  const streamJsonConfig = config.docker?.asciinema?.streamJson;
  // Get provider-specific streamJsonArgs, falling back to Claude's defaults
  const providers = getCliProviders();
  const providerConfig = config.cliProvider ? providers[config.cliProvider] : providers["claude"];
  const defaultStreamJsonArgs = ["--output-format", "stream-json", "--verbose", "--print"];
  const streamJsonArgs = providerConfig?.streamJsonArgs ?? defaultStreamJsonArgs;

  const streamJson: StreamJsonOptions | undefined = streamJsonConfig?.enabled ? {
    enabled: true,
    saveRawJson: streamJsonConfig.saveRawJson !== false, // default true
    outputDir: config.docker?.asciinema?.outputDir || ".recordings",
    args: streamJsonArgs,
  } : undefined;

  // Progress tracking: stop only if no tasks complete after N iterations
  const MAX_ITERATIONS_WITHOUT_PROGRESS = 3;

  // Get requested iteration count (may be adjusted dynamically)
  const requestedIterations = parseInt(filteredArgs[0]) || Infinity;

  // Container is required, so always run with skip-permissions
  const sandboxed = true;

  if (allMode) {
    const counts = countPrdItems(paths.prd, category);
    console.log("Starting ralph in --all mode (runs until all tasks complete)...");
    console.log(`PRD Status: ${counts.complete}/${counts.total} complete, ${counts.incomplete} remaining`);
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
        console.log(`Iteration ${iterationCount} | Progress: ${currentCounts.complete}/${currentCounts.total} complete`);
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
          break;
        }
      }

      const { exitCode, output } = await runIteration(prompt, paths, sandboxed, filteredPrdPath, cliConfig, debug, model, streamJson);

      // Sync any completed items from prd-tasks.json back to prd.json
      // This catches cases where the LLM updated prd-tasks.json instead of prd.json
      syncPassesFromTasks(filteredPrdPath, paths.prd);

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
          console.log(`\nStopping: no progress after ${MAX_ITERATIONS_WITHOUT_PROGRESS} consecutive iterations.`);
          console.log(`(No tasks completed and no new tasks added)`);
          console.log(`Status: ${progressCounts.complete}/${progressCounts.total} complete, ${progressCounts.incomplete} remaining.`);
          console.log("Check the PRD and task definitions for issues.");
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
