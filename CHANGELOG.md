# Changelog

Notable changes to `herdr-freebuff`. Versions match `version` in
`herdr-plugin.toml` and use [semantic versioning](https://semver.org/).

## 0.2.2 — 2026-11-18

- Documentation only. The README leads with screenshots, install, use, and
  limits, and now states what support to expect: best-effort, no SLA, and an
  adapter expected to be short-lived. The pin in the install instructions moves
  to `--ref v0.2.2`. No code changed.
- Verified session restore end to end. Stopping and restarting the Herdr 0.9.5
  server re-runs the reported resume command (`freebuff --continue <chat>`), and
  the pane reopens on the previous conversation. Freebuff creates a fresh chat
  directory for the resumed session, so the bound chat ID changes while the
  conversation continues.

## 0.2.1 — 2026-11-17

- Documentation only. The requirements row, `SECURITY.md`, and the CI paragraph
  now describe Linux, macOS, and Windows instead of calling the project
  Linux-first. No code changed.

## 0.2.0 — 2026-11-17

- Run on Windows. Every pane and action now has a PowerShell twin, and the
  manifest claims `windows` alongside `linux` and `macos`. Herdr 0.9.5 rejects a
  repeated id regardless of platform, so the Windows entrypoints are
  `task-windows`, `resume-last-windows`, `doctor-windows` and
  `register-pane-windows`; `platforms` decides which entry a host may open.
  Entrypoints run under `-NoProfile -ExecutionPolicy Bypass`.
- Split process inspection into `scripts/platform/`. Linux and macOS keep the
  procfs, `ps`, and `lsof` code unchanged in one file; the watcher itself no
  longer names a platform or reads `/proc`.
- Bind chats without a process tree. Windows has no cheap way to see which file
  a process holds open (a CIM query measured 370–560ms against a 500ms poll), so
  the watcher binds the chat log written after it started and keeps that binding
  until its writer exits. Freshness stands in for identity: a recycled process
  ID cannot produce a log written after the pane launched.
- `doctor` names the platform, what it can see (`seesOpenFiles`,
  `seesProcessTable`), the resolved Node and Freebuff paths, and on Windows the
  execution policy for every scope. Where Windows cannot enumerate processes it
  reports `process-table-unavailable` instead of claiming there is no watcher.
  The watcher also publishes its pane binding in the temp directory, so `doctor`
  names the chat that pane actually bound rather than the newest one on disk.
- `doctor` no longer guesses a chat from directory timestamps. It names one it
  has evidence for, or reports `bindingSource: null` with a null chat id, which
  is what a pane with no watcher and no published binding actually knows.
- Guard script shims. Node cannot execute a `.cmd` or `.bat` directly, so a
  Herdr or Freebuff resolved to one of those is run through `cmd.exe /d /s /c`.

## 0.1.5 — 2026-11-17

- Run on macOS. The watcher no longer needs procfs: child processes, open files,
  environment and the `doctor` scan fall back to `ps` and `lsof`, and the test
  suite runs on a macOS runner in CI. Linux still takes the procfs path first.
- Match a chat directory whose path is reported resolved. macOS resolves `/var`
  to `/private/var`, so `lsof` names never matched the projects root before.

## 0.1.4 — 2026-11-17

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
  checkpoint and log, with launcher-descendant PID tracking.
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

[0.1.4]: https://github.com/jond34/herdr-freebuff/releases/tag/v0.1.4
[0.1.3]: https://github.com/jond34/herdr-freebuff/releases/tag/v0.1.3
[0.1.2]: https://github.com/jond34/herdr-freebuff/releases/tag/v0.1.2
[0.1.1]: https://github.com/jond34/herdr-freebuff/releases/tag/v0.1.1
[0.1.0]: https://github.com/jond34/herdr-freebuff/releases/tag/v0.1.0
