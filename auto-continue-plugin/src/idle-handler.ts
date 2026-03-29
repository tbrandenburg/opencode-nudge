import type { Event } from "@opencode-ai/sdk"
import type { PluginInput } from "@opencode-ai/plugin"
import {
  IDLE_THRESHOLD,
  CONTINUE_PROMPT,
} from "./types.js"
import { getOrCreateState, canContinue, recordContinuation } from "./throttle.js"

type Client = PluginInput["client"]

function log(client: Client, level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>): void {
  client.app.log({ body: { service: "auto-continue", level, message, extra } })
}

export async function handleIdleEvent(
  { event }: { event: Event },
  client: Client
): Promise<void> {
  if (event.type !== "session.idle") return

  const sessionID = event.properties.sessionID
  const state = getOrCreateState(sessionID)
  const now = Date.now()

  // Single-phase: if we know when the last user message arrived, measure idle
  // time from that point — one idle event is enough to trigger continuation.
  // Two-phase fallback: when no user message is recorded, wait for a second
  // idle event separated by at least IDLE_THRESHOLD from the first.
  if (state.lastUserMessage > 0) {
    if (now - state.lastUserMessage < IDLE_THRESHOLD) {
      log(client, "debug", "idle detected, waiting for threshold", { sessionID })
      return
    }
  } else {
    if (state.lastIdleSeen === 0) {
      state.lastIdleSeen = now
      log(client, "debug", "idle detected, waiting for threshold", { sessionID })
      return
    }
    if (now - state.lastIdleSeen < IDLE_THRESHOLD) return
  }

  if (!canContinue(state, now)) {
    log(client, "debug", "idle threshold reached but throttled", { sessionID })
    return
  }

  try {
    await client.session.promptAsync({
      path: { id: sessionID },
      body: { parts: [{ type: "text", text: CONTINUE_PROMPT }] },
    })
    recordContinuation(state, now)
    state.lastIdleSeen = 0
    log(client, "info", "continuation prompt injected", { sessionID })
  } catch (err) {
    log(client, "error", "failed to inject continuation prompt", { sessionID, err: String(err) })
  }
}

export function handleUserMessage(input: { sessionID: string }): void {
  const state = getOrCreateState(input.sessionID)
  state.lastIdleSeen = 0
  state.lastUserMessage = Date.now()
}
