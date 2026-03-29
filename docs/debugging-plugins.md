# Debugging OpenCode Plugins

Practical techniques discovered while building the `auto-continue` plugin.

## Plugin registration

Plugins are registered in the **project-local** config at `.opencode/opencode.jsonc`.
The path must be absolute.

```jsonc
// .opencode/opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "/absolute/path/to/your-plugin/src/index.ts"
  ]
}
```

OpenCode loads this config whenever it starts with that directory as the working
directory. The global config at `~/.config/opencode/opencode.jsonc` is separate
and should be left untouched for project-specific plugins.

## Confirming the plugin loads

Run any one-shot command with debug logging enabled:

```sh
opencode run --print-logs --log-level DEBUG "say hello"
```

If the plugin is registered and the export is valid you will see two lines near
the top of the output:

```
INFO  service=plugin path=file:///...your-plugin/src/index.ts loading plugin
INFO  service=your-service plugin loaded
```

The second line is produced by the plugin itself via `client.app.log()` (see
[Logging](#logging) below). If only the first line appears, the plugin threw
during initialisation.

## Logging

Use `client.app.log()` for all output from inside a plugin. `console.log` is
swallowed; only the structured log API surfaces entries in OpenCode's log
stream.

```ts
client.app.log({
  body: {
    service: "your-service",   // appears as the "service=" field
    level: "info",             // "debug" | "info" | "warn" | "error"
    message: "something happened",
    extra: { sessionID, count }, // optional key-value bag
  },
})
```

Stream logs to stderr in real time with:

```sh
opencode run --print-logs --log-level DEBUG "your prompt"
```

Logs are also written to timestamped files (last 10 kept) under:

```
~/.local/share/opencode/log/
```

Tail the most-recent file to monitor a running session:

```sh
tail -f $(ls -t ~/.local/share/opencode/log/*.log | head -1)
```

## Keeping the server alive

`opencode run` exits as soon as the session completes. This is enough to confirm
the plugin loads and handles synchronous events, but it is too short-lived for
testing anything that requires idle time or repeated event cycles.

To keep a plugin-loaded server running indefinitely, use the ACP server with an
explicit `--cwd` pointing at your project:

```sh
opencode acp --print-logs --log-level DEBUG --port 9997 \
  --cwd /path/to/your/project
```

The `--cwd` flag is what causes OpenCode to read the project's
`.opencode/opencode.jsonc` and load your plugin. Without it (e.g. with
`opencode serve`), only the global config is read and project plugins are
skipped.

## Testing event handlers via the REST API

Once a server is running you can drive it from the shell using the HTTP API.

### List sessions

```sh
curl http://127.0.0.1:9997/session
```

### Send a prompt asynchronously

This is the same call your plugin makes via `client.session.promptAsync()`.
The REST path is `/session/{id}/prompt_async` (note the underscore).

```sh
curl -X POST http://127.0.0.1:9997/session/<SESSION_ID>/prompt_async \
  -H "Content-Type: application/json" \
  -d '{"parts": [{"type": "text", "text": "Say CONFIRMED"}]}'
```

A `204 No Content` response means the prompt was accepted and queued. The AI
response will appear asynchronously in the session.

### Read session messages

```sh
curl http://127.0.0.1:9997/session/<SESSION_ID>/message
```

## Observing `session.idle`

The `session.idle` event fires when a session transitions from active to idle
(i.e. after the last model response completes and no new user message has
arrived). It is published on the internal event bus, so the plugin's `event`
hook receives it.

To observe it in logs, grep for the bus publish line alongside your handler's
output:

```
INFO  service=bus type=session.idle publishing
DEBUG service=your-service sessionID=... idle detected
```

**Important:** in `opencode run` the process exits at the same timestamp that
`session.idle` fires for the first time, because the session ends immediately
after the response. Two-phase idle detection (waiting for a second event after
a threshold) only works in long-lived sessions (the interactive TUI or
`opencode acp`).

## Temporarily lowering thresholds for validation

If your plugin acts after N minutes of idle time, hardcoding 5 minutes into
tests is impractical. The cleanest pattern is a single constant in `types.ts`
that you can change temporarily:

```ts
// types.ts
export const IDLE_THRESHOLD = 10 * 1000  // 10 s — TEMP: restore to 5 * 60 * 1000
```

Change, observe, restore, confirm tests still pass. The threshold is only
referenced in one place so the diff is trivial and mechanical.

## SDK type reference

Relevant types (from `@opencode-ai/sdk`):

| Symbol | Notes |
|--------|-------|
| `Event` | Union of all bus event types; import from `@opencode-ai/sdk` |
| `event.properties.sessionID` | Correct field name on `session.idle` events |
| `client.session.promptAsync({ path: { id }, body: { parts } })` | Fire-and-forget; returns `void` |
| `client.app.log({ body: { service, level, message, extra? } })` | Structured logging |

The `event` object does **not** have top-level `sessionId` or `idleTime` fields.
All session-specific data lives under `event.properties`.

## TypeScript / Bun setup checklist

- `"moduleResolution": "bundler"` in `tsconfig.json` — required for Bun + ESM
- Import source files with `.js` extensions even though the files are `.ts`
- Add `"bun-types"` to `"types"` in `tsconfig.json` for `bun:test`
- Named exports only — `export const MyPlugin: Plugin = ...` (no `export default`)
- No `require()`, no CommonJS
