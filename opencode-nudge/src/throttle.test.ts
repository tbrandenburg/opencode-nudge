import { describe, it, expect, beforeEach } from "bun:test"
import { canContinue, getNextContinuationDelay, recordContinuation, getOrCreateState } from "./throttle.js"
import { sessionStates, COOLDOWN_PERIOD, MAX_HOURLY_CONTINUES, ONE_HOUR } from "./types.js"
import type { SessionState } from "./types.js"

describe("canContinue", () => {
  let state: SessionState

  beforeEach(() => {
    sessionStates.clear()
    state = getOrCreateState("test-session")
  })

  it("allows first continuation (no history)", () => {
    expect(canContinue(state, Date.now())).toBe(true)
  })

  it("blocks within cooldown window", () => {
    const now = 1000000
    recordContinuation(state, now)
    expect(canContinue(state, now + COOLDOWN_PERIOD - 1)).toBe(false)
  })

  it("allows after cooldown expires", () => {
    const now = 1000000
    recordContinuation(state, now)
    expect(canContinue(state, now + COOLDOWN_PERIOD)).toBe(true)
  })

  it("blocks when hourly cap reached within window", () => {
    const now = 1000000
    for (let i = 0; i < MAX_HOURLY_CONTINUES; i++) {
      recordContinuation(state, now + i * COOLDOWN_PERIOD)
    }
    expect(canContinue(state, now + MAX_HOURLY_CONTINUES * COOLDOWN_PERIOD)).toBe(false)
  })

  it("resets hourly window after one hour", () => {
    const now = 1000000
    for (let i = 0; i < MAX_HOURLY_CONTINUES; i++) {
      recordContinuation(state, now + i * COOLDOWN_PERIOD)
    }
    // One hour + cooldown later
    expect(canContinue(state, now + ONE_HOUR + COOLDOWN_PERIOD)).toBe(true)
  })
})

describe("getOrCreateState", () => {
  beforeEach(() => sessionStates.clear())

  it("creates fresh state for unknown session", () => {
    const s = getOrCreateState("new-session")
    expect(s.lastContinuation).toBe(0)
    expect(s.hourlyCount).toBe(0)
  })

  it("returns same state on second call", () => {
    const s1 = getOrCreateState("session-x")
    const s2 = getOrCreateState("session-x")
    expect(s1).toBe(s2)
  })
})

describe("getNextContinuationDelay", () => {
  let state: SessionState

  beforeEach(() => {
    sessionStates.clear()
    state = getOrCreateState("delay-session")
  })

  it("waits for cooldown to expire", () => {
    const now = 1_000_000
    recordContinuation(state, now)
    expect(getNextContinuationDelay(state, now + 1_000)).toBe(COOLDOWN_PERIOD - 1_000)
  })

  it("waits for the hourly window when its cap is reached", () => {
    const now = 1_000_000
    for (let count = 0; count < MAX_HOURLY_CONTINUES; count++) {
      recordContinuation(state, now + count * COOLDOWN_PERIOD)
    }
    const checkAt = now + MAX_HOURLY_CONTINUES * COOLDOWN_PERIOD
    expect(getNextContinuationDelay(state, checkAt)).toBe(ONE_HOUR - (checkAt - now))
  })
})
