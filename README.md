# tickr

A small stock watcher for the Windows tray. The tray icon shows the company's
logo with an up/down badge. Hover over it for the current price, the day's
change and the pre-market or after-hours move. A global hotkey opens a window
with a chart and the analyst consensus.

Built with Tauri 2 (Rust) and Svelte 5.

> Data comes from Yahoo Finance's public chart, search and quoteSummary
> endpoints, and logos come from Parqet's logo CDN. Neither is an official API; both can change or
> rate-limit without notice. Quotes may be delayed. Not investment advice.

## Using it

- **Tray icon:** hover for the quote. Left-click opens the window. Right-click
  holds every on/off setting: show pre-market/after-hours, show change as % or
  $, always on top, unload window when minimized, start hidden, and launch at
  login. Launch at login is off until you turn it on. If something needs
  attention (the hotkey is taken, or launch at login could not be changed),
  the tooltip ends with a ⚠ line.
- **Global hotkey** (default `Ctrl+Alt+K`): opens the window, or minimizes it
  if it's focused. To change it, click the hotkey field at the bottom of the
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
- **Unload when minimized** (on by default): minimizing destroys the web view,
  so the app drops to one process using about 7 MB. The hotkey reopens it
  already painted, with the last chart and quote, then refreshes in the
  background. Skeletons show while data loads.

Windows may hide new tray icons in the overflow menu (^). Drag it onto the
taskbar to keep it visible.

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
npx tauri build            # installer (NSIS on Windows)
```

`npm run icon` regenerates the app icons from `scripts/make-icon.mjs`.

## Tests

```bash
cd src-tauri && cargo test # quote and analyst parsing, sessions, tray tooltip, icon compositing, settings
cd src-tauri && cargo test -- --ignored live   # analyst fetch against Yahoo (network)
npm test                   # formatters, hotkey recording
npm run check              # svelte-check
```

## Layout

```
src-tauri/src/
  quote.rs      Yahoo chart/search: fetch, parse, market session, extended-hours price
  analyst.rs    Yahoo quoteSummary: cookie/crumb session, consensus and price targets, 12 h cache
  poller.rs     background refresh: 15 s during market hours, 60 s pre/post, 15 min when closed
  tray.rs       tooltip text and the right-click menu
  trayicon.rs   32x32 icon: logo in a rounded square plus a direction badge
  logo.rs       logo fetch with a disk cache
  window.rs     create, reveal after first paint, unload on minimize, geometry
  hotkey.rs     global shortcut register/swap with rollback
  commands.rs   window commands and the injected first-frame payload
  settings.rs   JSON settings in the OS config dir
src-tauri/windows/hooks.nsh   NSIS uninstall hook: autostart entry and app data
ui/src/         App, Left (ticker and details), Chart (canvas), Analysts, Search, HotkeyBar
```

## Memory (Windows 11, release build)

| State | Processes | Private |
| --- | --- | --- |
| Window open | 7 | 132 MB |
| Window unloaded (tray only) | 1 | 7 MB |

## License

MIT
