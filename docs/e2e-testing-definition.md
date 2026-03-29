# E2E Testing Definition

An E2E test is only complete when all of the following are true in a single uninterrupted execution:

1. **Real system running** — the system under test is started in its production-equivalent configuration; no component is replaced by a stub, mock, or simplified harness
2. **Real entry point** — the triggering condition is produced through the same entry point a real user or upstream system would use; nothing is injected mid-stack or via an internal API that bypasses the front door
3. **Full code path traversed** — the system's own code handles the trigger from entry to exit; this is confirmed by the system's own observable output (logs, UI state, persisted data), not inferred from prior unit or integration tests
4. **No layer substituted** — every layer between the trigger and the expected effect participates in the same run; manually calling a downstream function directly to "simulate" a layer does not count
5. **Side-effect verified externally** — the expected outcome is confirmed the way a real end user would confirm it (visible output, file written, message sent, UI updated); internal assertions alone are not sufficient

**Partial satisfaction is failure.** Meeting four out of five conditions, or meeting all five across separate runs, is the same as not having an E2E test at all.

## The failure mode this prevents

**Component assembly fraud**: validating each piece in isolation, then asserting the integration works without ever running the full chain in one trace.
