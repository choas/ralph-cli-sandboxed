/**
 * Stream JSON parser interface and provider-specific implementations.
 *
 * Each CLI provider has its own stream-json event format. This module provides
 * a unified interface for parsing stream-json output from different providers.
 */

/**
 * Interface for parsing stream-json lines from CLI providers.
 */
export interface StreamJsonParser {
  /**
   * Parse a single line of stream-json output and return displayable text.
   * @param line - A single line of JSON output
   * @returns Human-readable text to display, or empty string if nothing to show
   */
  parseStreamJsonLine(line: string): string;
}

/**
 * Base class for stream-json parsers with common utilities.
 */
abstract class BaseStreamParser implements StreamJsonParser {
  constructor(protected debug: boolean = false) {}

  abstract parseStreamJsonLine(line: string): string;

  protected debugLog(message: string): void {
    if (this.debug) {
      process.stderr.write(`[stream-json] ${message}\n`);
    }
  }

  protected truncateOutput(output: string | unknown, maxLength: number = 500): string {
    if (typeof output === "string") {
      return output.length > maxLength
        ? output.substring(0, maxLength) + "... (truncated)"
        : output;
    }
    return JSON.stringify(output, null, 2);
  }
}

/**
 * Parser for Claude Code CLI stream-json events.
 *
 * Event types:
 * - content_block_delta: Incremental text updates (text_delta, input_json_delta)
 * - content_block_start: Tool use or text block start
 * - content_block_stop: End of content block
 * - tool_result: Tool execution results
 * - assistant: Complete assistant message with content blocks
 * - message_start/message_delta/message_stop: Message lifecycle
 * - system/user: System and user messages
 * - result/error: Final results or errors
 * - file_edit/file_write/file_read: File operations
 * - bash/command: Command execution
 * - bash_output/command_output: Command results
 */
export class ClaudeStreamParser extends BaseStreamParser {
  parseStreamJsonLine(line: string): string {
    try {
      const json = JSON.parse(line);
      const type = json.type;

      if (this.debug && type) {
        this.debugLog(`type: ${type}`);
      }

      switch (type) {
        // === Text Content ===
        case "content_block_delta":
          if (json.delta?.type === "text_delta") {
            return json.delta.text || "";
          }
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
          return "";

        // === Tool Results ===
        case "tool_result": {
          const toolOutput = json.content || json.output || "";
          const truncated = this.truncateOutput(toolOutput);
          return `\n── Tool Result ──\n${truncated}\n`;
        }

        // === Assistant Messages ===
        case "assistant": {
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
        }

        case "message_start":
          return "\n";

        case "message_delta":
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
          return "";

        // === Results and Errors ===
        case "result":
          if (json.result !== undefined) {
            return `\n── Result ──\n${JSON.stringify(json.result, null, 2)}\n`;
          }
          return "";

        case "error": {
          const errMsg = json.error?.message || JSON.stringify(json.error);
          return `\n[Error] ${errMsg}\n`;
        }

        // === File Operations ===
        case "file_edit":
        case "file_write": {
          const filePath = json.path || json.file || "unknown";
          return `\n── Writing: ${filePath} ──\n`;
        }

        case "file_read": {
          const readPath = json.path || json.file || "unknown";
          return `── Reading: ${readPath} ──\n`;
        }

        case "bash":
        case "command": {
          const cmd = json.command || json.content || "";
          return `\n── Running: ${cmd} ──\n`;
        }

        case "bash_output":
        case "command_output": {
          const cmdOutput = json.output || json.content || "";
          return cmdOutput + "\n";
        }

        default:
          return this.handleFallback(json, type);
      }
    } catch (e) {
      if (this.debug) {
        this.debugLog(`parse error: ${e}`);
      }
      return "";
    }
  }

  private handleFallback(json: Record<string, unknown>, type: string): string {
    if (json.text) return json.text as string;
    if (json.content && typeof json.content === "string") return json.content;
    if (json.message && typeof json.message === "string") return json.message;
    if (json.output && typeof json.output === "string") return json.output;

    if (this.debug) {
      this.debugLog(`unhandled type: ${type}, keys: ${Object.keys(json).join(", ")}`);
    }
    return "";
  }
}

/**
 * Parser for Gemini CLI stream-json events.
 *
 * Event types:
 * - initialization: Model initialization info
 * - messages: Conversation messages
 * - tools: Tool calls and results
 * - turn_complete: End of turn
 * - response: Final response text
 */
export class GeminiStreamParser extends BaseStreamParser {
  parseStreamJsonLine(line: string): string {
    try {
      const json = JSON.parse(line);
      const type = json.type;

      if (this.debug && type) {
        this.debugLog(`type: ${type}`);
      }

      switch (type) {
        case "initialization":
          if (json.model) {
            return `[Gemini: ${json.model}]\n`;
          }
          return "";

        case "messages":
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
                const truncated = this.truncateOutput(toolResult);
                toolsOutput += `── Tool Result ──\n${truncated}\n`;
              }
            }
            return toolsOutput;
          }
          return "";

        case "turn_complete":
          return "\n";

        case "response":
          if (json.text) {
            return json.text;
          }
          if (json.content && typeof json.content === "string") {
            return json.content;
          }
          return "";

        default:
          return this.handleFallback(json, type);
      }
    } catch (e) {
      if (this.debug) {
        this.debugLog(`parse error: ${e}`);
      }
      return "";
    }
  }

  private handleFallback(json: Record<string, unknown>, type: string): string {
    if (json.text) return json.text as string;
    if (json.content && typeof json.content === "string") return json.content;

    if (this.debug) {
      this.debugLog(`unhandled type: ${type}, keys: ${Object.keys(json).join(", ")}`);
    }
    return "";
  }
}

/**
 * Parser for OpenCode CLI stream-json events.
 *
 * Event types:
 * - step_start/step_end/step_finish: Step lifecycle
 * - tool_use: Tool invocation with nested part structure (part.type="tool", part.tool, part.state)
 * - tool/tool_call: Direct tool invocation (alternate format)
 * - tool_response: Tool results
 * - text: Text output with nested part structure (part.text)
 * - assistant_message/model_response: Model output
 * - thinking/reasoning: Thinking process
 * - done/complete: Completion
 */
export class OpenCodeStreamParser extends BaseStreamParser {
  parseStreamJsonLine(line: string): string {
    try {
      const json = JSON.parse(line);
      const type = json.type;

      if (this.debug && type) {
        this.debugLog(`type: ${type}`);
      }

      switch (type) {
        case "step_start":
          if (json.step || json.name) {
            return `\n── Step: ${json.step || json.name} ──\n`;
          }
          return "\n";

        case "step_end":
        case "step_finish":
          return "";

        case "tool_use": {
          // OpenCode sends tool_use with nested part structure
          const part = json.part as Record<string, unknown> | undefined;
          if (part?.type === "tool" && part?.tool) {
            const toolName = part.tool as string;
            const state = part.state as Record<string, unknown> | undefined;
            let toolOutput = `\n── Tool: ${toolName} ──\n`;

            // Show title if available (e.g., "workspace/.ralph/prd-tasks.json")
            if (part.title) {
              toolOutput = `\n── Tool: ${toolName} (${part.title}) ──\n`;
            }

            // Show completed output if available
            if (state?.status === "completed" && state?.output) {
              const truncated = this.truncateOutput(state.output);
              toolOutput += `${truncated}\n`;
            }
            return toolOutput;
          }
          return "";
        }

        case "tool":
        case "tool_call":
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

        case "tool_response": {
          const toolRespOutput = json.output || json.result || json.content || "";
          const truncated = this.truncateOutput(toolRespOutput);
          return `── Tool Result ──\n${truncated}\n`;
        }

        case "assistant_message":
        case "model_response":
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

        case "text": {
          // OpenCode sends text with nested part structure
          const textPart = json.part as Record<string, unknown> | undefined;
          if (textPart?.text) {
            return textPart.text as string;
          }
          if (json.text) {
            return json.text as string;
          }
          return "";
        }

        case "thinking":
        case "reasoning":
          if (json.content || json.text) {
            return `[Thinking] ${json.content || json.text}\n`;
          }
          return "";

        case "done":
        case "complete":
          return "\n";

        default:
          return this.handleFallback(json, type);
      }
    } catch (e) {
      if (this.debug) {
        this.debugLog(`parse error: ${e}`);
      }
      return "";
    }
  }

  private handleFallback(json: Record<string, unknown>, type: string): string {
    if (json.text) return json.text as string;
    if (json.content && typeof json.content === "string") return json.content;

    if (this.debug) {
      this.debugLog(`unhandled type: ${type}, keys: ${Object.keys(json).join(", ")}`);
    }
    return "";
  }
}

/**
 * Parser for Codex CLI stream-json events.
 *
 * Event types:
 * - thread.started: Thread initialization
 * - turn.started/turn.completed/turn.failed: Turn lifecycle
 * - item.started/item.completed/item.failed: Action lifecycle
 *   - command_execution, file_change, file_read, mcp_tool_call, web_search, plan_update
 */
export class CodexStreamParser extends BaseStreamParser {
  parseStreamJsonLine(line: string): string {
    try {
      const json = JSON.parse(line);
      const type = json.type;

      if (this.debug && type) {
        this.debugLog(`type: ${type}`);
      }

      switch (type) {
        case "thread.started":
          if (json.thread_id) {
            return `[Codex: thread ${json.thread_id}]\n`;
          }
          return "";

        case "turn.started":
          return "\n";

        case "turn.completed":
          if (json.usage) {
            const usage = json.usage;
            return `\n[Turn complete: ${usage.input_tokens || 0} input, ${usage.output_tokens || 0} output tokens]\n`;
          }
          return "\n";

        case "turn.failed":
          if (json.error || json.message) {
            return `\n[Turn failed] ${json.error || json.message}\n`;
          }
          return "\n[Turn failed]\n";

        case "item.started":
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
          if (json.item) {
            const item = json.item;
            if (item.type === "agent_message" && item.text) {
              return item.text;
            }
            if (item.type === "command_execution" && item.output) {
              const truncated = this.truncateOutput(item.output);
              return `${truncated}\n`;
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
          if (json.item) {
            const item = json.item;
            const errMsg = item.error || item.message || "Unknown error";
            return `\n[Item failed: ${item.type || "unknown"}] ${errMsg}\n`;
          }
          return "";

        default:
          return this.handleFallback(json, type);
      }
    } catch (e) {
      if (this.debug) {
        this.debugLog(`parse error: ${e}`);
      }
      return "";
    }
  }

  private handleFallback(json: Record<string, unknown>, type: string): string {
    if (json.text) return json.text as string;
    if (json.content && typeof json.content === "string") return json.content;

    if (this.debug) {
      this.debugLog(`unhandled type: ${type}, keys: ${Object.keys(json).join(", ")}`);
    }
    return "";
  }
}

/**
 * Parser for Goose CLI stream-json events.
 *
 * Goose uses a similar event format to Claude Code.
 * Falls back to Claude parser behavior for common events.
 */
export class GooseStreamParser extends BaseStreamParser {
  private claudeParser: ClaudeStreamParser;

  constructor(debug: boolean = false) {
    super(debug);
    this.claudeParser = new ClaudeStreamParser(debug);
  }

  parseStreamJsonLine(line: string): string {
    // Goose uses a similar format to Claude, delegate to Claude parser
    // This can be extended with Goose-specific event handling as needed
    return this.claudeParser.parseStreamJsonLine(line);
  }
}

/**
 * Universal fallback parser that handles common event patterns.
 * Used for providers without specific stream-json support or as a fallback.
 */
export class DefaultStreamParser extends BaseStreamParser {
  parseStreamJsonLine(line: string): string {
    try {
      const json = JSON.parse(line);
      const type = json.type;

      if (this.debug && type) {
        this.debugLog(`type: ${type}`);
      }

      // Handle common patterns across providers
      if (json.text) return json.text;
      if (json.content && typeof json.content === "string") return json.content;
      if (json.message && typeof json.message === "string") return json.message;
      if (json.output && typeof json.output === "string") return json.output;

      if (this.debug && type) {
        this.debugLog(`unhandled type: ${type}, keys: ${Object.keys(json).join(", ")}`);
      }
      return "";
    } catch (e) {
      if (this.debug) {
        this.debugLog(`parse error: ${e}`);
      }
      return "";
    }
  }
}

/**
 * Get the appropriate stream-json parser for a CLI provider.
 *
 * @param provider - The CLI provider name (e.g., "claude", "gemini", "opencode")
 * @param debug - Enable debug logging
 * @returns The appropriate StreamJsonParser for the provider
 */
export function getStreamJsonParser(provider: string | undefined, debug: boolean = false): StreamJsonParser {
  switch (provider) {
    case "claude":
      return new ClaudeStreamParser(debug);
    case "gemini":
      return new GeminiStreamParser(debug);
    case "opencode":
      return new OpenCodeStreamParser(debug);
    case "codex":
      return new CodexStreamParser(debug);
    case "goose":
      return new GooseStreamParser(debug);
    default:
      // For unknown providers, use default parser
      return new DefaultStreamParser(debug);
  }
}
