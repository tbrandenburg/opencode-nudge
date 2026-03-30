/**
 * E2E test for the opencode-nudge plugin.
 *
 * What this test validates (all five E2E conditions):
 *
 *   1. Real system running    — createOpencode() spawns a genuine opencode serve
 *                               process; the project .opencode/opencode.jsonc is
 *                               loaded, registering this plugin automatically.
 *   2. Real entry point       — the triggering condition (session going idle after
 *                               the AI responds) happens naturally inside the
 *                               running server; nothing is injected mid-stack.
 *   3. Full code path         — the plugin's handleIdleEvent → promptAsync path
 *                               is exercised; confirmed by the continuation prompt
 *                               appearing as a user message in the SSE event stream.
 *   4. No layer substituted   — every layer runs in the same process; no REST
 *                               call manually simulates any step.
 *   5. Side-effect verified   — the continuation message part appearing in the
 *                               event stream is the external confirmation that
 *                               OpenCode accepted the async prompt injection
 *                               (204 No Content) and relayed it to the session.
 *
 * Requires:
 *   - `opencode` binary in PATH
 *   - A configured AI provider (if absent the test fails loudly — correct and
 *     expected; the environment is not ready for E2E testing)
 *
 * OPENCODE_IDLE_THRESHOLD_MS is set to 0 ms so the continuation fires on the
 * first idle event that follows the initial AI response.
 */

import { describe, it, expect, afterAll } from "bun:test"
import { createOpencode } from "@opencode-ai/sdk"
import { CONTINUE_PROMPT } from "./types.js"

// The server process inherits process.env, so setting this here propagates
// the override into the opencode server and therefore into the plugin.
process.env["OPENCODE_IDLE_THRESHOLD_MS"] = "0"

// 60 s: server start + plugin load + AI response + idle event + continuation injection.
// We only need to observe the injection, not wait for the second AI response to complete.
const E2E_TIMEOUT_MS = 60_000

let opencode: Awaited<ReturnType<typeof createOpencode>>

describe("opencode-nudge plugin — E2E", () => {
  afterAll(() => {
    opencode?.server.close()
  })

  it(
    "injects a continuation prompt after the AI responds to an initial message",
    async () => {
      // ── 1. Start a real opencode server (picks up .opencode/opencode.jsonc) ──
      // process.cwd() must be PROJECT_ROOT when the test runs (make test-e2e
      // sets cwd correctly; the server inherits it and loads the project config).
      opencode = await createOpencode({
        timeout: 15_000,
      })
      const { client } = opencode

      // ── 2. Create a session ──────────────────────────────────────────────────
      const sessionResp = await client.session.create({ body: {} })
      const sessionID = sessionResp.data!.id

      // ── 3. Open the event stream before sending the prompt ───────────────────
      // Subscribe before prompt so we do not miss the first idle event.
      const events = await client.event.subscribe()

      // ── 4. Send the initial prompt — do not await; watch events concurrently ──
      // Awaiting first would eat into the timeout budget before we can observe
      // the continuation injection.
      client.session.prompt({
        path: { id: sessionID },
        body: {
          parts: [{ type: "text", text: "say the word OK and nothing else" }],
        },
      })

      // ── 5. Wait for the continuation prompt to be injected ───────────────────
      // The sequence is:
      //   a) first AI response → server emits session.status idle + session.idle
      //   b) plugin calls promptAsync with CONTINUE_PROMPT
      //   c) server creates a new user message with CONTINUE_PROMPT text
      //      → server emits message.part.updated with the continuation text
      //
      // Asserting on the message.part.updated event with CONTINUE_PROMPT text
      // proves: plugin loaded + handleIdleEvent ran + promptAsync called.
      // This does NOT require waiting for the second AI response to complete,
      // making the assertion fast and reliable regardless of AI response time.
      let continuationInjected = false

      for await (const event of events.stream) {
        if (event.type === "message.part.updated") {
          const part = event.properties.part
          if (
            "text" in part &&
            typeof part.text === "string" &&
            part.text.includes(CONTINUE_PROMPT)
          ) {
            continuationInjected = true
            break
          }
        }
      }

      expect(
        continuationInjected,
        [
          "Continuation prompt was never injected as a user message.",
          "Possible causes:",
          "  • No AI provider configured (set one up before running E2E tests)",
          "  • Plugin was not loaded — check .opencode/opencode.jsonc registration",
          "  • chat.message hook did not fire — lastUserMessage was never recorded",
          "  • throttle blocked the continuation (check hourly cap / cooldown)",
          "  • promptAsync threw an error inside the plugin",
        ].join("\n")
      ).toBe(true)
    },
    E2E_TIMEOUT_MS
  )
})
