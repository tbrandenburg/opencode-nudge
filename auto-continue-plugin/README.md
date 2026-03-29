# opencode-auto-continue

An OpenCode plugin that nudges the AI to continue work after 5 minutes of session idle time.

## Installation

1. Clone this repo.
2. Run `bun install` inside `auto-continue-plugin/`.
3. Register the plugin in `~/.config/opencode/opencode.jsonc`:

```json
{
  "plugin": ["/absolute/path/to/auto-continue-plugin/src/index.ts"]
}
```

The path must be **absolute** and specific to your machine.

## How it works

- Listens for `session.idle` events from OpenCode.
- Tracks how long the session has been idle using wall-clock time.
- After **5 minutes** of continuous idle, injects a single continuation prompt.
- The AI receives: *"Please assess if there's any additional work needed and continue if appropriate."*
- If the AI decides there is nothing left to do, it says so and stops.
- Any new user message resets the idle timer.

## Rate limits

| Limit | Value |
|---|---|
| Idle threshold before first prompt | 5 minutes |
| Minimum gap between prompts | 10 minutes |
| Maximum prompts per hour | 3 |

## Development

```bash
bun install          # install dependencies
bun test             # run unit tests
bunx tsc --noEmit    # type check
```

## Caveats

- State is in-memory. Restarting OpenCode resets all counters.
- No configuration UI — edit `src/types.ts` constants to change thresholds.
- The plugin path in `opencode.jsonc` must be updated on each machine.
