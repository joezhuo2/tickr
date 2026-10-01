# Changelog

All notable changes to tickr are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-10-01

### Added

- Analyst consensus and 12-month price target from Yahoo Finance. The left
  panel shows the rating, average target and upside under the company name.
  Click it, or the new Analysts tab, for the low/average/high target range
  against the current price and the buy/hold/sell counts. Results are cached
  for 12 hours. Symbols without coverage (ETFs, indices, crypto) show nothing.

## [0.1.1] - 2026-10-01

### Added

- Log file in the app log dir (`%LOCALAPPDATA%\dev.tickr.desktop\logs\tickr.log`
  on Windows). It rotates at 1 MB and keeps two old files. Panics are logged
  before the app exits. Attach it to bug reports.
- If the global hotkey is taken by another app at startup, the window footer
  shows the error and the tray tooltip shows a ⚠ line until a working hotkey
  is set.
- If turning "Launch at login" on or off fails, the error is logged and the
  tray tooltip shows a ⚠ line.
- The Windows uninstaller also removes tickr's Task Manager startup entry. If
  you check "Delete the application data", it also removes settings and the
  logo cache.
- README section listing where settings, cache and logs are stored.

### Changed

- "Launch at login" is now off by default. The first launch no longer
  enables it on its own. If you already had it on, it stays on.
- The bundle identifier is now `dev.tickr.desktop` (was `dev.tickr.app`,
  which conflicts with the macOS `.app` extension). Settings and the logo
  cache don't move. The old `%LOCALAPPDATA%\dev.tickr.app` folder (WebView
  data) is no longer used and can be deleted.

## [0.1.0] - 2026-09-30

First release.

- Tray icon with the company logo and an up/down/closed badge. Hovering
  shows the price, the day's change and the pre-market or after-hours move.
- Right-click menu for every on/off setting: extended hours, change as % or
  $, always on top, unload window when minimized, start hidden, launch at
  login.
- Global hotkey (default `Ctrl+Alt+K`) that opens or minimizes the chart
  window. You can change it from the window footer.
- Chart window with symbol search, ranges from 1D to Max, line and candle
  modes, and a crosshair for OHLC and volume.
- Unload on minimize: the web view is destroyed and the app drops to about
  7 MB. It reopens already painted with the last chart and quote.
- Quotes from Yahoo Finance, refreshed every 15 s during market hours, every
  60 s pre/post-market, and every 15 min when the market is closed.

[0.2.0]: https://github.com/joezhuo2/tickr/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/joezhuo2/tickr/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/joezhuo2/tickr/releases/tag/v0.1.0
