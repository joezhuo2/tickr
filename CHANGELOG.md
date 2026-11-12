# Changelog

All notable changes to tickr are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.11.33] - 2026-11-11

### Added\n- **Theme colors:** a main (accent) and sub (background) color in Settings >\n  Display, chosen in a themed color picker.\n- **Fonts:** pick the text font and the number font.

## [0.11.32] - 2026-11-11

### Added\n- **Settings search:** a search box beside the Settings title suggests\n  settings by name, opens the chosen one and flashes it.

## [0.11.31] - 2026-11-11

### Changed\n- The list under the search box slides open on focus and shut on blur.

## [0.11.30] - 2026-11-11

### Changed\n- Settings keeps one size and scrolls inside; sections slide in and the Hotkeys\n  categories fold open and shut.

## [0.11.29] - 2026-11-11

### Added\n- **Scroll back:** pan past the left edge of the chart to load older candles.\n\n### Changed\n- Every candle interval can be picked at any time; tickr moves to the nearest\n  range that supports it.

## [0.11.28] - 2026-11-11

### Added\n- **Docked panels:** the watchlist and research panels open in a resizable\n  column beside the chart. The Dock button in the toolbar turns this off.

## [0.11.27] - 2026-11-11

### Added\n- **Indicator and drawing alerts:** alert on a Strategy condition such as an\n  RSI or moving-average cross, or on a close through a trendline. Checked\n  while that symbol and interval are on the main chart.

## [0.11.26] - 2026-11-11

### Added\n- **Order lines:** open simulated orders and their stop-loss and take-profit\n  are drawn on the chart; drag a line to change its price.

## [0.11.25] - 2026-11-11

### Added\n- **Go to date:** jump the chart to a date within the loaded range.\n- **Session volume profile** study and a **Volume profile (range)** drawing.

## [0.11.24] - 2026-11-11

### Added\n- **Studies:** Stochastic, Ichimoku, Supertrend, OBV and pivot points, toggled\n  from the Technicals tab and drawn without running Analyze.

## [0.11.23] - 2026-11-11

### Added\n- **More drawing tools:** parallel channel, vertical line, horizontal ray,\n  arrow, price range, date range, Fibonacci extension and pitchfork, in the\n  More menu of the drawing toolbar.

## [0.11.22] - 2026-11-11

### Added\n- **Drawing style:** select a drawing to set its color, width and dash, or lock\n  it against moves and deletion.\n- **Magnet:** snaps drawing points to the open, high, low or close.\n- **Hide drawings:** hides every drawing until toggled back.

## [0.11.21] - 2026-11-11

### Added\n- **Chart types:** Area, Baseline, Hollow candles, Bars, Heikin Ashi and Renko\n  join Line and Candles in a Chart type menu.\n\n### Changed\n- `C` cycles through every chart type.

## [0.11.20] - 2026-11-11

### Added\n- **Manual price scale:** drag the price axis to stretch or compress it. The\n  scale then stays locked while you pan and zoom; double-click the axis for\n  auto.

## [0.11.19] - 2026-11-11

### Added\n- **Live legend:** indicator labels on the chart show their values at the\n  crosshair, or at the latest bar on screen when nothing is hovered.

## [0.11.18] - 2026-11-11

### Added
- **Hotkey sections:** Hotkeys in Settings expands into General, Chart, Draw,
  Indicators, Panels, Options and Watchlist, each on its own page.
- **Themed dropdowns:** every dropdown opens a themed menu with a gliding
  highlight in place of the system popup.
- **Themed tooltips:** the first waits a moment, then its neighbours open at once.

### Changed
- Segmented controls slide a thumb between options, chip rows nudge apart around
  the chosen chip, and checkboxes fill and draw their tick.
- Drawing tool hotkeys are listed under Draw, not Chart.

## [0.11.17] - 2026-11-11

### Added
- **Alerts at key levels:** one-click price alerts in Technicals for the opening
  range, prior-day and premarket highs and lows.

### Changed
- Alerts on the selected symbol are checked on every streamed Alpaca trade.

## [0.11.16] - 2026-11-11

### Added
- **Drawing tools:** box, ray, Fibonacci retracement, long / short position with
  a 2R target, and anchored VWAP, each with a rebindable hotkey.

## [0.11.15] - 2026-11-11

### Added
- **Bracket orders** in Paper trading: an optional stop-loss and take-profit are
  placed when the entry fills, and filling one cancels the other.

## [0.11.14] - 2026-11-11

### Added
- **Position size calculator** in Paper trading: account size, risk %, entry and
  stop give the share count, amount at risk and 2R target.

## [0.11.13] - 2026-11-11

### Added
- **Backtester session terms and stop entries:** `time`, `vwap`, `atr(n)`,
  `or_high(minutes)`, `or_low(minutes)`, day and prior-day levels, plus an
  optional entry stop price that fills where a bar breaks the level.

## [0.11.12] - 2026-11-11

### Changed
- **Settings** has a left menu that switches between Display, Hotkeys, Chart,
  Market data, AI, Backup and Connections.

## [0.11.11] - 2026-11-11

### Added
- **Indicator hotkeys:** `6` to `9` toggle the opening range, key levels,
  volume average and volume profile; rebind them under Indicators in Settings.

## [0.11.10] - 2026-11-11

### Added
- **Candle countdown** on live intraday charts: time left until the forming
  candle closes.

## [0.11.9] - 2026-11-11

### Added
- **VWAP bands**, a **volume profile** overlay and an **ADX 14** reading in
  Technicals.

## [0.11.8] - 2026-11-11

### Added
- **Volume average** line over the volume bars (20 bars by default) and a
  **Relative volume** reading in Technicals.

## [0.11.7] - 2026-11-11

### Added
- **Key levels** overlay in Technicals for intraday charts: the prior day's high
  and low and today's premarket high and low, labeled on the chart. Off by default.
- The opening range is shaded as a box between its high and low.

## [0.11.6] - 2026-11-11

### Changed
- **Indicators stay on the chart** after the Technicals tab is closed, including
  in Paper trading and Strategy, and `Z` analyzes or re-analyzes from those views.

## [0.11.5] - 2026-11-11

### Added
- **Resizable Technicals panel:** drag the border above it (or focus it and press
  ↑ / ↓) to change its height; double-click resets. The height is remembered.

## [0.11.4] - 2026-11-11

### Added
- **Opening range** overlay in Technicals for intraday charts: the high, low and
  midpoint of the first 1 to 240 minutes of each regular session (15 by
  default), with optional extension targets above and below. Off by default.

## [0.11.3] - 2026-11-10

### Added
- **Strategy backtesting** ([#102](https://github.com/joezhuo2/tickr/issues/102)):
  a Strategy panel (`.`) runs entry and exit rules over the loaded chart. Build
  conditions from menus or type expressions with price fields, `sma`, `ema`,
  `rsi`, `crosses_above`, `crosses_below`, comparisons, arithmetic and
  `and` / `or` / `not`. Fills at the next candle's open with optional stop-loss
  and take-profit. The report shows each trade, win rate, total return, max
  drawdown, average trade and buy-and-hold, with trades marked on the chart.
- **Watchlist table** with optional columns: analysis score, RSI (14), days to
  earnings and an estimated IV rank. Column choices are saved.
- **Calendar tab** in the Events panel that puts your watchlist's earnings and
  ex-dividend dates next to macro releases by day.
- **Backup**: export and import settings, watchlists, groups, drawings, alerts,
  screens, keybinds and indicator presets as JSON from Settings.

### Fixed
- The chart no longer stays on the loading skeleton after opening the app
  until the range is changed ([#152](https://github.com/joezhuo2/tickr/issues/152)).

## [0.11.2] - 2026-11-05

### Added
- **Random historical practice** ([#115](https://github.com/joezhuo2/tickr/issues/115)):
  pick a watchlist group, candle interval and date range, and tickr picks a
  random symbol and start point (volatile periods about one time in three). It
  shows the preceding candles with the future hidden, and you choose Long, Short
  or Skip. Entries fill at the next candle's open, and you can close at a
  revealed close. Ending the exercise reveals the result card (return, bars
  held, Skip comparison) with entry and exit markers. Everything is labelled
  Simulated. Indicators and analysis use only revealed candles, and live quotes,
  news, earnings and analyst targets are hidden during practice.

## [0.11.1] - 2026-11-05

### Added
- **Paper trading** ([#101](https://github.com/joezhuo2/tickr/issues/101)):
  simulated market, limit and stop orders with long and short positions,
  commission and slippage settings, buying-power checks, realized and
  unrealized P&L, a trade history and fill markers on the chart. The live
  account is saved to paper.json. During bar replay a separate session-only
  account fills at the next revealed bar's open and steps back with the replay.
  Everything is labelled Simulated. Live market orders are only allowed in the
  regular session with a fresh quote.

## [0.11.0] - 2026-11-05

### Added
- **Bar replay** ([#100](https://github.com/joezhuo2/tickr/issues/100)): reveal
  the chart one candle at a time from a chosen start date, with play/pause,
  step forward and back, and playback speed. Indicators and analysis use only
  revealed candles. The live quote, news, earnings, analyst targets and other
  forward-looking panels are hidden or disabled while replay is on, and pan and
  zoom cannot show unrevealed candles. The replay hotkey is rebindable (default
  Y), with Space, Left, Right and Escape for playback controls. Nothing about
  replay is saved.

## [0.10.22] - 2026-11-05

### Added
- **Two synchronized charts** ([#95](https://github.com/joezhuo2/tickr/issues/95)):
  optional second chart pane, side by side or stacked, with its own symbol and
  range. Crosshair time is linked across both charts, and an optional sync
  toggle moves both to the same time window. The layout is saved; the default
  stays a single chart.

## [0.10.21] - 2026-11-05

### Added
- **Pen drawing tool** ([#139](https://github.com/joezhuo2/tickr/issues/139)):
  draw freehand strokes on the chart. Strokes are anchored to time and price,
  saved per symbol, and can be selected, erased and undone like other drawings.
  The hotkey is rebindable (default 5), there is a toolbar button, and pen mode
  stays on until Escape.

## [0.10.20] - 2026-11-04

### Added
- **Chart session controls** ([#110](https://github.com/joezhuo2/tickr/issues/110)):
  show or hide extended-hours candles on the chart independently of the tray
  quote setting, shade pre- and post-market sessions, and show chart times in
  exchange or local time. Defaults match previous behavior.

## [0.10.19] - 2026-11-04

### Added
- **Symbol search controls** ([#108](https://github.com/joezhuo2/tickr/issues/108)):
  filter results by asset type and exchange, exact ticker matches rank first,
  each result shows exchange, currency (when known) and instrument type, and
  search returns up to 20 results. Typing a ticker and pressing Enter still
  opens it directly.

## [0.10.18] - 2026-11-04

### Added
- **Alert actions** ([#107](https://github.com/joezhuo2/tickr/issues/107)):
  edit an alert's direction and level in place, duplicate an alert, click its
  ticker to open the chart, filter by All, Armed, Triggered or Paused, and see
  the trigger price and time on triggered alerts.

## [0.10.17] - 2026-11-04

### Changed
- **Data freshness labels** ([#105](https://github.com/joezhuo2/tickr/issues/105)):
  the footer shows source, quote time, chart time and known delay separately
  instead of a plain Live. Quote and chart are marked stale independently, with
  a note beside the affected content. Live only shows when the quote is recent
  and the market is open, and delay shows as unknown when the source does not
  say.

## [0.10.16] - 2026-11-04

### Added
- **Options strategy builder** ([#99](https://github.com/joezhuo2/tickr/issues/99)):
  add long or short legs from the chain, start from eight presets (long call,
  long put, covered call, bull call spread, bear put spread, straddle,
  strangle, iron condor), and see the expiration payoff diagram with
  break-evens, max profit and loss, and net debit or credit. Up to three saved
  strategies can be overlaid to compare.

## [0.10.15] - 2026-11-04

### Added
- **Watchlist heatmap** ([#98](https://github.com/joezhuo2/tickr/issues/98)):
  toggle the watchlist between cards and a heatmap. Tiles are colored by day
  change and sized by move magnitude, respect group tabs, and the choice is
  saved.

## [0.10.14] - 2026-11-04

### Added
- **Broader calendars** ([#93](https://github.com/joezhuo2/tickr/issues/93)):
  economic events get week navigation plus country and importance filters
  (saved). A new Watchlist dates tab lists upcoming earnings and ex-dividend
  dates for starred symbols.

### Changed
- Event ids now include country, so cached AI event analyses regenerate once.

## [0.10.13] - 2026-11-04

### Added
- **Financials tab** ([#92](https://github.com/joezhuo2/tickr/issues/92)):
  revenue, net income, gross, operating and net margins, and free cash flow
  history, annual or quarterly, with a trend chart and table.

## [0.10.12] - 2026-11-04

### Added
- **Watchlist screener** ([#91](https://github.com/joezhuo2/tickr/issues/91)):
  filter watchlist symbols by RSI(14), price above or below SMA 20, 50 and 200,
  and daily change %, with saved named filters.

## [0.10.11] - 2026-11-04

### Added
- **Watchlist sorting**: the watchlist can be sorted by price, change or volume,
  and your choice is saved.

## [0.10.10] - 2026-11-04

### Added
- **Connections panel** ([#111](https://github.com/joezhuo2/tickr/issues/111)):
  Settings > Connections shows quote, news and AI status, the last success and a
  readable error, with Retry for each. Copy diagnostics copies app and OS
  versions, the log folder and connection details with credentials, the AI base
  URL and your home folder redacted.

## [0.10.9] - 2026-11-04

### Added
- **AI connection test and provenance** ([#112](https://github.com/joezhuo2/tickr/issues/112)):
  Settings gains Test connection, which saves and checks each configured model.
  News labels each tone AI or Keyword, with the model and generation time on
  hover. Event analysis shows its model and generation time, and Regenerate
  requests a fresh one.

### Removed
- The Show button beside the AI key, which had nothing to show since v0.10.6.

## [0.10.8] - 2026-11-04

### Added
- **Drawing hotkeys** ([#129](https://github.com/joezhuo2/tickr/issues/129)):
  `1` to `4` pick the level, trendline, text and ruler tools, and pressing a
  tool's key again returns to Cursor. Rebind them in Settings.

## [0.10.7] - 2026-11-04

### Added
- **Candle length hotkey** ([#130](https://github.com/joezhuo2/tickr/issues/130)):
  `I` cycles the candle length through Auto and each length the current range
  allows. Rebind it in Settings.

## [0.10.6] - 2026-11-04

### Security
- **AI key stays out of the page:** the saved API key is no longer sent to the
  Settings page. The field shows "Key saved", leaving it blank keeps the key, and
  a new Clear button removes it.

## [0.10.5] - 2026-11-04

### Added
- **Recent symbols and history** ([#104](https://github.com/joezhuo2/tickr/issues/104)):
  the empty search box lists the last 10 symbols viewed. Back and Forward buttons
  or `Alt+←` and `Alt+→` step through this session's symbols, and `B` toggles
  between the last two.

## [0.10.4] - 2026-11-04

### Changed
- **Refresh follows the panel on screen** ([#106](https://github.com/joezhuo2/tickr/issues/106)):
  Refresh now also reloads News, Earnings, Stats, Analysts, Events, Market,
  Options or the Watchlist cards when they are open. The bottom bar reports
  success or the error for that panel, and a failed refresh keeps what was
  already shown.

## [0.10.3] - 2026-11-04

### Added
- **Display settings** ([#109](https://github.com/joezhuo2/tickr/issues/109)):
  Settings can force a light or dark theme, enlarge text up to 150%, and switch
  gain and loss to a blue and orange pair that also applies to the tray badge.
  Candle tooltips gain a direction arrow, so gain and loss never rely on color
  alone.

## [0.10.2] - 2026-11-04

### Added
- **Background refresh modes** ([#113](https://github.com/joezhuo2/tickr/issues/113)):
  Settings offers Balanced, the existing cadence, and Low-power, which slows
  updates while the window is hidden. Quotes refresh promptly after system wake,
  network recovery or showing the window. Armed alerts keep their 15-second
  cadence in both modes.

## [0.10.1] - 2026-11-04

### Added
- **Price scale hotkey** ([#119](https://github.com/joezhuo2/tickr/issues/119)):
  the `L` key cycles the chart through Lin, Log and %. It can be rebound in
  Settings.

## [0.10.0] - 2026-11-04

### Added
- **Chart drawings** ([#86](https://github.com/joezhuo2/tickr/issues/86)):
  a toolbar on the chart places horizontal levels, trendlines and text, and a
  ruler measures price, percent, bars and time. Drawings are saved per symbol
  and can be moved, deleted, undone and redone.

## [0.9.11] - 2026-11-04

### Added
- **Optional Alpaca market data** ([#97](https://github.com/joezhuo2/tickr/issues/97)):
  Settings can switch the selected stock's quotes and candles to Alpaca with
  your own keys, on the IEX or SIP feed, with live trades over a WebSocket
  stream. Yahoo stays the default and takes over if Alpaca fails. The footer
  shows the source in use. The watchlist and alerts still use Yahoo.

## [0.9.10] - 2026-11-04

### Added
- **Watchlist news feed** ([#96](https://github.com/joezhuo2/tickr/issues/96)):
  News can now combine headlines across the watchlist or a named group, merge
  duplicate stories, and filter by ticker, publisher or topic.

## [0.9.9] - 2026-11-03

### Added
- **Logarithmic and percentage scales** ([#90](https://github.com/joezhuo2/tickr/issues/90)):
  a Lin, Log and % control beside Line and Candles changes the price axis. The
  percentage scale rebases to the first visible candle as you pan and zoom. The
  choice is saved.

## [0.9.8] - 2026-11-03

### Added
- **Configurable indicators** ([#88](https://github.com/joezhuo2/tickr/issues/88)):
  moving averages, Bollinger Bands, VWAP and RSI now have editable lengths,
  colors and visibility, saved across restarts and in named presets. MACD joins
  as an optional lower pane. Shown analysis recalculates when candles refresh,
  and "Keep analysis on" runs it automatically. The composite score still uses
  the standard lengths, so display edits never change it.

## [0.9.7] - 2026-11-03

### Added
- **Independent candle intervals** ([#85](https://github.com/joezhuo2/tickr/issues/85)):
  a picker beside the range tabs sets candle resolution separately from the
  visible period, limited to combinations Yahoo supports. Auto keeps the old
  default for each range, and a saved interval resets to Auto when a range does
  not support it.

## [0.9.6] - 2026-11-03

### Added
- **Richer alerts** ([#81](https://github.com/joezhuo2/tickr/issues/81)):
  alerts can follow a day move %, a move since armed %, or a trailing
  percentage or amount from the high or low since arming. They can also be
  recurring with a cooldown, and limited to the regular session. Existing
  alerts keep working as one-shot price alerts.

## [0.9.5] - 2026-11-03

### Fixed
- **News tab closes on a second click** ([#80](https://github.com/joezhuo2/tickr/issues/80)):
  clicking News while News is open returns to the chart, as the `N` key and the
  Market, Events and Options tabs already do.

## [0.9.4] - 2026-11-03

### Added
- **Watchlist group hotkey** ([#84](https://github.com/joezhuo2/tickr/issues/84)):
  `G` (rebindable in Settings) cycles the Watchlist tabs, All then each group
  in order, then back to All. It opens the Watchlist if it is closed.

## [0.9.3] - 2026-11-01

### Added
- **A model per AI feature** ([#75](https://github.com/joezhuo2/tickr/issues/75)):
  Settings > AI has optional News model and Events model fields, saved to
  `.env.local` as `TICKR_AI_NEWS_MODEL` and `TICKR_AI_EVENTS_MODEL`. A blank
  field uses Model, which now acts as the master model, so existing setups work
  unchanged. Setting only a feature's model is enough to turn AI on for that
  feature.

## [0.9.2] - 2026-11-01

### Changed
- **Events from Yahoo, analyzed on click** ([#74](https://github.com/joezhuo2/tickr/issues/74)):
  the Events panel now lists the next 7 days of US economic releases straight
  from Yahoo's economic calendar, grouped by day with the actual, expected and
  prior figures. Opening it no longer needs or calls AI. Clicking an event
  runs the AI analysis for that event only (summary, plus affected stocks and
  sectors with score, confidence and reasoning), cached for 6 hours and redone
  once the actual figure is released.

## [0.9.1] - 2026-11-01

### Changed
- **Tray icon toggles the window** ([#76](https://github.com/joezhuo2/tickr/issues/76)):
  left-clicking the tray icon while the window is open and focused now closes
  it the same way the hotkey does (minimize, or hide/unload on macOS). If the
  window is open but behind other windows, the click brings it to the front.

## [0.9.0] - 2026-11-01

### Added

- **Upcoming market events** ([#72](https://github.com/joezhuo2/tickr/issues/72)):
  a new Events panel (header button, or `K`) lists market-moving events for the
  next 7 days with date, time and a positive, negative or neutral tone. The
  list is generated by the configured AI endpoint from current Yahoo market
  headlines and cached on disk for 6 hours; the Refresh button regenerates it.
  Clicking an event shows its details in an expandable summary, plus the
  affected stocks and sectors, each with a score, confidence and expandable
  reasoning.

## [0.8.16] - 2026-10-30

### Added

- **New hotkeys** ([#62](https://github.com/joezhuo2/tickr/issues/62)): `O`
  opens Options, `U` switches calls / puts, `D` jumps to the next expiry
  (wrapping around) and `F` adds the current stock to the Watchlist. The
  options keys only act while the Options view is loaded. Saved keybinds are
  unchanged.

## [0.8.15] - 2026-10-30

### Changed

- **Hotkey categories** ([#63](https://github.com/joezhuo2/tickr/issues/63)):
  keybinds in Settings are grouped under Chart, Panels, Watchlist and General
  headers. Saved keybinds are unchanged.

## [0.8.14] - 2026-10-30

### Added

- **Animations** ([#64](https://github.com/joezhuo2/tickr/issues/64)):
  views fade in when switching panels, the watchlist slides up from the
  footer, Settings fades and scales open and closed, and switching line and
  candles fades the chart. Toggle buttons ease their highlight. Durations and
  easing come from shared theme tokens, and the OS reduced-motion setting turns
  all of it off.

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
