# Security

## Reporting a vulnerability

Please report security issues privately through GitHub's security advisory
feature for this repository. Do not open a public issue containing tokens,
credentials, real chat logs, prompts, or personal data.

Include the affected version or commit, the Herdr and Freebuff versions, and a
minimal reproduction with synthetic data.

## Scope

This project supports Linux, macOS, and Windows. The validated target is Herdr
0.9.5 with Freebuff 0.2.36; other Freebuff 0.2.x releases are best-effort. The plugin must never
replace the Freebuff launcher, install a global PATH wrapper, or send prompt
content in a Herdr notification.

## Data handling

Fixtures and tests must be synthetic. Do not commit real Freebuff chat
directories, transcripts, local usernames, absolute home paths, API keys, or
other personal data.
