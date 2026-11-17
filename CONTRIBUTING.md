# Contributing

Issues and pull requests are welcome. There is no CLA, and support is
best-effort.

## Before opening a pull request

- Keep the change focused and explain the Freebuff/Herdr behavior it fixes.
- Run the checks from the README:
  ```bash
  sh tests/run.sh
  node --check scripts/status-watcher.js
  ```
- Add or update a synthetic test when you change watcher behavior.
- Do not include real Freebuff chat logs, prompts, local usernames, absolute
  home paths, tokens, or other personal data.
- Keep the plugin working on Linux, macOS, and Windows. What a host cannot do
  belongs behind `scripts/platform/`, and callers branch on what the seam can
  see (`seesOpenFiles`, `seesProcessTable`), never on a platform name. A new
  platform needs a seam implementation and a manifest entry per entrypoint.

## Scope

The plugin reports lifecycle state, launches Freebuff panes, and restores
sessions. It does not patch Freebuff, replace the Freebuff launcher, or install
a global PATH wrapper.

## Security

Do not report vulnerabilities in a public issue. Follow
[SECURITY.md](SECURITY.md).
