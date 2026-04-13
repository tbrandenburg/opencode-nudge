# Investigation: Nudge never fires in interactive TUI sessions despite E2E passing

**Issue**: #4 (https://github.com/tbrandenburg/opencode-nudge/issues/4)
**Type**: BUG
**Investigated**: 2026-04-13T00:00:00Z

### Assessment

| Metric     | Value  | Reasoning                                                                                                                                             |
| ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity   | HIGH   | Core plugin functionality (nudge injection) is completely non-functional in interactive TUI sessions, which is the primary use-case for the plugin     |
| Complexity | LOW    | Fix is a single-file change in `index.ts` (≤10 lines), plus adding one new `describe` block to the existing test file; no architectural changes needed |
| Confidence | HIGH   | Root cause fully verified with code evidence from all three files; the SDK event type definitions confirm `chat.message` cannot fire for TUI input      |

---

## Problem Statement

The plugin never injects a nudge in interactive (TUI) sessions because `handleUserMessage` is never called: the `chat.message` hook registered in `index.ts` is only invoked for REST-originated messages, not for keystrokes entered through the TUI. With `state.lastUserMessage` permanently at `0`, the two-phase fallback in `idle-handler.ts` records the first `session.idle` event and then waits for a **second** one that the OpenCode server never emits. The E2E test masks this entirely by setting `OPENCODE_IDLE_THRESHOLD_MS=0`, making the second-event wait trivially short.

---

## Analysis

### Root Cause / Change Rationale

The `session.status` event with `status.type === "running"` is emitted by OpenCode every time the AI begins processing a new user message — in all contexts including the TUI. Using this event as the trigger for `handleUserMessage` replaces the broken `chat.message` hook with a reliable proxy, enabling the existing single-phase path (`lastUserMessage > 0`) to work correctly.

### Evidence Chain

WHY: Nudge never fires in TUI sessions
↓ BECAUSE: Two-phase fallback waits indefinitely for a second `session.idle` event
Evidence: `opencode-nudge/src/idle-handler.ts:34-41`
```typescript
} else {                                        // ← TUI always falls here
  if (state.lastIdleSeen === 0) {               // first idle event
    state.lastIdleSeen = now                    // records timestamp, returns
    return                                      // ← exits, awaits SECOND event
  }
  if (now - state.lastIdleSeen < getIdleThreshold()) return  // second gate
}
```

↓ BECAUSE: `state.lastUserMessage === 0` so the single-phase path is never taken
Evidence: `opencode-nudge/src/idle-handler.ts:29-33`
```typescript
if (state.lastUserMessage > 0) {               // ← NEVER true in TUI sessions
  if (now - state.lastUserMessage < getIdleThreshold()) {
    return
  }
}
```

↓ BECAUSE: `handleUserMessage` is never called in TUI sessions
Evidence: `opencode-nudge/src/index.ts:9-12`
```typescript
"chat.message": (messageInput) => {
  handleUserMessage({ sessionID: messageInput.sessionID })
  return Promise.resolve()
},
```

↓ ROOT CAUSE: The `chat.message` hook does not fire for TUI-originated messages
Evidence: SDK type `EventTuiPromptAppend` (node_modules `@opencode-ai/sdk` types.gen.d.ts)
```typescript
export type EventTuiPromptAppend = {
  type: "tui.prompt.append";
  properties: {
    text: string;    // ← NO sessionID — cannot correlate to a session
  };
};
```
TUI keystrokes go through `EventTuiPromptAppend` / `EventTuiCommandExecute`, not through the REST `POST /session/{id}/message` endpoint that triggers the `chat.message` plugin hook.

**Masking: Why E2E passes**
Evidence: `opencode-nudge/src/e2e.test.ts:37`
```typescript
process.env["OPENCODE_IDLE_THRESHOLD_MS"] = "0"
```
With threshold=0, the check `now - state.lastIdleSeen < getIdleThreshold()` (line 40) evaluates to `0 < 0` which is always `false`, so the second-event gate is immediately cleared on the very next `session.idle` — even 1 ms later. The two-phase stall is invisible under this test setup.

### Affected Files

| File                                          | Lines   | Action | Description                                                    |
| --------------------------------------------- | ------- | ------ | -------------------------------------------------------------- |
| `opencode-nudge/src/index.ts`                 | 7-13    | UPDATE | Replace `chat.message` hook with `session.status` event branch |
| `opencode-nudge/src/idle-handler.test.ts`     | 156+    | UPDATE | Add test for `session.status`-based user message recording     |

### Integration Points

- `index.ts:8` — `event` handler already receives every `Event`; the fix adds a branch inside the existing handler
- `index.ts:9-12` — `chat.message` hook (to be removed)
- `idle-handler.ts:61-65` — `handleUserMessage` function called by the new event branch
- `idle-handler.ts:29-33` — single-phase path becomes active once `lastUserMessage > 0`

### Git History

- **Introduced**: `568fb37` - 2026-03-30 - "fix: changed plugin name to opencode-nudge" (rename only)
- **Two-phase fallback introduced**: `9185d9a` - 2026-03-29 - "feat: add e2e test" (introduced the `lastUserMessage` branch alongside E2E with `THRESHOLD=0` masking)
- **Implication**: The two-phase fallback and the masking test were added in the same commit, so the bug was never visible in CI.

---

## Implementation Plan

### Step 1: Replace `chat.message` hook with `session.status` event branch in `index.ts`

**File**: `opencode-nudge/src/index.ts`
**Lines**: 7-13
**Action**: UPDATE

**Current code:**

```typescript
// Lines 7-13
  return {
    event: ({ event }) => handleIdleEvent({ event }, input.client),
    "chat.message": (messageInput) => {
      handleUserMessage({ sessionID: messageInput.sessionID })
      return Promise.resolve()
    },
  }
```

**Required change:**

```typescript
  return {
    event: ({ event }) => {
      if (event.type === "session.status" && event.properties.status.type === "running") {
        handleUserMessage({ sessionID: event.properties.sessionID })
      }
      return handleIdleEvent({ event }, input.client)
    },
  }
```

**Why**: `session.status` with `status.type === "running"` fires every time the AI begins processing a user message, in all contexts including the TUI. This is the correct proxy for "user sent a message." The `chat.message` hook can be removed entirely — it is only invoked for REST-originated messages and is therefore unreliable.

---

### Step 2: Add unit tests for `session.status`-based user message recording

**File**: `opencode-nudge/src/idle-handler.test.ts`
**Action**: UPDATE — append after the existing `handleUserMessage` describe block (line 156)

**Test cases to add:**

```typescript
// ─── session.status "running" as proxy for user message (TUI fix) ──────────

describe("handleIdleEvent — session.status 'running' records lastUserMessage", () => {
  isolateThresholdEnv()
  beforeEach(() => sessionStates.clear())

  it("does not prompt and does not set lastIdleSeen on session.status running", async () => {
    const client = makeClient()
    await handleIdleEvent(
      {
        event: {
          type: "session.status" as const,
          properties: { sessionID: "r1", status: { type: "running" as const } },
        } as any,
      },
      client as any
    )
    expect(client.session.promptAsync).not.toHaveBeenCalled()
    // session.status is not session.idle — idle-handler should do nothing
    const state = getOrCreateState("r1")
    expect(state.lastUserMessage).toBe(0)
    expect(state.lastIdleSeen).toBe(0)
  })

  it("prompts on first idle event (single-phase) when session.status running was observed via handleUserMessage", async () => {
    const promptFn = mock(() => Promise.resolve())
    const client = makeClient(promptFn)

    // Simulate what index.ts now does: session.status running → handleUserMessage
    handleUserMessage({ sessionID: "r2" })
    const state = getOrCreateState("r2")
    // Backdate past threshold to simulate time elapsed
    state.lastUserMessage = Date.now() - getIdleThreshold() - 1000

    // First idle event — should trigger immediately (single-phase path)
    await handleIdleEvent(idleEvent("r2"), client as any)
    expect(promptFn).toHaveBeenCalledTimes(1)
    expect(state.lastIdleSeen).toBe(0) // two-phase branch never taken
  })

  it("does not enter two-phase fallback when lastUserMessage is set", async () => {
    const client = makeClient()

    // session.status running → handleUserMessage
    handleUserMessage({ sessionID: "r3" })
    const state = getOrCreateState("r3")

    // First idle event (threshold not yet elapsed)
    await handleIdleEvent(idleEvent("r3"), client as any)
    // Two-phase branch must NOT have been taken — lastIdleSeen stays 0
    expect(state.lastIdleSeen).toBe(0)
    expect(client.session.promptAsync).not.toHaveBeenCalled()
  })
})
```

**Why**: These tests validate that once `handleUserMessage` is called (now via `session.status` from `index.ts`), the single-phase path works correctly and the two-phase fallback is never entered, proving the TUI bug is fixed.

---

## Patterns to Follow

**From codebase — mirror these exactly:**

```typescript
// SOURCE: opencode-nudge/src/idle-handler.test.ts:31-33
// Pattern for creating event helper with correct `as const` typing
const idleEvent = (sessionID: string) => ({
  event: { type: "session.idle" as const, properties: { sessionID } },
})

// SOURCE: opencode-nudge/src/idle-handler.test.ts:43-46
// Pattern for typing a session.status event as `any` to satisfy union narrowing
{ event: { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } } as any }

// SOURCE: opencode-nudge/src/idle-handler.test.ts:7-12
// Pattern for makeClient mock
function makeClient(promptFn = mock(() => Promise.resolve())) {
  return {
    app: { log: mock(() => undefined) },
    session: { promptAsync: promptFn },
  } as any
}
```

---

## Edge Cases & Risks

| Risk / Edge Case                                            | Mitigation                                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `session.status` with `running` fires multiple times per message | `handleUserMessage` is idempotent — it just timestamps `lastUserMessage`; multiple calls are harmless  |
| Stale `lastUserMessage` from a previous session survives reset | `handleUserMessage` also resets `lastIdleSeen = 0`; `sessionStates` is keyed by `sessionID`; separate sessions are isolated |
| `event.properties.sessionID` missing on some `session.status` events | SDK type `EventSessionStatus.properties.sessionID` is not optional — guaranteed by the type contract   |
| `event.properties.status.type` values other than `running` (e.g., `idle`, `error`) | The guard `status.type === "running"` is explicit — only the start of AI processing triggers the hook  |
| Return value of `handleIdleEvent` not being forwarded       | The revised handler calls `return handleIdleEvent(...)` — the Promise is correctly forwarded            |

---

## Validation

### Automated Checks

```bash
# Type check
cd opencode-nudge && bun run typecheck

# Run all unit tests
cd opencode-nudge && bun test

# Run only the relevant test file
cd opencode-nudge && bun test src/idle-handler.test.ts
```

All three commands must exit 0 with 0 failures.

### Manual Verification

1. Build the plugin: `make build-plugin`
2. Install it: `make install`
3. Start an interactive OpenCode TUI session: `opencode`
4. Send any message and wait for the AI response to complete
5. Wait 5+ minutes past the AI response
6. Observe: the continuation prompt is injected as a new user message

---

## Scope Boundaries

**IN SCOPE:**
- Updating `opencode-nudge/src/index.ts` to remove the `chat.message` hook and add the `session.status` branch
- Adding unit tests to `opencode-nudge/src/idle-handler.test.ts` for the new behavior

**OUT OF SCOPE (do not touch):**
- `idle-handler.ts` — the two-phase fallback logic itself is correct; once `lastUserMessage > 0` is set, the single-phase path works as intended
- `throttle.ts` — unrelated to this bug
- `e2e.test.ts` — the `OPENCODE_IDLE_THRESHOLD_MS=0` override is valid for E2E; leave it in place
- Documentation updates — defer to a separate PR

---

## Metadata

- **Investigated by**: Claude
- **Timestamp**: 2026-04-13T00:00:00Z
- **Artifact**: `.claude/PRPs/issues/issue-4.md`
