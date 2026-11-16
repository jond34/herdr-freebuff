# herdr-freebuff

Freebuff integration for [Herdr](https://herdr.dev), the terminal multiplexer
for coding agents.

> **Status: Phase 2 implementation complete; live validation pending.** This
> repository has the Freebuff 0.2.36 lifecycle, chat attribution, and session
> reporting implementation, but it is not yet a release. Phase 3 validates it
> against a real Herdr 0.9.5 installation.

The goal is to make Freebuff a first-class Herdr agent: report `idle`,
`working`, and `blocked` to the pane, launch Freebuff in plugin panes, and
restore a conversation after a Herdr restart.

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
- Target: Herdr 0.9.2 or newer and Freebuff 0.2.x.
- Node.js 22 or newer for the watcher.
- macOS is a follow-up because the PID resolver needs a portable replacement
  for `/proc`. Windows-native Herdr driving Freebuff inside WSL is not
  supported in v1.

The plugin never replaces `~/.local/bin/freebuff` and never installs a global
PATH wrapper. It runs in Herdr plugin panes, which provide a real PTY.

## Development

Link the working tree into Herdr:

```bash
herdr plugin link /path/to/herdr-freebuff
herdr plugin list
```

The pane entrypoints are `task` and `resume-last`. The Phase 2 tests drive
`launch.sh` with a fake launcher/child process tree and a JSON-recording Herdr
stub, so they exercise the real PID attribution path without a Herdr install:

```bash
sh tests/run.sh
node --check scripts/status-watcher.js
```

`doctor` prints diagnostic JSON for an unresolved pane:

```bash
sh scripts/doctor.sh
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
