import { describe, it, expect } from "vitest";
import {
  ClaudeStreamParser,
  GeminiStreamParser,
  OpenCodeStreamParser,
  CodexStreamParser,
  GooseStreamParser,
  AiderStreamParser,
  DefaultStreamParser,
  getStreamJsonParser,
} from "./stream-json.js";

// ─── ClaudeStreamParser ─────────────────────────────────────────────

describe("ClaudeStreamParser", () => {
  const parser = new ClaudeStreamParser();

  it("parses text_delta events", () => {
    const line = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello" },
    });
    expect(parser.parseStreamJsonLine(line)).toBe("Hello");
  });

  it("ignores input_json_delta events", () => {
    const line = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "input_json_delta", partial_json: '{"key":' },
    });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("parses text events", () => {
    const line = JSON.stringify({ type: "text", text: "World" });
    expect(parser.parseStreamJsonLine(line)).toBe("World");
  });

  it("parses tool_use content_block_start", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "read_file" },
    });
    expect(parser.parseStreamJsonLine(line)).toContain("read_file");
  });

  it("parses text content_block_start", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "text", text: "Starting" },
    });
    expect(parser.parseStreamJsonLine(line)).toBe("Starting");
  });

  it("parses tool_result events", () => {
    const line = JSON.stringify({ type: "tool_result", content: "file contents here" });
    expect(parser.parseStreamJsonLine(line)).toContain("file contents here");
  });

  it("parses assistant messages with text blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      content: [{ type: "text", text: "I will help" }],
    });
    expect(parser.parseStreamJsonLine(line)).toBe("I will help");
  });

  it("parses assistant messages with tool_use blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      content: [{ type: "tool_use", name: "bash", input: { command: "ls" } }],
    });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("bash");
  });

  it("parses file operations", () => {
    expect(
      parser.parseStreamJsonLine(JSON.stringify({ type: "file_edit", path: "src/main.ts" })),
    ).toContain("src/main.ts");
    expect(
      parser.parseStreamJsonLine(JSON.stringify({ type: "file_read", path: "README.md" })),
    ).toContain("README.md");
  });

  it("parses bash/command events", () => {
    const line = JSON.stringify({ type: "bash", command: "npm test" });
    expect(parser.parseStreamJsonLine(line)).toContain("npm test");
  });

  it("parses error events", () => {
    const line = JSON.stringify({ type: "error", error: { message: "Rate limited" } });
    expect(parser.parseStreamJsonLine(line)).toContain("Rate limited");
  });

  it("returns empty string for invalid JSON", () => {
    expect(parser.parseStreamJsonLine("not json")).toBe("");
  });

  it("handles message lifecycle events", () => {
    expect(parser.parseStreamJsonLine(JSON.stringify({ type: "message_start" }))).toBe("\n");
    expect(parser.parseStreamJsonLine(JSON.stringify({ type: "message_stop" }))).toBe("\n");
    expect(
      parser.parseStreamJsonLine(
        JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
      ),
    ).toContain("end_turn");
  });

  it("parses system messages", () => {
    const line = JSON.stringify({ type: "system", message: "Initializing" });
    expect(parser.parseStreamJsonLine(line)).toContain("Initializing");
  });

  it("falls back to text/content/message fields", () => {
    expect(parser.parseStreamJsonLine(JSON.stringify({ type: "unknown", text: "fallback" }))).toBe(
      "fallback",
    );
    expect(
      parser.parseStreamJsonLine(JSON.stringify({ type: "unknown", content: "fallback2" })),
    ).toBe("fallback2");
  });

  // --- new edge case tests ---

  it("returns empty for content_block_stop", () => {
    const line = JSON.stringify({ type: "content_block_stop" });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("returns empty for user events", () => {
    const line = JSON.stringify({ type: "user", content: "user message" });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles content_block_delta with missing delta text", () => {
    const line = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta" },
    });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles content_block_delta with unknown delta type", () => {
    const line = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "custom_delta", text: "hi" },
    });
    // Falls through to delta.text fallback
    expect(parser.parseStreamJsonLine(line)).toBe("hi");
  });

  it("handles text event with empty text", () => {
    const line = JSON.stringify({ type: "text", text: "" });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles content_block_start with unknown block type", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "image", url: "http://example.com" },
    });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles tool_result with output field instead of content", () => {
    const line = JSON.stringify({ type: "tool_result", output: "tool output here" });
    expect(parser.parseStreamJsonLine(line)).toContain("tool output here");
  });

  it("handles tool_use content_block_start without name", () => {
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use" },
    });
    expect(parser.parseStreamJsonLine(line)).toContain("unknown");
  });

  it("handles assistant messages from message.content path", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "From message" }] },
    });
    expect(parser.parseStreamJsonLine(line)).toBe("From message");
  });

  it("handles assistant messages with multiple content blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      content: [
        { type: "text", text: "First " },
        { type: "text", text: "Second" },
      ],
    });
    expect(parser.parseStreamJsonLine(line)).toBe("First Second");
  });

  it("handles assistant tool_use without input", () => {
    const line = JSON.stringify({
      type: "assistant",
      content: [{ type: "tool_use", name: "read_file" }],
    });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("read_file");
  });

  it("handles file_write event", () => {
    const line = JSON.stringify({ type: "file_write", path: "output.txt" });
    expect(parser.parseStreamJsonLine(line)).toContain("output.txt");
  });

  it("handles file_edit with file field instead of path", () => {
    const line = JSON.stringify({ type: "file_edit", file: "alt.ts" });
    expect(parser.parseStreamJsonLine(line)).toContain("alt.ts");
  });

  it("handles file_read with file field instead of path", () => {
    const line = JSON.stringify({ type: "file_read", file: "data.json" });
    expect(parser.parseStreamJsonLine(line)).toContain("data.json");
  });

  it("handles command event", () => {
    const line = JSON.stringify({ type: "command", command: "git status" });
    expect(parser.parseStreamJsonLine(line)).toContain("git status");
  });

  it("handles bash event with content field instead of command", () => {
    const line = JSON.stringify({ type: "bash", content: "echo hello" });
    expect(parser.parseStreamJsonLine(line)).toContain("echo hello");
  });

  it("handles bash_output event", () => {
    const line = JSON.stringify({ type: "bash_output", output: "hello world" });
    expect(parser.parseStreamJsonLine(line)).toContain("hello world");
  });

  it("handles command_output event", () => {
    const line = JSON.stringify({ type: "command_output", content: "output data" });
    expect(parser.parseStreamJsonLine(line)).toContain("output data");
  });

  it("handles result event", () => {
    const line = JSON.stringify({ type: "result", result: { success: true } });
    expect(parser.parseStreamJsonLine(line)).toContain("success");
  });

  it("handles result event with undefined result", () => {
    const line = JSON.stringify({ type: "result" });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles error event without message (raw error object)", () => {
    const line = JSON.stringify({ type: "error", error: { code: 500, detail: "server" } });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("Error");
    expect(result).toContain("500");
  });

  it("handles message_delta without stop_reason", () => {
    const line = JSON.stringify({ type: "message_delta", delta: {} });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles system event without message", () => {
    const line = JSON.stringify({ type: "system" });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("falls back to output field for unknown types", () => {
    const line = JSON.stringify({ type: "custom", output: "custom output" });
    expect(parser.parseStreamJsonLine(line)).toBe("custom output");
  });

  it("returns empty for unknown type with no fallback fields", () => {
    const line = JSON.stringify({ type: "unknown", data: 42 });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles empty JSON object", () => {
    expect(parser.parseStreamJsonLine("{}")).toBe("");
  });

  it("handles JSON array (not an object)", () => {
    expect(parser.parseStreamJsonLine("[]")).toBe("");
  });

  it("handles truncation of long tool results", () => {
    const longOutput = "x".repeat(1000);
    const line = JSON.stringify({ type: "tool_result", content: longOutput });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("truncated");
    expect(result.length).toBeLessThan(1000);
  });
});

// ─── GeminiStreamParser ─────────────────────────────────────────────

describe("GeminiStreamParser", () => {
  const parser = new GeminiStreamParser();

  it("parses initialization events", () => {
    const line = JSON.stringify({ type: "initialization", model: "gemini-pro" });
    expect(parser.parseStreamJsonLine(line)).toContain("gemini-pro");
  });

  it("parses assistant messages", () => {
    const line = JSON.stringify({
      type: "messages",
      messages: [{ role: "assistant", content: "Hello from Gemini" }],
    });
    expect(parser.parseStreamJsonLine(line)).toBe("Hello from Gemini");
  });

  it("parses model role messages", () => {
    const line = JSON.stringify({
      type: "messages",
      messages: [{ role: "model", content: [{ type: "text", text: "Model says" }] }],
    });
    expect(parser.parseStreamJsonLine(line)).toBe("Model says");
  });

  it("parses tool events", () => {
    const line = JSON.stringify({
      type: "tools",
      tools: [{ name: "search", output: "Results here" }],
    });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("search");
    expect(result).toContain("Results here");
  });

  it("parses response events", () => {
    const line = JSON.stringify({ type: "response", text: "Final answer" });
    expect(parser.parseStreamJsonLine(line)).toBe("Final answer");
  });

  it("returns empty for invalid JSON", () => {
    expect(parser.parseStreamJsonLine("bad")).toBe("");
  });

  // --- new edge case tests ---

  it("handles initialization without model", () => {
    const line = JSON.stringify({ type: "initialization" });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("ignores user role messages", () => {
    const line = JSON.stringify({
      type: "messages",
      messages: [{ role: "user", content: "User input" }],
    });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles messages event without messages array", () => {
    const line = JSON.stringify({ type: "messages" });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles messages with empty messages array", () => {
    const line = JSON.stringify({ type: "messages", messages: [] });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles multiple assistant messages", () => {
    const line = JSON.stringify({
      type: "messages",
      messages: [
        { role: "assistant", content: "First " },
        { role: "assistant", content: "Second" },
      ],
    });
    expect(parser.parseStreamJsonLine(line)).toBe("First Second");
  });

  it("handles tools with input", () => {
    const line = JSON.stringify({
      type: "tools",
      tools: [{ name: "calc", input: { expression: "2+2" } }],
    });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("calc");
    expect(result).toContain("2+2");
  });

  it("handles tools with result field instead of output", () => {
    const line = JSON.stringify({
      type: "tools",
      tools: [{ name: "search", result: "Found it" }],
    });
    expect(parser.parseStreamJsonLine(line)).toContain("Found it");
  });

  it("handles tools event without tools array", () => {
    const line = JSON.stringify({ type: "tools" });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles empty tools array", () => {
    const line = JSON.stringify({ type: "tools", tools: [] });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles tool without name", () => {
    const line = JSON.stringify({
      type: "tools",
      tools: [{ output: "anonymous tool result" }],
    });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("anonymous tool result");
  });

  it("handles turn_complete event", () => {
    const line = JSON.stringify({ type: "turn_complete" });
    expect(parser.parseStreamJsonLine(line)).toBe("\n");
  });

  it("handles response with content field instead of text", () => {
    const line = JSON.stringify({ type: "response", content: "Content response" });
    expect(parser.parseStreamJsonLine(line)).toBe("Content response");
  });

  it("handles response with neither text nor content", () => {
    const line = JSON.stringify({ type: "response" });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("falls back to text field for unknown types", () => {
    const line = JSON.stringify({ type: "custom_type", text: "custom text" });
    expect(parser.parseStreamJsonLine(line)).toBe("custom text");
  });

  it("falls back to content field for unknown types", () => {
    const line = JSON.stringify({ type: "custom_type", content: "custom content" });
    expect(parser.parseStreamJsonLine(line)).toBe("custom content");
  });

  it("returns empty for unknown type with no fallback fields", () => {
    const line = JSON.stringify({ type: "custom_type", data: 42 });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles model content with mixed block types", () => {
    const line = JSON.stringify({
      type: "messages",
      messages: [
        {
          role: "model",
          content: [
            { type: "text", text: "Text block" },
            { type: "image", url: "http://example.com" },
            { type: "text", text: " more text" },
          ],
        },
      ],
    });
    expect(parser.parseStreamJsonLine(line)).toBe("Text block more text");
  });
});

// ─── OpenCodeStreamParser ───────────────────────────────────────────

describe("OpenCodeStreamParser", () => {
  const parser = new OpenCodeStreamParser();

  it("parses step_start events", () => {
    const line = JSON.stringify({ type: "step_start", step: "Planning" });
    expect(parser.parseStreamJsonLine(line)).toContain("Planning");
  });

  it("parses tool_use events with part structure", () => {
    const line = JSON.stringify({
      type: "tool_use",
      part: { type: "tool", tool: "file_read", title: "main.ts" },
    });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("file_read");
    expect(result).toContain("main.ts");
  });

  it("parses text events with part structure", () => {
    const line = JSON.stringify({
      type: "text",
      part: { text: "Analyzing code" },
    });
    expect(parser.parseStreamJsonLine(line)).toBe("Analyzing code");
  });

  it("parses assistant_message events", () => {
    const line = JSON.stringify({ type: "assistant_message", content: "Here is my analysis" });
    expect(parser.parseStreamJsonLine(line)).toBe("Here is my analysis");
  });

  it("parses thinking events", () => {
    const line = JSON.stringify({ type: "thinking", content: "Let me think" });
    expect(parser.parseStreamJsonLine(line)).toContain("Let me think");
  });

  it("returns empty for invalid JSON", () => {
    expect(parser.parseStreamJsonLine("{broken")).toBe("");
  });

  // --- new edge case tests ---

  it("handles step_start with name field instead of step", () => {
    const line = JSON.stringify({ type: "step_start", name: "Analysis" });
    expect(parser.parseStreamJsonLine(line)).toContain("Analysis");
  });

  it("handles step_start without step or name", () => {
    const line = JSON.stringify({ type: "step_start" });
    expect(parser.parseStreamJsonLine(line)).toBe("\n");
  });

  it("returns empty for step_end", () => {
    const line = JSON.stringify({ type: "step_end" });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("returns empty for step_finish", () => {
    const line = JSON.stringify({ type: "step_finish" });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles tool_use without part", () => {
    const line = JSON.stringify({ type: "tool_use" });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles tool_use with non-tool part type", () => {
    const line = JSON.stringify({
      type: "tool_use",
      part: { type: "text", text: "not a tool" },
    });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles tool_use with completed state and output", () => {
    const line = JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "file_read",
        state: { status: "completed", output: "file contents" },
      },
    });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("file_read");
    expect(result).toContain("file contents");
  });

  it("handles tool event (direct tool invocation)", () => {
    const line = JSON.stringify({ type: "tool", name: "search", input: { query: "test" } });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("search");
    expect(result).toContain("test");
  });

  it("handles tool_call event", () => {
    const line = JSON.stringify({ type: "tool_call", tool: "execute", args: "npm test" });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("execute");
  });

  it("handles tool_call with string input", () => {
    const line = JSON.stringify({ type: "tool_call", name: "bash", input: "ls -la" });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("bash");
    expect(result).toContain("ls -la");
  });

  it("handles tool_response event", () => {
    const line = JSON.stringify({ type: "tool_response", output: "command output" });
    expect(parser.parseStreamJsonLine(line)).toContain("command output");
  });

  it("handles model_response event", () => {
    const line = JSON.stringify({ type: "model_response", content: "model says" });
    expect(parser.parseStreamJsonLine(line)).toBe("model says");
  });

  it("handles assistant_message with text field", () => {
    const line = JSON.stringify({ type: "assistant_message", text: "text field" });
    expect(parser.parseStreamJsonLine(line)).toBe("text field");
  });

  it("handles assistant_message with content array", () => {
    const line = JSON.stringify({
      type: "assistant_message",
      content: [{ type: "text", text: "part 1 " }, "part 2"],
    });
    expect(parser.parseStreamJsonLine(line)).toBe("part 1 part 2");
  });

  it("handles text event with direct text field", () => {
    const line = JSON.stringify({ type: "text", text: "Direct text" });
    expect(parser.parseStreamJsonLine(line)).toBe("Direct text");
  });

  it("handles text event without part or text", () => {
    const line = JSON.stringify({ type: "text" });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles reasoning event", () => {
    const line = JSON.stringify({ type: "reasoning", text: "reasoning text" });
    expect(parser.parseStreamJsonLine(line)).toContain("reasoning text");
  });

  it("handles thinking event without content or text", () => {
    const line = JSON.stringify({ type: "thinking" });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles done event", () => {
    const line = JSON.stringify({ type: "done" });
    expect(parser.parseStreamJsonLine(line)).toBe("\n");
  });

  it("handles complete event", () => {
    const line = JSON.stringify({ type: "complete" });
    expect(parser.parseStreamJsonLine(line)).toBe("\n");
  });

  it("falls back to text field for unknown type", () => {
    const line = JSON.stringify({ type: "custom", text: "fallback" });
    expect(parser.parseStreamJsonLine(line)).toBe("fallback");
  });

  it("returns empty for unknown type with no fallback", () => {
    const line = JSON.stringify({ type: "custom", data: 123 });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });
});

// ─── CodexStreamParser ──────────────────────────────────────────────

describe("CodexStreamParser", () => {
  const parser = new CodexStreamParser();

  it("parses thread.started events", () => {
    const line = JSON.stringify({ type: "thread.started", thread_id: "abc123" });
    expect(parser.parseStreamJsonLine(line)).toContain("abc123");
  });

  it("parses item.started command_execution", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: { type: "command_execution", command: "ls -la" },
    });
    expect(parser.parseStreamJsonLine(line)).toContain("ls -la");
  });

  it("parses item.started file_change", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: { type: "file_change", path: "src/index.ts" },
    });
    expect(parser.parseStreamJsonLine(line)).toContain("src/index.ts");
  });

  it("parses item.completed agent_message", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "Done editing" },
    });
    expect(parser.parseStreamJsonLine(line)).toBe("Done editing");
  });

  it("parses turn.completed with usage", () => {
    const line = JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("100");
    expect(result).toContain("50");
  });

  it("parses turn.failed events", () => {
    const line = JSON.stringify({ type: "turn.failed", error: "Timeout" });
    expect(parser.parseStreamJsonLine(line)).toContain("Timeout");
  });

  it("parses item.failed events", () => {
    const line = JSON.stringify({
      type: "item.failed",
      item: { type: "command_execution", error: "Permission denied" },
    });
    expect(parser.parseStreamJsonLine(line)).toContain("Permission denied");
  });

  // --- new edge case tests ---

  it("handles thread.started without thread_id", () => {
    const line = JSON.stringify({ type: "thread.started" });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles turn.started event", () => {
    const line = JSON.stringify({ type: "turn.started" });
    expect(parser.parseStreamJsonLine(line)).toBe("\n");
  });

  it("handles turn.completed without usage", () => {
    const line = JSON.stringify({ type: "turn.completed" });
    expect(parser.parseStreamJsonLine(line)).toBe("\n");
  });

  it("handles turn.failed with message field", () => {
    const line = JSON.stringify({ type: "turn.failed", message: "Rate limited" });
    expect(parser.parseStreamJsonLine(line)).toContain("Rate limited");
  });

  it("handles turn.failed without error or message", () => {
    const line = JSON.stringify({ type: "turn.failed" });
    expect(parser.parseStreamJsonLine(line)).toContain("Turn failed");
  });

  it("handles item.started file_edit type", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: { type: "file_edit", path: "src/utils.ts" },
    });
    expect(parser.parseStreamJsonLine(line)).toContain("src/utils.ts");
  });

  it("handles item.started file_read type", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: { type: "file_read", path: "config.json" },
    });
    expect(parser.parseStreamJsonLine(line)).toContain("config.json");
  });

  it("handles item.started file_read with file field", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: { type: "file_read", file: "alt-path.ts" },
    });
    expect(parser.parseStreamJsonLine(line)).toContain("alt-path.ts");
  });

  it("handles item.started mcp_tool_call", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: { type: "mcp_tool_call", name: "custom_tool" },
    });
    expect(parser.parseStreamJsonLine(line)).toContain("custom_tool");
  });

  it("handles item.started tool_call", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: { type: "tool_call", tool: "search" },
    });
    expect(parser.parseStreamJsonLine(line)).toContain("search");
  });

  it("handles item.started web_search", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: { type: "web_search", query: "how to parse JSON" },
    });
    expect(parser.parseStreamJsonLine(line)).toContain("how to parse JSON");
  });

  it("handles item.started web_search without query", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: { type: "web_search" },
    });
    expect(parser.parseStreamJsonLine(line)).toContain("Web search");
  });

  it("handles item.started plan_update", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: { type: "plan_update" },
    });
    expect(parser.parseStreamJsonLine(line)).toContain("Plan update");
  });

  it("handles item.started with unknown item type", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: { type: "custom_action" },
    });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles item.started without item", () => {
    const line = JSON.stringify({ type: "item.started" });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles item.completed command_execution with output", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { type: "command_execution", output: "test passed" },
    });
    expect(parser.parseStreamJsonLine(line)).toContain("test passed");
  });

  it("handles item.completed reasoning with text", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { type: "reasoning", text: "I think we should..." },
    });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("Thinking");
    expect(result).toContain("I think we should...");
  });

  it("handles item.completed with generic text", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { type: "unknown", text: "some text" },
    });
    expect(parser.parseStreamJsonLine(line)).toBe("some text");
  });

  it("handles item.completed without item", () => {
    const line = JSON.stringify({ type: "item.completed" });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles item.completed with empty item", () => {
    const line = JSON.stringify({ type: "item.completed", item: {} });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles item.failed without item", () => {
    const line = JSON.stringify({ type: "item.failed" });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles item.failed with message instead of error", () => {
    const line = JSON.stringify({
      type: "item.failed",
      item: { type: "bash", message: "Command not found" },
    });
    expect(parser.parseStreamJsonLine(line)).toContain("Command not found");
  });

  it("handles item.failed without error or message", () => {
    const line = JSON.stringify({
      type: "item.failed",
      item: { type: "bash" },
    });
    expect(parser.parseStreamJsonLine(line)).toContain("Unknown error");
  });

  it("truncates long command_execution output", () => {
    const longOutput = "x".repeat(1000);
    const line = JSON.stringify({
      type: "item.completed",
      item: { type: "command_execution", output: longOutput },
    });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("truncated");
  });

  it("handles turn.completed with zero tokens", () => {
    const line = JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("0");
  });

  it("falls back to text field for unknown type", () => {
    const line = JSON.stringify({ type: "custom.event", text: "fallback" });
    expect(parser.parseStreamJsonLine(line)).toBe("fallback");
  });

  it("returns empty for unknown type with no fallback", () => {
    const line = JSON.stringify({ type: "custom.event", data: [1, 2] });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("returns empty for invalid JSON", () => {
    expect(parser.parseStreamJsonLine("not json at all")).toBe("");
  });
});

// ─── GooseStreamParser ──────────────────────────────────────────────

describe("GooseStreamParser", () => {
  it("delegates to ClaudeStreamParser for text events", () => {
    const parser = new GooseStreamParser();
    const line = JSON.stringify({ type: "text", text: "Hello from Goose" });
    expect(parser.parseStreamJsonLine(line)).toBe("Hello from Goose");
  });

  it("delegates to ClaudeStreamParser for content_block_delta", () => {
    const parser = new GooseStreamParser();
    const line = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "streaming" },
    });
    expect(parser.parseStreamJsonLine(line)).toBe("streaming");
  });

  it("delegates to ClaudeStreamParser for tool events", () => {
    const parser = new GooseStreamParser();
    const line = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "file_read" },
    });
    expect(parser.parseStreamJsonLine(line)).toContain("file_read");
  });

  it("handles error events via Claude parser", () => {
    const parser = new GooseStreamParser();
    const line = JSON.stringify({ type: "error", error: { message: "Oops" } });
    expect(parser.parseStreamJsonLine(line)).toContain("Oops");
  });

  it("returns empty for invalid JSON", () => {
    const parser = new GooseStreamParser();
    expect(parser.parseStreamJsonLine("not json")).toBe("");
  });

  it("handles file operations via Claude parser", () => {
    const parser = new GooseStreamParser();
    const line = JSON.stringify({ type: "file_edit", path: "goose.ts" });
    expect(parser.parseStreamJsonLine(line)).toContain("goose.ts");
  });
});

// ─── AiderStreamParser ──────────────────────────────────────────────

describe("AiderStreamParser", () => {
  const parser = new AiderStreamParser();

  it("parses text events", () => {
    const line = JSON.stringify({ type: "text", text: "Hello" });
    expect(parser.parseStreamJsonLine(line)).toBe("Hello");
  });

  it("parses tool_call events", () => {
    const line = JSON.stringify({ type: "tool_call", name: "edit", arguments: { file: "a.ts" } });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("edit");
  });

  it("parses file_edit events", () => {
    const line = JSON.stringify({ type: "file_edit", path: "src/main.ts" });
    expect(parser.parseStreamJsonLine(line)).toContain("src/main.ts");
  });

  it("parses error events", () => {
    const line = JSON.stringify({ type: "error", message: "Something broke" });
    expect(parser.parseStreamJsonLine(line)).toContain("Something broke");
  });

  it("returns raw line for non-JSON input", () => {
    expect(parser.parseStreamJsonLine("plain text output")).toBe("plain text output");
  });

  // --- new edge case tests ---

  it("parses content events (alternative to text)", () => {
    const line = JSON.stringify({ type: "content", content: "Content text" });
    expect(parser.parseStreamJsonLine(line)).toBe("Content text");
  });

  it("parses function_call events (alternative to tool_call)", () => {
    const line = JSON.stringify({ type: "function_call", function: "write_file", args: "test.ts" });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("write_file");
  });

  it("parses tool_call with string arguments", () => {
    const line = JSON.stringify({ type: "tool_call", name: "bash", arguments: "npm test" });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("bash");
    expect(result).toContain("npm test");
  });

  it("parses tool_call with args field", () => {
    const line = JSON.stringify({ type: "tool_call", name: "search", args: { query: "test" } });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("search");
  });

  it("handles tool_call without name or function", () => {
    const line = JSON.stringify({ type: "tool_call" });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("parses tool_result events", () => {
    const line = JSON.stringify({ type: "tool_result", result: "success" });
    expect(parser.parseStreamJsonLine(line)).toContain("success");
  });

  it("parses function_result events", () => {
    const line = JSON.stringify({ type: "function_result", output: "function output" });
    expect(parser.parseStreamJsonLine(line)).toContain("function output");
  });

  it("parses edit events (alternative to file_edit)", () => {
    const line = JSON.stringify({ type: "edit", file: "utils.ts" });
    expect(parser.parseStreamJsonLine(line)).toContain("utils.ts");
  });

  it("handles file_edit with file field instead of path", () => {
    const line = JSON.stringify({ type: "file_edit", file: "alt.ts" });
    expect(parser.parseStreamJsonLine(line)).toContain("alt.ts");
  });

  it("handles error with error field instead of message", () => {
    const line = JSON.stringify({ type: "error", error: "Error string" });
    expect(parser.parseStreamJsonLine(line)).toContain("Error string");
  });

  it("handles error without message or error field", () => {
    const line = JSON.stringify({ type: "error" });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("Error");
  });

  it("handles done event", () => {
    const line = JSON.stringify({ type: "done" });
    expect(parser.parseStreamJsonLine(line)).toBe("\n");
  });

  it("handles complete event", () => {
    const line = JSON.stringify({ type: "complete" });
    expect(parser.parseStreamJsonLine(line)).toBe("\n");
  });

  it("falls back to text field for unknown type", () => {
    const line = JSON.stringify({ type: "custom", text: "fallback text" });
    expect(parser.parseStreamJsonLine(line)).toBe("fallback text");
  });

  it("falls back to content field for unknown type", () => {
    const line = JSON.stringify({ type: "custom", content: "fallback content" });
    expect(parser.parseStreamJsonLine(line)).toBe("fallback content");
  });

  it("falls back to message field for unknown type", () => {
    const line = JSON.stringify({ type: "custom", message: "fallback msg" });
    expect(parser.parseStreamJsonLine(line)).toBe("fallback msg");
  });

  it("returns empty for unknown type with no fallback", () => {
    const line = JSON.stringify({ type: "custom", data: 123 });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles multiline plain text output", () => {
    expect(parser.parseStreamJsonLine("line 1\nline 2")).toBe("line 1\nline 2");
  });

  it("handles empty string input", () => {
    // Empty string is not valid JSON, returns as raw line
    expect(parser.parseStreamJsonLine("")).toBe("");
  });

  it("truncates long tool results", () => {
    const longResult = "x".repeat(1000);
    const line = JSON.stringify({ type: "tool_result", result: longResult });
    const result = parser.parseStreamJsonLine(line);
    expect(result).toContain("truncated");
  });
});

// ─── DefaultStreamParser ────────────────────────────────────────────

describe("DefaultStreamParser", () => {
  const parser = new DefaultStreamParser();

  it("extracts text field", () => {
    const line = JSON.stringify({ type: "anything", text: "Hello" });
    expect(parser.parseStreamJsonLine(line)).toBe("Hello");
  });

  it("extracts content field", () => {
    const line = JSON.stringify({ type: "anything", content: "World" });
    expect(parser.parseStreamJsonLine(line)).toBe("World");
  });

  it("extracts message field", () => {
    const line = JSON.stringify({ type: "anything", message: "Info" });
    expect(parser.parseStreamJsonLine(line)).toBe("Info");
  });

  it("returns empty for unrecognized events", () => {
    const line = JSON.stringify({ type: "unknown", data: [1, 2, 3] });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("returns empty for invalid JSON", () => {
    expect(parser.parseStreamJsonLine("not json")).toBe("");
  });

  // --- new edge case tests ---

  it("extracts output field", () => {
    const line = JSON.stringify({ type: "anything", output: "output text" });
    expect(parser.parseStreamJsonLine(line)).toBe("output text");
  });

  it("prefers text over content, message, and output", () => {
    const line = JSON.stringify({
      type: "anything",
      text: "text wins",
      content: "not this",
      message: "not this",
      output: "not this",
    });
    expect(parser.parseStreamJsonLine(line)).toBe("text wins");
  });

  it("prefers content over message and output when text missing", () => {
    const line = JSON.stringify({
      type: "anything",
      content: "content wins",
      message: "not this",
      output: "not this",
    });
    expect(parser.parseStreamJsonLine(line)).toBe("content wins");
  });

  it("prefers message over output when text and content missing", () => {
    const line = JSON.stringify({
      type: "anything",
      message: "message wins",
      output: "not this",
    });
    expect(parser.parseStreamJsonLine(line)).toBe("message wins");
  });

  it("returns empty for empty JSON object", () => {
    expect(parser.parseStreamJsonLine("{}")).toBe("");
  });

  it("returns empty for JSON with only non-string content", () => {
    const line = JSON.stringify({ content: [1, 2, 3] });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("handles JSON with only numeric fields", () => {
    const line = JSON.stringify({ type: "metrics", tokens: 100, cost: 0.5 });
    expect(parser.parseStreamJsonLine(line)).toBe("");
  });

  it("returns empty for JSON null", () => {
    expect(parser.parseStreamJsonLine("null")).toBe("");
  });

  it("returns empty for JSON number", () => {
    expect(parser.parseStreamJsonLine("42")).toBe("");
  });

  it("returns empty for JSON string", () => {
    expect(parser.parseStreamJsonLine('"hello"')).toBe("");
  });
});

// ─── getStreamJsonParser ────────────────────────────────────────────

describe("getStreamJsonParser", () => {
  it("returns ClaudeStreamParser for 'claude'", () => {
    expect(getStreamJsonParser("claude")).toBeInstanceOf(ClaudeStreamParser);
  });

  it("returns GeminiStreamParser for 'gemini'", () => {
    expect(getStreamJsonParser("gemini")).toBeInstanceOf(GeminiStreamParser);
  });

  it("returns OpenCodeStreamParser for 'opencode'", () => {
    expect(getStreamJsonParser("opencode")).toBeInstanceOf(OpenCodeStreamParser);
  });

  it("returns CodexStreamParser for 'codex'", () => {
    expect(getStreamJsonParser("codex")).toBeInstanceOf(CodexStreamParser);
  });

  it("returns AiderStreamParser for 'aider'", () => {
    expect(getStreamJsonParser("aider")).toBeInstanceOf(AiderStreamParser);
  });

  it("returns DefaultStreamParser for unknown providers", () => {
    expect(getStreamJsonParser("unknown")).toBeInstanceOf(DefaultStreamParser);
    expect(getStreamJsonParser(undefined)).toBeInstanceOf(DefaultStreamParser);
  });

  // --- new edge case tests ---

  it("returns GooseStreamParser for 'goose'", () => {
    expect(getStreamJsonParser("goose")).toBeInstanceOf(GooseStreamParser);
  });

  it("returns DefaultStreamParser for empty string", () => {
    expect(getStreamJsonParser("")).toBeInstanceOf(DefaultStreamParser);
  });

  it("returns DefaultStreamParser for null-like values", () => {
    expect(getStreamJsonParser(undefined)).toBeInstanceOf(DefaultStreamParser);
  });

  it("is case-sensitive (uppercase does not match)", () => {
    expect(getStreamJsonParser("Claude")).toBeInstanceOf(DefaultStreamParser);
    expect(getStreamJsonParser("AIDER")).toBeInstanceOf(DefaultStreamParser);
    expect(getStreamJsonParser("Gemini")).toBeInstanceOf(DefaultStreamParser);
  });

  it("returns unique instances on each call", () => {
    const parser1 = getStreamJsonParser("claude");
    const parser2 = getStreamJsonParser("claude");
    expect(parser1).not.toBe(parser2);
  });

  it("all parsers implement parseStreamJsonLine method", () => {
    const providers = [
      "claude",
      "gemini",
      "opencode",
      "codex",
      "goose",
      "aider",
      "unknown",
      undefined,
    ];
    for (const provider of providers) {
      const parser = getStreamJsonParser(provider);
      expect(typeof parser.parseStreamJsonLine).toBe("function");
    }
  });
});
