# herdr-freebuff

[![CI](https://github.com/jond34/herdr-freebuff/actions/workflows/ci.yml/badge.svg)](https://github.com/jond34/herdr-freebuff/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/jond34/herdr-freebuff)](https://github.com/jond34/herdr-freebuff/releases)
[![License: MIT](https://img.shields.io/github/license/jond34/herdr-freebuff)](LICENSE)

Run [Freebuff](https://freebuff.com) in a [Herdr](https://herdr.dev) plugin
pane and let Herdr see it: live `idle` / `working` / `blocked` state in the
sidebar, native notifications, `herdr agent wait`, and a `resume-last` pane that
continues the previous conversation.

## Screenshots

| Started by hand in a pane | Opened by the plugin | Pane beside it closed |
|---|---|---|
| ![Freebuff running in a plain Herdr pane, agents list empty](docs/screenshots/01-plain-pane-no-agent.png) | ![Freebuff in a plugin pane beside a shell, listed under agents](docs/screenshots/02-plugin-pane-registered.png) | ![Freebuff alone in a tab, still listed under agents](docs/screenshots/03-extra-pane-closed.png) |
| Herdr reads the foreground command as `freebuff`, has no built-in kind by that name, and lists nothing. | The plugin reports the pane over the socket API, so the sidebar lists it and carries its state. | Closing the pane beside it leaves the `freebuff` entry in place; only the Freebuff pane itself owns that entry. |

## Install

```sh
herdr plugin install jond34/herdr-freebuff
```

That tracks `main`. To pin the current release instead:

```sh
herdr plugin install jond34/herdr-freebuff --ref v0.1.4
```

A pinned install stays on its ref; a default install picks up new commits on
`main` when you run `herdr plugin update`. There is no setup step, PATH change,
or launcher replacement.

Bind `prefix+f` in `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+f"
type = "plugin_action"
command = "freebuff.integration.new-task"
description = "Freebuff: new task"
```

Run `herdr server reload-config`, then restart the Herdr client (detach with
`prefix+q` and run `herdr` again) so it picks up the new keymap, and press
`prefix+f`. Herdr keybindings can only invoke plugin actions, so the plugin
ships a `new-task` action that opens the pane. To skip the key, open it from
the CLI:

```sh
herdr plugin pane open --plugin freebuff.integration --entrypoint task
```

The pane opens in the directory of the pane you invoke it from, so Freebuff
starts in that project. Pass `--cwd <dir>` to the CLI form to start somewhere
else.

If `prefix+f` does nothing at all, check that the prefix itself reaches Herdr:
press `prefix+?`. Editors and terminals that bind `ctrl+b` (VS Code toggles its
sidebar with it) swallow the prefix before Herdr sees it. Accept a second,
unclaimed prefix and keep both:

```toml
[keys]
prefix = ["ctrl+b", "ctrl+space"]

[[keys.command]]
key = "prefix+f"
type = "plugin_action"
command = "freebuff.integration.new-task"
description = "Freebuff: new task"
```

The `[keys]` table has to come before any `[[keys.command]]` entry.

### Requirements

| Requirement | Notes |
|---|---|
| Herdr 0.9.5 | the `herdr` TUI only, not `herdr-app`/`herdr-core`; validated only on 0.9.5, and `min_herdr_version` refuses anything older. The app's agent list holds only programs that emit [OSC 7501](https://herdr.dev/core), which Freebuff does not |
| Freebuff 0.2.36 | validated; other 0.2.x releases are best-effort |
| Linux or WSL2 | Herdr and Freebuff must run in the same distro |
| Node.js 22+ | runs the background watcher |

## What works

| Surface | Behavior |
|---|---|
| State | `idle`, `working`, and `blocked` reported per pane, derived from Freebuff's own chat checkpoint and log rather than screen scraping |
| Notifications | Herdr's native agent notifications; the plugin adds no second notification path |
| `herdr agent wait` | waits on the reported state like any other agent |
| Session | reports the chat ID, chat path, and a resume command; Herdr 0.9.5 stores that command but reopens a restored plugin pane from its entrypoint, so the pane starts a new chat and `resume-last` is how you continue the previous one |
| `doctor` | pane action that prints the watcher, launcher, and child PIDs, the bound chat, and the resume argv |
| `register-pane` | pane action that lists a pane you started yourself as a Freebuff agent (see [Panes you start yourself](#panes-you-start-yourself)) |
| Panes | `task` and `resume-last` entrypoints, plus the `new-task` action behind `prefix+f` (see [Install](#install)) |

Each pane binds its own Freebuff chat by process tree, so two panes in the same
project stay independent.

Tested in the suite: state transitions, two-pane isolation, the resume
arguments, and `doctor`. Walked by hand on Herdr 0.9.5: restarting the server
reopens the plugin pane by re-running its entrypoint, so the pane starts a new
chat even though the reported resume command is stored, and even with
`[session] resume_agents_on_restore = true`. Continuing a conversation therefore
means the `resume-last` pane. Notifications are Herdr's own response to a
reported state, not a second path this plugin adds.

## Panes you start yourself

Herdr knows about a Freebuff pane because something reports it. The plugin's
watcher does that for panes it opened. A `freebuff` you type into a plain pane
reports nothing, so Herdr lists it as `unknown` and the sidebar stays empty.

Register that pane once Freebuff is running in it, and it appears as an agent:

```sh
herdr pane report-agent w1:p2 --source freebuff --agent freebuff --state unknown
```

Inside Herdr, the `Freebuff: register this pane` action does the same for the
focused pane. It registers the pane with state `unknown` and claims nothing
else: nothing watches that session, so its entry does not follow
`working` / `blocked` and stays until the pane closes. Starting Freebuff as a
plugin pane gets you the live state instead.

Two details matter. Register while Freebuff is in the foreground: Herdr drops a
self-reported agent from a pane that has returned to its shell. And every report
must carry a `--seq` greater than the one Herdr last accepted for that source;
the script handles this with a microsecond timestamp, so do not hand-write a
smaller number.

### Why this is manual

Herdr identifies an agent from the pane's foreground command text, then looks
that name up in a closed list of built-in agent kinds (`Agent` in
`src/detect/mod.rs`). Detection manifests carry state rules for a kind in that
list, and a local override under `~/.config/herdr/agent-detection/` can only
shadow a kind that already exists. Freebuff is not one of them, so on Herdr
0.9.5 there is nothing a manifest, an override, or this plugin can add that
makes Herdr recognise `freebuff` on its own.

What would change that, in order of value:

1. **Herdr adds Freebuff as a built-in agent kind** — an enum variant plus a
   bundled manifest. The manifest needs either screen rules (fragile, and it
   duplicates what this plugin already knows from Freebuff's own logs) or a
   detection-only entry that recognises the pane without claiming a state.
2. **Freebuff reports its own lifecycle** — hooks that send idle / working /
   blocked and the chat ID to Herdr's socket, the way OpenCode, Kimi, and Droid
   integrations do. That gives real state, not scraped state, and needs both
   Freebuff and Herdr to ship a side of it.

Until one of those lands, the honest maximum is what this section describes: a
pane Herdr lists, with state left `unknown`.

## Limits

This is a **self-reported agent**, not a built-in Herdr agent kind. Herdr 0.9.5
gives self-reported agents a smaller command surface than built-in kinds:

| Command | Freebuff support | Workaround |
|---|---|---|
| `herdr agent prompt` | Unavailable | Type into the Freebuff pane directly |
| `herdr agent send-keys` | Unavailable | Send keys to the pane directly |
| `herdr agent start --kind` | Unavailable | Use the `task` or `resume-last` pane |
| `herdr agent explain` | Unavailable | Use the `doctor` action for process and chat evidence |

`herdr pane send-text` can write into the pane, but it lacks the native
foreground-agent guard and is not equivalent to `agent prompt`; this plugin
does not wrap it, seed a detection override, or use a fake agent label.

The rest of the surface above does work: state reporting, notifications,
`herdr agent wait`, the reported resume command, and `doctor`. Native parity needs a Herdr
change; see [herdrdev/herdr discussion #4832](https://github.com/herdrdev/herdr/discussions/4832).

## Trust

The plugin is a shell entrypoint plus one Node watcher, both in this repository:

- No binary, installer, npm package, or release asset.
- No global `PATH` wrapper and no modification of `~/.local/bin/freebuff`.
- No network calls, telemetry, or hosted service. It reads Freebuff's local
  chat directory and reports to Herdr over the existing Herdr socket.
- No prompt or message content is sent to Herdr; the only blocked-state message
  is generic.

## Troubleshooting

`doctor` runs inside Herdr against the focused pane. From a shell, pass a
launcher PID and optional chat ID to inspect an unresolved pane:

```sh
sh scripts/doctor.sh [launcher-pid] [chat-id]
```

It reports the watcher, launcher, and descendant PIDs, the bound chat directory,
and the resume argv. It matches watchers by pane ID and inherited
`HERDR_SOCKET_PATH`, so two Herdr sessions that both use `w1:p2` do not collide;
when identity cannot choose a candidate it reports the ambiguity instead of
guessing.

If a pane is not bound to a chat, confirm that Freebuff is actually running in
that pane and that the chat directory exists under
`~/.config/manicode/projects/<project>/chats/`. `resume-named` refuses to start
when the named chat is missing rather than silently opening a different one.

## Development

Link the working tree instead of installing:

```sh
herdr plugin link /path/to/herdr-freebuff
herdr plugin list
herdr plugin action list --plugin freebuff.integration
```

The tests drive `launch.sh` with a fake launcher/child process tree and a
JSON-recording Herdr stub, so they exercise the real PID attribution path
without a Herdr install:

```sh
sh tests/run.sh
node --check scripts/status-watcher.js
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the fixture and data rules, and
[CHANGELOG.md](CHANGELOG.md) for release history.

## Lineage

This project began from
[TheMetalStorm/herdr-freebuff-plugin](https://github.com/TheMetalStorm/herdr-freebuff-plugin).
It is a standalone repository, not a GitHub fork, because the Herdr marketplace
excludes forks; the original commits and attribution are preserved.

The original plugin supplied the architecture, pane launch, and screen-marker
ideas. [1024ch/herdr-freebuff-plugin](https://github.com/1024ch/herdr-freebuff-plugin)
supplied the Node watcher, PID-bound chat attribution, incremental log tail, and
checkpoint arbitration. Both are MIT licensed; see [CREDITS.md](CREDITS.md) and
[LICENSE](LICENSE).

## License

MIT. See [LICENSE](LICENSE).
