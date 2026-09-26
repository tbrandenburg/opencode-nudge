import type { SessionState } from "./types.js"
import type { SendPrompt } from "./idle-handler.js"
import type { OpenCodeEvent } from "@opencode/client"
import {
  getDenyThreshold,
  DENY_COOLDOWN,
  SANDBOX_PROMPT,
  sessionStates,
} from "./types.js"
import { getOrCreateState } from "./throttle.js"

const PERMISSION_ERROR_PATTERN = /permission denied|EACCES|Operation not permitted|not allowed/i

function log(level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>): void {
  console[level](`[opencode-nudge] ${message}`, extra ?? {})
}

export function handlePermissionReplied(
  { sessionID }: { sessionID: string },
  sendPrompt: SendPrompt
): void {
  const state = getOrCreateState(sessionID)
  state.denyCount++
  log("debug", "permission denied", { sessionID, denyCount: state.denyCount })
  maybeInjectDenyNudge(sessionID, state, sendPrompt)
}

export function handleToolError(
  { sessionID }: { sessionID: string },
  error: string,
  sendPrompt: SendPrompt
): void {
  if (!PERMISSION_ERROR_PATTERN.test(error)) return
  const state = getOrCreateState(sessionID)
  state.denyCount++
  log("debug", "tool error detected (permission-related)", { sessionID, denyCount: state.denyCount })
  maybeInjectDenyNudge(sessionID, state, sendPrompt)
}

export function handleSessionStatus(
  event: Extract<OpenCodeEvent, { type: "session.status" }>
): void {
  if (event.data.status.type !== "busy") return

  const sessionID = event.data.sessionID
  const state = sessionStates.get(sessionID)
  if (state) {
    state.denyCount = 0
    log("debug", "session busy, reset deny count", { sessionID })
  }
}

function maybeInjectDenyNudge(sessionID: string, state: SessionState, sendPrompt: SendPrompt): void {
  const threshold = getDenyThreshold()
  if (state.denyCount < threshold) return

  const now = Date.now()
  if (state.lastDenyNudge > 0 && now - state.lastDenyNudge < DENY_COOLDOWN) {
    log("debug", "deny threshold reached but throttled", { sessionID })
    return
  }

  state.lastDenyNudge = now
  state.denyCount = 0

  sendPrompt({ sessionID, text: SANDBOX_PROMPT }).then(() => {
    log("info", "sandbox-awareness nudge injected", { sessionID })
  }).catch((err) => {
    log("error", "failed to inject sandbox-awareness nudge", { sessionID, err: String(err) })
  })
}
