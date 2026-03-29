import { describe, it, expect } from "vitest";
import {
  ClaudeStreamParser,
  GeminiStreamParser,
  OpenCodeStreamParser,
  CodexStreamParser,
  AiderStreamParser,
  DefaultStreamParser,
  getStreamJsonParser,
} from "./stream-json.js";

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
});

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
});

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
});

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
});

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
});

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
});

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
});
