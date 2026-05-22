/**
 * PTY-backed driver for the interactive Claude Code TUI. Spawns the
 * TUI under a real PTY (via the port of `claude_pty` in
 * `src/utils/pty-session.ts`) and drives it programmatically:
 *
 *   1. accept the workspace-trust dialog when it appears
 *   2. wait for the first `❯` prompt indicator
 *   3. send the resolved ralph prompt
 *   4. surface assistant output to stdout, watching for the
 *      `<promise>COMPLETE</promise>` signal
 *   5. once the assistant settles (no new output for `IDLE_EXIT_MS`),
 *      send `/exit` so the TUI shuts down cleanly
 *
 * Two entry points:
 *   - `runOnceViaPty` — used by `ralph once --pty`, sends a single
 *     iteration's notifications and returns.
 *   - `runViaPty` — lower-level reusable driver used by both
 *     `runOnceViaPty` and `ralph run --pty` (the iteration loop in
 *     `run.ts`). Returns `{ exitCode, output }` so the caller can
 *     handle notifications and progress tracking itself.
 */

import {
  checkFilesExist,
  loadConfig,
  loadPrompt,
  getPaths,
  getCliConfig,
  requireContainer,
} from "../utils/config.js";
import { resolvePromptVariables } from "../templates/prompts.js";
import { sendNotificationWithDaemonEvents } from "../utils/notification.js";
import { ClaudeCode, type Event, type PtySession } from "../utils/pty-session.js";

interface RunOnceViaPtyOptions {
  debug: boolean;
  model?: string;
}

export interface RunViaPtyOptions {
  command: string;
  cwd: string;
  /** Fully-resolved prompt text to send (with any `@file` references already prepended). */
  prompt: string;
  model?: string;
  debug: boolean;
}

export interface RunViaPtyResult {
  exitCode: number;
  output: string;
}

const IDLE_EXIT_MS = 5_000;
const SAFETY_TIMEOUT_MS = 30 * 60_000;

/**
 * Spawn the Claude Code TUI in a PTY, send `prompt`, and drive the
 * session to completion. Returns the accumulated assistant output and
 * an exit code (0 = clean, 1 = PTY library error).
 *
 * Caller is responsible for notifications, progress tracking, and any
 * file syncing — this function only deals with the PTY lifecycle.
 */
export async function runViaPty(opts: RunViaPtyOptions): Promise<RunViaPtyResult> {
  const builder = ClaudeCode.builder()
    .binary(opts.command)
    .cwd(opts.cwd)
    .permissionMode("bypassPermissions");
  if (opts.model) builder.model(opts.model);

  if (opts.debug) {
    const spec = builder.resolve();
    console.log(`[debug] ${spec.binary} ${spec.args.join(" ")}\n`);
  }

  const session: PtySession = await builder.open();

  let output = "";
  let promptSent = false;
  let lastActivity = Date.now();
  let exitedCleanly = false;
  let exitCode = 0;

  const idleTimer = setInterval(() => {
    if (!promptSent) return;
    const idleFor = Date.now() - lastActivity;
    if (idleFor >= IDLE_EXIT_MS && !exitedCleanly) {
      exitedCleanly = true;
      session.sendLine("/exit");
      setTimeout(() => session.kill(), 1_000);
    }
  }, 1_000);

  const safetyTimer = setTimeout(() => {
    console.error(
      `\n[ralph] PTY session exceeded ${SAFETY_TIMEOUT_MS / 60_000}m safety timeout; killing.`,
    );
    session.kill();
  }, SAFETY_TIMEOUT_MS);

  const handleEvent = (evt: Event) => {
    switch (evt.type) {
      case "tui_tool_confirmation":
        if (evt.message === "Trust folder dialog") {
          session.writeRaw("\r");
        } else if (evt.message === "Tool confirmation dialog") {
          // bypassPermissions should make this rare, but accept if it appears
          session.writeRaw("\r");
        }
        return;
      case "tui_prompt":
        if (!promptSent) {
          promptSent = true;
          lastActivity = Date.now();
          // Small delay so the TUI is settled before we type.
          setTimeout(() => session.sendLine(opts.prompt), 200);
        }
        return;
      case "tui_screen":
        for (const line of evt.lines) {
          if (line.length > 0) {
            process.stdout.write(line + "\n");
            output += line + "\n";
          }
        }
        lastActivity = Date.now();
        return;
      case "tui_assistant_message":
        output += evt.content;
        lastActivity = Date.now();
        return;
      case "tui_output":
        lastActivity = Date.now();
        return;
      case "lib_error":
        console.error(`\n[ralph] PTY error: ${evt.message}`);
        exitCode = 1;
        return;
      case "lib_done":
        return;
    }
  };

  try {
    for await (const evt of session.events()) {
      handleEvent(evt);
      if (evt.type === "lib_done" || evt.type === "lib_error") break;
    }
  } finally {
    clearInterval(idleTimer);
    clearTimeout(safetyTimer);
  }

  return { exitCode, output };
}

export async function runOnceViaPty(opts: RunOnceViaPtyOptions): Promise<void> {
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

  const model = opts.model ?? cliConfig.model;

  // Embed the file references the same way the non-PTY path does for
  // Claude (the PTY mode is Claude-specific: the TUI parsing is keyed
  // on Claude Code's `❯`, `●`, trust-dialog wording, etc.).
  const promptValue = `@${paths.prd} @${paths.progress} ${prompt}`;

  const notifyOptions = {
    command: config.notifyCommand,
    debug: opts.debug,
    daemonConfig: config.daemon,
    chatConfig: config.chat,
  };

  console.log("Starting single ralph iteration (PTY mode)...\n");

  let result: RunViaPtyResult;
  try {
    result = await runViaPty({
      command: cliConfig.command,
      cwd: process.cwd(),
      prompt: promptValue,
      model,
      debug: opts.debug,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to open PTY session: ${message}`);
    await sendNotificationWithDaemonEvents("error", `Ralph: ${message}`, {
      ...notifyOptions,
      errorMessage: message,
    });
    throw err;
  }

  if (result.output.includes("<promise>COMPLETE</promise>")) {
    await sendNotificationWithDaemonEvents("prd_complete", undefined, notifyOptions);
  } else {
    await sendNotificationWithDaemonEvents("iteration_complete", undefined, notifyOptions);
  }
}
