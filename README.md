# tickr

A small stock watcher for the Windows tray and the macOS menu bar. The tray
icon shows the company's logo with an up/down badge. Hover over it for the
current price, the day's change and the pre-market or after-hours move. On
macOS the price and change also sit next to the icon. A global hotkey opens a window
with a chart and the analyst consensus.

Built with Tauri 2 (Rust) and Svelte 5.

> Data comes from Yahoo Finance's public chart, search and quoteSummary
> endpoints, and logos come from [Elbstream](https://elbstream.com/logos)'s
> logo API (formerly Parqet). Yahoo's endpoints are not an official API and can
> change or rate-limit without notice. Quotes may be delayed. Not investment
> advice.

## Download

Get the latest installer from
[Releases](https://github.com/joezhuo2/tickr/releases/latest):

- **Windows:** `tickr_x.y.z_x64-setup.exe`. Installs per user, no admin
  prompt.
- **macOS:** `tickr_x.y.z_universal.dmg` (Apple silicon and Intel), macOS 10.15
  or later. Drag tickr into Applications.

Builds are not code-signed yet. On Windows, SmartScreen may say "Windows
protected your PC": click **More info**, then **Run anyway**. On macOS,
Gatekeeper blocks the first launch: right-click tickr in Applications and
choose **Open**, or run `xattr -dr com.apple.quarantine /Applications/tickr.app`.

There is no auto-update. **Check for updates** in the tray menu shows your
version and opens the latest release.

## Using it

- **Tray icon:** hover for the quote. Left-click opens the window. Right-click
  holds every on/off setting: show pre-market/after-hours, show change as % or
  $, always on top, unload window when minimized, start hidden, launch at
  login and, on macOS, show price in menu bar. **Check for updates** shows the
  installed version and opens the latest GitHub release. Launch at login is off until you turn it on; once on, it stays on
  across upgrades (tickr re-registers itself if an installer removed the
  entry, unless you turned it off in Task Manager). If something needs
  attention (the hotkey is taken, or launch at login could not be changed),
  the tooltip ends with a ⚠ line.
- **Global hotkey** (default `Ctrl+Alt+K` on Windows, `⌘⇧K` on macOS): opens
  the window, or minimizes it if it's focused. On macOS, where tickr has no
  Dock icon, the hotkey hides the window instead of minimizing it (or unloads
  it, when unload is on). Settings saved by an older version keep their
  hotkey; **Reset** switches to the new default. To change it, click the hotkey field at the bottom of the
  window and press the new combination. If another app already owns the
  hotkey at startup, the window footer shows the error until you pick one
  that works.
- **Window:** search to change the symbol (you can only change it here).
  Pick a range from 1D to Max and switch between line and candles. Hover the
  chart, or use ← and →, to see time, open, high, low, close and volume.
- **Analyst consensus:** below the price, the left panel shows the rating
  (Strong buy to Sell), the average 12-month price target with its upside,
  and the analyst count and low–high target range. Click it, or the
  **Analysts** tab next to the ranges, for the target range plotted against
  the current price and the count of each rating. Results are cached for 12
  hours. ETFs, indices and crypto have no coverage, so nothing is shown.
- **Watchlist:** click the star next to the ticker to add or remove it.
  The **Watchlist** button at the bottom of the window shows your starred
  stocks as cards (three across, four rows visible, scroll for more),
  refreshed every minute while open. Each card shows the price and the
  percent move on one line, like `$333.02 | +1.10%`, for the session now
  trading: the pre-market or after-hours price and move when there is one,
  otherwise the regular day. Cards are sorted from biggest gain to biggest
  loss; stocks without a quote go last. Click a card to chart it.
- **Unload when minimized** (on by default): minimizing destroys the web view,
  so the app drops to one process using about 7 MB. The hotkey reopens it
  already painted, with the last chart and quote, then refreshes in the
  background. Skeletons show while data loads.

The **Logos by Elbstream** link in the window footer is the attribution
Elbstream's free logo tier requires.

Windows may hide new tray icons in the overflow menu (^). Drag it onto the
taskbar to keep it visible.

The window opens with a dark or light background to match the OS theme, so it
never flashes white before the page paints.

## Files

| What | Windows | macOS |
| --- | --- | --- |
| Settings | `%APPDATA%\tickr\settings.json` | `~/Library/Application Support/tickr/` |
| Logo cache | `%LOCALAPPDATA%\tickr\` | `~/Library/Caches/tickr/` |
| Logs | `%LOCALAPPDATA%\dev.tickr.desktop\logs\tickr.log` | `~/Library/Logs/dev.tickr.desktop/` |

Logs rotate at 1 MB and keep two old files. Attach `tickr.log` to bug reports.

Uninstalling on Windows removes the launch-at-login entry. Check "Delete the
application data" in the uninstaller to also remove settings, the logo cache,
logs and WebView data.

## Build

Requirements: Rust 1.85+, Node 20+, and the
[Tauri 2 prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev          # dev build with hot reload
npx tauri build            # installer (NSIS on Windows, .app and .dmg on macOS)
```

The Windows installer installs per user (no UAC prompt), in English. On
macOS, `src-tauri/Info.plist` sets `LSUIElement` so tickr never shows a Dock
icon; the minimum version is macOS 10.15.

## Releasing

Releases are built by GitHub Actions. Bump the version in `package.json`,
`src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, add a `CHANGELOG.md`
entry, then push a tag:

```bash
git tag v0.4.2
git push origin v0.4.2
```

`.github/workflows/release.yml` builds the Windows NSIS installer and a
universal macOS `.app`/`.dmg` with `tauri-apps/tauri-action`, and attaches them
to a **draft** release for that tag. Review the notes and publish it from the
Releases page.

`.github/workflows/ci.yml` runs `npm run check`, `npm test`,
`cargo clippy -- -D warnings` and `cargo test` (Windows and macOS) on every
push to `main` and every pull request.

Unsigned builds work, but Windows SmartScreen warns about the installer and
macOS Gatekeeper blocks the app. Signing needs certificates, so it is set up
through environment variables at build time rather than in the repo.

**macOS** needs a Developer ID Application certificate in the keychain and an
Apple ID app-specific password (or an App Store Connect API key) for
notarization. `tauri build` signs, notarizes and staples when these are set:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
npx tauri build --target universal-apple-darwin
```

**Windows** can use an Authenticode certificate (set
`bundle.windows.certificateThumbprint`, `digestAlgorithm: "sha256"` and a
`timestampUrl` in `tauri.conf.json`) or Azure Trusted Signing (set
`bundle.windows.signCommand` to a `trusted-signing-cli` call). See
[Windows code signing](https://v2.tauri.app/distribute/sign/windows/) and
[macOS code signing](https://v2.tauri.app/distribute/sign/macos/). In CI, add
the Apple values as repository secrets (plus `APPLE_CERTIFICATE`, the base64
`.p12`, and `APPLE_CERTIFICATE_PASSWORD`) and uncomment them in
`release.yml`.

`npm run icon` regenerates the app icons from `scripts/make-icon.mjs`.

## Tests

```bash
cd src-tauri && cargo test # quote and analyst parsing, sessions, tray tooltip and title, icon compositing, settings, watchlist symbols
cd src-tauri && cargo test -- --ignored live   # analyst fetch against Yahoo (network)
npm test                   # formatters, watchlist sort, hotkey recording and display
npm run check              # svelte-check
```

## Layout

```
src-tauri/src/
  quote.rs      Yahoo chart/search: fetch, parse, market session, extended-hours price
  analyst.rs    Yahoo quoteSummary: cookie/crumb session, consensus and price targets, 12 h cache
  poller.rs     background refresh: 15 s during market hours, 60 s pre/post, 15 min when closed
  tray.rs       tooltip text, macOS menu bar title, and the right-click menu
  trayicon.rs   icon (32 px, 36 px on macOS): logo in a rounded square plus a direction badge
  logo.rs       Elbstream logo fetch with a disk cache
  window.rs     create, OS theme background, reveal after first paint, unload on minimize, geometry
  hotkey.rs     global shortcut register/swap with rollback
  commands.rs   window commands and the injected first-frame payload
  settings.rs   JSON settings in the OS config dir
  autostart.rs  launch at login: restores the Run entry after upgrades
src-tauri/windows/hooks.nsh   NSIS uninstall hook: autostart entry and app data
.github/workflows/  ci.yml (checks on push/PR), release.yml (installers on tag push)
ui/src/         App, Left (ticker and details), Chart (canvas), Analysts, Watchlist, Search, HotkeyBar
```

## Memory (Windows 11, release build)

| State | Processes | Private |
| --- | --- | --- |
| Window open | 7 | 132 MB |
| Window unloaded (tray only) | 1 | 7 MB |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports should include
`tickr.log`, your OS and the tickr version.

## License

MIT. Company logos are provided by [Elbstream](https://elbstream.com/logos).
