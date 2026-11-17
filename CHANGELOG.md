# Changelog

Notable changes to `herdr-freebuff`. Versions match `version` in
`herdr-plugin.toml` and use [semantic versioning](https://semver.org/).

## 0.1.0 — 2026-11-16

First public release. Freebuff runs in Herdr plugin panes and reports itself as
a self-reported agent.

### Install

```sh
herdr plugin install jond34/herdr-freebuff
```

Open the `task` pane with
`herdr plugin pane open --plugin freebuff.integration --entrypoint task`; see
the [README](README.md#install) for a `prefix+f` keybinding.

### What works

- Per-pane `idle`, `working`, and `blocked` state from Freebuff's chat
  checkpoint and log, with launcher-descendant PID attribution.
- Herdr's native agent notifications and `herdr agent wait`.
- Session reporting with chat ID, chat path, and a resume argv; a restarted
  pane reopens the same conversation with `--continue`.
- `doctor` action: watcher, launcher, and child PIDs, bound chat, and resume
  argv, matched to the calling Herdr session.
- `task` and `resume-last` panes. `resume-named` refuses a missing chat rather
  than falling back to the newest one.

### Compatibility

- Herdr 0.9.5 (`min_herdr_version = "0.9.5"`). Earlier 0.9.x releases are not
  tested; the resume reporting this plugin uses landed in 0.9.2, but 0.9.5 is
  the only validated version.
- Freebuff 0.2.36 is validated. Other 0.2.x releases are best-effort because
  Freebuff's chat and log layout is undocumented and changes between releases.
- Linux, including WSL2 when Herdr and Freebuff run in the same distro.
  Node.js 22 or newer.

### Known limitation

Herdr 0.9.5 does not expose `agent prompt`, `agent send-keys`,
`agent start --kind`, or `agent explain` to self-reported agents, so this
plugin cannot provide them for Freebuff. That is a Herdr capability limit, not
a plugin configuration error. See [Limits](README.md#limits).

### Verification

- `sh tests/run.sh`: 10 tests covering child-PID recognition, two-pane
  isolation, no unverified fallback binding, startup idle, working/idle
  transitions, fast turns, blocked `ask_user`, answer/skip, Esc-leftover
  blocks, model-picker text, static working screens, session and release
  reporting, and doctor session matching.
- `node --check scripts/status-watcher.js`, `sh -n` on every shell entrypoint,
  `git diff --check`, and GitHub Actions CI.
- Live validation on Herdr 0.9.5 with Freebuff 0.2.36: normal turn, `ask_user`,
  Esc, exit/release, two panes in one directory, named-session restart restore,
  and an isolated install from the tagged commit.

[0.1.0]: https://github.com/jond34/herdr-freebuff/releases/tag/v0.1.0
