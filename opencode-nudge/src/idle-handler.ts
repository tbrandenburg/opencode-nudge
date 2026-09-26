import {
  getIdleThreshold,
  CONTINUE_PROMPT,
} from "./types.js"
import { getOrCreateState, canContinue, recordContinuation } from "./throttle.js"
import type { OpenCodeEvent } from "@opencode/client"

export type SendPrompt = (input: { sessionID: string; text: string }) => Promise<unknown>

function log(level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>): void {
  console[level](`[opencode-nudge] ${message}`, extra ?? {})
}

export async function handleIdleEvent(
  { event }: { event: OpenCodeEvent },
  sendPrompt: SendPrompt
): Promise<void> {
  if (event.type !== "session.idle") return

  await handleIdleSession({ sessionID: event.data.sessionID }, sendPrompt)
}

export async function handleIdleSession(
  { sessionID }: { sessionID: string },
  sendPrompt: SendPrompt
): Promise<void> {
  const state = getOrCreateState(sessionID)
  const now = Date.now()

  // Single-phase: if we know when the last user message arrived, measure idle
  // time from that point — one idle event is enough to trigger continuation.
  // Two-phase fallback: when no user message is recorded, wait for a second
  // idle event separated by at least IDLE_THRESHOLD from the first.
  if (state.lastUserMessage > 0) {
    if (now - state.lastUserMessage < getIdleThreshold()) {
      log("debug", "idle detected, waiting for threshold", { sessionID })
      return
    }
  } else {
    if (state.lastIdleSeen === 0) {
      state.lastIdleSeen = now
      log("debug", "idle detected, waiting for threshold", { sessionID })
      return
    }
    if (now - state.lastIdleSeen < getIdleThreshold()) return
  }

  if (!canContinue(state, now)) {
    log("debug", "idle threshold reached but throttled", { sessionID })
    return
  }

  try {
    await sendPrompt({ sessionID, text: CONTINUE_PROMPT })
    recordContinuation(state, now)
    state.lastIdleSeen = 0
    log("info", "continuation prompt injected", { sessionID })
  } catch (err) {
    log("error", "failed to inject continuation prompt", { sessionID, err: String(err) })
  }
}

export function handleUserMessage(input: { sessionID: string }): void {
  const state = getOrCreateState(input.sessionID)
  state.lastIdleSeen = 0
  state.lastUserMessage = Date.now()
}
