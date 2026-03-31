import type { SessionState } from "./types.js"
import {
  COOLDOWN_PERIOD,
  MAX_HOURLY_CONTINUES,
  ONE_HOUR,
  sessionStates,
} from "./types.js"

export function getOrCreateState(sessionID: string): SessionState {
  if (!sessionStates.has(sessionID)) {
    sessionStates.set(sessionID, {
      lastContinuation: 0,
      hourlyCount: 0,
      hourStart: 0,
      lastIdleSeen: 0,
      lastUserMessage: 0,
      denyCount: 0,
      lastDenyNudge: 0,
    })
  }
  return sessionStates.get(sessionID)!
}

export function canContinue(state: SessionState, now: number): boolean {
  // Cooldown: must be at least COOLDOWN_PERIOD since last continuation
  if (state.lastContinuation > 0 && now - state.lastContinuation < COOLDOWN_PERIOD) {
    return false
  }
  // Hourly cap: reset window if more than an hour has passed
  const inCurrentWindow = state.hourStart > 0 && now - state.hourStart < ONE_HOUR
  if (inCurrentWindow && state.hourlyCount >= MAX_HOURLY_CONTINUES) {
    return false
  }
  return true
}

export function recordContinuation(state: SessionState, now: number): void {
  state.lastContinuation = now
  // Reset hourly window if expired
  if (state.hourStart === 0 || now - state.hourStart >= ONE_HOUR) {
    state.hourStart = now
    state.hourlyCount = 0
  }
  state.hourlyCount++
}
