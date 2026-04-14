import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { handlePermissionReplied, handleToolError, handleSessionStatus } from "./deny-handler.js"
import { sessionStates, getDenyThreshold, SANDBOX_PROMPT } from "./types.js"

function makeClient(promptFn = mock(() => Promise.resolve())) {
  return {
    app: { log: mock(() => undefined) },
    session: { promptAsync: promptFn },
  } as any
}

let savedDenyEnv: string | undefined
function isolateDenyEnv() {
  beforeEach(() => {
    savedDenyEnv = process.env["OPENCODE_DENY_THRESHOLD"]
    delete process.env["OPENCODE_DENY_THRESHOLD"]
  })
  afterEach(() => {
    if (savedDenyEnv !== undefined) {
      process.env["OPENCODE_DENY_THRESHOLD"] = savedDenyEnv
    } else {
      delete process.env["OPENCODE_DENY_THRESHOLD"]
    }
  })
}

describe("handlePermissionReplied", () => {
  isolateDenyEnv()
  beforeEach(() => sessionStates.clear())

  it("does not nudge on single denial", () => {
    const client = makeClient()
    handlePermissionReplied({ sessionID: "s1" }, client as any)
    expect(client.session.promptAsync).not.toHaveBeenCalled()
    expect(sessionStates.get("s1")!.denyCount).toBe(1)
  })

  it("nudges when threshold (2) is reached", async () => {
    const promptFn = mock(() => Promise.resolve())
    const client = makeClient(promptFn)
    handlePermissionReplied({ sessionID: "s2" }, client as any)
    expect(client.session.promptAsync).not.toHaveBeenCalled()
    handlePermissionReplied({ sessionID: "s2" }, client as any)
    expect(promptFn).toHaveBeenCalledTimes(1)
    const calls = promptFn.mock.calls as unknown as Array<[{ path: { id: string }; body: { parts: Array<{ text: string }> } }]>
    const call = calls[0]![0]!
    expect(call.path.id).toBe("s2")
    expect(call.body.parts[0]!.text).toBe(SANDBOX_PROMPT)
  })

  it("resets denyCount after successful nudge", () => {
    const client = makeClient(mock(() => Promise.resolve()))
    handlePermissionReplied({ sessionID: "s3" }, client as any)
    handlePermissionReplied({ sessionID: "s3" }, client as any)
    expect(sessionStates.get("s3")!.denyCount).toBe(0)
  })

  it("does not throw when promptAsync rejects", () => {
    const client = makeClient(mock(() => Promise.reject(new Error("network error"))))
    handlePermissionReplied({ sessionID: "s4" }, client as any)
    handlePermissionReplied({ sessionID: "s4" }, client as any)
    expect(sessionStates.get("s4")!.denyCount).toBe(0)
  })
})

describe("handleToolError", () => {
  isolateDenyEnv()
  beforeEach(() => sessionStates.clear())

  it("does not trigger on non-permission errors", () => {
    const client = makeClient()
    handleToolError({ sessionID: "t1" }, { output: "file not found" }, client as any)
    expect(client.session.promptAsync).not.toHaveBeenCalled()
  })

  it("matches 'permission denied' pattern", () => {
    const client = makeClient()
    handleToolError({ sessionID: "t2" }, { output: "Error: permission denied" }, client as any)
    expect(sessionStates.get("t2")!.denyCount).toBe(1)
  })

  it("matches 'EACCES' pattern", () => {
    const client = makeClient()
    handleToolError({ sessionID: "t3" }, { output: "EACCES: permission denied" }, client as any)
    expect(sessionStates.get("t3")!.denyCount).toBe(1)
  })

  it("matches 'Operation not permitted' pattern", () => {
    const client = makeClient()
    handleToolError({ sessionID: "t4" }, { output: "Operation not permitted" }, client as any)
    expect(sessionStates.get("t4")!.denyCount).toBe(1)
  })

  it("matches 'not allowed' pattern (case insensitive)", () => {
    const client = makeClient()
    handleToolError({ sessionID: "t5" }, { output: "Access NOT ALLOWED" }, client as any)
    expect(sessionStates.get("t5")!.denyCount).toBe(1)
  })

  it("triggers nudge after threshold with tool errors", async () => {
    const promptFn = mock(() => Promise.resolve())
    const client = makeClient(promptFn)
    handleToolError({ sessionID: "t6" }, { output: "permission denied" }, client as any)
    expect(promptFn).not.toHaveBeenCalled()
    handleToolError({ sessionID: "t6" }, { output: "EACCES: access denied" }, client as any)
    expect(promptFn).toHaveBeenCalledTimes(1)
  })
})

describe("handleSessionStatus", () => {
  isolateDenyEnv()
  beforeEach(() => sessionStates.clear())

  it("resets denyCount when session goes to busy (active)", () => {
    const client = makeClient()
    handlePermissionReplied({ sessionID: "r1" }, client as any)
    handlePermissionReplied({ sessionID: "r1" }, client as any)
    expect(sessionStates.get("r1")!.denyCount).toBe(0)
    handlePermissionReplied({ sessionID: "r1" }, client as any)
    expect(sessionStates.get("r1")!.denyCount).toBe(1)
    handleSessionStatus(
      { event: { type: "session.status", properties: { sessionID: "r1", status: { type: "busy" } } } as any },
      client as any
    )
    expect(sessionStates.get("r1")!.denyCount).toBe(0)
  })

  it("does nothing for idle status", () => {
    const client = makeClient()
    handlePermissionReplied({ sessionID: "r2" }, client as any)
    handleSessionStatus(
      { event: { type: "session.status", properties: { sessionID: "r2", status: { type: "idle" } } } as any },
      client as any
    )
    expect(sessionStates.get("r2")!.denyCount).toBe(1)
  })

  it("does nothing for retry status", () => {
    const client = makeClient()
    handlePermissionReplied({ sessionID: "r3" }, client as any)
    handleSessionStatus(
      { event: { type: "session.status", properties: { sessionID: "r3", status: { type: "retry", attempt: 1, message: "error", next: 1000 } } } as any },
      client as any
    )
    expect(sessionStates.get("r3")!.denyCount).toBe(1)
  })
})

describe("getDenyThreshold", () => {
  afterEach(() => {
    delete process.env["OPENCODE_DENY_THRESHOLD"]
  })

  it("defaults to 2", () => {
    delete process.env["OPENCODE_DENY_THRESHOLD"]
    expect(getDenyThreshold()).toBe(2)
  })

  it("reads from env var", () => {
    process.env["OPENCODE_DENY_THRESHOLD"] = "3"
    expect(getDenyThreshold()).toBe(3)
  })
})
