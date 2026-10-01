# tickr

A small stock watcher for the Windows tray. The tray icon shows the company's
logo with an up/down badge. Hover over it for the current price, the day's
change and the pre-market or after-hours move. A global hotkey opens a window
with a chart.

Built with Tauri 2 (Rust) and Svelte 5.

> Data comes from Yahoo Finance's public chart and search endpoints, and logos
> come from Parqet's logo CDN. Neither is an official API; both can change or
> rate-limit without notice. Quotes may be delayed. Not investment advice.

## Using it

- **Tray icon:** hover for the quote. Left-click opens the window. Right-click
  holds every on/off setting: show pre-market/after-hours, show change as % or
  $, always on top, unload window when minimized, start hidden, and launch at
  login.
- **Global hotkey** (default `Ctrl+Alt+K`): opens the window, or minimizes it
  if it's focused. To change it, click the hotkey field at the bottom of the
  window and press the new combination.
- **Window:** search to change the symbol (you can only change it here).
  Pick a range from 1D to Max and switch between line and candles. Hover the
  chart, or use ← and →, to see time, open, high, low, close and volume.
- **Unload when minimized** (on by default): minimizing destroys the web view,
  so the app drops to one process using about 7 MB. The hotkey reopens it
  already painted, with the last chart and quote, then refreshes in the
  background. Skeletons show while data loads.

Windows may hide new tray icons in the overflow menu (^). Drag it onto the
taskbar to keep it visible.

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
cd src-tauri && cargo test # quote parsing, sessions, tray tooltip, icon compositing, settings
npm test                   # formatters, hotkey recording
npm run check              # svelte-check
```

## Layout

```
src-tauri/src/
  quote.rs      Yahoo chart/search: fetch, parse, market session, extended-hours price
  poller.rs     background refresh: 15 s during market hours, 60 s pre/post, 15 min when closed
  tray.rs       tooltip text and the right-click menu
  trayicon.rs   32x32 icon: logo in a rounded square plus a direction badge
  logo.rs       logo fetch with a disk cache
  window.rs     create, reveal after first paint, unload on minimize, geometry
  hotkey.rs     global shortcut register/swap with rollback
  commands.rs   window commands and the injected first-frame payload
  settings.rs   JSON settings in the OS config dir
ui/src/         App, Left (ticker and details), Chart (canvas), Search, HotkeyBar
```

## Memory (Windows 11, release build)

| State | Processes | Private |
| --- | --- | --- |
| Window open | 7 | 132 MB |
| Window unloaded (tray only) | 1 | 7 MB |

## License

MIT
