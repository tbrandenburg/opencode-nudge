# opencode-nudge

An OpenCode plugin that automatically nudges the AI to continue work after a
session has been idle for 5 minutes.

## What it does

When you are using OpenCode interactively and the AI finishes a task, it is easy
to forget to ask it to keep going. This plugin watches for idle sessions and
injects the continuation prompt:

> "Please assess if there's any additional work needed and continue if appropriate."

The AI can then decide to keep working or conclude that everything is done.

## Rate limits

| Limit | Value |
|---|---|
| Idle threshold before first nudge | 5 minutes |
| Minimum gap between nudges | 10 minutes |
| Maximum nudges per hour | 3 |

## Getting started

```bash
git clone https://github.com/tbrandenburg/opencode-nudge.git
cd opencode-nudge
make install        # installs dependencies and registers the git hooks
```

Then register the plugin in your project's `.opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["/absolute/path/to/opencode-nudge/auto-continue-plugin/src/index.ts"]
}
```

The path must be absolute.

## Development

```bash
make install        # bun install + register git hooks
make test           # unit tests (~50 ms)
make test-e2e       # full E2E against a real OpenCode session (~20 s, requires AI provider)
make typecheck      # tsc --noEmit
```

The pre-push hook runs `make test` and `make test-e2e` automatically before
every push.

## Docs

- [Debugging plugins with OpenCode](docs/debugging-plugins.md)

## License

MIT — see [LICENSE](LICENSE).
