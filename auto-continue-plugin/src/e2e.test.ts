/**
 * E2E test for the auto-continue plugin.
 *
 * What this test validates (all five E2E conditions from docs/e2e-testing-definition.md):
 *
 *   1. Real system running    — a genuine `opencode run` process starts with the
 *                               project config that registers this plugin
 *   2. Real entry point       — the triggering condition (session going idle after
 *                               the AI responds) happens naturally; nothing is
 *                               injected mid-stack
 *   3. Full code path         — the plugin's own `handleIdleEvent` → `promptAsync`
 *                               path is exercised; confirmed by the plugin's own
 *                               "continuation prompt injected" log line
 *   4. No layer substituted   — every layer participates in the same run; the REST
 *                               API is not called manually to simulate any step
 *   5. Side-effect verified   — the "continuation prompt injected" log line is the
 *                               external confirmation that OpenCode accepted the
 *                               async prompt injection request (204 No Content)
 *
 * Requires:
 *   - `opencode` binary in PATH
 *   - A configured AI provider (if absent the test fails loudly — that is correct
 *     and expected; the environment is not ready for E2E testing)
 *
 * Threshold is set to 0 ms via OPENCODE_IDLE_THRESHOLD_MS so the continuation
 * fires on the first idle event that follows the initial AI response.
 */

import { describe, it, expect } from "bun:test"
import { spawnSync } from "child_process"
import { resolve } from "path"

const PROJECT_ROOT = resolve(import.meta.dir, "../..")
const OPENCODE_BIN = "/home/tom/.opencode/bin/opencode"
// 90 s is enough for: plugin load + AI response + idle event + promptAsync call
const E2E_TIMEOUT_MS = 90_000

describe("auto-continue plugin — E2E", () => {
  it(
    "injects a continuation prompt after the AI responds to an initial message",
    () => {
      const result = spawnSync(
        OPENCODE_BIN,
        ["run", "--print-logs", "--log-level", "DEBUG", "say the word OK and nothing else"],
        {
          cwd: PROJECT_ROOT,
          encoding: "utf8",
          timeout: E2E_TIMEOUT_MS,
          env: {
            ...process.env,
            // Zero threshold: fire continuation on the first idle event that
            // follows a recorded user message, without waiting any extra time.
            OPENCODE_IDLE_THRESHOLD_MS: "0",
          },
        }
      )

      const output = (result.stdout ?? "") + (result.stderr ?? "")

      // ── 1. plugin loaded ────────────────────────────────────────────────
      expect(
        output,
        "plugin was not loaded — check .opencode/opencode.jsonc registration"
      ).toContain("service=auto-continue")

      expect(
        output,
        "plugin initialisation log line missing"
      ).toContain("plugin loaded")

      // ── 2. session.idle event fired ─────────────────────────────────────
      expect(
        output,
        "session.idle event was never published — OpenCode did not emit an idle event"
      ).toContain("type=session.idle publishing")

      // ── 3. plugin's own code path ran ───────────────────────────────────
      //    "idle detected, waiting for threshold" confirms handleIdleEvent ran.
      //    With threshold=0 and lastUserMessage set, the very next check fires
      //    the continuation, so this line may not appear — what matters is the
      //    injected line below.
      //    We assert only the definitive outcome.
      expect(
        output,
        [
          "continuation prompt was never injected.",
          "Possible causes:",
          "  • No AI provider configured (set one up before running E2E tests)",
          "  • chat.message hook did not fire — lastUserMessage was never recorded",
          "  • throttle blocked the continuation (check hourly cap / cooldown)",
          "  • promptAsync threw an error (search output for 'failed to inject')",
          "",
          "Full output:",
          output,
        ].join("\n")
      ).toContain("continuation prompt injected")

      // ── 4. process exited cleanly (not killed by timeout) ───────────────
      expect(
        result.signal,
        `opencode run was killed by signal ${result.signal} — likely timed out after ${E2E_TIMEOUT_MS} ms`
      ).toBeNull()

      expect(
        result.status,
        `opencode run exited with non-zero status ${result.status}`
      ).toBe(0)
    },
    E2E_TIMEOUT_MS
  )
})
