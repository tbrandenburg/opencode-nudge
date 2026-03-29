import { describe, it, expect, beforeEach, mock } from "bun:test"
import { handleIdleEvent, handleUserMessage } from "./idle-handler.js"
import { sessionStates, IDLE_THRESHOLD } from "./types.js"
import { getOrCreateState } from "./throttle.js"

// Minimal mock client — only the methods we use
function makeClient(promptFn = mock(() => Promise.resolve())) {
  return {
    app: { log: mock(() => undefined) },
    session: { promptAsync: promptFn },
  } as any
}

const idleEvent = (sessionID: string) => ({
  event: { type: "session.idle" as const, properties: { sessionID } },
})

describe("handleIdleEvent", () => {
  beforeEach(() => sessionStates.clear())

  it("ignores non-idle events", async () => {
    const client = makeClient()
    await handleIdleEvent(
      { event: { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } } as any },
      client as any
    )
    expect(client.session.promptAsync).not.toHaveBeenCalled()
  })

  it("records lastIdleSeen on first idle event and does not prompt yet", async () => {
    const client = makeClient()
    await handleIdleEvent(idleEvent("s1"), client as any)
    expect(client.session.promptAsync).not.toHaveBeenCalled()
    const state = getOrCreateState("s1")
    expect(state.lastIdleSeen).toBeGreaterThan(0)
  })

  it("does not prompt if idle threshold not yet reached", async () => {
    const client = makeClient()
    // First event: records lastIdleSeen
    await handleIdleEvent(idleEvent("s2"), client as any)
    const state = getOrCreateState("s2")
    // Manually backdate by less than threshold
    state.lastIdleSeen = Date.now() - (IDLE_THRESHOLD - 1000)
    await handleIdleEvent(idleEvent("s2"), client as any)
    expect(client.session.promptAsync).not.toHaveBeenCalled()
  })

  it("prompts when idle threshold is exceeded", async () => {
    const promptFn = mock(() => Promise.resolve())
    const client = makeClient(promptFn)
    await handleIdleEvent(idleEvent("s3"), client as any)
    const state = getOrCreateState("s3")
    // Backdate past threshold
    state.lastIdleSeen = Date.now() - IDLE_THRESHOLD - 1000
    await handleIdleEvent(idleEvent("s3"), client as any)
    expect(promptFn).toHaveBeenCalledTimes(1)
    const calls = promptFn.mock.calls as unknown as Array<[{ path: { id: string }; body: { parts: Array<{ text: string }> } }]>
    const call = calls[0]![0]!
    expect(call.path.id).toBe("s3")
    expect(call.body.parts[0]!.text).toContain("continue if appropriate")
  })

  it("resets lastIdleSeen to 0 after prompting", async () => {
    const client = makeClient()
    await handleIdleEvent(idleEvent("s4"), client as any)
    const state = getOrCreateState("s4")
    state.lastIdleSeen = Date.now() - IDLE_THRESHOLD - 1000
    await handleIdleEvent(idleEvent("s4"), client as any)
    expect(state.lastIdleSeen).toBe(0)
  })

  it("does not throw when promptAsync rejects", async () => {
    const client = makeClient(mock(() => Promise.reject(new Error("network error"))))
    await handleIdleEvent(idleEvent("s5"), client as any)
    const state = getOrCreateState("s5")
    state.lastIdleSeen = Date.now() - IDLE_THRESHOLD - 1000
    await expect(handleIdleEvent(idleEvent("s5"), client as any)).resolves.toBeUndefined()
  })
})

describe("handleUserMessage", () => {
  beforeEach(() => sessionStates.clear())

  it("resets lastIdleSeen to 0", () => {
    const state = getOrCreateState("u1")
    state.lastIdleSeen = 9999999
    handleUserMessage({ sessionID: "u1" })
    expect(state.lastIdleSeen).toBe(0)
  })

  it("updates lastUserMessage", () => {
    const before = Date.now()
    handleUserMessage({ sessionID: "u2" })
    const state = getOrCreateState("u2")
    expect(state.lastUserMessage).toBeGreaterThanOrEqual(before)
  })
})
