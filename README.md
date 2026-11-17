# herdr-freebuff

[![CI](https://github.com/jond34/herdr-freebuff/actions/workflows/ci.yml/badge.svg)](https://github.com/jond34/herdr-freebuff/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/jond34/herdr-freebuff)](https://github.com/jond34/herdr-freebuff/releases)
[![License: MIT](https://img.shields.io/github/license/jond34/herdr-freebuff)](LICENSE)

Run [Freebuff](https://freebuff.com) in a [Herdr](https://herdr.dev) plugin
pane and let Herdr see it: live `idle` / `working` / `blocked` state in the
sidebar, native notifications, `herdr agent wait`, and conversation restore
after a Herdr restart.

## Install

```sh
herdr plugin install jond34/herdr-freebuff
```

That tracks `main`. To pin the reviewed release instead:

```sh
herdr plugin install jond34/herdr-freebuff --ref v0.1.0
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

### Requirements

| Requirement | Notes |
|---|---|
| Herdr 0.9.5+ | validated on 0.9.5; 0.9.2–0.9.4 is untested |
| Freebuff 0.2.36 | validated; other 0.2.x releases are best-effort |
| Linux or WSL2 | Herdr and Freebuff must run in the same distro |
| Node.js 22+ | runs the background watcher |

## What works

| Surface | Behavior |
|---|---|
| State | `idle`, `working`, and `blocked` reported per pane, derived from Freebuff's own chat checkpoint and log rather than screen scraping |
| Notifications | Herdr's native agent notifications; the plugin adds no second notification path |
| `herdr agent wait` | waits on the reported state like any other agent |
| Session restore | reports chat ID, chat path, and a resume argv, so a restarted pane reopens the same conversation |
| `doctor` | pane action that prints the watcher, launcher, and child PIDs, the bound chat, and the resume argv |
| Panes | `task` and `resume-last` entrypoints, plus the `new-task` action behind `prefix+f` (see [Install](#install)) |

Each pane binds its own Freebuff chat by process tree, so two panes in the same
project stay independent.

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
`herdr agent wait`, session restore, and `doctor`. Native parity needs a Herdr
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
