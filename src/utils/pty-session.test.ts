import { describe, it, expect } from "vitest";
import {
  stripAnsi,
  isSpinnerOrStatus,
  isDivider,
  trimToChatRegion,
  deltaLines,
  ClaudeCode,
} from "./pty-session.js";

describe("stripAnsi", () => {
  it("removes CSI SGR sequences", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m text")).toBe("red text");
  });

  it("removes cursor movement sequences", () => {
    expect(stripAnsi("hello\x1b[2K\x1b[Hworld")).toBe("helloworld");
  });

  it("leaves plain text untouched", () => {
    expect(stripAnsi("just plain text")).toBe("just plain text");
  });

  it("removes OSC sequences terminated by BEL", () => {
    expect(stripAnsi("\x1b]0;title\x07after")).toBe("after");
  });
});

describe("isSpinnerOrStatus", () => {
  const positive = [
    "*",
    "✶",
    "✻ Cerebrating…",
    "✽ Cerebrating… (1s · ↓ 1 tokens)",
    "(2s · thinking)",
    "✶ Befuddling… (2s · ↓ 34 tokens)",
    "✻ Ionizing… (40s · ↑ 5.3k tokens · thinking some more)",
    "✳ Thundering… ",
    "  ⎿  Tip: Use /theme to change the color theme",
    "  ⎿  Press ? for help",
    "  ⎿  Running… (9s)",
    "     … +114 lines (ctrl+o to expand)",
    "                                                                                                               ─────────",
    "  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt",
  ];

  for (const s of positive) {
    it(`treats ${JSON.stringify(s)} as spinner/status`, () => {
      expect(isSpinnerOrStatus(s)).toBe(true);
    });
  }

  const negative = [
    "● Hi",
    "❯ say hi in one word",
    "  Claudio stood at the edge of the pitch in Bremen",
    "abc",
    "program Sum;",
  ];

  for (const s of negative) {
    it(`does NOT treat ${JSON.stringify(s)} as spinner/status`, () => {
      expect(isSpinnerOrStatus(s)).toBe(false);
    });
  }
});

describe("isDivider", () => {
  it("recognises a long run of box-drawing dashes", () => {
    expect(isDivider("─".repeat(40))).toBe(true);
  });

  it("rejects short dash runs", () => {
    expect(isDivider("─".repeat(5))).toBe(false);
  });

  it("recognises divider with trailing slash-command suffix", () => {
    const line = `${"─".repeat(100)}· /effort`;
    expect(isDivider(line)).toBe(true);
  });
});

describe("trimToChatRegion", () => {
  it("drops the welcome box header and footer divider", () => {
    const lines = [
      "╭─────────── Claude Code v2.1.143 ─────────────╮",
      "│ Welcome back!                                │",
      "╰──────────────────────────────────────────────╯",
      "",
      "  Claudio stood at the edge of the pitch",
      "  He raised both arms",
      "",
      "────────────────────────────────────────────────",
      "❯ ",
      "────────────────────────────────────────────────",
      "  auto mode on (shift+tab to cycle)",
    ];
    expect(trimToChatRegion(lines)).toEqual([
      "  Claudio stood at the edge of the pitch",
      "  He raised both arms",
    ]);
  });

  it("handles missing header", () => {
    const lines = [
      "",
      "  some paragraph",
      "────────────────────────────────────────────────",
      "❯  ",
    ];
    expect(trimToChatRegion(lines)).toEqual(["  some paragraph"]);
  });
});

describe("deltaLines", () => {
  it("returns only the new suffix", () => {
    expect(deltaLines(["a", "b", "c"], ["a", "b", "c", "d", "e"])).toEqual(["d", "e"]);
  });

  it("returns the divergent tail when lines change", () => {
    expect(deltaLines(["a", "b", "c"], ["a", "X", "c"])).toEqual(["X", "c"]);
  });

  it("returns empty when nothing is new", () => {
    expect(deltaLines(["a", "b"], ["a", "b"])).toEqual([]);
  });
});

describe("ClaudeCodeBuilder.resolve", () => {
  it("builds bare args when no options are set", () => {
    const spec = ClaudeCode.builder().resolve();
    expect(spec.binary).toBe("claude");
    expect(spec.args).toEqual([]);
    expect(spec.rows).toBe(40);
    expect(spec.cols).toBe(120);
  });

  it("threads model, permission mode, and tool filters into args", () => {
    const spec = ClaudeCode.builder()
      .binary("/usr/local/bin/claude")
      .cwd("/workspace")
      .model("claude-sonnet-4")
      .permissionMode("bypassPermissions")
      .allowedTools(["Read", "Edit"])
      .disallowedTools(["Bash"])
      .extraArgs(["--verbose"])
      .env("ANTHROPIC_API_KEY", "secret")
      .ptySize(50, 200)
      .resolve();

    expect(spec.binary).toBe("/usr/local/bin/claude");
    expect(spec.cwd).toBe("/workspace");
    expect(spec.args).toEqual([
      "--model",
      "claude-sonnet-4",
      "--permission-mode",
      "bypassPermissions",
      "--allowedTools",
      "Read,Edit",
      "--disallowedTools",
      "Bash",
      "--verbose",
    ]);
    expect(spec.env.ANTHROPIC_API_KEY).toBe("secret");
    expect(spec.rows).toBe(50);
    expect(spec.cols).toBe(200);
  });
});
