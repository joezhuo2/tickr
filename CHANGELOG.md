# Changelog

All notable changes to tickr are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.5.2] - 2026-10-02

### Fixed

- The v0.5.1 Windows release job failed with "other side closed" while
  uploading `latest.json`, so the draft release had the Windows installer but
  no Windows entry in `latest.json`, and Windows copies could not auto-update.
  The release workflow now retries failed uploads (`retryAttempts: 2`).

## [0.5.1] - 2026-10-02

v0.5.0 was never published: both release builds failed at the updater signing
step. v0.5.1 ships the same features, and auto-update works from v0.5.1
onward.

### Fixed

- Release builds failed with "Missing comment in secret key" because the
  `TAURI_SIGNING_PRIVATE_KEY` repository secret was not set. The release
  workflow now checks the secret before building and stops with a clear error
  if it is missing or is not the contents of the key file.

## [0.5.0] - 2026-10-02

### Added

- Auto-update. tickr checks GitHub for a new release 30 seconds after launch
  and every 12 hours, and says so in the tray tooltip. The tray menu item
  changes to "Install vX.Y.Z and restart"; nothing installs until you pick
  it. Updates are verified against a signing key built into the app. Turn
  background checks off with "Check for updates automatically" in the tray
  menu. Updating works from v0.5.0 onward; older versions need one manual
  install.

### Changed

- "Check for updates" now checks in place instead of opening the Releases
  page, and shows "Up to date" or the new version.
- macOS builds are ad-hoc signed. They are still not notarized, but Gatekeeper
  now reports an unidentified developer instead of calling the app damaged.
- The README and release notes explain how to get past SmartScreen and
  Gatekeeper on first launch, including the macOS 15 "Open Anyway" step.

## [0.4.2] - 2026-10-02

### Fixed

- The tray badge test checked pixel positions that only hold for the 32 px
  Windows icon, so it failed on macOS, where the icon is 36 px. It now scales
  its probe points to the icon size. The app itself is unchanged; this release
  exists because the v0.4.1 CI run failed.

## [0.4.1] - 2026-10-02

### Added

- "Check for updates" in the tray menu shows the installed version and opens
  the latest GitHub release. There is no auto-update.
- GitHub Actions: CI runs svelte-check, the frontend tests, clippy and the Rust
  tests on Windows and macOS for every push and pull request; pushing a `v*`
  tag builds the Windows installer and a universal macOS `.dmg` into a draft
  release.
- Installer and bundle metadata: publisher, copyright, category (Finance) and
  descriptions, shown in the installer, Add/Remove Programs and the macOS
  About box.
- `CONTRIBUTING.md` and issue templates.

### Changed

- Logos are fetched from Elbstream's logo API (`api.elbstream.com`), which
  replaced Parqet's. The window footer links to Elbstream, as its free tier
  requires. Cached logos are kept.

## [0.4.0] - 2026-10-02

### Changed

- Watchlist cards are sorted from biggest gain to biggest loss, and show the
  price and percent move on one line (`$333.02 | +1.10%`). During pre-market
  and after hours the card shows that session's price and move. Dragging to
  reorder is gone, since the order now follows the market.
- The default hotkey on macOS is `⌘⇧K` (`Super+Shift+K`), and the hotkey
  field shows macOS shortcuts with ⌘ ⌥ ⌃ ⇧ symbols. Windows keeps
  `Ctrl+Alt+K`. Saved hotkeys are not changed.
- Windows installer: per-user install mode, English only with no language
  picker, and the tickr icon on the installer and uninstaller.

### Added

- macOS: the price and change show next to the menu bar icon, with a "Show
  price in menu bar" toggle in the tray menu.
- macOS: `LSUIElement` in `Info.plist`, so no Dock icon appears at launch.

### Fixed

- macOS: the window flashed white in dark mode before the page painted,
  because dark mode was only detected on Windows.
- macOS: the menu bar icon was upscaled from 32 px and looked blurry on
  Retina displays. It is now drawn at 36 px.
- macOS: the hotkey minimized the window into a Dock tickr does not have.
  It now hides the window, or unloads it when "Unload window when minimized"
  is on.

## [0.3.0] - 2026-10-01

### Added

- Watchlist. Star a stock with the button next to its ticker, then open the
  Watchlist from the button in the bottom bar: a scrollable grid of cards
  (three across, four rows visible) with price and daily change, refreshed
  every minute. Click a card to chart it; drag cards to reorder. The list and
  its order are saved in settings.

### Fixed

- Launch at login turned itself off after installing a new version over an
  old one, because the old uninstaller deletes the Run registry entry. The
  choice is now saved in settings and tickr restores the entry at startup
  (unless it was disabled in Task Manager). If you upgraded from 0.2.1 or
  earlier, turn launch at login on once more.

## [0.2.1] - 2026-10-01

### Changed

- The analyst summary in the left panel now sits below the price, daily
  change and market state, and takes two lines: the rating, average target
  and upside, then the analyst count and low–high target range. The range
  and count no longer need a hover.

### Fixed

- The upside after the price target was cut off (shown as `+12.3` without the
  `%`) when the rating, target and upside did not fit on one line.

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

[0.5.2]: https://github.com/joezhuo2/tickr/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/joezhuo2/tickr/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/joezhuo2/tickr/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/joezhuo2/tickr/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/joezhuo2/tickr/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/joezhuo2/tickr/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/joezhuo2/tickr/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/joezhuo2/tickr/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/joezhuo2/tickr/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/joezhuo2/tickr/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/joezhuo2/tickr/releases/tag/v0.1.0
