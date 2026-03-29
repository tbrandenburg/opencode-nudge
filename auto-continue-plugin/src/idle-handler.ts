import type { Event } from "@opencode-ai/sdk"
import type { PluginInput } from "@opencode-ai/plugin"
import {
  IDLE_THRESHOLD,
  CONTINUE_PROMPT,
} from "./types.js"
import { getOrCreateState, canContinue, recordContinuation } from "./throttle.js"

export async function handleIdleEvent(
  { event }: { event: Event },
  client: PluginInput["client"]
): Promise<void> {
  if (event.type !== "session.idle") return

  const sessionID = event.properties.sessionID
  const state = getOrCreateState(sessionID)
  const now = Date.now()

  // Record when we first saw this idle state
  if (state.lastIdleSeen === 0) {
    state.lastIdleSeen = now
    return  // Not idle long enough yet — wait for next event
  }

  // Check if idle threshold has been reached
  if (now - state.lastIdleSeen < IDLE_THRESHOLD) return

  // Check throttle
  if (!canContinue(state, now)) return

  try {
    await client.session.promptAsync({
      path: { id: sessionID },
      body: { parts: [{ type: "text", text: CONTINUE_PROMPT }] },
    })
    recordContinuation(state, now)
    state.lastIdleSeen = 0  // Reset: next idle event starts a fresh window
  } catch (err) {
    console.error("[auto-continue] Failed to inject continuation prompt:", err)
  }
}

export function handleUserMessage(input: { sessionID: string }): void {
  const state = getOrCreateState(input.sessionID)
  state.lastIdleSeen = 0
  state.lastUserMessage = Date.now()
}
