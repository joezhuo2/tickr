<p align="center"><img src="assets/tickr-banner.png" alt="tickr" width="100%"></p>

<p align="center">
  <a href="https://github.com/joezhuo2/tickr/releases/latest"><img src="https://img.shields.io/github/v/release/joezhuo2/tickr?logo=github&color=orange" alt="release"></a>
  <a href="https://github.com/joezhuo2/tickr/releases"><img src="https://img.shields.io/github/downloads/joezhuo2/tickr/total?logo=github&color=blue" alt="downloads"></a>
  <a href="https://github.com/joezhuo2/tickr/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/joezhuo2/tickr/ci.yml?branch=main&label=CI&logo=githubactions&logoColor=white" alt="CI"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey" alt="platform: Windows | macOS">
  <a href="https://v2.tauri.app"><img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" alt="Tauri 2"></a>
  <a href="https://svelte.dev"><img src="https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white" alt="Svelte 5"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/joezhuo2/tickr?color=green" alt="license"></a>
</p>

<p align="center">
  <a href="#download">Download</a> •
  <a href="#features">Features</a> •
  <a href="#settings-and-keybinds">Keybinds</a> •
  <a href="#screenshots">Screenshots</a> •
  <a href="#data">Data</a> •
  <a href="#files">Files</a> •
  <a href="#development">Development</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#license">License</a>
</p>

> tickr is a stock watcher and trading practice app for the Windows tray and
> macOS menu bar. Hover over the tray icon for a quote, or use a global hotkey
> to open charts, watchlists, alerts and market research. Compare two charts,
> replay historical candles, and practice trades with simulated orders or
> randomly selected setups. Backtest entry and exit rules, screen your
> watchlist, add studies and drawings, and quiz yourself on candle and chart
> patterns.

<p align="center"><img src="assets/tickr-demo.gif" alt="Tickr demo showing linked chart crosshairs, candle-by-candle replay, a simulated order filling, and a historical practice result" width="100%"></p>

## Download

Get the latest installer from
[Releases](https://github.com/joezhuo2/tickr/releases/latest):

- **Windows:** `tickr_x.y.z_x64-setup.exe`. Installs per user, no admin
  prompt.
- **macOS:** `tickr_x.y.z_universal.dmg` (Apple silicon and Intel), macOS 10.15
  or later. Drag tickr into Applications.

### First launch

tickr is not code-signed yet, so both systems warn the first time you open
it. The builds come from the public
[release workflow](.github/workflows/release.yml), so you can check what went
into them.

- **Windows:** SmartScreen says "Windows protected your PC". Click
  **More info**, then **Run anyway**. You only see this once. If Microsoft
  Defender removes tickr as `Trojan:Win32/Bearfoos` (a false positive on the
  unsigned build), update to the newest release, or restore it under
  **Windows Security > Protection history**.
- **macOS 15 (Sequoia) or later:** open tickr and close the warning that it
  can't be verified. Go to **System Settings > Privacy & Security**, scroll
  down to the message about tickr and click **Open Anyway**, then confirm
  with your password.
- **macOS 14 or earlier:** right-click tickr in Applications, choose
  **Open**, then **Open** again.
- **macOS says tickr "is damaged and can't be opened":** the download was
  quarantined. Run this, then open it again:

  ```bash
  xattr -dr com.apple.quarantine /Applications/tickr.app
  ```

### Updates

From v0.5.1, tickr updates itself. It checks GitHub 30 seconds after launch
and every 12 hours. When a new version is out, the tray tooltip says so and
the update item in the tray menu reads **Install vX.Y.Z and restart**.
Nothing installs until you click it. tickr then downloads the update, checks
its signature against the key built into the app, installs it and restarts.
The first-launch warnings above don't come back after an update.

**Check for updates** checks right away. Turn off **Check for updates
automatically** to stop the background checks. Versions before v0.5.1 can't
update themselves: install v0.5.1 once from Releases.

## Features

- **Display settings:** choose System, Light or Dark, text size from 100% to 150%, and standard or accessible blue/orange gain and loss colors. Changes apply immediately and are saved.
- **Theme colors and fonts:** Settings > Display also has a **Main color** (the accent on buttons, links and highlights) and a **Sub color** (the background; text, panels and borders are derived from it, and it decides light or dark by itself, overriding Theme). Both open a themed color picker with a saturation and brightness square, a hue slider, presets and a hex box; changes preview live, and Reset returns to the theme's own color. **Font** and **Number font** pick from font families already on your computer, so a choice that is not installed falls back to the next in its list. Below them, **Colors** lists every color tickr draws with (interface, gain/loss and every chart overlay and marker), each with its own picker and Reset; a color set there wins over Main, Sub and the gain/loss palette. **Reset to defaults** at the top of Display clears every color choice at once. All of these are remembered on this computer and are included in Backup.

### Tray and hotkey

- **Tray icon:** the company logo with an up/down badge. Hover for the
  quote, left-click to open the window, or to close it again the way the
  hotkey does if it's already open and focused. Right-click holds every on/off
  setting: show pre-market/after-hours, show change as % or $, always on top,
  unload window when minimized, start hidden, launch at login, check for
  updates automatically and, on macOS, show price in menu bar. If something
  needs attention (the hotkey is taken, or launch at login could not be
  changed), the tooltip ends with a ⚠ line.
- **Global hotkey** (default `Ctrl+Alt+K` on Windows, `⌘⇧K` on macOS): opens
  the window, or minimizes it if it's focused. On macOS, where tickr has no
  Dock icon, it hides the window instead (or unloads it, when unload is on).
  Change it in [Settings](#settings-and-keybinds). If another app owns the
  hotkey at startup, the window footer shows the error until you pick one
  that works.
- **Launch at login** is off until you turn it on. Once on, it survives
  upgrades: tickr re-registers itself if an installer removed the entry,
  unless you turned it off in Task Manager.
- **Unload when minimized** (on by default): minimizing destroys the web view,
  so the app drops to one process using about 7 MB. The hotkey reopens it
  already painted with the last chart and quote, then refreshes in the
  background. The window opens on a dark or light background to match the
  OS theme, so it never flashes white.

Windows may hide new tray icons in the overflow menu (^). Drag it onto the
taskbar to keep it visible.

### Chart

- **Symbol and range:** search to change the symbol, pick a range from 1D to
  Max and choose a chart type. Search filters by asset type and
  exchange, and exact ticker matches come first. Press Enter on a typed ticker
  to open it directly. 1D, 5D and 1M charts reload about once a minute.
- **Sessions and time zone:** extended-hours candles can be shown or hidden on
  the chart without changing the tray quote setting. Pre- and post-market
  sessions are shaded, and chart times can use the exchange or local time zone.
- **Second chart:** the toggle (J by default) opens a second chart pane, side by
  side or stacked, with its own symbol and range. Crosshair time is linked
  across both charts. Turn on **Sync** to pan and zoom both panes together.
  tickr saves the layout across launches.
- **Chart windows:** the window button next to the layout control (= by
  default) opens the current symbol in a new window. Each window keeps its own
  symbol, range, candle length, chart type and view, and you can open as many
  as you like. Closing one just closes it; the main window keeps its saved
  size, position, symbol and layout. Chart windows refresh their quote every
  15 seconds; the Alpaca stream feeds only the main window's symbol.
- **Recent symbols and history:** focus the empty search box to see the last
  10 symbols you viewed. The Back and Forward buttons (or Alt+Left and
  Alt+Right) step through this session's symbols, and B jumps to the previous
  one, so pressing it again toggles between two. The list
  under the search box slides open on focus and shut when you leave it.
- **Chart types:** Line, Area, Baseline, Candles, Hollow candles, Bars (OHLC),
  Heikin Ashi, Renko, Range bars, Line break, Kagi and Point & Figure, from the
  **Chart type** menu next to the price scale or by pressing C to cycle. Baseline colors the line green above and red below the previous
  close on 1D, or the first bar on screen otherwise. Heikin Ashi and Renko show
  smoothed prices, so the tooltip values are not traded prices. Renko bricks
  are one 14-bar average true range tall, are built from closes, and are not
  evenly spaced in time. Range bars, Line break, Kagi and Point & Figure work
  the same way: they are rebuilt from the candles on screen (so replay and
  practice never see future data), drawn evenly spaced by index, and studies
  compute on the transformed series. Tick data is not available, so a range bar
  walks each candle as open, low, high, close (or open, high, low, close on a
  down candle) and splits it into several bars when it covers more than one
  range; the real intrabar order is unknown. Next to the menu, a box takes the
  range size (0 uses the 14-bar ATR), the Line break count (2 to 5, default 3),
  the Kagi reversal (0 uses ATR, in price or percent), or the Point & Figure
  box size (0 uses ATR) and reversal boxes (default 3). Kagi and Point &
  Figure use closes only. These settings are kept in local storage and included
  in settings backups.
- **Price scales:** linear, logarithmic, or percentage change rebased to the
  first visible candle as you pan and zoom. Press L to cycle scales. The
  **Left price scale** button at the top right adds a second scale on the left:
  the same labels as the right, or percent change from the first visible bar.
- **Panes:** hover a pane for its buttons at the top right. RSI, MACD,
  Stochastic and OBV panes move up or down, **Merge** puts a pane into the one
  above (or into the price pane) as an overlay with its own autoscaled range,
  and **Unmerge** splits them again. A merged pane shows the first study's
  scale on the right and the second's on the left. **Maximize** fills the chart
  with one pane, the price pane included; the same button, Escape, or a
  double-click on a lower pane's header restores it. Order, merges and the left
  scale are saved and shared by every chart.
- **Drawings:** the toolbar places levels, trendlines, text, freehand pen strokes, boxes, rays,
  Fibonacci retracements, long / short positions and anchored VWAPs, saved per symbol.
  Keys 1 to 5 pick the level, trendline, text, ruler and pen tools; `[` `]` `;` `'` `/` pick
  box, ray, Fibonacci, position (R:R) and anchored VWAP. A position is drawn from the entry to
  the stop and shows the stop distance and the 2R target; an anchored VWAP starts at the candle
  you click.
  Drag to move them or adjust trend endpoints, and Delete removes the selection.
  Drawings, notes, targets and Fibonacci extensions can be placed in the empty
  space right of the latest candle; a future point keeps its date and time, so it
  stays put as new bars arrive and when you switch intervals.
  Ctrl+Z undoes, Ctrl+Shift+Z redoes, and Escape returns to Cursor (Cmd on
  macOS). Ctrl+C copies the selected drawing and Ctrl+V pastes it a few bars
  right and a little lower, on this or any other symbol; Ctrl+D or **Clone**
  in the style row copies it in place the same way. A pasted copy is
  unlocked, selected and can be undone. The ruler
  measures price, percent, bars and elapsed time without saving.
  The **More** menu adds a parallel channel, vertical line, horizontal ray,
  arrow, price range, date range, trend-based Fibonacci extension and
  pitchfork. Channel, Fibonacci extension and pitchfork take three clicks: the
  first two set the base move and the third sets the channel width, the
  projection start, or the second pitchfork tine. It also has arrow up and
  arrow down markers (one click), a **Callout** (click the anchor, then where
  the text box goes, then type; double-click it or use **Edit** to change the
  text), **Elliott impulse** (six clicks, labelled 0 to 5) and **Elliott
  correction** (four clicks, 0, A, B, C), an **XABCD harmonic** (five clicks;
  it shades the XAB and BCD triangles and prints the AB/XA, BC/AB, CD/BC and
  AD/XA ratios on the dashed XB, AC, BD and XD lines) and **Head and
  shoulders** (five clicks: left shoulder, first neckline point, head, second
  neckline point, right shoulder; the neckline is extended across the
  pattern). It also has a **Gann fan** (two clicks: the origin and the 1x1
  point; rays from 1x8 to 8x1, labelled), a **Fib fan** (two clicks; rays
  from the first point through the 0.236 to 0.786 levels of the move at the
  second point), **Fib time zones** (two clicks set the unit width; vertical
  lines at 0, 1, 2, 3, 5, 8 … 89 units), an **Ellipse** (two clicks for the
  corners, lightly filled), a **Polyline** (click to add points, double-click
  or Enter to finish, Escape cancels), a **Brush** (a wide see-through
  highlighter stroke, drawn like the pen) and **Icon** stamps (pick check,
  cross, star, flag, question, exclamation or an up or down triangle in the
  row under the toolbar, then click; select an icon to change it). These tools
  have no hotkeys.
  **Objects** opens the object tree: every drawing on the chart, newest first,
  with its price or text. Click a row to select it and scroll it into view
  (a note opens its popover), and each row can be hidden, locked, deleted or,
  for text and callouts, renamed. Hide all / Show all, Lock all / Unlock all
  and Delete all… (unlocked drawings only, after a confirm) act on the whole
  chart. A locked drawing ignores clicks on the chart, so it cannot be moved,
  resized or deleted there; select it from the list to unlock it. Hidden and
  locked states are saved with the drawing, and replay and practice runs keep
  their own lists.
  The **Note** tool (`` ` ``) pins a multi-line note to a candle: it shows as a
  small marker, hovering shows the text, and clicking opens a popover to edit it,
  pick a color or delete it. Notes stay on their candle when you change the candle
  interval, appear on the second chart and chart windows, are hidden by Hide and
  during bar replay, and are listed under Notes in the Alerts panel, where
  clicking one scrolls the chart to it.
  Select a drawing to style it: a row under the toolbar sets its color, line
  width (1 to 8 px), a dashed line, and **Lock**, which stops it being moved or
  deleted until unlocked. **Intervals** sets which candle intervals it shows
  on: All intervals, or any of Minutes, Hours, Days and Weeks/Months. On other
  intervals it is not drawn and cannot be clicked, and **Objects** greys it
  out as hidden on this interval. **Default** saves the style as the starting style
  for new drawings of that tool, and **Templates** lists named styles: type a
  name and **Save style** to keep the current one, click a template to apply
  it, or × to delete it (up to 20). **Magnet** snaps new points and dragged endpoints to
  the open, high, low or close of the candle under the cursor when within 12
  pixels, and **Hide** hides every drawing until you click it again. Drawings,
  Magnet, Hide, the study toggles and the Technicals panel (height and whether
  Indicator settings is open) are all restored when you relaunch tickr.
- **Candle interval:** choose Auto to keep the default resolution for each
  range, or pick any interval from 1m to 1M at any time. Besides Yahoo's
  intervals the list has 2m, 3m, 10m, 45m, 2h, 3h, 4h, 2D and 3D, and
  Custom… takes any length you type: minutes (`7m`, 1 to 1440), hours (`4h`,
  1 to 24), days (`2D`, 1 to 30), weeks (`3W`, 1 to 8) or months (`2mo`, 1 to
  12). These are built from the largest native interval that divides them (45m
  from 15m, 2h and 4h from 30m, or 60m on 6M to 1Y, 2m and 7m from 1m, 2D from
  1D) with the same rules for Yahoo and Alpaca, so the base interval's
  history limits apply: 1m-based lengths only reach back about 30 days.
  Intraday bars start at each day's session open (the pre-market open with
  extended hours on), so a 4h chart has 09:30 and 13:30 bars and the last bar
  of the day can be shorter. N-day bars count trading days from each year's
  first session and need YTD, 1Y, 5Y or Max; N-week bars count weeks from
  Monday 5 January 1970; N-month bars count from January. Lengths you type are
  remembered in the list. If the current range cannot show that interval,
  tickr moves to the nearest range that can (5m on 1Y becomes 5m on 1M) and
  you scroll back for more. The choice is saved, and switching to a range that
  does not support it returns to Auto.
- **Scroll back for history:** drag or scroll past the left edge of the main
  chart, or zoom out when everything is already on screen, to load older
  candles at the same interval. Each step adds about as much history as is
  already loaded and the view stays where it was. Yahoo limits intraday
  history (about 30 days of 1m, 60 days of 5m to 30m, two years of 1h); with
  Alpaca keys, US stocks scroll back through Alpaca's years of history at the
  same interval. Intraday candles you load are also saved on this computer, so
  scrolling back reaches past Yahoo's limit over time (see [Files](#files)).
  Scrolling stops at 20,000 candles; daily and longer go back to the first
  listing. Analysis overlays cover the range's own candles, not the older
  ones. The second chart does not scroll back.
- **Candle countdown:** on a live intraday chart, the bottom right corner shows
  the time left until the forming candle closes.
- **Tooltip:** hover the chart, or use ← and →, for time, open, high, low,
  close and volume.
- **Legend:** each indicator label on the chart shows its value at the
  crosshair, or at the latest bar on screen when nothing is hovered. Bollinger
  shows upper / middle / lower, the opening range high / low, and MACD its
  line / signal / histogram.
- **Zoom and pan:** scroll or pinch to zoom at the cursor (down to 10 bars),
  drag or scroll sideways to pan, and double-click to see the whole range
  again. With the chart focused, + and - zoom and 0 resets. The price axis
  fits the visible bars, and a zoomed view follows new bars at the right edge.
  The chart keeps 3 empty bars right of the latest candle, and you can drag
  further into the future, up to half the visible bars (at most 200). The time
  axis and crosshair continue there with future bar times, skipping weekends
  and closed hours like the real bars (holidays are not skipped).
- **Go to date:** the calendar button at the top right of the chart opens a
  date box (date and time on intraday charts). Picking a date centers the
  first candle at or after it and puts the crosshair there. It moves within
  the candles already loaded for the range, so the box only accepts dates
  inside it.
- **Price axis:** drag the price axis up or down to stretch or compress the
  price scale. While it is set by hand the scale stays locked as you pan and
  zoom, and dragging the chart also moves it vertically. Double-click the axis,
  or use the **Auto price scale** button at the top right, to fit the visible
  bars again; changing symbol, range or scale type also returns to auto.
- **Event dots** along the bottom of the chart; hover the candle for details:

  | Dot | Marks |
  | --- | --- |
  | Blue | Earnings report: quarter and EPS vs estimate (last four quarters) |
  | Orange | Analyst initiation, upgrade or downgrade: firm, ratings, new target |
  | Yellow | One of the 20 latest headlines |
  | Green | Ex-dividend date and amount (6M to Max) |
  | Purple | Stock split and ratio (6M to Max) |

  Dots stack when a candle has more than one. A news dot gets a smaller inner
  circle: green when that candle's headlines lean positive, red when they lean
  negative, and plain when neutral. Earnings, news and rating dots can be
  turned off in Settings.
- **Exports:** hover the chart for two buttons at its top left. One copies
  the chart as a PNG image, the other its candles as CSV (time in UTC, open,
  high, low, close, volume). A button turns green once the copy lands.
- **Refresh:** the button in the bottom bar fetches the quote and reloads the
  chart right away, then force-reloads the panel on screen (News, Earnings,
  Stats, Analysts, Events, Market, Options or the Watchlist cards). The bar
  says "<Panel> refreshed" or shows the error, and a failed refresh keeps what
  was already shown. **Background refresh** in Settings defaults to **Balanced**:
  quotes update every 15 seconds during regular trading, 60 seconds pre/post-market,
  and 15 minutes when closed. **Low-power** keeps that cadence while visible and
  slows it to 60 seconds, 5 minutes, and 30 minutes while hidden or minimized.
  Armed alerts keep their usual 15-second cadence in either mode. Low-power pauses
  automatic minute chart and watchlist refreshes while hidden and refreshes stale
  data when shown. Quotes also refresh promptly after system wake or network recovery.

### Replay and trading practice

- **Bar replay** (`Y`) starts at a historical date you choose. Play at an
  adjustable speed or step forward and back one candle at a time. Indicators
  use only the candles you've revealed. tickr hides live quotes and research
  panels during the session. Change the candle interval mid-replay to zoom
  in or out on the same moment: a higher-timeframe candle that is still
  forming is built from the finer candles revealed so far, never its final
  close, and stepping back stops at the moment you switched. The split
  layout stays on, and the second chart follows the same moment on its own
  interval; each step advances one candle of the main chart.
- **Paper trading** (`H`) simulates market, limit and stop orders for long and
  short positions. Set commission and slippage, track realized and unrealized
  P&L, and review fills on the chart. The account used with current quotes is
  saved to `paper.json`. Replay uses a separate account for the session, and
  simulated market orders fill at the next revealed candle's open.
  Open limit and stop orders for the symbol on screen are drawn on the chart
  as dashed lines, green for buys and red for sells, with their stop-loss and
  take-profit when they carry one. Drag a line up or down to change that
  price; a move that would put a stop-loss or take-profit on the wrong side of
  its entry is refused and the line snaps back. A limit dragged through the
  market fills on the next price check, as it would if typed that way.
  An order can carry an optional **stop-loss** and **take-profit**: when the
  entry fills, tickr places both as exit orders, and filling one cancels the
  other (shown as OCO in Open orders). If a single candle reaches both, the
  stop-loss fills.
  The **Position size** row turns an account size, risk %, entry and stop into
  a share count, the amount at risk and the 2R target; it defaults to the paper
  account's equity and the current price, and **Use in ticket** copies the side,
  quantity, stop-loss and 2R take-profit into the order ticket.
- **Random historical practice** (`Q`) draws a symbol and starting point from
  your watchlist or a group, using the candle interval and date range you pick.
  Choose **Long**, **Short** or **Skip** with future candles hidden. Close at a
  revealed candle's close to see your return, bars held and how you did against
  skipping the trade. Saved runs feed a **Practice stats** section with trades,
  win rate, average R, expectancy, profit factor and win/loss streaks, broken
  down by symbol and by tag, plus a filterable trade history where you can add
  tags (such as a setup name) and a note to each trade. R is the trade's return
  divided by the 14-bar ATR at the decision candle, since practice trades have
  no stop.
- **Pattern trainer:** the **Mode** menu in the Practice bar has three quizzes
  besides Trade. **Name the pattern** highlights the candles of a detected
  candle pattern with its label hidden and offers four choices, then explains
  the answer. **Next move** names the pattern and asks whether the close five
  candles later is higher or lower. **Name the chart pattern** works like Name
  the pattern, with a confirmed chart pattern (head and shoulders, double top,
  triangle, flag, wedge and so on).
  The session keeps your score and streak. Detected candle patterns: doji, spinning
  top, hammer, inverted hammer, hanging man, shooting star, bullish and bearish
  marubozu, bullish and bearish engulfing, bullish and bearish harami, piercing
  line, dark cloud cover, tweezer top and bottom, morning star, evening star,
  three white soldiers, three black crows, three inside up and down, bullish and
  bearish kicker, and bullish and bearish abandoned baby.
- **Strategy backtesting** (`.`) runs entry and exit rules over the loaded
  chart. Build conditions from menus or type expressions such as
  `crosses_above(sma(20), sma(50)) and rsi(14) < 70`, using price fields,
  `sma`, `ema`, `rsi`, `crosses_above`, `crosses_below`, comparisons,
  arithmetic and `and` / `or` / `not`. Session terms cover intraday setups:
  `time` (exchange time as HHMM, so 945 is 9:45), `vwap`, `atr(n)`,
  `or_high(minutes)` and `or_low(minutes)` for the opening range once it is
  complete, `day_high` and `day_low` for the regular session before the current
  bar, and `prev_high`, `prev_low`, `prev_close` for the prior day on the chart.
  The study functions `macd(fast, slow, signal)`, `macd_signal`, `macd_hist`,
  `bb_upper(n, k)`, `bb_mid`, `bb_lower`, `stoch_k(n, smooth, d)`, `stoch_d`,
  `stochrsi(rsi, stoch, k, d)`, `wma(n)`, `hma(n)`, `vwma(n)`, `aroon_up(n)`,
  `aroon_down(n)`, `cmf(n)`, `roc(n)`, `cci(n)`, `mfi(n)`, `willr(n)`,
  `adx(n)`, `supertrend(n, multiplier)`, `donchian_high(n)` and
  `donchian_low(n)` are in the menus too; numbers left out take the study
  defaults, so `macd()` is 12, 26, 9 and `bb_upper(20)` is 2 deviations. They
  also work in indicator alerts.
  Entries and exits fill at the next candle's open, with an optional stop-loss
  and take-profit. **Direction** switches to short: entries sell at the next
  open, the stop-loss sits above the entry and the take-profit below, a trade
  gains when the price falls, and the chart marks and trade list show sells
  then buys. Buy and hold stays long. Set an **Entry stop price** such as `or_high(15)` to buy
  where a bar trades up through that level instead (at the open if it gaps
  above); the entry condition then only arms the order. The **ORB example**
  link fills in a 15-minute opening range breakout. A stop-loss can trigger on
  the entry bar, since the order of prices inside one candle is unknown. The report lists
  each trade with win rate, total return, max drawdown, average trade, profit
  factor, an annualized Sharpe ratio (per-bar equity returns, no risk-free
  rate) and a buy-and-hold comparison, draws an equity curve with a drawdown
  strip and a hover readout, and marks trades on the chart. The **Parameter
  sweep** runs the rules across a from/to/step grid of one or two numbers in
  the rules (indicator periods, thresholds, stop-loss, take-profit), up to 400
  runs, into a table you can sort by return, profit factor, Sharpe, drawdown,
  win rate or trades, plus a heatmap for two parameters; click a row or cell to
  apply those values.

### Views

The stock overview on the left can be resized: drag its right edge (or focus
it and press ← or →); the width is remembered. Hide or show it with the
button left of the back arrow, or `\`.

The Watchlist, Analysts, Earnings, Stats, Market, Events,
Options and News open in a column to the right of the chart, so the chart
stays on screen. Drag the border between them (or focus it and press ← or →)
to resize the column; the width is remembered. Turn **Dock** off in the
toolbar to give those views the full width instead, which is also what
happens when the window is narrower than 860 pixels. Click a tab again, or a
range, to close its panel. Zoom on the chart resets when a panel opens or
closes. Technicals, Paper trading and Strategy keep their own layout with the
chart on top.
Views fade in, the watchlist slides up, Settings scales open and switching
line / candles fades the chart. Text boxes across the app share the look of the symbol search box, and dropdowns share the look of the calendar's country menu. With the OS reduced-motion setting on, all of
it is instant.

- **Technicals:** click **Analyze** to run RSI, moving averages, candlestick
  and chart patterns and volatility/Fibonacci targets on the candles of the
  selected range, on your machine (same candles, same result). You get a score from
  −100 to +100 with a bias and confidence, upside and downside targets for the
  next 10 bars, an invalidation level and the signals behind the score.
  Checkboxes toggle moving averages, Bollinger bands, VWAP, the opening range,
  key levels, the volume average, the volume profile, Fibonacci levels, targets, pattern markers (hover one for what it means), chart patterns, RSI and MACD panes.
  **Chart patterns** are found from swing highs and lows in the analyzed
  candles: head and shoulders and its inverse, double and triple tops and
  bottoms, ascending, descending and symmetrical triangles, bull and bear
  flags, and rising and falling wedges. Each is drawn through its swing
  points with its neckline or trendlines and a label (a `?` means the
  breakout has not happened yet); hover it for what it means. The Technicals
  panel lists them with a quality score; click one to bring it into view.
  Indicator settings let you edit
  lengths, colors (or reset to the theme), and individual line visibility, with
  up to eight SMA and eight EMA lines. MACD defaults to 12/26/9 and starts hidden.
  Settings and up to 50 named presets persist across launches; saving an existing
  name replaces that preset. Display settings never change the score, signals,
  or targets, which retain their fixed indicator lengths.
  Analysis refreshes when new candles arrive. Enable **Auto analyze** (in
  Indicator settings or Settings > Chart > Technical analysis) to also run it
  at startup and after symbol, range or interval changes, without pressing
  Analyze; otherwise those changes clear the results until you click Analyze
  again. Auto analyze only runs the local analysis, never the AI, and in
  replay and practice it sees only the revealed candles. The same Settings
  section picks what the chart shows afterwards (the overlay checkboxes) and
  which chart patterns to detect. Overlay
  visibility is preserved. VWAP resets each day on intraday charts and is
  anchored to the first candle on daily and longer intervals. Short histories
  show warm-up estimates and reduced confidence. Computed locally; not
  investment advice.
  Once analyzed, the overlays and RSI / MACD panes stay on the chart after you
  close the Technicals tab, including in Paper trading and Strategy. Press `Z`
  there to analyze or re-analyze without opening the tab.
  Drag the border above the Technicals panel, or focus it and press ↑ or ↓, to
  resize the panel; double-click the border to reset it. The height is
  remembered.
  **Volume average** draws a moving average of volume (20 bars by default) over
  the volume bars, and the Indicators list shows **Relative volume**: the
  latest bar's volume divided by the average of the 20 bars before it. The
  latest bar is still forming on a live chart, so its relative volume reads low
  until the bar closes.
  **VWAP bands** (Bands σ in Indicator settings, 0 to 5, off at 0) draw lines
  that many volume-weighted standard deviations above and below VWAP.
  **Volume profile** (off by default) shows volume by price for the candles on
  screen as bars along the right edge, with the busiest price band darker. A
  solid line marks the point of control (the price band with the most volume)
  and dashed lines mark the value area high and low, the band around the point
  of control that holds 70% of the volume; bars inside the value area are
  darker, and the levels show in the legend. Set **Value area %** (50 to 95) or
  turn off **Show POC and value area** under Indicator settings. The
  Indicators list also shows **ADX 14** next to the existing ATR 14.
  With the opening range or key levels computed, an **Alert when price crosses**
  row offers one-click price alerts at the opening range high and low, PDH, PDL,
  PMH and PML (regular session only, firing once).
  **Opening range** (off by default, intraday charts only) draws the high, low
  and midpoint of the first minutes of each regular session, 15 by default and
  1 to 240 in Indicator settings. The lines grow while the range forms and then
  hold for the rest of the day. **Extension** adds target lines that many range
  heights above the high and below the low; 0 hides them. The area between
  the high and low is shaded as a box.
  **Key levels** (off by default, intraday charts only) draws the prior day's
  regular-session high and low (PDH, PDL) and today's premarket high and low
  (PMH, PML), each labeled with its price. Premarket levels need extended
  hours shown on the chart. On a 1D chart the prior day comes from one extra
  daily-candle request per analysis.

  Two more volume profiles sit beside the visible-range one. **Session volume
  profile**, in Studies, draws one profile per day on intraday charts (per
  month on daily charts, per year on longer ones), growing from the start of
  each session. **Volume profile (range)**, in the drawing toolbar's More
  menu, is a two-click drawing that profiles the candles between its two ends
  and is saved with the symbol like any other drawing. Both draw the point of
  control and value area across their own span, with the same settings.
  **Studies** at the bottom of the Technicals tab add Stochastic, OBV, CCI,
  Williams %R, MFI, Stoch RSI, Aroon (up and down), CMF and ROC in their own
  panes, and Ichimoku, Supertrend, Keltner channels, Donchian channels,
  Parabolic SAR (dots), pivot points (P, R1, R2, S1, S2), WMA, Hull MA, VWMA,
  ZigZag and a linear regression channel over the price. They are drawn on
  both charts without running Analyze, follow replay, and do not feed the
  score. Their parameters (defaults: Stochastic 14/3/3, Ichimoku 9/26/52 with
  a 26-bar displacement, Supertrend 10/3, Keltner 20/10/2, Donchian 20, CCI
  20, Williams %R 14, MFI 14, SAR 0.02/0.2, WMA, Hull MA and VWMA 20, ZigZag
  5%, linear regression 100 bars with bands 2 standard deviations out, Stoch
  RSI 14/14/3/3, Aroon 25, CMF 20, ROC 9) and the pivot type (classic,
  Fibonacci, Camarilla or Woodie) are set under Indicator settings. ZigZag
  joins swing highs and lows that reversed by at least the set percent; only
  its last leg moves as new bars arrive, so confirmed swings stay put in
  replay. The regression channel covers the latest bars only.
  RSI study and MACD study are RSI and MACD panes of their own, separate from
  the Analyze panes. Under Indicator settings, **Add** next to a study puts
  another copy of it on the chart (for example two RSIs with different
  lengths), each with its own settings, pane or line, legend entry and
  **Remove** button; a study pane can also be removed with the x in its
  header. Each copy has a **Timeframe**: Chart, or a longer interval such as
  60m, 1d or 1wk built from the chart's own bars and drawn as steps. A bar
  only sees the longer bar formed up to and including it, so replay never
  shows a value from later bars. ZigZag, the regression channel and Ichimoku
  always use the chart's bars. Pivots come from the previous day on intraday
  charts, the previous month on daily charts and the previous year on longer
  ones. The Ichimoku cloud is projected by the displacement past the latest bar
  into the empty space on the right, and the lagging line sits that far back.
  Which studies are on and their settings are remembered on this computer and
  are in Backup, but not in indicator presets.

- **Analysts:** the rating (Strong buy to Sell), average 12-month target and
  its upside also sit under the price on the left. The tab adds the target
  range against the current price and the count of each rating. Cached for 12
  hours; ETFs, indices and crypto have no coverage.
- **Earnings:** the next report date (confirmed or estimated) with EPS and
  revenue estimates, and the last four quarters with estimate, actual and
  surprise % (green beat, red miss).
- **Stats:** key statistics in Valuation, Trading, Dividends & splits, Shares
  & short interest, Profitability and Financials. ETFs get a Fund section and
  crypto a Crypto section. Changes, growth and returns are green or red.
- **Financials** (below the statistics in Stats): revenue, net income, free cash flow and gross, operating and
  net margins over the reported periods, with an Annual / Quarterly toggle, two
  small trend charts and a table. Margins are computed from revenue, and
  figures Yahoo does not report show as —. Cached for 12 hours; ETFs, indices
  and crypto have no statements.
- **News feed:** choose Watchlist or a named group in News to combine headlines,
  deduplicate stories and filter by ticker, publisher and topic.
- **News:** the 20 latest headlines, newest first, with publisher, time and a
  Positive / Negative / Neutral pill. The sentiment is guessed on your machine
  from the headline's words, so take it as a hint. Click one to open it in
  your browser.
- **Market:** the S&P 500, Nasdaq, Dow, Russell 2000 and VIX; the 10-year
  yield, crude oil, gold, the dollar index and Bitcoin; the 11 S&P sector ETFs
  by day change; and hotlists of up to 25 names (gainers, losers, most active, gap up, gap down, 52-week highs and lows; the gap and 52-week lists rank within Yahoo's top gainers, losers and most-active names); a Heatmap switch shows S&P 500 stocks as tiles grouped by sector, sized by market cap and colored by day change. Click a row or tile to chart
  it.
- **Options:** the option chain for the current symbol, calls or puts one
  side at a time, for any expiry (type a YYYY-MM-DD date or pick from the
  list). Strikes sit above or below the current price, in-the-money rows are
  tagged, and each row shows last, bid/ask, change, volume, open interest,
  implied volatility and last trade time.
  Add legs from the chain to build a strategy (presets include spreads,
  straddles and iron condors) and see its expiration payoff, break-evens and
  max profit and loss.

### Watchlist

Click the star next to the ticker to add or remove it. The star in the bottom
bar shows starred stocks as cards with price and percent move for the current
session, including pre-market or after-hours when available. Sort by change,
price or volume, or switch to a heatmap whose tiles are colored by day change
and sized by the magnitude of the move.

**Screen** filters the watchlist into a table. Add any number of conditions
with **Add filter…**; a stock must match all of them. Each picks a field, a
condition (above, below or between a range) and a value; **Sector** uses
**is** or **is any of**. Fields are price, volume, relative volume, gap and daily
change; performance over 1W, 1M, 3M, 6M, YTD and 1Y, distance from the 52-week
high and low, and ATR %; RSI, price versus SMA 20/50/200 and the MACD
histogram; and market cap, P/E, EPS, dividend yield, revenue growth, profit
margin, beta and sector. Technical and performance fields come from the daily
bars of the past year. Fundamentals come from Yahoo and are fetched only while a
fundamentals column or condition is in use, then cached for six hours. Rows with a
missing value never match a condition. **Columns** chooses what the results show
(kept between sessions), and clicking a header sorts by it, with missing values
last. Type a name and click **Save** to keep a filter; saved filters appear as
buttons above the conditions.

**Groups** split the watchlist into tabs such as "Tech" or "Crypto"; **All**
always shows every starred stock. Click **+** and type a name to add a group.
In a group tab, **Edit** shows every starred stock: click cards to add or
remove them, rename the group, or **Delete** it. Unstarring a stock removes it
from every group. Press `G` to cycle through All and each group (opening the
Watchlist if it is closed).

**Table** shows the watchlist as rows with price and change, plus optional
columns you switch on: analysis **Score**, **RSI** (14), **days to earnings**
and **IV rank**. IV rank is an estimate: the at-the-money implied volatility
placed within the past year's range of 30-day realized volatility, since Yahoo
has no implied-volatility history. Column data is only fetched while the column
is on.

### Price alerts

Click the bell next to the star in the stock overview (or press `P`) to open
**Alerts** over the window, like Settings; Escape or a click outside closes
it. Use it to add an alert for the selected symbol. Pick a kind: **Price** (at or above or below a level, in the trading
currency), **Day move %** (up or down X% from yesterday's close), **Move since
armed %** (up or down X% from the price when armed), **Trailing %** or
**Trailing amount** (falls by that much from the high since arming, or rises
from the low). The list includes alerts for every symbol. **Pause**, **Rearm**
and **Delete** manage them, **Edit** changes an alert's direction and level, and
**Duplicate** copies it. Click an alert's ticker to open its chart, and filter
the list by All, Armed, Triggered or Paused. Triggered alerts show the trigger
price and time. By default an alert fires once and then shows
**Triggered**; tick **Recurring** to keep it armed, with a cooldown in minutes
(default 15) during which it stays quiet. A recurring alert needs a fresh
crossing to fire again. **Regular session only** ignores extended-hours
prices and checks nothing outside the regular session.

**Indicator and drawing alerts** sit under the price alerts. Pick a preset or
type a condition in the Strategy syntax, such as
`crosses_above(rsi(14), 70)` or `crosses_below(sma(20), sma(50))`, or choose a
trendline or ray drawn on the symbol and whether the close should cross above
or below it. Each alert belongs to the symbol and candle interval on screen
when it was added. These alerts are checked each time the chart refreshes
while that symbol and interval are on the main chart. Turn on **Check
indicator and drawing alerts in the background** (Settings, Chart, off by
default) to check every symbol and interval that has an armed alert for as
long as tickr runs, even while the window is hidden in the tray or shows
another symbol. Each symbol and interval is downloaded about once per bar,
at most every 15 minutes and at least a minute apart (1m every minute, 5m
every 5 minutes, 15m and longer every 15 minutes; a custom interval follows
the interval it is built from), using regular-session candles. With it on, minimizing or closing the window hides it instead of
unloading it, and the window loads hidden at startup when tickr starts in
the tray, so expect the memory of an open window. Each alert in the list
says whether it is checked in the background or only on screen. They fire
once with a desktop notification, then show **Triggered** until you **Rearm**
them. A line alert keeps the line as it was when the alert was added, so
moving the drawing later does not move the alert. They are saved on this
computer and are included in Backup.

With an Alpaca stream connected, alerts on the symbol on screen are also
checked on each streamed trade, about four times a second.
Armed symbols are checked about every 15 seconds while tickr is running,
including with the window closed and when viewing a different stock. The
first successful price after arming or restarting establishes a baseline;
the next crossing sends a native desktop notification. Move-since-armed and
trailing alerts take their reference price from the first price after arming
and save it, so a trailing stop breached while tickr was closed fires on the
first price after restart. Extended-hours prices are used when available.
Alerts and their triggered state are saved across restarts. Allow tickr
notifications in your OS settings; on Windows, use an
installed build for notifications. Quotes can be delayed and crossings between
polls can be missed.

### Settings and keybinds

The gear at the bottom left opens Settings. A menu on the left switches between
Display, Hotkeys, Chart, Market data, AI, Backup and Connections. The window
keeps one size: a section longer than it scrolls inside, sections slide in as
you switch, and the Hotkeys categories fold open and shut (click Hotkeys again
to fold them). The search box beside the Settings title suggests settings as
you type (or the first few when empty); pick one with the mouse or ↑ ↓ and
Enter to open its section, scroll to it and flash it. Hotkeys holds
the global hotkey (click the field and press a new combination; **Reset**
restores the default) and the in-window keybinds; Chart holds the session
shading and chart dot toggles, the R:R reward multiple and **Technical
analysis** (Auto analyze, the chart overlays and which chart patterns to
detect). Esc or a click outside closes it.

Keybinds are grouped by category. Click a keybind and press a new key to rebind it (an action already on that
key takes the old one), or Backspace to unbind it. Keybinds are ignored while
typing in a text field.

| Category | Key | Action |
| --- | --- | --- |
| Chart | `C` | Cycle chart type |
| | `L` | Cycle price scale (Lin, Log, %) |
| | `I` | Cycle candle length (Auto, then the lengths the range allows, including presets and remembered custom lengths) |
| | `1` | Draw level (press again for Cursor) |
| | `2` | Draw trendline |
| | `3` | Draw text |
| | `4` | Ruler |
| | `5` | Pen |
| | `[` | Draw box |
| | `]` | Draw ray |
| | `;` | Draw Fibonacci retracement |
| | `'` | Draw long / short position |
| | `/` | Anchored VWAP |
| | `` ` `` | Pin a note |
| | `J` | Toggle second chart |
| | `=` | Open in new window |
| | `Y` | Toggle bar replay |
| | `H` | Open Paper trading |
| | `Q` | Start random practice |
| | `V` | Cycle date range |
| | `R` | Refresh |
| Indicators | `6` | Toggle opening range |
| | `7` | Toggle key levels |
| | `8` | Toggle volume average |
| | `9` | Toggle volume profile |
| Panels | `T` | Open Technicals |
| | `Z` | Analyze / re-analyze |
| | `A` | Open Analysts |
| | `E` | Open Earnings |
| | `P` | Toggle Alerts |
| | `M` | Open Market |
| | `K` | Open Events |
| | `N` | Open News |
| | `O` | Open Options |
| | `.` | Open Strategy backtest |
| Options | `U` | Switch calls / puts |
| | `D` | Next expiry date (wraps around) |
| Watchlist | `W` | Toggle Watchlist |
| | `X` | Next watchlist stock |
| | `G` | Next watchlist group (opens the Watchlist) |
| | `F` | Add stock to Watchlist |
| General | `S` | Focus search |
| | `B` | Previous symbol (toggles between two) |
| | `,` | Toggle Settings |
| | `\` | Toggle stock overview |
| Fixed | `Alt+←` | Back to the previous symbol in history |
| | `Alt+→` | Forward in history |

**Backup** exports your settings, watchlists, groups, drawings, alerts, saved
screens, keybinds, indicator presets, indicator alerts, study toggles, theme
colors and fonts, drawing default styles and templates, and the magnet, hide-drawings and Indicator settings toggles to a JSON file, and **Import** restores
one after checking it (older backups without those parts leave them as they are). API keys stay in `.env` and are never exported; the data
provider, window position and start-at-login setting are kept on import.

### AI news analysis

Headline tone (the dots on the chart and the News view) comes from a local
keyword lexicon by default. Optionally, Settings > AI > News analysis sends new
headlines to any OpenAI-compatible chat-completions endpoint (OpenAI, Ollama,
LM Studio, ...) to classify them as positive, neutral or negative. Fill in the
base URL (for example `https://api.openai.com/v1`), the model and, if the
endpoint needs one, the API key. The key may stay empty for local endpoints. A saved key is never sent back to
the page: the field shows "Key saved", leaving it blank keeps the key, and Clear
removes it. **Test connection** saves the settings and checks each configured model.

Model is the master model. To use a different one for a feature, fill in News
model (headline tone) or Events model (event analysis); a blank field uses
Model.

These are saved to `.env.local` in the settings folder (see [Files](#files)),
not to `settings.json`, as `TICKR_AI_BASE_URL`, `TICKR_AI_MODEL`,
`TICKR_AI_NEWS_MODEL`, `TICKR_AI_EVENTS_MODEL` and `TICKR_AI_API_KEY`; other
lines in that file are left alone. Results are cached
per model and headline in the cache folder, so each headline is sent once. If
AI is off, not configured or a call fails, the keyword tone is used.
News labels each tone **AI** or **Keyword**; hover for the model and generation time.

Settings > Connections shows quote, news and AI status, last successes and
readable errors, with a Retry action for each service. **Copy diagnostics**
copies app and OS versions and connection details with credentials redacted.

### Market events

The Events panel (header button or `K`) has three tabs.

**Economic** lists seven days of releases from Yahoo's economic calendar,
grouped by day, each with its local release time and, where Yahoo has them, the
actual, expected and prior figures. It starts with the next 7 days; the arrows
step a week back or forward (up to about a year either way) and **Today**
returns. The country menu picks which countries to show (US by default, or all)
and **High / Medium+ / All** limits the list by importance. Yahoo does not rate
importance, so each release gets a high, medium or low rating (three bars) from a
curated table of release names, one level lower for non-US releases. It is a
rough guide. Both choices are saved in
settings. The list needs no AI and is refreshed every 15 minutes or with the
Refresh button.

**Watchlist** merges the upcoming earnings dates and ex-dividend dates of your
starred symbols into one list by day, with an All / Earnings / Ex-dividend
toggle. Click a row to open that symbol. Estimated earnings dates are marked and
the EPS estimate is shown when Yahoo has one. Dates are cached for 6 hours and
fetched three symbols at a time; ETFs, indices and crypto have none.

**Calendar** combines both: your watchlist's earnings and ex-dividend dates
next to the macro releases, grouped by day, with the same week arrows and the
saved country and importance filters applied to the macro rows.

Clicking an event asks the AI configured in Settings, as above, using the
Events model or else Model, to analyze that
one release: a summary and the affected stocks and sectors, each with a score,
confidence and reasoning. Only the opened event is sent, along with its figures
and a few current Yahoo headlines about it. Analyses are cached for 6 hours per
model, and a new one is made once the actual figure is out. Details show the model
and generation time; **Regenerate** requests a fresh analysis for that event.

## Screenshots

The demo and screenshots use sample data. Click an image to view it at full
size.

| | |
| :---: | :---: |
| [![Five-year and one-year AAPL charts with linked crosshairs](assets/screenshots/split-charts.png)](assets/screenshots/split-charts.png)<br>**Linked charts** let you inspect the same date in two date ranges. | [![Historical AAPL chart with bar replay controls](assets/screenshots/bar-replay.png)](assets/screenshots/bar-replay.png)<br>**Bar replay** reveals candles at your pace. |
| [![Replay chart with a buy fill and the simulated position panel](assets/screenshots/paper-trading.png)](assets/screenshots/paper-trading.png)<br>**Paper trading** shows the filled order and open position. | [![Historical practice result with return, bars held and a Skip comparison](assets/screenshots/historical-practice.png)](assets/screenshots/historical-practice.png)<br>**Historical practice** shows how a trade performed against skipping. |
| [![AAPL candle chart with an OHLC tooltip and event markers](assets/screenshots/chart.png)](assets/screenshots/chart.png)<br>**Chart** shows candle details and lets you copy a PNG or CSV. | [![AAPL chart with indicator overlays, RSI and a technical analysis score](assets/screenshots/technicals.webp)](assets/screenshots/technicals.webp)<br>**Technicals** computes signals and targets from the chart's candles. |
| [![Market overview with indices, macro quotes, sectors and movers](assets/screenshots/market.png)](assets/screenshots/market.png)<br>**Market** groups indices, sectors and daily movers. | [![Stock watchlist with session prices and named groups](assets/screenshots/watchlist.png)](assets/screenshots/watchlist.png)<br>**Watchlist** keeps prices and session moves for starred symbols together. |
| [![Bar replay with a daily chart and a weekly second chart stopped at the same date](assets/screenshots/multi-timeframe-replay.png)](assets/screenshots/multi-timeframe-replay.png)<br>**Multi-timeframe replay** keeps the second chart on the replay moment at its own interval. | [![Practice view with saved runs, a stats card, breakdowns by symbol and tag, and a trade history](assets/screenshots/practice-stats.png)](assets/screenshots/practice-stats.png)<br>**Practice stats** summarize saved runs and list each trade with its tags and note. |
| [![Name the pattern quiz with four choices and the explanation of the correct answer](assets/screenshots/pattern-trainer.png)](assets/screenshots/pattern-trainer.png)<br>**Pattern trainer** asks you to name the highlighted candles, then explains the answer. | [![Chart with a double top and a falling wedge drawn on it and listed in Technicals](assets/screenshots/chart-patterns.png)](assets/screenshots/chart-patterns.png)<br>**Chart patterns** are drawn on the chart and listed in Technicals with a quality score. |
| [![Strategy backtest with trade markers, an equity curve with drawdown and a parameter sweep heatmap](assets/screenshots/backtest-report.png)](assets/screenshots/backtest-report.png)<br>**Backtest report** charts equity and drawdown and sweeps two parameters into a heatmap. | [![Chart with Keltner channels, Parabolic SAR dots and a CCI pane](assets/screenshots/studies.png)](assets/screenshots/studies.png)<br>**Studies** add channels, Parabolic SAR and oscillator panes without running Analyze. |
| [![Watchlist screener with three conditions and a results table sorted by one-month performance](assets/screenshots/screener.png)](assets/screenshots/screener.png)<br>**Screener** filters the watchlist by conditions you build and shows the columns you pick. | [![Point and Figure chart with X and O columns and a column tooltip](assets/screenshots/point-and-figure.png)](assets/screenshots/point-and-figure.png)<br>**Chart types** include Point & Figure, Kagi, Line break and Range bars. |
| [![Chart with an Elliott impulse, an XABCD pattern and a callout, and the Objects list open](assets/screenshots/drawing-objects.png)](assets/screenshots/drawing-objects.png)<br>**Objects** lists every drawing so you can hide, lock, rename or delete it. | |

## Data

Quotes, charts, news and fundamentals come from Yahoo Finance's public chart,
search and quoteSummary endpoints. They are not an official API and can change
or rate-limit without notice, and quotes may be delayed. Logos come from
[Elbstream](https://elbstream.com/logos)'s logo API (formerly Parqet); the
**Logos by Elbstream** link in the footer is the attribution its free tier
requires. Analysis and sentiment run on your machine. Not investment advice.

## Files

| What | Windows | macOS |
| --- | --- | --- |
| Settings | `%APPDATA%\tickr\settings.json` | `~/Library/Application Support/tickr/` |
| AI credentials | `%APPDATA%\tickr\.env.local` | `~/Library/Application Support/tickr/` |
| Intraday candle history | `%APPDATA%\tickr\bars\` | `~/Library/Application Support/tickr/bars/` |
| Logo, AI tone and event analysis cache | `%LOCALAPPDATA%\tickr\` | `~/Library/Caches/tickr/` |
| Logs | `%LOCALAPPDATA%\dev.tickr.desktop\logs\tickr.log` | `~/Library/Logs/dev.tickr.desktop/` |

Logs rotate at 1 MB and keep two old files. Attach `tickr.log` to bug reports.

The candle history keeps the newest 20,000 candles per symbol, interval and
source (custom intervals store the native candles they are built from), for at most 40 series; the least recently updated series is dropped
first. A stock split restarts that symbol's history. Settings > Market data >
Clear cached history deletes it.

Uninstalling on Windows removes the launch-at-login entry. Check "Delete the
application data" in the uninstaller to also remove settings, the logo cache,
logs and WebView data.

## Development

### Build

Requirements: Rust 1.85+, Node 20+, and the
[Tauri 2 prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev          # dev build with hot reload
npx tauri build            # installer (NSIS on Windows, .app and .dmg on macOS)
```

`npx tauri build` also signs the updater bundles, which needs the private key
(see [Updater key](#updater-key)). Without it, skip the updater artifacts:

```bash
npx tauri build -c '{"bundle":{"createUpdaterArtifacts":false}}'
```

The Windows installer installs per user (no UAC prompt), in English. On
macOS, `src-tauri/Info.plist` sets `LSUIElement` so tickr never shows a Dock
icon; the minimum version is macOS 10.15.

### Releasing

Releases are built by GitHub Actions. Bump the version in `package.json`,
`src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, add a `CHANGELOG.md`
entry, then push a tag:

```bash
git tag v0.11.77
git push origin v0.11.77
```

`.github/workflows/release.yml` builds the Windows NSIS installer and a
universal macOS `.app`/`.dmg` with `tauri-apps/tauri-action`, and attaches them
to a **draft** release for that tag, along with the signed updater bundles and
`latest.json`. Failed asset uploads are retried twice. A last job checks that
`latest.json` lists Windows and both macOS architectures; if it fails, re-run
the failed jobs from the Actions tab, which re-uploads into the same draft. Once that check passes the workflow publishes the
release and marks it latest. Installed copies only see it once it is published and marked
latest (not a pre-release), because the updater reads
`releases/latest/download/latest.json`.

You rarely need to push the tag yourself: when CI passes on `main` and the
version in `package.json` has no tag yet, CI creates the tag and starts the
Release workflow, so merging a version bump publishes it.

#### Updater key

Updates are signed with a minisign key pair, separate from code signing and
free. The public key is `plugins.updater.pubkey` in
`src-tauri/tauri.conf.json`. The private key stays off the repo, in
`~/.tauri/tickr.key`, and CI reads it from the `TAURI_SIGNING_PRIVATE_KEY`
repository secret. Set it to the file's contents, unchanged (one base64 line):

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/tickr.key
```

The key has no password, so leave `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` unset.
If the secret is missing or mangled, tauri fails at the end of the build with
"Missing comment in secret key"; the release workflow checks the secret first
and fails right away instead.

Back the key up somewhere safe. If it is lost, installed copies reject every
future update and users have to reinstall by hand. A local `npx tauri build`
needs the same two variables, or it fails at the updater signing step.

`.github/workflows/ci.yml` runs `npm run check`, `npm test`,
`cargo clippy -- -D warnings` and `cargo test` (Windows and macOS) on every
push to `main` and every pull request.

#### Code signing

Releases are not code-signed yet (see [First launch](#first-launch)). macOS
builds are ad-hoc signed (`bundle.macOS.signingIdentity: "-"`), so Gatekeeper
reports an unidentified developer rather than a damaged app. Signing needs
certificates, so it is set up through environment variables at build time
rather than in the repo.

**macOS** needs a Developer ID Application certificate in the keychain and an
Apple ID app-specific password (or an App Store Connect API key) for
notarization. Remove `"signingIdentity": "-"` from `tauri.conf.json` first;
`tauri build` signs, notarizes and staples when these are set:

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

### Tests

```bash
cd src-tauri && cargo test # technical analysis (indicators, patterns, Fibonacci, scoring), quote, analyst, earnings, rating change, stats, financials, market and news parsing, headline sentiment, sessions, tray tooltip and title, icon compositing, settings, watchlist symbols and groups, economic calendar and watchlist dates, update menu labels
cd src-tauri && cargo test -- --ignored live   # analyst, market, financials, economic calendar and watchlist date fetches against Yahoo (network)
npm test                   # formatters, watchlist sort, calendar filters and dates, hotkey recording and display, keybinds
npm run check              # svelte-check
```

### Layout

```
src-tauri/src/
  quote.rs      Yahoo chart/search: fetch, parse, market session, extended-hours price
  analysis/     local technical analysis: indicators (RSI, SMA/EMA, ATR, σ), patterns, Fibonacci swing, score and targets
  analyst.rs    Yahoo quoteSummary: cookie/crumb session, consensus and price targets, 12 h cache
  earnings.rs   Yahoo quoteSummary: past EPS reports and next report date
  events.rs     Yahoo economic calendar: any week, all countries, paged; AI analysis of one event on demand, 6 h cache
  calendar.rs   Yahoo quoteSummary calendarEvents: earnings and ex-dividend dates per watchlist symbol, 6 h cache
  grades.rs     Yahoo quoteSummary: analyst upgrades, downgrades and initiations
  stats.rs      Yahoo quoteSummary: key statistics in labeled sections
  financials.rs Yahoo fundamentals-timeseries: annual and quarterly revenue, net income, gross and operating profit, free cash flow, 12 h cache
  market.rs     Yahoo batch quotes and screeners: indices, macro, sectors, top movers
  news.rs       Yahoo search news: 20 latest headlines, newest first, web links only
  sentiment.rs  headline tone (positive, negative, neutral) from a financial keyword list
  poller.rs     Balanced/Low-power refresh, alert cadence, system wake and network recovery
  tray.rs       tooltip text, macOS menu bar title, and the right-click menu
  trayicon.rs   icon (32 px, 36 px on macOS): logo in a rounded square plus a direction badge
  logo.rs       Elbstream logo fetch with a disk cache
  window.rs     create, OS theme background, reveal after first paint, unload on minimize, geometry
  hotkey.rs     global shortcut register/swap with rollback
  commands.rs   window commands and the injected first-frame payload
  settings.rs   JSON settings in the OS config dir
  autostart.rs  launch at login: restores the Run entry after upgrades
  updater.rs    background update checks, tray menu state, install and restart
src-tauri/windows/hooks.nsh   NSIS uninstall hook: autostart entry and app data
.github/workflows/  ci.yml (checks on push/PR), release.yml (installers, updater bundles and latest.json on tag push)
ui/src/         App, Left (ticker and details), Chart (canvas, analysis overlays), Technicals, Analysts, Earnings, Stats, Market, Events, WatchCalendar, News, Watchlist, Search, Settings, Footer
```

### Memory (Windows 11, release build)

| State | Processes | Private |
| --- | --- | --- |
| Window open | 7 | 132 MB |
| Window unloaded (tray only) | 1 | 7 MB |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports should include
`tickr.log`, your OS and the tickr version.

## Market data

Yahoo is the default; no provider configuration is required. To use Alpaca, open Settings > Market data, choose Alpaca, select a feed, enter your key ID and secret, then Save and Test connection. Blank key fields keep saved credentials. Clear keys removes them and switches back to Yahoo.

Free Alpaca keys provide real-time IEX trades for US stocks. IEX covers one exchange; the paid SIP feed provides consolidated US market data and requires the appropriate subscription. Only symbols of one to five uppercase letters use Alpaca. Indices, crypto, foreign listings and symbols such as BRK-B continue to use Yahoo. Yahoo also supplies company metadata, sessions, corporate actions and quote volume. Alpaca supplies prices for the selected stock, the watchlist and alerts, chart candles, and older intraday candles when you scroll the chart back (split-adjusted, from your selected feed), with automatic Yahoo fallback on failure. The footer shows the actual quote source and stream status.

Watchlist and alert prices take one Alpaca snapshot request per refresh for all their stocks, since free Alpaca keys allow 200 requests per minute. The stream subscribes only to the selected stock, using one connection (the free plan allows one connection and 30 symbols). Polling continues as a backstop. Authentication, connection-limit and subscription errors pause stream retries until the symbol or provider configuration changes.

Keys are stored in `.env.local` in tickr's OS configuration directory, alongside the AI configuration, and are never returned to the page. `settings.json` stores only the provider and feed. Changing market data settings reloads the chart.

## License

MIT. Company logos are provided by [Elbstream](https://elbstream.com/logos).
