# Investigation: Add sandbox-awareness recovery: nudge agent after repeated tool denials

**Issue**: #5 (https://github.com/tbrandenburg/opencode-nudge/issues/5)
**Type**: ENHANCEMENT
**Investigated**: 2026-04-13T00:00:00.000Z

### Assessment

| Metric     | Value  | Reasoning |
| ---------- | ------ | --------- |
| Priority   | HIGH   | Directly observed production failure (agent retrying denied paths in a loop) with a clear, concrete proposed fix in the issue |
| Complexity | MEDIUM | 4 files to touch (types.ts, throttle.ts, index.ts, new deny-handler.ts) plus a test file; two new hook types (`permission.replied`, `tool.execute.after`) but no architectural changes |
| Confidence | HIGH   | Event shapes fully confirmed in `@opencode-ai/plugin` type definitions (index.d.ts:196-205, 172-174); existing patterns in idle-handler.ts mirror the needed implementation exactly |

---

## Problem Statement

When the agent hits permission denials or OS-level sandboxing errors it retries the same failing path instead of adapting. PR #6 (`fix/issue-5-sandbox-awareness`) already implements this feature but has **not been merged** and contains two issues that need correcting before merge: (1) it deleted the TUI `session.status busy` tests from `idle-handler.test.ts` that were added by issue #4's fix, and (2) it uses `session.status busy` for deny-counter reset in `deny-handler.ts` which conflicts with the same event being used by the idle handler for `handleUserMessage` tracking.

---

## Analysis

### Context: Existing PR

PR #6 (`fix/issue-5-sandbox-awareness`) exists on branch `origin/fix/issue-5-sandbox-awareness` and was submitted on 2026-03-31. It is **open and unmerged**. The implementation is largely correct but has two defects:

1. **Deleted TUI tests** — The PR removes the `session.status 'busy' records lastUserMessage` describe block from `idle-handler.test.ts` (lines 159–212 on `main`). These tests cover the issue #4 fix and must be preserved.
2. **Reset on `busy` vs `running`** — The PR resets the deny counter on `session.status.type === "busy"`, but the issue specification says reset on `session.status.type === "running"`. The `busy` type is already used by the idle-handler to detect user activity. Using the same signal for deny-reset introduces coupling; resetting on `running` is cleaner and matches the issue spec.

### Change Rationale

Instead of implementing from scratch, the task is to **review, fix, and merge PR #6** by correcting the two defects above. All acceptance criteria from the issue are met by the PR except:
- Counter reset trigger: `busy` should be `running`
- Test deletion must be reverted

### Evidence Chain

**ISSUE REQUIREMENT**: After 2 consecutive denials/errors, inject nudge; reset on `session.status.type === "running"`
↓ CONFIRMED: Issue body: "Reset the counter when the session transitions back to `running` (new user message detected via `session.status`)"

**PR IMPLEMENTATION**: `deny-handler.ts:42` — resets on `busy` not `running`:
```typescript
if (event.type === "session.status" && event.properties.status.type === "busy") {
```

**ISSUE SPEC**: `running` is the correct type:
```typescript
if (event.type === "session.status" && event.properties.status.type === "running") {
  resetDenyCounts(event.properties.sessionID)
}
```

**DELETED TESTS**: `idle-handler.test.ts:159-212` on `main` — the entire TUI describe block is missing in the PR branch diff.

**`tool.execute.after` SIGNATURE CONFIRMED**: `@opencode-ai/plugin/dist/index.d.ts:196-205`
```typescript
"tool.execute.after"?: (input: {
  tool: string;
  sessionID: string;   // ← sessionID IS present in input
  callID: string;
  args: any;
}, output: {
  title: string;
  output: string;      // ← output field is named 'output'
  metadata: any;
}) => Promise<void>;
```
The PR's `handleToolError(_input, output, client)` correctly passes `_input` (which has `sessionID`) and `output` (which has the `.output` string). This is correct.

**`permission.replied` SHAPE CONFIRMED**: SDK event type has `sessionID`, `permissionID`, `response`.
The PR correctly destructures `event.properties.sessionID` and checks `event.properties.response === "deny"`.

### Affected Files

| File | Lines | Action | Description |
| ---- | ----- | ------ | ----------- |
| `opencode-nudge/src/deny-handler.ts` | 42 | UPDATE | Change `busy` → `running` for deny counter reset |
| `opencode-nudge/src/idle-handler.test.ts` | 159-212 | RESTORE | Re-add TUI tests deleted by PR |

All other files in the PR (`types.ts`, `throttle.ts`, `index.ts`, `deny-handler.test.ts`) are correct and should be kept as-is.

### Integration Points

- `src/index.ts:8-13` — event hook dispatches to both `handleIdleEvent` and `handleSessionStatus`; the `handleSessionStatus` in deny-handler.ts will reset deny count on `running`
- `src/idle-handler.ts:9-12` — uses `session.status busy` to record `lastUserMessage`; deny-handler must NOT also use `busy` for its own reset (avoid coupling)
- `src/throttle.ts:9-20` — `getOrCreateState` initializes `denyCount: 0, lastDenyNudge: 0` — correct in PR

### Git History

- **Branch created**: 2026-03-31 — commit `e802a33` "Fix: Add sandbox-awareness recovery nudge"
- **Merged into main**: Not merged
- **Base branch divergence**: Branch is based on commit `3610d0b` (before issue #4's TUI fix on `main`)

---

## Implementation Plan

The implementation is already in PR #6 on branch `fix/issue-5-sandbox-awareness`. The task is to apply two corrections and merge.

### Step 1: Fix deny counter reset — change `busy` to `running`

**File**: `opencode-nudge/src/deny-handler.ts`
**Line**: 42
**Action**: UPDATE

**Current code (in PR branch):**
```typescript
  if (event.type === "session.status" && event.properties.status.type === "busy") {
```

**Required change:**
```typescript
  if (event.type === "session.status" && event.properties.status.type === "running") {
```

**Why**: The issue specification explicitly says reset on `running` (line: "Reset the counter when the session transitions back to `running`"). Using `busy` is incorrect per spec and creates coupling with the idle-handler's `busy`-detection logic.

---

### Step 2: Restore deleted TUI tests in idle-handler.test.ts

**File**: `opencode-nudge/src/idle-handler.test.ts`
**Lines**: After line 157 (end of `handleUserMessage` describe block)
**Action**: RESTORE

The PR deleted the entire `session.status 'busy' records lastUserMessage` describe block. It must be restored verbatim from `main`. The full block to restore at the end of the file:

```typescript
// ─── session.status "busy" as proxy for user message (TUI fix) ──────────────

describe("handleIdleEvent — session.status 'busy' records lastUserMessage", () => {
  isolateThresholdEnv()
  beforeEach(() => sessionStates.clear())

  it("does not prompt and does not set lastIdleSeen on session.status busy", async () => {
    const client = makeClient()
    await handleIdleEvent(
      {
        event: {
          type: "session.status" as const,
          properties: { sessionID: "r1", status: { type: "busy" as const } },
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

  it("prompts on first idle event (single-phase) when session.status busy was observed via handleUserMessage", async () => {
    const promptFn = mock(() => Promise.resolve())
    const client = makeClient(promptFn)

    // Simulate what index.ts now does: session.status busy → handleUserMessage
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

    // session.status busy → handleUserMessage
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

**Why**: These tests cover the issue #4 TUI fix. Removing them creates a regression in test coverage for existing functionality. The boyscout rule applies: leave the codebase cleaner than found, not with fewer tests.

---

### Step 3: Also check `idle-handler.test.ts` single-phase describe is missing `isolateThresholdEnv()`

The PR also removed `isolateThresholdEnv()` from the single-phase describe block (line 105 on `main`). The PR's version of this block does NOT call `isolateThresholdEnv()`.

**File**: `opencode-nudge/src/idle-handler.test.ts` (in PR branch)
**Action**: RESTORE `isolateThresholdEnv()` call

**Current in PR:**
```typescript
describe("handleIdleEvent — single-phase (lastUserMessage known)", () => {
  beforeEach(() => sessionStates.clear())
```

**Should be:**
```typescript
describe("handleIdleEvent — single-phase (lastUserMessage known)", () => {
  isolateThresholdEnv()
  beforeEach(() => sessionStates.clear())
```

**Why**: Without `isolateThresholdEnv()`, env leakage from E2E runs could cause false test passes/failures.

---

### Step 4: Update `handleSessionStatus` test for `running` (not `busy`) reset

The `deny-handler.test.ts` in the PR tests reset on `busy`:
```typescript
handleSessionStatus(
  { event: { type: "session.status", properties: { sessionID: "r1", status: { type: "busy" } } } as any },
  client as any
)
```

After fixing Step 1, the test must be updated to use `running` as well. The existing test at line ~87 of `deny-handler.test.ts` that uses `{ type: "busy" }` should change to `{ type: "running" }`.

---

### Step 5: Validate

```bash
cd opencode-nudge
bun run typecheck
bun test
```

Expected: all tests pass (22 existing + 15 new deny-handler tests = 37 total).

---

## Patterns to Follow

**From codebase — mirror these exactly:**

```typescript
// SOURCE: src/idle-handler.ts:11-13
// Logging pattern
function log(client: Client, level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>): void {
  client.app.log({ body: { service: "opencode-nudge", level, message, extra } })
}
```

```typescript
// SOURCE: src/types.ts:9-12
// Env var config pattern
export function getIdleThreshold(): number {
  const env = process.env["OPENCODE_IDLE_THRESHOLD_MS"]
  return env !== undefined ? parseInt(env, 10) : 5 * 60 * 1000
}
```

```typescript
// SOURCE: src/idle-handler.test.ts:16-29
// Env var isolation in tests
let savedThresholdEnv: string | undefined
function isolateThresholdEnv() {
  beforeEach(() => {
    savedThresholdEnv = process.env["OPENCODE_IDLE_THRESHOLD_MS"]
    delete process.env["OPENCODE_IDLE_THRESHOLD_MS"]
  })
  afterEach(() => { /* restore */ })
}
```

---

## Edge Cases & Risks

| Risk/Edge Case | Mitigation |
| -------------- | ---------- |
| `session.status.type === "running"` may not fire in all scenarios | The issue spec says to use it; if empirically `running` never fires, the fallback is `chat.message` hook already used by the idle-handler |
| `tool.execute.after` fires for ALL tools including successful ones | The `PERMISSION_ERROR_PATTERN` regex guard already filters correctly |
| Deny counter never resets if session never goes `running` | Counter resets after nudge fires (state.denyCount = 0), so max one nudge per DENY_COOLDOWN window regardless |
| PR branch is based on an older commit (before issue #4 merge) | The fix applies changes on top of main, not on the old PR branch — cherry-pick or re-apply |

---

## Validation

### Automated Checks

```bash
cd opencode-nudge
bun run typecheck      # TypeScript strict mode
bun test               # all unit tests
```

### Manual Verification

1. Load plugin; deny 2 permission dialogs in same session → verify recovery prompt appears in chat
2. After reset (new user message or `running` status) → deny 2 more → verify nudge fires again
3. Check `OPENCODE_DENY_THRESHOLD=3` env var → verify 3 denials needed before nudge

---

## Scope Boundaries

**IN SCOPE:**
- Fix `busy` → `running` in `deny-handler.ts`
- Restore deleted TUI tests in `idle-handler.test.ts`
- Restore `isolateThresholdEnv()` in single-phase describe
- Update `deny-handler.test.ts` to use `running` in reset test

**OUT OF SCOPE (do not touch):**
- Auto-allow/deny in `permission.ask` hook — issue spec forbids this
- `experimental.chat.system.transform` for permanent injection
- E2E tests for permission dialogs
- Any changes to `idle-handler.ts` or `throttle.ts` logic

---

## Implementation Strategy

**Option A (recommended)**: Apply the 4 corrections directly on the `fix/issue-5-sandbox-awareness` branch, push, and merge the PR.

**Option B**: Cherry-pick `e802a33` onto a fresh branch from current `main`, apply corrections, open a new PR.

Option A is simpler since the PR already exists and only needs surgical fixes.

---

## Metadata

- **Investigated by**: Claude
- **Timestamp**: 2026-04-13T00:00:00.000Z
- **Artifact**: `.claude/PRPs/issues/issue-5.md`
