# Changelog

All notable changes to tickr are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.8.13] - 2026-10-30

### Added

- **Chart zoom and pan** ([#65](https://github.com/joezhuo2/tickr/issues/65)):
  scroll or pinch to zoom at the cursor, drag or scroll sideways to pan, and
  double-click or the reset button to see the whole range again. With the
  chart focused, + and - zoom and 0 resets. The price axis fits the visible
  bars.

## [0.8.12] - 2026-10-30

### Fixed

- **Overscroll** ([#66](https://github.com/joezhuo2/tickr/issues/66)):
  scrollable panels and the page no longer overscroll or chain scrolling.

## [0.8.11] - 2026-10-29

### Added

- **AI news analysis** ([#55](https://github.com/joezhuo2/tickr/issues/55)):
  optionally classify headline tone with any OpenAI-compatible endpoint,
  configured in Settings and stored in `.env.local`. The keyword tone stays as
  the fallback.

## [0.8.10] - 2026-10-29

### Added

- **News tone on chart dots** ([#56](https://github.com/joezhuo2/tickr/issues/56)):
  news dots show a green or red inner circle when that candle's headlines lean
  positive or negative.

## [0.8.9] - 2026-10-29

### Added

- **Options tab** ([#57](https://github.com/joezhuo2/tickr/issues/57)): view
  calls or puts for any expiry, with the current price as a divider and
  in-the-money rows marked.

## [0.8.8] - 2026-10-29

### Changed

- Refreshed every README screenshot to show the current interface, including
  chart export controls and the complete set of keyboard shortcuts.
- Added screenshots for price alerts, the watchlist, watchlist groups and
  group editing, with feature captions and a sample-data note.

## [0.8.7] - 2026-10-28

### Changed

- **Instant open** ([#52](https://github.com/joezhuo2/tickr/issues/52)): the
  window now opens immediately and shows skeleton loaders while stock data
  loads, instead of waiting for the first paint before appearing.

## [0.8.6] - 2026-10-28

### Added

- **Hotkeys** ([#51](https://github.com/joezhuo2/tickr/issues/51)): new
  rebindable in-window keys for Alerts (`P`), Market (`M`), News (`N`), and
  Analyze / re-analyze in Technicals (`Z`). Settings already had a key.

## [0.8.5] - 2026-10-26

### Added

- **Price alerts** ([#27](https://github.com/joezhuo2/tickr/issues/27)) in
  an Alerts tab to the left of Technicals. Add above/below levels for the
  selected symbol, pause, rearm or delete them. All armed symbols are checked
  in the background, including while the window is closed. A crossing sends
  a native desktop notification and marks the alert Triggered. Alerts persist
  across restarts; the first successful price after arming or restarting sets
  the crossing baseline. Extended-hours prices are used when available.

## [0.8.4] - 2026-10-26

### Added

- Configurable **Toggle Watchlist** shortcut, defaulting to `W`
  ([#46](https://github.com/joezhuo2/tickr/issues/46)). Press it again to
  return to the chart. `X` still cycles through watchlist stocks.

## [0.8.3] - 2026-10-24

### Added

- Configurable **Toggle Settings** shortcut, defaulting to `,`
  ([#47](https://github.com/joezhuo2/tickr/issues/47)). Press it again to
  close Settings; recording a binding takes priority over toggling.

### Changed

- README reorganized: badges, a one-line quick navigation bar, screenshots
  of every view, usage grouped into Features sections with a keybind table,
  and build and release docs under Development.

## [0.8.2] - 2026-10-24

### Added

- **Watchlist groups** ([#40](https://github.com/joezhuo2/tickr/issues/40)):
  tabs above the watchlist cards, with **All** first. **+** adds a group;
  **Edit** in a group tab picks its stocks from the starred ones and lets
  you rename or delete it. Groups are saved with the settings, and
  unstarring a stock drops it from every group.

## [0.8.1] - 2026-10-24

### Added

- Chart **exports** ([#42](https://github.com/joezhuo2/tickr/issues/42)): two
  icon buttons at the top left of the chart, shown while hovering it, copy
  the chart as a PNG image or its candles as CSV to the clipboard.

## [0.8.0] - 2026-10-23

### Added

- **Settings** overlay ([#19](https://github.com/joezhuo2/tickr/issues/19)),
  opened from a gear at the bottom left of the window. It holds the global
  hotkey and its Reset button, which moved out of the footer.
- Configurable in-window keybinds: `C` line/candles, `R` refresh, `V` cycle
  the date range, `T` Technicals, `A` Analysts, `E` Earnings, `X` next
  watchlist stock and `S` focus search. Rebinding a key already in use swaps
  the two; Backspace unbinds. Keys typed into a text field are ignored.
- Toggles for the earnings, news and analyst rating dots on the chart, each
  on by default.

## [0.7.19] - 2026-10-23

### Changed

- Stats now color signed values green or red
  ([#35](https://github.com/joezhuo2/tickr/issues/35)): 52-week change (and
  the S&P 500's), revenue and earnings growth, return on assets and equity,
  and fund returns (YTD, 3- and 5-year). Levels such as market cap, P/E or
  margins stay uncolored.

## [0.7.18] - 2026-10-23

### Changed

- **Market** moved out of the tab row (Technicals, Analysts, Earnings, Stats)
  into its own button in the toolbar, left of News
  ([#36](https://github.com/joezhuo2/tickr/issues/36)), since it is about
  the whole market rather than the current symbol. Line and Candles no longer
  show as selected while it is open.

## [0.7.17] - 2026-10-23

### Added

- **Bollinger bands and VWAP** in Technicals
  ([#25](https://github.com/joezhuo2/tickr/issues/25)). Bollinger bands (20
  bars, 2 standard deviations, population σ as on TradingView) draw as a
  shaded band with upper, middle and lower lines. VWAP uses the typical
  price weighted by volume: on intraday ranges (1D, 5D, 1M) it resets each
  trading day; on daily and longer ranges it is anchored to the first candle
  on the chart. Each has its own overlay checkbox, and the indicator list
  shows the latest upper band, lower band and VWAP. Symbols with no volume,
  such as indices, have no VWAP.

## [0.7.16] - 2026-10-23

### Changed

- The **Watchlist** button in the bottom bar is now just a star icon, styled
  like the Refresh button; it turns gold while the watchlist is open
  ([#26](https://github.com/joezhuo2/tickr/issues/26)). Hover it for the
  "Watchlist" label.

## [0.7.15] - 2026-10-23

### Added

- **Dividend and split markers** on the chart
  ([#24](https://github.com/joezhuo2/tickr/issues/24)). On 6M to Max, a green
  dot marks each ex-dividend date and a purple dot each stock split, stacked
  with the earnings, rating and news dots. Hovering the candle shows the
  dividend amount or split ratio. The chart request now asks Yahoo for
  dividend and split events; intraday ranges (1D, 5D, 1M) have none.

## [0.7.14] - 2026-10-23

### Fixed

- Window commands sent without waiting for an answer (saving the range and
  chart type, refresh, opening a headline or the logo credit) could fail
  with an unhandled promise rejection
  ([#23](https://github.com/joezhuo2/tickr/issues/23)). Failures are now
  logged to the console, and a failed refresh stops the spinning icon.

## [0.7.13] - 2026-10-23

### Fixed

- The newest candle on 5D and 1M charts never updated while the window was
  open; only 1D reloaded as new quotes arrived
  ([#22](https://github.com/joezhuo2/tickr/issues/22)). Every chart with
  intraday candles (1D, 5D, 1M) now reloads at most once a minute as quotes
  come in.

## [0.7.12] - 2026-10-23

### Added

- **Market** tab next to Stats ([#21](https://github.com/joezhuo2/tickr/issues/21)),
  an overview that does not depend on the current symbol: major indices with
  the VIX; the 10-year Treasury yield, crude oil, gold, the US dollar index
  and Bitcoin; the 11 S&P sector ETFs ranked by day change; and the day's top
  5 gainers and losers from Yahoo's screeners. Click any row to open it on the
  chart. It loads when the tab opens and when you press Refresh, with no
  background polling. Clicking the tab again returns to the chart.

## [0.7.11] - 2026-10-23

### Added

- **Stats** tab next to Earnings ([#20](https://github.com/joezhuo2/tickr/issues/20)).
  Key statistics in sections: Valuation (market cap, enterprise value, P/E,
  PEG, price/sales, price/book, EV/revenue, EV/EBITDA), Trading (beta, 52w
  change vs the S&P 500, 50- and 200-day averages, average volume, all-time
  high/low), Dividends & splits, Shares & short interest, Profitability and
  Financials. ETFs show a Fund section and crypto a Crypto section instead of
  the company ones. Values come pre-formatted from Yahoo's quoteSummary (same
  session as analyst targets); missing values are left out. Clicking the tab
  again returns to the chart.

## [0.7.10] - 2026-10-23

### Added

- **News dots** on the chart ([#17](https://github.com/joezhuo2/tickr/issues/17)).
  Each of the 20 latest headlines puts a yellow dot at the bottom of the chart
  on the candle it was published in, stacked with the blue earnings and orange
  rating change dots when they share a candle. Hovering the candle lists the
  headlines. Headlines now load whenever the symbol changes, not only when
  News is open.

## [0.7.9] - 2026-10-23

### Changed

- Clicking the **Earnings** tab while it is already open now closes it and
  returns to the chart, in the Line or Candles mode you were using
  ([#15](https://github.com/joezhuo2/tickr/issues/15)).

## [0.7.8] - 2026-10-23

### Changed

- Clicking the **Analysts** tab while it is already open now closes it and
  returns to the chart, in the Line or Candles mode you were using
  ([#9](https://github.com/joezhuo2/tickr/issues/9)).

## [0.7.7] - 2026-10-23

### Changed

- Clicking the **Technicals** tab while it is already open now closes it and
  returns to the chart, in the Line or Candles mode you were using
  ([#8](https://github.com/joezhuo2/tickr/issues/8)). The analysis is kept, so
  reopening Technicals shows it again until the symbol or range changes.

## [0.7.6] - 2026-10-23

### Added

- **Refresh** button ([#7](https://github.com/joezhuo2/tickr/issues/7)) in the
  bottom bar, left of the "Live" / "Updated x min ago" status. Clicking it
  fetches the quote right away instead of waiting for the next poll, and
  reloads the chart. The icon spins until the new quote arrives.

## [0.7.5] - 2026-10-23

### Added

- **Rating changes** on the chart ([#6](https://github.com/joezhuo2/tickr/issues/6)).
  Each time a firm starts coverage, upgrades or downgrades the symbol, an
  orange dot marks the candle at the bottom of the chart (stacked above the
  blue earnings dot when both fall on one candle). Hovering the candle lists
  each change: firm, old → new rating (or "initiates" for new coverage) and
  the new price target when given. Reiterated and maintained ratings are left
  out. Data comes from Yahoo's quoteSummary upgrade/downgrade history.

## [0.7.4] - 2026-10-23

### Added

- **Earnings** tab next to Analysts ([#5](https://github.com/joezhuo2/tickr/issues/5)).
  It shows the next report date (confirmed or estimated) with the EPS
  estimate, EPS range and revenue estimate, and the last four reported
  quarters with fiscal quarter, report date, EPS estimate, actual EPS, surprise
  % (green beat, red miss) and revenue. Each past report also shows as a blue
  dot at the bottom of the chart on the candle it was reported in; hovering
  that candle shows the quarter and EPS vs estimate. Data comes from Yahoo's
  quoteSummary (same session as analyst targets). Yahoo only returns the last
  four quarters, so older reports have no dot.

## [0.7.3] - 2026-10-21

### Added

- Headline sentiment. Each headline in News has a pill after how long ago it
  was published: **Positive** (green), **Negative** (red) or **Neutral**
  (gray) ([#3](https://github.com/joezhuo2/tickr/issues/3)). Yahoo gives no
  sentiment, so tickr guesses it locally from the words of the title, using a
  financial keyword list that handles negation ("don't expect a slowdown")
  and concessions ("rises although ..."). It reads headlines only, not the
  articles, so treat it as a hint.

## [0.7.2] - 2026-10-20

### Fixed

- The search dropdown no longer stays open after switching symbol. Typing a
  symbol and pressing Enter before the results arrived opened the new
  symbol's page, then the late results reopened the dropdown on top of it
  ([#1](https://github.com/joezhuo2/tickr/issues/1)).

## [0.7.1]

### Added

- Technicals view. A **Technicals** tab next to Analysts splits the window
  into the chart and an analysis panel. Nothing is computed until you click
  **Analyze**; the analysis runs locally and deterministically on the candles
  of the range on screen:
  - RSI 14 (Wilder), SMA 20/50/200, EMA 9/21 with golden/death and EMA
    crosses, ATR 14 and the volatility of returns.
  - 15 candlestick patterns (doji, hammer, inverted hammer, hanging man,
    shooting star, engulfing, harami, piercing line, dark cloud cover,
    morning/evening star, three white soldiers/black crows). A reversal only
    counts when the trend before it agrees.
  - Fibonacci retracements and extensions from the last major swing.
  - A score from −100 to +100 (trend 35%, momentum 25%, crosses 15%,
    patterns 25%), a bias from Strong bearish to Strong bullish, a confidence
    level, upside and downside targets over the next 10 bars (ATR × √10,
    snapped to a Fibonacci level within half an ATR) and an invalidation level.
  - Chart overlays, each with its own toggle: moving averages, Fibonacci
    levels, targets, pattern markers and an RSI pane.
  - Charts with fewer than 200 candles are still analyzed, with a "Limited
    data" warning, estimates marked * and lower confidence.
  - Changing the symbol or range clears the results. A chart refresh keeps
    them, labeled with the time of the last candle analyzed.

## [0.6.0] - 2026-10-02

### Added

- News view. A **News** button left of the Line/Candles toggle replaces the
  chart with the 20 latest headlines for the symbol, newest first, showing
  title, publisher, date and how long ago. Clicking a headline opens it in
  the default browser. Headlines are fetched when News opens and cached for
  the session, so reopening shows the last list at once while it refreshes.

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

[0.7.19]: https://github.com/joezhuo2/tickr/compare/v0.7.18...v0.7.19
[0.7.18]: https://github.com/joezhuo2/tickr/compare/v0.7.17...v0.7.18
[0.7.17]: https://github.com/joezhuo2/tickr/compare/v0.7.16...v0.7.17
[0.7.16]: https://github.com/joezhuo2/tickr/compare/v0.7.15...v0.7.16
[0.7.15]: https://github.com/joezhuo2/tickr/compare/v0.7.14...v0.7.15
[0.7.14]: https://github.com/joezhuo2/tickr/compare/v0.7.13...v0.7.14
[0.7.13]: https://github.com/joezhuo2/tickr/compare/v0.7.12...v0.7.13
[0.7.12]: https://github.com/joezhuo2/tickr/compare/v0.7.11...v0.7.12
[0.7.11]: https://github.com/joezhuo2/tickr/compare/v0.7.10...v0.7.11
[0.7.10]: https://github.com/joezhuo2/tickr/compare/v0.7.9...v0.7.10
[0.7.9]: https://github.com/joezhuo2/tickr/compare/v0.7.8...v0.7.9
[0.7.8]: https://github.com/joezhuo2/tickr/compare/v0.7.7...v0.7.8
[0.7.7]: https://github.com/joezhuo2/tickr/compare/v0.7.6...v0.7.7
[0.7.6]: https://github.com/joezhuo2/tickr/compare/v0.7.5...v0.7.6
[0.7.5]: https://github.com/joezhuo2/tickr/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/joezhuo2/tickr/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/joezhuo2/tickr/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/joezhuo2/tickr/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/joezhuo2/tickr/compare/v0.6.0...v0.7.1
[0.6.0]: https://github.com/joezhuo2/tickr/compare/v0.5.2...v0.6.0
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
