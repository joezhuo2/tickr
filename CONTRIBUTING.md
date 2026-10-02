# Contributing

Bug reports and pull requests are welcome.

## Reporting a bug

Open an issue with the bug report template. Include your tickr version (shown
in the tray menu, on the "Check for updates" or "Up to date" item), your OS
and version, and
`tickr.log`:

- Windows: `%LOCALAPPDATA%\dev.tickr.desktop\logs\tickr.log`
- macOS: `~/Library/Logs/dev.tickr.desktop/tickr.log`

## Pull requests

See [Build](README.md#build) for the setup. Before opening a PR, run the same
checks CI runs:

```bash
npm run check
npm test
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo test
```

Keep changes small and focused, and add an entry under `[Unreleased]` in
`CHANGELOG.md` for anything a user would notice.

tickr aims to stay light: one process and a few MB when the window is
unloaded. Avoid new dependencies or background work unless they pull their
weight.
