/**
 * Integration test for the Claude PTY: spawns the real `claude` TUI under
 * a PTY, sends a single user message ("Hello, what model are we using?"),
 * and verifies that the session reached the prompt and produced output
 * before being told to `/exit`.
 *
 * Opt in with `RALPH_RUN_PTY_INTEGRATION=1`. It also requires:
 *   - the optional `node-pty` dependency installed
 *   - the `claude` CLI on PATH
 *   - valid Claude credentials so the assistant can respond
 *
 * Run only this test:
 *   RALPH_RUN_PTY_INTEGRATION=1 npx vitest run src/utils/pty-session.integration.test.ts
 */

import { describe, it, expect } from "vitest";
import { ClaudeCode, type Event, type PtySession } from "./pty-session.js";

const isOptedIn = process.env.RALPH_RUN_PTY_INTEGRATION === "1";

describe("Claude PTY integration", () => {
  it.skipIf(!isOptedIn)(
    'answers "Hello, what model are we using?" via the interactive TUI',
    async () => {
      const IDLE_EXIT_MS = 5_000;
      const SAFETY_TIMEOUT_MS = 90_000;

      const session: PtySession = await ClaudeCode.builder()
        .binary("claude")
        .cwd(process.cwd())
        .permissionMode("bypassPermissions")
        .open();

      let output = "";
      let promptSent = false;
      let sawAssistantContent = false;
      let lastActivity = Date.now();
      let exited = false;

      const idleTimer = setInterval(() => {
        if (!promptSent) return;
        if (Date.now() - lastActivity >= IDLE_EXIT_MS && !exited) {
          exited = true;
          session.sendLine("/exit");
          setTimeout(() => session.kill(), 1_000);
        }
      }, 500);

      const safetyTimer = setTimeout(() => session.kill(), SAFETY_TIMEOUT_MS);

      const handleEvent = (evt: Event): void => {
        switch (evt.type) {
          case "tui_tool_confirmation":
            session.writeRaw("\r");
            return;
          case "tui_prompt":
            if (!promptSent) {
              promptSent = true;
              lastActivity = Date.now();
              setTimeout(
                () => session.sendLine("Hello, what model are we using?"),
                200,
              );
            }
            return;
          case "tui_screen":
            for (const line of evt.lines) {
              output += line + "\n";
            }
            lastActivity = Date.now();
            return;
          case "tui_assistant_message":
            output += evt.content;
            sawAssistantContent = true;
            lastActivity = Date.now();
            return;
          case "tui_output":
            lastActivity = Date.now();
            return;
          default:
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

      expect(promptSent).toBe(true);
      expect(sawAssistantContent || output.trim().length > 0).toBe(true);
    },
    120_000,
  );
});
