# Changelog

Notable changes to `herdr-freebuff`. Versions match `version` in
`herdr-plugin.toml` and use [semantic versioning](https://semver.org/).

## Unreleased

- Do not hand Herdr a directory that no longer exists. Herdr opens the pane at
  `$HOME` in that case without reporting an error, so a pane whose directory
  was deleted (a removed worktree, a cleaned scratch directory) would file
  Freebuff chats under a project named after the user. The first candidate
  directory that still exists is used instead.
- Cover the paths around that: a directory containing spaces, a deleted
  focused-pane directory, and no usable directory at all.

## 0.1.3 — 2026-11-17

- Open the `new-task` pane in the directory of the pane it was invoked from.
  Plugin commands run with the plugin directory as their cwd, so `prefix+f`
  used to start Freebuff in the plugin checkout, which also switched Freebuff's
  project. The directory now comes from Herdr's invocation context
  (`focused_pane_cwd`, then `workspace_cwd`, then the working directory). The
  CLI form still takes `--cwd`.
- A test pins the `new-task` action to that script, so an inline command that
  would start Freebuff in the plugin directory again fails the suite.

## 0.1.2 — 2026-11-17

- Fix `register-pane` where `date +%3N` does not return milliseconds. uutils
  coreutils ignores the width and returns nanoseconds, so the microsecond `--seq`
  overflowed to a negative number, which Herdr rejects outright, and the pane
  never registered. The seq now comes from Node, the same `Date.now() * 1000`
  clock the watcher uses.
- Rename the test suites after their subjects (`watcher.test.js`,
  `register-pane.test.js`) so the repository reads the same to someone who did
  not plan the work. CI now fails if a tracked file mentions a planning phase or
  points at a gitignored path.

## 0.1.1 — 2026-11-16

- Add a `new-task` action so `prefix+f` can open the `task` pane. Herdr 0.9.5
  keybindings dispatch plugin actions only, never panes.
- Correct the install instructions; the previous snippet used an invalid
  keybinding type and could not bind.
- Add a `register-pane` action and `scripts/register-pane.sh`, which list a pane
  you started yourself as a Freebuff agent with state `unknown`. Herdr 0.9.5
  cannot detect Freebuff on its own, so a hand-started session is otherwise
  invisible in the agent list.
- Document the second-prefix fallback for terminals and editors that swallow
  `ctrl+b`.
- State which Herdr this plugin covers: the `herdr` TUI 0.9.5+, not the separate
  `herdr-app`/`herdr-core` runtime, whose agents list only shows programs that
  emit OSC 7501 themselves.

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

[0.1.3]: https://github.com/jond34/herdr-freebuff/releases/tag/v0.1.3
[0.1.2]: https://github.com/jond34/herdr-freebuff/releases/tag/v0.1.2
[0.1.1]: https://github.com/jond34/herdr-freebuff/releases/tag/v0.1.1
[0.1.0]: https://github.com/jond34/herdr-freebuff/releases/tag/v0.1.0
