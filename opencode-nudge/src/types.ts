export interface SessionState {
  lastContinuation: number  // ms timestamp of last nudge prompt (0 = never)
  hourlyCount: number       // number of nudges issued in current hour window
  hourStart: number         // ms timestamp marking start of current hour window
  lastIdleSeen: number      // ms timestamp when session.idle was first observed (0 = not idle)
  lastUserMessage: number   // ms timestamp of last incoming user message (0 = never)
  denyCount: number         // consecutive permission denials/errors in this session
  lastDenyNudge: number     // ms timestamp of last deny-nudge (0 = never)
}

export function getIdleThreshold(): number {
  const env = process.env["OPENCODE_IDLE_THRESHOLD_MS"]
  return env !== undefined ? parseInt(env, 10) : 5 * 60 * 1000  // 300,000ms default
}

export function getDenyThreshold(): number {
  const env = process.env["OPENCODE_DENY_THRESHOLD"]
  return env !== undefined ? parseInt(env, 10) : 2  // default 2 consecutive failures
}
export const COOLDOWN_PERIOD = 10 * 60 * 1000      // 600,000ms — minimum gap between two nudges
export const MAX_HOURLY_CONTINUES = 3              // hard cap on nudges per hour
export const ONE_HOUR = 60 * 60 * 1000             // 3,600,000ms — rolling hour window size
export const CONTINUE_PROMPT =
  "Only continue if you were clearly interrupted mid-task (e.g. a tool call, loop, or step sequence was cut short). If so, resume — and consider a more interruption-resistant approach. Do NOT invent next steps or start new work just because it seems logical."
export const DENY_COOLDOWN = 5 * 60 * 1000        // 300,000ms — minimum gap between deny nudges
export const SANDBOX_PROMPT =
  "Several tool calls have been denied or failed. You may be running in a sandboxed environment where file access is restricted to the project working directory. Avoid retrying the same path — find an alternative approach within the allowed workspace."

export const sessionStates = new Map<string, SessionState>()
