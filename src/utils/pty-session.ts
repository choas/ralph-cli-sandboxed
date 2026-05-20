/**
 * PtySession — run a command (e.g. the interactive `claude` TUI) under a
 * real PTY and surface its output as typed events.
 *
 * This is a TypeScript port of the Rust `claude_pty` crate from the
 * Dirigent project. It spawns the configured binary under a PTY via
 * `node-pty`, ANSI-strips the bytes, and emits typed events for the
 * interesting transitions: the workspace-trust dialog, the tool
 * permission dialog, the prompt indicator, assistant messages, and a
 * `TuiScreen` delta whenever genuinely new content appears.
 *
 * `TuiScreen.lines` is a delta — only the lines that are new since the
 * previous `TuiScreen` event are included, with TUI header / footer
 * stripped and spinner / status noise filtered out.
 *
 * The `node-pty` native module is loaded lazily so that environments
 * without prebuilt binaries (and without a working build toolchain)
 * still install ralph-cli; the import only fails when a PTY session is
 * actually requested.
 *
 * Example:
 *
 *   const session = await ClaudeCode.builder().open();
 *   for await (const evt of session.events()) {
 *     if (evt.type === "tui_tool_confirmation" && evt.message === "Trust folder dialog") {
 *       session.writeRaw("\r");
 *     } else if (evt.type === "tui_prompt") {
 *       session.sendLine("say hi in one word");
 *     } else if (evt.type === "tui_screen") {
 *       for (const line of evt.lines) console.log(line);
 *     } else if (evt.type === "lib_done") {
 *       break;
 *     }
 *   }
 */

import { EventEmitter } from "events";

// ─── Types ───────────────────────────────────────────────────────────

export type PermissionMode =
  | "acceptEdits"
  | "auto"
  | "bypassPermissions"
  | "default"
  | "dontAsk"
  | "plan";

export type Event =
  | {
      type: "tui_output";
      text: string;
    }
  | {
      type: "tui_screen";
      lines: string[];
    }
  | { type: "tui_prompt" }
  | { type: "tui_tool_confirmation"; message: string }
  | { type: "tui_assistant_message"; content: string }
  | { type: "lib_error"; message: string }
  | { type: "lib_done" };

export interface PtyChild {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  kill(signal?: string): void;
  resize(cols: number, rows: number): void;
}

interface NodePtyModule {
  spawn(
    file: string,
    args: string[] | string,
    opts: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    },
  ): PtyChild;
}

// ─── ANSI stripping ──────────────────────────────────────────────────

/**
 * Matches CSI / OSC / single-char ANSI escape sequences. Identical in
 * intent to the regex used by the Rust `claude_pty` crate.
 */
const ANSI_REGEX = new RegExp(
  // eslint-disable-next-line no-control-regex
  "\\[[0-9;?<>=]*[ -/]*[@-~]|\\][^]*(?:|\\\\)|[0-?@-Z\\\\^-~]",
  "g",
);

export function stripAnsi(input: string): string {
  return input.replace(ANSI_REGEX, "");
}

// ─── Spinner / status filtering ──────────────────────────────────────

/**
 * Heuristic match for Claude Code TUI spinner / status lines that should
 * not be surfaced as content. Ported from the Rust crate.
 */
export function isSpinnerOrStatus(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;

  // Whitespace / box-drawing only
  let allWhitespaceOrDash = true;
  for (const ch of line) {
    if (
      !(ch === " " || ch === "\t" || ch === "\n" || ch === " " || ch === "─")
    ) {
      allWhitespaceOrDash = false;
      break;
    }
  }
  if (allWhitespaceOrDash) return true;

  const chars = Array.from(t);
  const count = chars.length;
  const first = chars[0];

  if (count === 1) return true;
  if (["✶", "✻", "✽", "⠁", "✢", "✳", "✺", "✦"].includes(first)) return true;
  if (first === "⏵") return true;
  if ((first === "·" || first === "*") && count < 80) return true;
  if (
    t.includes("tokens)") ||
    t.includes("· ↓") ||
    t.includes("· ↑") ||
    t.includes("thinking)") ||
    t.includes("thinking some more")
  ) {
    return true;
  }
  if (
    first === "⎿" &&
    (t.includes("Tip:") ||
      t.includes("Press ") ||
      t.includes("Use /") ||
      t.includes("Running… ") ||
      t.includes("Running…("))
  ) {
    return true;
  }
  if (t.includes("(ctrl+") && t.includes(" to ")) return true;

  return false;
}

// ─── Chat region detection ───────────────────────────────────────────

export function isDivider(line: string): boolean {
  const t = line.trim();
  let dashCount = 0;
  let total = 0;
  for (const ch of t) {
    total++;
    if (ch === "─") dashCount++;
  }
  return dashCount >= 30 && dashCount * 5 >= total * 4;
}

/**
 * Trim raw screen lines down to the chat region: drop the welcome / status
 * header that ends with `╯`, and stop at the first divider line.
 */
export function trimToChatRegion(lines: string[]): string[] {
  let out = [...lines];

  const endOfBox = out.findIndex((l) => l.trimEnd().endsWith("╯"));
  if (endOfBox >= 0) {
    out = out.slice(endOfBox + 1);
  }

  const divider = out.findIndex((l) => isDivider(l));
  if (divider >= 0) {
    out = out.slice(0, divider);
  }

  while (out.length > 0 && out[0].trim() === "") out.shift();
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();

  return out;
}

/**
 * Return the suffix of `next` after the longest common prefix with
 * `prev`. Used to emit only the genuinely new lines on each screen
 * update.
 */
export function deltaLines(prev: string[], next: string[]): string[] {
  let common = 0;
  const max = Math.min(prev.length, next.length);
  while (common < max && prev[common] === next[common]) common++;
  return next.slice(common);
}

// ─── Lazy node-pty loader ────────────────────────────────────────────

let cachedPty: NodePtyModule | null = null;

async function loadNodePty(): Promise<NodePtyModule> {
  if (cachedPty) return cachedPty;
  try {
    // Dynamic import keeps node-pty optional: ralph-cli still works
    // for users who never spawn a PTY session. The indirection through
    // a string variable suppresses TypeScript's module resolution so the
    // package can stay an optional dep.
    const moduleName = "node-pty";
    const mod = (await import(moduleName)) as unknown as NodePtyModule;
    cachedPty = mod;
    return mod;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `node-pty is not available (${reason}). Install it with ` +
        `\`npm install node-pty\` or ensure a build toolchain (python3, make, g++) is present.`,
    );
  }
}

// ─── Builder ─────────────────────────────────────────────────────────

export interface ClaudeCodeOptions {
  binary?: string;
  cwd?: string;
  model?: string;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
  extraArgs?: string[];
  env?: Record<string, string>;
  rows?: number;
  cols?: number;
}

export class ClaudeCodeBuilder {
  private opts: ClaudeCodeOptions = {};

  binary(p: string): this {
    this.opts.binary = p;
    return this;
  }
  cwd(p: string): this {
    this.opts.cwd = p;
    return this;
  }
  model(name: string): this {
    this.opts.model = name;
    return this;
  }
  permissionMode(mode: PermissionMode): this {
    this.opts.permissionMode = mode;
    return this;
  }
  allowedTools(tools: string[]): this {
    this.opts.allowedTools = tools;
    return this;
  }
  disallowedTools(tools: string[]): this {
    this.opts.disallowedTools = tools;
    return this;
  }
  extraArgs(args: string[]): this {
    this.opts.extraArgs = args;
    return this;
  }
  env(key: string, value: string): this {
    this.opts.env = { ...(this.opts.env ?? {}), [key]: value };
    return this;
  }
  envs(vars: Record<string, string>): this {
    this.opts.env = { ...(this.opts.env ?? {}), ...vars };
    return this;
  }
  ptySize(rows: number, cols: number): this {
    this.opts.rows = rows;
    this.opts.cols = cols;
    return this;
  }

  /**
   * Spawn the interactive `claude` TUI under a PTY and return a
   * `PtySession` you can read events from and write input to.
   */
  async open(): Promise<PtySession> {
    return PtySession.spawn(this.resolve());
  }

  resolve(): ResolvedSpec {
    const args: string[] = [];
    if (this.opts.model) {
      args.push("--model", this.opts.model);
    }
    if (this.opts.permissionMode) {
      args.push("--permission-mode", this.opts.permissionMode);
    }
    if (this.opts.allowedTools && this.opts.allowedTools.length > 0) {
      args.push("--allowedTools", this.opts.allowedTools.join(","));
    }
    if (this.opts.disallowedTools && this.opts.disallowedTools.length > 0) {
      args.push("--disallowedTools", this.opts.disallowedTools.join(","));
    }
    if (this.opts.extraArgs && this.opts.extraArgs.length > 0) {
      args.push(...this.opts.extraArgs);
    }

    return {
      binary: this.opts.binary ?? "claude",
      args,
      env: this.opts.env ?? {},
      cwd: this.opts.cwd,
      rows: this.opts.rows ?? 40,
      cols: this.opts.cols ?? 120,
    };
  }
}

export interface ResolvedSpec {
  binary: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  rows: number;
  cols: number;
}

export const ClaudeCode = {
  builder(): ClaudeCodeBuilder {
    return new ClaudeCodeBuilder();
  },
};

// ─── PtySession ──────────────────────────────────────────────────────

/**
 * A spawned PTY session. Subscribe to events via `events()` (async
 * iterable) or `on(...)` (EventEmitter). Writes go through `sendLine`
 * or `writeRaw`.
 */
export class PtySession {
  private child: PtyChild;
  private emitter = new EventEmitter();
  private buffer: Event[] = [];
  private waiters: ((evt: Event | null) => void)[] = [];
  private closed = false;

  // Detection state, mirroring the Rust reader loop.
  private accumulated = "";
  private activeConfirmation: string | null = null;
  private promptCount = 0;
  private prevChatLines: string[] = [];
  private emittedLines = new Set<string>();
  private emittedOrder: string[] = [];
  private static readonly EMITTED_LINES_CAP = 4096;

  private constructor(child: PtyChild) {
    this.child = child;
  }

  static async spawn(spec: ResolvedSpec): Promise<PtySession> {
    const pty = await loadNodePty();
    const child = pty.spawn(spec.binary, spec.args, {
      name: "xterm-256color",
      cols: spec.cols,
      rows: spec.rows,
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
    });

    const session = new PtySession(child);

    child.onData((data) => session.handleData(data));
    child.onExit(() => session.emit({ type: "lib_done" }));

    return session;
  }

  /**
   * Async-iterable stream of events. Drains the internal buffer first,
   * then awaits new events until `lib_done` / `lib_error` is emitted.
   */
  async *events(): AsyncIterableIterator<Event> {
    while (true) {
      const buffered = this.buffer.shift();
      if (buffered) {
        yield buffered;
        if (buffered.type === "lib_done" || buffered.type === "lib_error")
          return;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<Event | null>((resolve) => {
        this.waiters.push(resolve);
      });
      if (next === null) return;
      yield next;
      if (next.type === "lib_done" || next.type === "lib_error") return;
    }
  }

  /** EventEmitter-style subscription. */
  on(event: "event", cb: (evt: Event) => void): this {
    this.emitter.on(event, cb);
    return this;
  }

  /** Writes `text\r` to the PTY — the TUI treats `\r` as "submit". */
  sendLine(text: string): void {
    this.writeRaw(text + "\r");
  }

  /** Alias for `sendLine` matching the Rust API. */
  sendUserMessage(text: string): void {
    this.sendLine(text);
  }

  writeRaw(data: string): void {
    this.child.write(data);
  }

  resize(rows: number, cols: number): void {
    this.child.resize(cols, rows);
  }

  kill(signal: string = "SIGTERM"): void {
    try {
      this.child.kill(signal);
    } catch {
      // Ignore — child already exited
    }
  }

  // ─── Internals ────────────────────────────────────────────────────

  private emit(evt: Event): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(evt);
    } else {
      this.buffer.push(evt);
    }
    this.emitter.emit("event", evt);
    if (evt.type === "lib_done" || evt.type === "lib_error") {
      this.closed = true;
      while (this.waiters.length > 0) {
        const w = this.waiters.shift();
        w?.(null);
      }
    }
  }

  /**
   * Per-chunk processing that mirrors the Rust reader loop. We work
   * line-by-line on the accumulated ANSI-stripped stream rather than
   * maintaining a full vt100 screen, but the event surface is the same.
   */
  private handleData(raw: string): void {
    this.accumulated += raw;
    if (this.accumulated.length > 30_000) {
      const cut = this.accumulated.indexOf("\n", 20_000);
      this.accumulated =
        cut >= 0
          ? this.accumulated.slice(cut + 1)
          : this.accumulated.slice(20_000);
    }

    const cleanedChunk = stripAnsi(raw);
    const cleanedAcc = stripAnsi(this.accumulated);

    // Emit raw output (ANSI-stripped) for consumers that want everything.
    if (cleanedChunk.length > 0) {
      this.emit({ type: "tui_output", text: cleanedChunk });
    }

    // Assistant-message heuristic: chunk contains the `●` marker.
    if (cleanedChunk.includes("●")) {
      const parts = cleanedChunk.split("●");
      const last = parts[parts.length - 1];
      if (last && last.trim().length > 0) {
        this.emit({ type: "tui_assistant_message", content: last });
      }
    }

    // Confirmation dialog detection.
    const normalized = cleanedAcc.replace(/[  ]/g, "");
    let currentConfirmation: string | null = null;
    if (
      normalized.includes("1.Yes") &&
      (normalized.includes("trustthisfolder") ||
        normalized.includes("projectyoucreated"))
    ) {
      currentConfirmation = "Trust folder dialog";
    } else if (
      normalized.includes("1.Yes") &&
      normalized.includes("Doyouwantto")
    ) {
      currentConfirmation = "Tool confirmation dialog";
    }
    if (currentConfirmation !== this.activeConfirmation) {
      if (currentConfirmation) {
        this.emit({
          type: "tui_tool_confirmation",
          message: currentConfirmation,
        });
      }
      this.activeConfirmation = currentConfirmation;
    }

    // Screen-region delta. We use the accumulated cleaned buffer split
    // into lines as a proxy for the rendered screen.
    const rows = cleanedAcc.split(/\r?\n/);
    const chat = trimToChatRegion(rows);

    const promptVisible = rows
      .slice(rows.length - 5)
      .some((l) => l.includes("❯ ") || l.trimEnd() === "❯");
    if (promptVisible && this.promptCount === 0) {
      this.emit({ type: "tui_prompt" });
      this.promptCount++;
    }

    const newLines = deltaLines(this.prevChatLines, chat).filter(
      (l) =>
        !isSpinnerOrStatus(l) && (l.trim() === "" || !this.emittedLines.has(l)),
    );

    if (newLines.length > 0) {
      for (const l of newLines) {
        if (l.trim() !== "" && !this.emittedLines.has(l)) {
          this.emittedLines.add(l);
          this.emittedOrder.push(l);
          while (this.emittedOrder.length > PtySession.EMITTED_LINES_CAP) {
            const oldest = this.emittedOrder.shift();
            if (oldest !== undefined) this.emittedLines.delete(oldest);
          }
        }
      }
      this.emit({ type: "tui_screen", lines: newLines });
    }
    this.prevChatLines = chat;
  }
}
