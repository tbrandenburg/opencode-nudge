# opencode-nudge

An OpenCode plugin that automatically nudges the AI to continue work after a
session has been idle for 5 minutes.

## Why

Especially in long-lasting agent harnesses and non-interactive sessions unforeseen interruptions can happen due to permission requests, failing subprocesses, hickups. To remind the agent to continue working it has to be nudged gently.

## What it does

When you are using OpenCode interactively and the AI finishes a task, it is easy
to forget to ask it to keep going. This plugin watches for idle sessions and
injects the continuation prompt:

> "Only continue if you were clearly interrupted mid-task (e.g. a tool call, loop, or step sequence was cut short). If so, resume — and consider a more interruption-resistant approach. Do NOT invent next steps or start new work just because it seems logical."

The AI can then decide to resume interrupted work or conclude that everything is done.

## Rate limits

| Limit | Value |
|---|---|
| Idle threshold before first nudge | 5 minutes |
| Minimum gap between nudges | 10 minutes |
| Maximum nudges per hour | 3 |

## Getting started

**Version compatibility:** `opencode-nudge@0.3.0` is the last release compatible
with OpenCode v1. Pin this version if you are using OpenCode v1; future releases
will target the v2 plugin API.

Register the plugin in your project's or global `opencode.jsonc`. For OpenCode
v1, pin the package version explicitly:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-nudge@0.3.0"]
}
```

For a local build, use the absolute path to `dist/index.js` instead.

More information: https://opencode.ai/docs/en/plugins/

## Development

```bash
git clone https://github.com/tbrandenburg/opencode-nudge.git
cd opencode-nudge
make install        # installs dependencies, builds the plugin, and registers git hooks
```

```bash
make install        # bun install + build + register git hooks
make build          # compile TypeScript to dist/
make clean          # remove dist/
make test           # unit tests (~50 ms)
make test-e2e       # full E2E against a real OpenCode session (~20 s, requires AI provider)
make typecheck      # tsc --noEmit
make validate       # typecheck + test
make publish        # interactive: bump version, publish to npm, push tag & GitHub release
```

The pre-push hook runs `make test` and `make test-e2e` automatically before
every push.

## Docs

- [Debugging plugins with OpenCode](docs/debugging-plugins.md)

## License

MIT — see [LICENSE](LICENSE).
