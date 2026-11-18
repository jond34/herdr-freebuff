# herdr-freebuff

[![CI](https://github.com/jond34/herdr-freebuff/actions/workflows/ci.yml/badge.svg)](https://github.com/jond34/herdr-freebuff/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/jond34/herdr-freebuff)](https://github.com/jond34/herdr-freebuff/releases)
[![License: MIT](https://img.shields.io/github/license/jond34/herdr-freebuff)](LICENSE)

Run [Freebuff](https://freebuff.com) in a [Herdr](https://herdr.dev) pane and let
Herdr see it: `idle` / `working` / `blocked` in the sidebar, native
notifications, `herdr agent wait`, and the same conversation back after a
restart.

| Started by hand in a pane | Opened by the plugin | Pane beside it closed |
|---|---|---|
| ![Freebuff in a plain Herdr pane, agents list empty](docs/screenshots/01-plain-pane-no-agent.png) | ![Freebuff in a plugin pane beside a shell, listed under agents](docs/screenshots/02-plugin-pane-registered.png) | ![Freebuff alone in a tab, still listed under agents](docs/screenshots/03-extra-pane-closed.png) |
| Herdr has no kind for `freebuff`, so it lists nothing. | The plugin reports the pane, and the sidebar carries its state. | Closing the other pane leaves the entry in place. |

## Install

Two commands, no configuration:

```sh
herdr plugin install jond34/herdr-freebuff
herdr plugin pane open --plugin freebuff.integration --entrypoint task
```

The pane starts in the directory you invoke it from, and `--cwd <dir>` starts it
elsewhere. Add `--ref v0.2.1` to pin the release. There is no setup step, `PATH`
change, or launcher replacement.

On Windows use `--entrypoint task-windows`. Herdr 0.9.5 rejects a manifest that
repeats an id, so every Windows entry carries a `-windows` suffix, and `task`
there fails with `platform_unsupported`.

For a key instead of the second command, add this to
`~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+f"
type = "plugin_action"
command = "freebuff.integration.new-task"
description = "Freebuff: new task"
```

Then run `herdr server reload-config` and restart the client (`prefix+q`, then
`herdr`). If the key does nothing, check that Herdr receives the prefix with
`prefix+?`; editors that bind `ctrl+b` swallow it first. A second prefix goes in
`[keys]`, above any `[[keys.command]]`, as `prefix = ["ctrl+b", "ctrl+space"]`.

## Requirements

- Herdr 0.9.5: the `herdr` TUI, not `herdr-app`/`herdr-core`, and
  `min_herdr_version` refuses older releases. The app's agent list holds only
  programs that emit [OSC 7501](https://herdr.dev/core), which Freebuff does not.
- Freebuff 0.2.36, validated. Other 0.2.x releases are best-effort.
- Linux, WSL2, macOS, or Windows 10+. On WSL2, both must run in the same distro.
  macOS passes CI but has not been walked by hand against a real pane.
- Node.js 22+ runs the watcher. Without it the pane starts but stays `unknown`,
  and `doctor` exits.

## Use

- State: `idle`, `working`, and `blocked` per pane, read from Freebuff's chat
  checkpoint and log.
- Notifications and `herdr agent wait`: Herdr's own, driven by the reported
  state.
- Session restore: reports the chat ID, path, and resume command, which Herdr
  runs after a restart.
- Entrypoints: `task` for a new session, `resume-last` for the previous one.
- Actions: `doctor` and `register-pane`, described below.

Each pane binds its own chat by process tree, so two panes in one project stay
independent. Windows has no process table cheap enough to poll, so a pane there
binds the log written after it launched, and `doctor` says which evidence named
the chat.

Tested in the suite: state transitions, two-pane isolation, resume arguments,
`doctor`. Walked by hand: a server restart reopened the pane on the previous
conversation, and Freebuff opened a fresh chat directory, so the chat ID changes
while the conversation continues. A notification firing was not observed; Herdr
sends it from the reported state.

### Panes you start yourself

Freebuff typed into a plain pane reports nothing, so Herdr lists it as
`unknown`. Register it once Freebuff is running:

```sh
herdr pane report-agent w1:p2 --source freebuff --agent freebuff --state unknown
```

`Freebuff: register this pane` does the same for the focused pane. That entry
does not follow `working` or `blocked` and goes when the pane closes; a plugin
pane is what gets live state. Register while Freebuff is in the foreground, and
let the script's `--seq` stand.

Herdr identifies an agent from the foreground command and a closed list of
built-in kinds, and Freebuff is not one, so no manifest or override makes it
detectable. [Discussion
#4832](https://github.com/herdrdev/herdr/discussions/4832) tracks the two fixes:
a built-in kind, or lifecycle hooks in Freebuff.

## Limits

Self-reported agents get a smaller command surface in Herdr 0.9.5:

| Command | Support | Workaround |
|---|---|---|
| `herdr agent prompt` | Unavailable | Type into the pane |
| `herdr agent send-keys` | Unavailable | Send keys to the pane |
| `herdr agent start --kind` | Unavailable | Use `task` or `resume-last` |
| `herdr agent explain` | Unavailable | Use `doctor` |

`herdr pane send-text` can write into the pane, but it lacks the foreground-agent
guard, so this plugin does not wrap it. State, notifications, `agent wait`,
restore, and `doctor` all work.

## Windows

PowerShell twins run with `-NoProfile -ExecutionPolicy Bypass`, and the watcher
is the same Node file. Two limits:

- A Group Policy that sets execution policy overrides the flag the manifest
  passes, and the pane closes as soon as it opens. `doctor` prints the policy
  for every scope.
- Status reporting needs Node on `PATH`. The npm install of Freebuff brings it; a
  tarball install may not, and the pane then stays `unknown`.

Verified by hand on Windows 11: pane environment, chat log shape, process
liveness, TUI input, and a reported `working`. That walk predates the watcher
split, so a live pane on the current code is unverified; CI covers parsing and
the binding rules.

## Troubleshooting

`sh scripts/doctor.sh [launcher-pid] [chat-id]` prints the watcher, launcher, and
child PIDs, the bound chat, and the resume argv; inside Herdr, the `doctor`
action does this for the focused pane, matching watchers by pane ID and inherited
`HERDR_SOCKET_PATH`. If a pane has no chat, confirm Freebuff is running in it and
that `~/.config/manicode/projects/<project>/chats/` holds it; `resume-named`
refuses a missing chat. On Windows pass the launcher PID, since the session match
reports `process-table-unavailable`.

## Development

```sh
herdr plugin link /path/to/herdr-freebuff
sh tests/run.sh
```

The tests drive `launch.sh` with a fake launcher and a JSON-recording Herdr
stub, so the PID binding path runs without Herdr. CI runs Linux, macOS, and
Windows; `scripts/status-watcher.js` wires `binding.js`, `turns.js`, `herdr.js`,
and `doctor.js`, one decision each. Fixture rules are in
[CONTRIBUTING.md](CONTRIBUTING.md), releases in [CHANGELOG.md](CHANGELOG.md), and
scope in [SECURITY.md](SECURITY.md).

## Trust

A shell entrypoint and one Node watcher, both here. No binary, installer, npm
package, or release asset; no global `PATH` wrapper; no network calls or
telemetry; no prompt content sent to Herdr.

## License

MIT. Started from
[TheMetalStorm/herdr-freebuff-plugin](https://github.com/TheMetalStorm/herdr-freebuff-plugin)
with the watcher and chat binding from
[1024ch/herdr-freebuff-plugin](https://github.com/1024ch/herdr-freebuff-plugin);
see [CREDITS.md](CREDITS.md) and [LICENSE](LICENSE).
