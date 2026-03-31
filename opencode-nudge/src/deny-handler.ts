import type { Event } from "@opencode-ai/sdk"
import type { PluginInput } from "@opencode-ai/plugin"
import type { SessionState } from "./types.js"
import {
  getDenyThreshold,
  DENY_COOLDOWN,
  SANDBOX_PROMPT,
  sessionStates,
} from "./types.js"
import { getOrCreateState } from "./throttle.js"

type Client = PluginInput["client"]

const PERMISSION_ERROR_PATTERN = /permission denied|EACCES|Operation not permitted|not allowed/i

function log(client: Client, level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>): void {
  client.app.log({ body: { service: "opencode-nudge", level, message, extra } })
}

export function handlePermissionReplied(
  { sessionID }: { sessionID: string },
  client: Client
): void {
  const state = getOrCreateState(sessionID)
  state.denyCount++
  log(client, "debug", "permission denied", { sessionID, denyCount: state.denyCount })
  maybeInjectDenyNudge(sessionID, state, client)
}

export function handleToolError(
  { sessionID }: { sessionID: string },
  output: { output: string },
  client: Client
): void {
  if (!PERMISSION_ERROR_PATTERN.test(output.output)) return
  const state = getOrCreateState(sessionID)
  state.denyCount++
  log(client, "debug", "tool error detected (permission-related)", { sessionID, denyCount: state.denyCount })
  maybeInjectDenyNudge(sessionID, state, client)
}

export function handleSessionStatus(
  { event }: { event: Event },
  client: Client
): void {
  if (event.type !== "session.status") return
  if (event.properties.status.type === "busy") {
    const sessionID = event.properties.sessionID
    const state = sessionStates.get(sessionID)
    if (state) {
      state.denyCount = 0
      log(client, "debug", "session busy, reset deny count", { sessionID })
    }
  }
}

function maybeInjectDenyNudge(sessionID: string, state: SessionState, client: Client): void {
  const threshold = getDenyThreshold()
  if (state.denyCount < threshold) return

  const now = Date.now()
  if (state.lastDenyNudge > 0 && now - state.lastDenyNudge < DENY_COOLDOWN) {
    log(client, "debug", "deny threshold reached but throttled", { sessionID })
    return
  }

  state.lastDenyNudge = now
  state.denyCount = 0

  client.session.promptAsync({
    path: { id: sessionID },
    body: { parts: [{ type: "text", text: SANDBOX_PROMPT }] },
  }).then(() => {
    log(client, "info", "sandbox-awareness nudge injected", { sessionID })
  }).catch((err) => {
    log(client, "error", "failed to inject sandbox-awareness nudge", { sessionID, err: String(err) })
  })
}
