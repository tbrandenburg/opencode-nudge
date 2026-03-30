export interface SessionState {
  lastContinuation: number  // ms timestamp of last auto-continue prompt (0 = never)
  hourlyCount: number       // number of auto-continues issued in current hour window
  hourStart: number         // ms timestamp marking start of current hour window
  lastIdleSeen: number      // ms timestamp when session.idle was first observed (0 = not idle)
  lastUserMessage: number   // ms timestamp of last incoming user message (0 = never)
}

export function getIdleThreshold(): number {
  const env = process.env["OPENCODE_IDLE_THRESHOLD_MS"]
  return env !== undefined ? parseInt(env, 10) : 5 * 60 * 1000  // 300,000ms default
}
export const COOLDOWN_PERIOD = 10 * 60 * 1000      // 600,000ms — minimum gap between two auto-continues
export const MAX_HOURLY_CONTINUES = 3              // hard cap on auto-continues per hour
export const ONE_HOUR = 60 * 60 * 1000             // 3,600,000ms — rolling hour window size
export const CONTINUE_PROMPT =
  "Only continue if you were clearly interrupted mid-task (e.g. a tool call, loop, or step sequence was cut short). If so, resume — and consider a more interruption-resistant approach. Do NOT invent next steps or start new work just because it seems logical."

export const sessionStates = new Map<string, SessionState>()
