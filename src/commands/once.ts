import { spawn } from "child_process";
import { existsSync, appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { checkFilesExist, loadConfig, loadPrompt, getPaths, getCliConfig, requireContainer } from "../utils/config.js";
import { resolvePromptVariables, getCliProviders } from "../templates/prompts.js";

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

export async function once(args: string[]): Promise<void> {
  // Parse flags
  let debug = false;
  let model: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--debug" || args[i] === "-d") {
      debug = true;
    } else if (args[i] === "--model" || args[i] === "-m") {
      if (i + 1 < args.length) {
        model = args[i + 1];
        i++; // Skip the model value
      } else {
        console.error("Error: --model requires a value");
        process.exit(1);
      }
    }
  }

  requireContainer("once");
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
  const streamJsonEnabled = streamJsonConfig?.enabled ?? false;
  const saveRawJson = streamJsonConfig?.saveRawJson !== false; // default true
  const outputDir = config.docker?.asciinema?.outputDir || ".recordings";

  // Get provider-specific streamJsonArgs, falling back to Claude's defaults
  const providers = getCliProviders();
  const providerConfig = config.cliProvider ? providers[config.cliProvider] : providers["claude"];
  const defaultStreamJsonArgs = ["--output-format", "stream-json", "--verbose", "--print"];
  const streamJsonArgs = providerConfig?.streamJsonArgs ?? defaultStreamJsonArgs;

  console.log("Starting single ralph iteration...");
  if (streamJsonEnabled) {
    console.log("Stream JSON output enabled - displaying formatted Claude output");
    if (saveRawJson) {
      console.log(`Raw JSON logs will be saved to: ${outputDir}/`);
    }
  }
  console.log();

  // Build CLI arguments: config args + yolo args + model args + prompt args
  // Use yoloArgs from config if available, otherwise default to Claude's --dangerously-skip-permissions
  const yoloArgs = cliConfig.yoloArgs ?? ["--dangerously-skip-permissions"];
  const promptArgs = cliConfig.promptArgs ?? ["-p"];
  const promptValue = `@${paths.prd} @${paths.progress} ${prompt}`;
  const cliArgs = [
    ...(cliConfig.args ?? []),
    ...yoloArgs,
  ];

  // Add stream-json output format if enabled (using provider-specific args)
  let jsonLogPath: string | undefined;
  if (streamJsonEnabled) {
    cliArgs.push(...streamJsonArgs);

    // Setup JSON log file if saving raw JSON
    if (saveRawJson) {
      const fullOutputDir = join(process.cwd(), outputDir);
      if (!existsSync(fullOutputDir)) {
        mkdirSync(fullOutputDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      jsonLogPath = join(fullOutputDir, `ralph-once-${timestamp}.jsonl`);
    }
  }

  // Add model args if model is specified
  if (model && cliConfig.modelArgs) {
    cliArgs.push(...cliConfig.modelArgs, model);
  }

  cliArgs.push(...promptArgs, promptValue);

  if (debug) {
    console.log(`[debug] ${cliConfig.command} ${cliArgs.map(a => a.includes(" ") ? `"${a}"` : a).join(" ")}\n`);
    if (jsonLogPath) {
      console.log(`[debug] Saving raw JSON to: ${jsonLogPath}\n`);
    }
  }

  return new Promise((resolve, reject) => {
    if (streamJsonEnabled) {
      // Stream JSON mode: capture stdout, parse JSON, display clean text
      let lineBuffer = "";

      const proc = spawn(cliConfig.command, cliArgs, {
        stdio: ["inherit", "pipe", "inherit"],
      });

      proc.stdout.on("data", (data: Buffer) => {
        const chunk = data.toString();
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
            }
          } else {
            // Non-JSON line - display as-is (might be status messages, errors, etc.)
            process.stdout.write(trimmedLine + "\n");
          }
        }
      });

      proc.on("close", (code) => {
        // Process any remaining buffered content
        if (lineBuffer.trim()) {
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
            }
          } else {
            // Non-JSON remaining content
            process.stdout.write(trimmedLine + "\n");
          }
        }

        // Ensure final newline
        process.stdout.write("\n");

        if (code !== 0) {
          console.error(`\n${cliConfig.command} exited with code ${code}`);
        }
        resolve();
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to start ${cliConfig.command}: ${err.message}`));
      });
    } else {
      // Standard mode: pass through all I/O
      const proc = spawn(cliConfig.command, cliArgs, {
        stdio: "inherit",
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          console.error(`\n${cliConfig.command} exited with code ${code}`);
        }
        resolve();
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to start ${cliConfig.command}: ${err.message}`));
      });
    }
  });
}
