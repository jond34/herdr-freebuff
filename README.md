# herdr-freebuff

Freebuff integration for [Herdr](https://herdr.dev), the terminal multiplexer
for coding agents.

> **Status: Phase 3 live validation complete; Phase 4 hardening complete
> locally.** The Freebuff 0.2.36 lifecycle, chat attribution, session reporting,
> and session-aware doctor were validated against Herdr 0.9.5. This is not yet
> a release.

The goal is to make Freebuff a reliable agent inside Herdr plugin panes: report
`idle`, `working`, and `blocked`, launch Freebuff in a real PTY, restore a
conversation after a Herdr restart, and expose enough evidence to diagnose
unresolved panes.

## Lineage

This project began from
[TheMetalStorm/herdr-freebuff-plugin](https://github.com/TheMetalStorm/herdr-freebuff-plugin).
It is a standalone repository, not a GitHub fork, because the Herdr marketplace
excludes forks; the original commits and attribution are preserved.

The original plugin supplied the architecture, pane launch, and screen-marker
ideas. [1024ch/herdr-freebuff-plugin](https://github.com/1024ch/herdr-freebuff-plugin)
supplied the Node watcher, PID-bound chat attribution, incremental log tail,
and checkpoint arbitration. Both are MIT licensed; see [CREDITS.md](CREDITS.md)
and [LICENSE](LICENSE).

## Scope

- Linux first, including WSL2 when Herdr and Freebuff run in the same distro.
- Target: Herdr 0.9.2 or newer and Freebuff 0.2.x; validated on Herdr 0.9.5
  with Freebuff 0.2.36.
- Node.js 22 or newer for the watcher.
- macOS is a follow-up because the PID resolver needs a portable replacement
  for `/proc`. Windows-native Herdr driving Freebuff inside WSL is not
  supported in v1.

The plugin never replaces `~/.local/bin/freebuff` and never installs a global
PATH wrapper. It runs in Herdr plugin panes, which provide a real PTY.

## Herdr support and parity

Herdr 0.9.5 lets a pane self-report an agent and its current session. For
Freebuff, this supplies:

- `idle`, `working`, and `blocked` state reporting.
- Herdr's native agent notifications and `herdr agent wait`.
- Agent session ID, path, and resume argv for restart restoration.
- The `doctor` action for process and chat-binding evidence.

That is the complete supported surface. It does not make Freebuff a built-in
Herdr agent kind, and the plugin cannot change that from outside Herdr.

### Parity limitation

Herdr's built-in agent kinds expose a command surface that self-reported agents
do not receive. On Herdr 0.9.5, Freebuff does not support:

| Command | Freebuff support | Implication |
|---|---|---|
| `herdr agent prompt` | Unavailable | Type into the Freebuff pane directly. Scripts that target Freebuff through Herdr cannot use this command. |
| `herdr agent send-keys` | Unavailable | Send keys directly to the pane if needed. The plugin does not expose this as an agent API. |
| `herdr agent start --kind` | Unavailable | Start Freebuff with the plugin's `task` or `resume-last` panes. |
| `herdr agent explain` | Unavailable | Use `doctor` for Freebuff process, chat, and resume evidence. |

`herdr pane send-text` can write text into the pane, but it does not provide the
native foreground-agent guard and is not equivalent to `agent prompt`. The
plugin intentionally does not wrap it, add detection overrides, or use a fake
agent label.

This is a Herdr capability limit, not a configuration error in the plugin. Native
parity would require Herdr to expose self-reported agents on the native agent
surface, or to add Freebuff as a built-in kind. State reporting, notifications,
`herdr agent wait`, session restore, and `doctor` continue to work.

## Development

Link the working tree into Herdr:

```bash
herdr plugin link /path/to/herdr-freebuff
herdr plugin list
```

The pane entrypoints are `task` and `resume-last`. The tests drive `launch.sh`
with a fake launcher/child process tree and a JSON-recording Herdr stub, so they
exercise the real PID attribution path without a Herdr install. The suite also
covers two Herdr sessions using the same pane ID, including the doctor's
session-aware watcher selection and its ambiguity refusal:

```bash
sh tests/run.sh
node --check scripts/status-watcher.js
```

The `doctor` action inspects the focused pane and reports its watcher, launcher,
child processes, bound chat, and resume argv. It matches the watcher by pane ID
and the pane's inherited `HERDR_SOCKET_PATH`, so two Herdr sessions with the
same pane ID do not collide. If several candidates remain and session identity
cannot choose one, the report marks the result ambiguous instead of guessing.
From a shell, pass a launcher PID and optional chat ID to inspect an unresolved
pane:

```bash
sh scripts/doctor.sh [launcher-pid] [chat-id]
```

## Layout

```text
herdr-freebuff/
  herdr-plugin.toml
  README.md
  CREDITS.md
  CONTRIBUTING.md
  SECURITY.md
  LICENSE
  .gitignore
  .github/workflows/ci.yml
  scripts/
    launch.sh
    status-watcher.js
    doctor.sh
    common.sh
  tests/
    run.sh
    phase2.test.js
```

## Contributing

Issues and pull requests are welcome. There is no CLA, and support is
best-effort. Keep fixtures synthetic: never commit real Freebuff chat logs,
prompts, local usernames, absolute home paths, tokens, or other personal data.
See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
