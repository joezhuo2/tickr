<script lang="ts">
  import { applyCustom, loadCustom } from "./lib/display";
  import * as Scrollback from "./lib/scrollback";
  import * as ChartAlertRules from "./lib/chartAlerts";
  import { chartAlerts, setChartAlerts } from "./lib/chartAlertStore.svelte";
  import { CHART_MODES, nextMode } from "./lib/charttypes";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { onMount, tick, untrack } from "svelte";
  import Analysts from "./Analysts.svelte";
  import Alerts from "./Alerts.svelte";
  import ChartView from "./Chart.svelte";
  import ChartSkeleton from "./ChartSkeleton.svelte";
  import EarningsView from "./Earnings.svelte";
  import EventsView from "./Events.svelte";
  import FinancialsView from "./Financials.svelte";
  import Footer from "./Footer.svelte";
  import MarketView from "./Market.svelte";
  import OptionsView from "./Options.svelte";
  import StatsView from "./Stats.svelte";
  import Left from "./Left.svelte";
  import News from "./News.svelte";
  import Search from "./Search.svelte";
  import SecondChart from "./SecondChart.svelte";
  import Settings from "./Settings.svelte";
  import Technicals from "./Technicals.svelte";
  import Watchlist from "./Watchlist.svelte";
  import {
    RANGES,
    INTERVAL_LABELS,
    intervalsFor,
    nextInterval,
    validInterval,
    type DataProvider,
    type StreamStatus,
    type Analysis,
    type Article,
    type Candle,
    type FeedArticle,
    type Chart,
    type ChartMode,
    type RefreshMode,
    type ChartScale,
    type ChartTimeZone,
    type ChartLayout,
    type Market,
    type Options,
    type Consensus,
    type Dots,
    type Earnings,
    type EventFilter,
    type EventsReport,
    type Financials,
    type Group,
    type WatchlistSort,
    type WatchlistView,
    type WatchlistColumns,
    type SavedScreen,
    type ScreenRule,
    type Init,
    type Keybinds,
    type IndicatorConfig,
    type IndicatorPreset,
    type QuoteState,
    type PriceAlert,
    type RatingChange,
    type StatSection,
    type WatchDates,
  } from "./lib/types";
  import { actionFor, bindKey, keyLabel, nextGroupTab, overlayFor, practiceAllows, replayAllows } from "./lib/keybinds";
  import ReplayBar from "./ReplayBar.svelte";
  import * as Replay from "./lib/replay";
  import PracticeView from "./Practice.svelte";
  import * as Practice from "./lib/practice";
  import PaperView from "./Paper.svelte";
  import * as Paper from "./lib/paper";
  import BacktestView from "./Backtest.svelte";
  import { clockFor } from "./lib/strategy";
  import * as Backtest from "./lib/backtest";
  import { fullTime } from "./lib/format";
  import { overlayVisibility, shouldAnalyze, toggleOverlay } from "./lib/indicators";
  import { applyDisplay } from "./lib/display";
  import type { Theme, TextSize, Palette } from "./lib/types";
  import { refreshOutcome, type RefreshView } from "./lib/refresh";
  import { chartNote, chartSegment, chartTime, classifyChart, classifyQuote, delayLabel, localOffset, quoteNote, quoteSegment, quoteStatus, quoteTime, sourceName } from "./lib/freshness";
  import { paneIn } from "./lib/motion";
  import { displayOffset, isIntraday } from "./lib/session";
  import { emptyHistory, goBack, goForward, previous, pushRecent, visit, type History, type Move } from "./lib/history";
  import { DEFAULT_EVENT_FILTER, localDay, weekRange, type EventsTab } from "./lib/calendar";
  import { DEFAULT_WATCHLIST_COLUMNS, DEFAULT_WATCHLIST_SORT } from "./lib/watchlistSort";
  import type { TimeWindow } from "./lib/chartsync";

  // Injected before load, so the first frame already has real content.
  const reloaded = sessionStorage.getItem("tickr-reload-state") !== null;
  sessionStorage.removeItem("tickr-reload-state");
  const boot = reloaded ? null : (window.__TICKR_INIT__ ?? null);

  let dataProvider = $state<DataProvider>({ provider: "yahoo", feed: "iex", has_keys: false, stream: { kind: "off" } });
  let ready = $state(false);
  let symbol = $state("");
  let range = $state("1d");
  let interval = $state("auto");
  let drawings = $state<import("./lib/types").Init["drawings"]>({});
  let drawingBusy = $state(false);
  async function saveDrawings(symbol: string, next: import("./lib/types").Drawing[]) {
    if (drawingBusy) return false;
    drawingBusy = true;
    const previous = drawings[symbol] ?? [];
    drawings[symbol] = next;
    try {
      await invoke("set_drawings", { symbol, drawings: next });
      return true;
    } catch (error) {
      drawings[symbol] = previous;
      console.warn(error);
      return false;
    } finally { drawingBusy = false; }
  }

  let theme = $state<Theme>("system");
  let textSize = $state<TextSize>(100);
  let palette = $state<Palette>("standard");
  let displayKey = $state(0);
  let custom = $state(loadCustom());
  $effect(() => {
    applyDisplay(document.documentElement, theme, palette);
    applyCustom(document.documentElement, custom);
    void textSize;
    untrack(() => displayKey++);
  });

  let mode = $state<ChartMode>("line");
  let refreshMode = $state<RefreshMode>("balanced");
  let scale = $state<ChartScale>("linear");
  let chartExtended = $state(true);
  let shadeSessions = $state(true);
  let chartTimeZone = $state<ChartTimeZone>("exchange");
  let layout = $state<ChartLayout>({ split: false, orientation: "side", sync_range: false, symbol: "", range: "", interval: "auto" });
  let layoutWrite = Promise.resolve();
  let secondView: SecondChart | undefined = $state();
  type Pane = "main" | "second";
  let syncHover = $state.raw<{ source: Pane; t: number } | null>(null);
  let syncWindow = $state.raw<{ source: Pane; w: TimeWindow } | null>(null);
  let hotkey = $state("");
  let defaultHotkey = $state("");
  let hotkeyError = $state<string | null>(null);
  let keybinds = $state<Keybinds>() as Keybinds;
  let dots = $state<Dots>() as Dots;
  let settingsOpen = $state(false);
  let search: Search | undefined = $state();
  let qs = $state<QuoteState>({ quote: null, error: null, updated_at: 0 });
  let chart = $state<Chart | null>(null);
  let chartError = $state<string | null>(null);
  let loading = $state(false);
  // undefined while loading (skeleton), null when there is no logo.
  let logo = $state<string | null | undefined>(undefined);
  // undefined while loading, null when there is no coverage (or it failed).
  let analyst = $state<Consensus | null | undefined>(undefined);
  let earnings = $state<Earnings | null | undefined>(undefined);
  let ratingChanges = $state<RatingChange[]>([]);
  let stats = $state<StatSection[] | null | undefined>(undefined);
  let financials = $state<Financials | null | undefined>(undefined);
  let financialsError = $state<string | null>(null);
  let financialsSym = "";
  let financialsSeq = 0;
  let market = $state<Market | undefined>(undefined);
  let marketError = $state<string | null>(null);
  let marketLoading = $state(false);
  let events = $state<EventsReport | undefined>(undefined);
  let eventsError = $state<string | null>(null);
  let eventsLoading = $state(false);
  let eventsSeq = 0;
  let eventsTab = $state<EventsTab>("economic");
  let eventsWeek = $state(0);
  const eventsCache = new Map<string, EventsReport>();
  let eventFilter = $state<EventFilter>(DEFAULT_EVENT_FILTER);
  let savedEventFilter = DEFAULT_EVENT_FILTER;
  let eventFilterWrite = Promise.resolve();
  let watchCal = $state<WatchDates[] | undefined>(undefined);
  let watchCalError = $state<string | null>(null);
  let watchCalLoading = $state(false);
  let watchCalAt = $state(0);
  let watchCalSeq = 0;
  let options = $state<Options | undefined>(undefined);
  let optionsError = $state<string | null>(null);
  let optionsLoading = $state(false);
  let optionsSeq = 0;
  let optionsSide = $state<"calls" | "puts">("calls");
  let view = $state<RefreshView>("chart");
  let analysis = $state<Analysis | null>(null);
  /** cacheKey() the analysis belongs to. */
  let analysisKey = $state("");
  let analyzing = $state(false);
  let analysisError = $state<string | null>(null);
  let indicators = $state<IndicatorConfig>();
  let indicatorPresets = $state<IndicatorPreset[]>([]);
  const overlays = $derived(indicators ? overlayVisibility(indicators) : null);
  let analysisSeq = 0;
  // undefined while loading with nothing cached for the symbol.
  let news = $state<Article[] | undefined>(undefined);
  let newsError = $state<string | null>(null);
  let newsLoading = $state(false);
  let newsScope = $state("symbol");
  let feed = $state<FeedArticle[] | undefined>(undefined);
  let feedError = $state<string | null>(null);
  let feedLoading = $state(false);
  const feedCache = new Map<string, { members: string; articles: FeedArticle[] }>();
  let feedSeq = 0;
  let watchlist = $state<string[]>([]);
  let groups = $state<Group[]>([]);
  let watchlistSort = $state<WatchlistSort>(DEFAULT_WATCHLIST_SORT);
  let watchlistLayout = $state<WatchlistView>("cards");
  let watchlistColumns = $state<WatchlistColumns>(DEFAULT_WATCHLIST_COLUMNS);
  let screens = $state<SavedScreen[]>([]);
  let groupTab = $state<string | null>(null);
  let alerts = $state<PriceAlert[]>([]);
  let recent = $state<string[]>([]);
  let history = $state<History>(emptyHistory());
  let paper = $state.raw<Paper.Account>(Paper.newAccount());
  let backtestRules = $state.raw<Backtest.Rules | null>(null);
  let paperLoaded = $state(false);
  let paperWrite = Promise.resolve();
  let paperError = $state<string | null>(null);
  let paperNotice = $state<string | null>(null);
  let paperBook = $state.raw<Paper.Book | null>(null);
  let navigating = false;
  let picking = 0;
  let now = $state(Date.now() / 1000);
  let refreshing = $state(false);
  let refreshStatus = $state<ReturnType<typeof refreshOutcome> | null>(null);
  let watchlistView: Watchlist | undefined = $state();
  let chartView: ChartView | undefined = $state();
  let finishQuote: ((error?: string) => void) | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshContext = 0;
  $effect(() => {
    view;
    symbol;
    newsScope;
    refreshContext++;
    refreshStatus = null;
    clearTimeout(statusTimer);
  });

  let analystSeq = 0;
  let earningsSeq = 0;
  let statsSeq = 0;
  let ratingChangesSeq = 0;
  let chartSeq = 0;
  let chartSettingsWrite = Promise.resolve();
  let chartAt = 0;
  /** Charts fetched this session, keyed "SYMBOL|range|interval". */
  const cache = new Map<string, { chart: Chart; at: number }>();
  const FRESH_MS = 60_000;
  const cacheKey = () => `${symbol}|${range}|${interval}|${chartExtended && range === "1d"}`;
  /** Headlines fetched this session, keyed by symbol. */
  const newsCache = new Map<string, Article[]>();
  let newsSeq = 0;

  const feedSymbols = $derived(newsScope === "watchlist" ? watchlist : groups.find((g) => `group:${g.name}` === newsScope)?.symbols ?? []);

  $effect(() => {
    const scope = newsScope;
    const symbols = [...feedSymbols];
    if (view === "news") {
      untrack(() => {
        if (scope !== "symbol") loadFeed(scope, symbols);
        else ++feedSeq;
      });
    }
  });

  $effect(() => {
    void watchlist;
    untrack(() => {
      if (view === "events" && eventsTab !== "economic" && watchCal) loadWatchCalendar();
    });
  });

  $effect(() => {
    if (newsScope.startsWith("group:") && !groups.some((g) => `group:${g.name}` === newsScope)) newsScope = "symbol";
  });

  async function loadFeed(scope = newsScope, symbols = [...feedSymbols], manual = false) {
    const mine = ++feedSeq;
    const members = JSON.stringify(symbols);
    const cached = feedCache.get(scope);
    if (!manual) feed = cached?.members === members ? cached.articles : undefined;
    feedError = null;
    feedLoading = symbols.length > 0;
    if (!symbols.length) {
      feed = [];
      return;
    }
    try {
      const articles = await invoke<FeedArticle[]>("get_news_feed", { symbols });
      if (mine === feedSeq) {
        feedCache.set(scope, { members, articles });
        feed = articles;
      }
    } catch (e) {
      if ((!manual || !feed) && mine === feedSeq) feedError = String(e);
      return String(e);
    } finally {
      if (mine === feedSeq) feedLoading = false;
    }
  }

  function apply(init: Init) {
    theme = init.theme;
    textSize = init.text_size;
    palette = init.palette;
    applyDisplay(document.documentElement, theme, palette);
    dataProvider = init.data_provider;
    symbol = init.symbol;
    range = init.range;
    interval = validInterval(range, init.interval);
    drawings = init.drawings ?? {};
    mode = init.chart_mode;
    refreshMode = init.refresh_mode ?? "balanced";
    scale = init.chart_scale;
    chartExtended = init.chart_extended_hours ?? true;
    shadeSessions = init.chart_shade_sessions ?? true;
    chartTimeZone = init.chart_time_zone ?? "exchange";
    if (init.chart_layout) layout = init.chart_layout;
    hotkey = init.hotkey;
    defaultHotkey = init.default_hotkey;
    hotkeyError = init.hotkey_error;
    keybinds = init.keybinds;
    dots = init.dots;
    indicators = init.indicators;
    indicatorPresets = init.indicator_presets;
    qs = init.quote;
    watchlist = init.watchlist ?? [];
    groups = init.groups ?? [];
    watchlistSort = init.watchlist_sort ?? DEFAULT_WATCHLIST_SORT;
    watchlistLayout = init.watchlist_view ?? "cards";
    watchlistColumns = init.watchlist_columns ?? DEFAULT_WATCHLIST_COLUMNS;
    screens = init.screens ?? [];
    eventFilter = savedEventFilter = init.event_filter ?? DEFAULT_EVENT_FILTER;
    alerts = init.alerts ?? [];
    recent = init.recent_symbols ?? [];
    if (init.logo_known) logo = init.logo;
    if (init.analyst_known) analyst = init.analyst;
    // Shown at once, refreshed by loadChart (at = 0 marks it stale).
    if (init.chart) cache.set(cacheKey(), { chart: init.chart, at: 0 });
    ready = true;
    loadChart();
    if (!init.logo_known) loadLogo();
    if (!init.analyst_known) loadAnalyst();
    loadEarnings();
    loadRatingChanges();
    loadStats();
    loadNews();
    loadPaper();
  }

  const quote = $derived(qs.quote && qs.quote.symbol === symbol ? qs.quote : null);

  const shownChart = $derived(chart && chart.meta.symbol.toUpperCase() === symbol.toUpperCase() ? chart : null);
  const offset = $derived(localOffset(now));
  const quoteReading = $derived(quote ? classifyQuote({ time: quoteTime(quote), session: quote.session, now, delay: quote.delay_secs }) : null);
  const chartReading = $derived(
    shownChart && quote
      ? classifyChart({ time: chartTime(shownChart), interval: shownChart.interval, session: quote.session, now, delay: shownChart.delay_secs })
      : null,
  );
  const status = $derived(
    quoteStatus({ hasQuote: !!quote, error: qs.error, reading: quoteReading, session: quote?.session ?? null, delay: quote?.delay_secs, now, offset }),
  );
  const quoteStale = $derived(
    quote ? quoteNote(quoteReading, now, offset, { source: quote.source, error: qs.error, stream: dataProvider.stream.kind, delay: quote.delay_secs }) : null,
  );
  const chartStale = $derived(
    shownChart
      ? chartNote(chartReading, shownChart.interval, now, offset, {
          source: shownChart.source,
          error: qs.error,
          stream: dataProvider.stream.kind,
          lowPower: refreshMode === "low_power",
          delay: shownChart.delay_secs,
        })
      : null,
  );
  const quoteLabel = $derived(quoteSegment(quoteReading, now, offset));
  const chartLabel = $derived(
    shownChart && quote
      ? chartSegment(chartReading, shownChart.interval, now, offset, shownChart.source !== quote.source ? sourceName(shownChart.source) : null)
      : null,
  );
  const delayText = $derived(quote ? delayLabel(quote.delay_secs) : null);

  let olderBusy = $state(false);
  const olderDone = new Set<string>();
  const olderKept = new Map<string, Candle[]>();

  function withOlder(key: string, c: Chart): Chart {
    const candles = Scrollback.mergeOlder(olderKept.get(key) ?? [], c.candles);
    return candles === c.candles ? c : { ...c, candles };
  }

  async function loadOlder() {
    const c = chart;
    const key = cacheKey();
    if (!c || replay || olderBusy || olderDone.has(key) || !c.candles.length) return;
    const first = c.candles[0].t;
    const w = c.candles.length < Scrollback.MAX_CANDLES ? Scrollback.olderWindow(c.interval, first, c.candles[c.candles.length - 1].t) : null;
    if (!w) return;
    olderBusy = true;
    try {
      const older = await invoke<Chart>("get_older", { symbol: c.meta.symbol, interval: c.interval, start: w.start, end: w.end, extended: c.extended ?? false });
      const add = older.candles.filter((k) => k.t < first);
      if (!add.length) olderDone.add(key);
      else {
        olderKept.set(key, [...add, ...(olderKept.get(key) ?? [])]);
        if (chart === c && cacheKey() === key) {
          chart = withOlder(key, c);
          cache.set(key, { chart, at: cache.get(key)?.at ?? Date.now() });
        }
      }
    } catch {
      olderDone.add(key);
    } finally {
      olderBusy = false;
    }
  }

  /** Shows the cached chart (or a skeleton) at once, then fetches if stale. */
  async function loadChart(force = false, manual = false) {
    if (replay) return;
    const mine = ++chartSeq;
    const key = cacheKey();
    const hit = cache.get(key);
    if (!manual) chart = hit?.chart ?? null;
    chartError = null;
    if (hit && !force && !shouldAnalyze(!!analysis, indicators?.keep_analysis ?? false) && Date.now() - hit.at < FRESH_MS) {
      loading = false;
      chartAt = hit.at;
      return;
    }
    loading = true;
    try {
      const c = await invoke<Chart>("get_chart", { symbol, range, interval, extended: chartExtended });
      if (mine !== chartSeq) return;
      const merged = withOlder(key, c);
      cache.set(key, { chart: merged, at: Date.now() });
      chart = merged;
      chartAt = Date.now();
      loading = false;
      if (shouldAnalyze(!!analysis, indicators?.keep_analysis ?? false)) void runAnalysis(true);
    } catch (e) {
      if ((!manual || !chart) && mine === chartSeq) chartError = String(e);
      return String(e);
    } finally {
      if (mine === chartSeq) loading = false;
    }
  }

  async function loadLogo() {
    const sym = symbol;
    const l = await invoke<string | null>("get_logo", { symbol: sym }).catch(() => null);
    if (sym === symbol) logo = l;
  }

  async function loadAnalyst(manual = false) {
    const mine = ++analystSeq;
    const sym = symbol;
    try {
      const result = await invoke<Consensus | null>("get_analyst", { symbol: sym, force: manual });
      if (mine === analystSeq && sym === symbol) analyst = result;
    } catch (e) {
      if (!manual && mine === analystSeq && sym === symbol) analyst = null;
      return String(e);
    }
  }

  async function loadEarnings(manual = false) {
    const mine = ++earningsSeq;
    const sym = symbol;
    try {
      const result = await invoke<Earnings | null>("get_earnings", { symbol: sym });
      if (mine === earningsSeq && sym === symbol) earnings = result;
    } catch (e) {
      if (!manual && mine === earningsSeq && sym === symbol) earnings = null;
      return String(e);
    }
  }

  async function loadStats(manual = false) {
    const mine = ++statsSeq;
    const sym = symbol;
    try {
      const result = await invoke<StatSection[]>("get_stats", { symbol: sym });
      if (mine === statsSeq && sym === symbol) stats = result;
    } catch (e) {
      if (!manual && mine === statsSeq && sym === symbol) stats = null;
      return String(e);
    }
  }

  async function loadFinancials(manual = false) {
    const mine = ++financialsSeq;
    const sym = symbol;
    financialsError = null;
    try {
      const result = await invoke<Financials | null>("get_financials", { symbol: sym, force: manual });
      if (mine === financialsSeq && sym === symbol) {
        financials = result;
        financialsSym = sym;
      }
    } catch (e) {
      if ((!manual || financials === undefined) && mine === financialsSeq && sym === symbol) financialsError = String(e);
      return String(e);
    }
  }

  function toggleFinancials() {
    view = view === "financials" ? "chart" : "financials";
    if (view === "financials" && financialsSym !== symbol) loadFinancials();
  }

  async function loadRatingChanges(manual = false) {
    const mine = ++ratingChangesSeq;
    const sym = symbol;
    try {
      const result = await invoke<RatingChange[]>("get_rating_changes", { symbol: sym });
      if (mine === ratingChangesSeq && sym === symbol) ratingChanges = result;
    } catch (e) {
      if (!manual && mine === ratingChangesSeq && sym === symbol) ratingChanges = [];
      return String(e);
    }
  }

  /** Shows cached headlines at once, then refetches. Only runs when News opens. */
  async function loadNews(manual = false) {
    const mine = ++newsSeq;
    const sym = symbol;
    if (!manual) news = newsCache.get(sym);
    newsError = null;
    newsLoading = true;
    try {
      const list = await invoke<Article[]>("get_news", { symbol: sym });
      newsCache.set(sym, list);
      if (mine === newsSeq && sym === symbol) news = list;
    } catch (e) {
      if ((!manual || !news) && mine === newsSeq && sym === symbol) newsError = String(e);
      return String(e);
    } finally {
      if (mine === newsSeq) newsLoading = false;
    }
  }

  function toggleNews() {
    view = view === "news" ? "chart" : "news";
    if (view === "news") loadNews();
  }

  let replay = $state<Replay.ReplayState | null>(null);
  let replayBars = $state.raw<Candle[]>([]);
  let replayBase = $state.raw<Chart | null>(null);
  let replaySession = 0;
  let replayAnalysis = $state.raw<Analysis | null>(null);
  let replayAnalyzeOn = $state(false);
  let replayAnalyzing = $state(false);
  let replayAnalysisError = $state<string | null>(null);
  let replayAnalysisBusy = false;
  let replayAnalysisAgain = false;
  let replayIndicatorsChanged = false;
  const replayCursor = $derived(replay?.cursor ?? -1);
  const replayPlaying = $derived(replay?.playing ?? false);
  const replayCutoff = $derived(replay ? Replay.cutoff(replayBars, replay) : Infinity);
  const replayChart = $derived.by<Chart | null>(() => {
    const base = replayBase;
    const cursor = replayCursor;
    const cut = replayCutoff;
    if (!base || cursor < 0) return null;
    const candles = Replay.revealed(replayBars, untrack(() => replay)!);
    const last = candles[candles.length - 1];
    return {
      ...base,
      meta: { ...base.meta, price: last.c, market_time: last.t },
      candles,
      dividends: Replay.known(base.dividends, (d) => d.t, cut),
      splits: Replay.known(base.splits, (s) => s.t, cut),
      last_bar_time: last.t,
    };
  });
  const replayLastTime = $derived(replayChart ? replayChart.candles[replayChart.candles.length - 1].t : -Infinity);
  const shownReplayAnalysis = $derived(replayAnalysis && replayAnalysis.as_of <= replayLastTime ? replayAnalysis : null);
  const replayIntraday = $derived(replayBase ? isIntraday(replayBase.interval) : false);
  const canStartReplay = $derived(!!shownChart && Replay.canReplay(shownChart.candles.length));

  function replayOffset(t: number): number {
    const base = replayBase;
    if (!base) return 0;
    return displayOffset(t, chartTimeZone, { timezone: base.meta.timezone, gmtoffset: base.meta.gmtoffset }, base.interval);
  }

  function replayInput(t: number): string {
    return new Date((t + replayOffset(t)) * 1000).toISOString().slice(0, replayIntraday ? 16 : 10);
  }

  function replayWhen(t: number): string {
    return replayBase ? fullTime(t, replayOffset(t), replayBase.interval) : "";
  }

  const replayHeader = $derived.by(() => {
    if (!replayChart) return null;
    const c = replayChart.candles;
    const bar = c[c.length - 1];
    const prev = c.length > 1 ? c[c.length - 2] : null;
    const change = prev ? bar.c - prev.c : null;
    const header = { bar, change, change_pct: prev && change != null && prev.c ? (change / prev.c) * 100 : null, currency: replayChart.meta.currency, when: replayWhen(bar.t) };
    return practice ? { ...header, label: "Practice", name: practice.name, exchange: replayChart.meta.exchange } : header;
  });

  let practice = $state.raw<Practice.Exercise | null>(null);
  let practiceSetup = $state<Practice.Setup>({ ...Practice.DEFAULT_SETUP });
  let practiceOpen = $state(false);
  let practiceBusy = $state(false);
  let practiceError = $state<string | null>(null);
  let practiceSeq = 0;
  const practiceCount = $derived(Practice.scopeSymbols(practiceSetup.scope, watchlist, groups).length);
  const practiceResult = $derived(practice?.trade && replay ? Practice.evaluate(practice.trade, replayBars, replay.cursor) : null);
  const practiceSummary = $derived(practice?.ended && practice.trade ? Practice.summarize(practice.trade, replayBars) : null);
  const practiceCanDecide = $derived(!!practice && !!replay && !practice.trade && !practice.ended && !Replay.isAtEnd(replay));
  const practiceCanClose = $derived(!!practice?.trade && !!replay && !practice.ended && Practice.canClose(practice.trade, replay.cursor));

  function beginReplay(base: Chart, next: Replay.ReplayState | null, paperSession = true) {
    if (!next) return;
    chartSeq++;
    loading = false;
    if (view !== "chart" && view !== "technicals" && view !== "paper") view = "chart";
    replaySession++;
    replayBars = base.candles;
    replayBase = base;
    replayAnalysis = null;
    replayAnalysisError = null;
    replayAnalyzing = false;
    replayIndicatorsChanged = false;
    replayAnalyzeOn = shouldAnalyze(!!activeAnalysis, indicators?.keep_analysis ?? false);
    syncHover = null;
    syncWindow = null;
    replay = next;
    if (paperSession) openPaperBook();
  }

  function enterReplay() {
    const base = shownChart;
    if (replay || !base || !Replay.canReplay(base.candles.length)) return;
    if (practiceOpen) cancelPractice();
    const bars = base.candles;
    beginReplay(base, Replay.startAt(bars, bars[Math.max(Replay.MIN_CONTEXT, Math.floor(bars.length / 2))].t));
  }

  function togglePractice() {
    if (practice) exitReplay();
    else if (practiceOpen) cancelPractice();
    else {
      exitReplay();
      practiceSetup = Practice.validSetup(practiceSetup, groups);
      practiceError = null;
      practiceOpen = true;
    }
  }

  function cancelPractice() {
    practiceSeq++;
    practiceBusy = false;
    practiceError = null;
    practiceOpen = false;
  }

  function changePractice() {
    exitReplay();
    practiceSetup = Practice.validSetup(practiceSetup, groups);
    practiceOpen = true;
  }

  async function startPractice() {
    if (practiceBusy) return;
    const setup = Practice.validSetup(practiceSetup, groups);
    practiceSetup = setup;
    const pool = Practice.scopeSymbols(setup.scope, watchlist, groups);
    if (!pool.length) {
      practiceError = "No symbols to practice on";
      return;
    }
    const mine = ++practiceSeq;
    practiceBusy = true;
    practiceError = null;
    const rng: Practice.Rng = Math.random;
    const w = Practice.fetchWindow(setup, Math.floor(Date.now() / 1000));
    const misses: string[] = [];
    try {
      for (let n = 0; n < Practice.MAX_TRIES && pool.length; n++) {
        const pick = pool.splice(Practice.randomInt(rng, pool.length), 1)[0];
        let c: Chart;
        try {
          c = await invoke<Chart>("get_history", { symbol: pick, interval: setup.interval, start: w.start, end: w.end });
        } catch (e) {
          if (mine !== practiceSeq) return;
          misses.push(`${pick}: ${e}`);
          continue;
        }
        if (mine !== practiceSeq) return;
        const start = Practice.pickStart(c.candles, w.from, rng);
        if (!start) {
          misses.push(`${pick}: not enough history`);
          continue;
        }
        beginPractice(setup, pick, c, start);
        return;
      }
      practiceError = `No usable setup found${misses.length ? ` (${misses.slice(0, 3).join("; ")})` : ""}`;
    } finally {
      if (mine === practiceSeq) practiceBusy = false;
    }
  }

  function beginPractice(setup: Practice.Setup, pick: string, c: Chart, start: Practice.Candidate) {
    const w = Practice.exerciseBars(c.candles, start.index);
    const next = Replay.startAt(w.bars, w.bars[w.start].t, Practice.CONTEXT);
    if (!next || next.start !== w.start) {
      practiceError = "Could not start the setup";
      return;
    }
    const base: Chart = { ...c, range: Practice.displayRange(setup.interval), meta: { ...c.meta, prev_close: null }, candles: w.bars, last_bar_time: w.bars[w.bars.length - 1].t };
    exitReplay();
    practiceSeq++;
    practiceOpen = false;
    practiceBusy = false;
    practiceError = null;
    practice = { setup, symbol: c.meta.symbol || pick, name: c.meta.name, start: w.start, volatile: start.volatile, trade: null, ended: false };
    beginReplay(base, next, false);
  }

  function practiceDecide(decision: Practice.Decision) {
    if (!practice || !replay || practice.trade || practice.ended) return;
    if (decision !== "skip" && Replay.isAtEnd(replay)) return;
    practice = { ...practice, trade: Practice.decide(decision, replay.cursor) };
    if (decision === "skip") endPractice();
  }

  function practiceClose() {
    if (!practice?.trade || !replay || practice.ended || !Practice.canClose(practice.trade, replay.cursor)) return;
    practice = { ...practice, trade: Practice.close(practice.trade, replay.cursor) };
    endPractice();
  }

  function endPractice() {
    if (!practice || !replay || practice.ended) return;
    const trade = Practice.finish(practice.trade ?? Practice.decide("skip", replay.cursor), replay.cursor);
    practice = { ...practice, trade, ended: true };
    replay = { ...Replay.pause(replay), cursor: replay.total - 1 };
  }

  function exitReplay() {
    if (!replay) return;
    const wasPractice = !!practice;
    practice = null;
    practiceBusy = false;
    practiceSeq++;
    replaySession++;
    paperBook = null;
    paperError = null;
    paperNotice = null;
    replay = null;
    replayBars = [];
    replayBase = null;
    replayAnalysis = null;
    replayAnalysisError = null;
    replayAnalyzing = false;
    replayAnalyzeOn = false;
    if (wasPractice && !chart) void loadChart();
    if (replayIndicatorsChanged) {
      replayIndicatorsChanged = false;
      if (chart && !loading && shouldAnalyze(!!analysis, indicators?.keep_analysis ?? false)) void runAnalysis(true);
    }
  }

  function toggleReplay() {
    if (replay) exitReplay();
    else enterReplay();
  }

  function restartReplay(value: string) {
    if (!replay || !replayBars.length) return;
    const wall = Date.parse(value.length === 10 ? `${value}T00:00Z` : `${value}Z`) / 1000;
    const next = Replay.startAt(replayBars.map((b) => ({ t: b.t + replayOffset(b.t) })), wall, Replay.MIN_CONTEXT, replay.speed);
    if (next) {
      replay = next;
      openPaperBook();
    }
  }

  function openPaperBook(account = Paper.newAccount(paper.starting_cash, paper.costs)) {
    paperBook = replay ? Paper.openBook(account, replay.cursor) : null;
    paperError = null;
    paperNotice = null;
  }

  $effect(() => {
    const cursor = replayCursor;
    if (cursor < 0) return;
    untrack(() => {
      if (!paperBook || !replay) return;
      const r = Paper.seekBook(paperBook, replayBars, cursor, symbol);
      paperBook = r.book;
      if (r.events.length) paperNotice = paperEventText(r.events);
    });
  });

  const paperAccount = $derived(replay ? (paperBook ? Paper.bookAccount(paperBook) : null) : paperLoaded ? paper : null);
  const paperMark = $derived(replay ? (replayChart ? replayChart.candles[replayChart.candles.length - 1].c : null) : (quote?.price ?? null));
  const liveBlock = $derived(Paper.liveBlock(quote?.session ?? null, quoteReading?.state ?? null, quote?.price ?? null));
  const paperMarketBlock = $derived(replay ? (Replay.isAtEnd(replay) ? "End of replay data, no next bar to fill at" : null) : liveBlock);
  const paperFills = $derived((paperAccount?.fills ?? []).filter((f) => f.symbol === symbol).map((f) => ({ t: f.time, side: f.side, price: f.price })));

  function paperEventText(events: Paper.BarEvent[]): string {
    return events
      .map((e) => (e.kind === "fill" ? `Simulated ${e.order.side} ${e.fill.qty} ${e.fill.symbol} filled at ${e.fill.price.toFixed(2)}` : `Simulated ${e.order.side} ${e.order.qty} ${e.order.symbol} rejected: ${e.error}`))
      .join(". ");
  }

  async function loadPaper() {
    try {
      paper = await invoke<Paper.Account>("get_paper");
      paperLoaded = true;
    } catch (e) {
      paperError = `Could not load the simulated account: ${e}`;
    }
  }

  function savePaper(next: Paper.Account) {
    paper = next;
    paperWrite = paperWrite
      .then(() => invoke<Paper.Account>("save_paper", { account: next }))
      .then(
        () => {
          if (!replay && paperError?.startsWith("Could not save")) paperError = null;
        },
        (e) => {
          if (!replay) paperError = `Could not save the simulated account: ${e}`;
        },
      );
  }

  function setPaperAccount(next: Paper.Account) {
    if (replay) {
      if (paperBook) paperBook = Paper.updateBook(paperBook, next);
    } else savePaper(next);
  }

  function paperOrder(req: Paper.OrderRequest) {
    const account = paperAccount;
    paperError = null;
    paperNotice = null;
    if (!account) return;
    let r: Paper.Outcome;
    if (replay) {
      if (req.kind === "market" && paperMarketBlock) {
        paperError = paperMarketBlock;
        return;
      }
      const bar = replayBars[replay.cursor];
      r = Paper.placeOrder(account, req, bar.t, bar.c);
    } else if (req.kind === "market") {
      if (liveBlock || !quote) {
        paperError = liveBlock ?? "No live quote yet";
        return;
      }
      r = Paper.marketOrder(account, req.symbol, req.side, req.qty, quote.price, quoteTime(quote) ?? quote.market_time, req.bracket ?? null);
    } else {
      r = Paper.placeOrder(account, req, quote ? (quoteTime(quote) ?? quote.market_time) : 0);
    }
    if (!r.ok) {
      paperError = r.error;
      return;
    }
    setPaperAccount(r.account);
    if (r.fill) paperNotice = `Simulated ${r.fill.side} ${r.fill.qty} ${r.fill.symbol} filled at ${r.fill.price.toFixed(2)}`;
    else if (r.order) paperNotice = r.order.kind === "market" ? "Simulated market order queued for the next bar's open" : `Simulated ${r.order.kind} order placed`;
  }

  $effect(() => {
    const c = chart;
    if (!c || replay) return;
    untrack(() => {
      const fired = ChartAlertRules.due(chartAlerts.list, c.meta.symbol, c.interval, c.candles, clockFor(c.meta));
      if (!fired.length) return;
      const ids = new Set(fired.map((a) => a.id));
      const now = Math.floor(Date.now() / 1000);
      setChartAlerts(chartAlerts.list.map((a) => (ids.has(a.id) ? { ...a, enabled: false, fired_at: now } : a)));
      for (const a of fired) invoke("send_notification", { title: `tickr · ${a.symbol} chart alert`, body: `${a.label} (${a.interval})` }).catch(console.warn);
    });
  });

  const paperLines = $derived(Paper.orderLines(paperAccount, symbol));

  function paperMove(id: string, price: number) {
    if (!paperAccount) return;
    const r = Paper.moveOrder(paperAccount, id, price);
    paperNotice = null;
    paperError = r.ok ? null : r.error;
    if (r.ok) {
      setPaperAccount(r.account);
      paperNotice = `Simulated order moved to ${price >= 1 ? price.toFixed(2) : price.toFixed(4)}`;
    }
  }

  function paperCancel(id: number) {
    if (paperAccount) setPaperAccount(Paper.cancelOrder(paperAccount, id));
  }

  function paperCosts(costs: Paper.Costs) {
    if (!paperAccount) return;
    const r = Paper.setCosts(paperAccount, costs);
    if (!r.ok) paperError = r.error;
    else {
      setPaperAccount(r.account);
      paperNotice = "Simulation costs saved";
    }
  }

  async function paperReset(startingCash: number) {
    if (!paperAccount) return;
    const costs = paperAccount.costs;
    const r = Paper.reset(paperAccount, startingCash);
    if (!r.ok) {
      paperError = r.error;
      return;
    }
    paperError = null;
    if (replay) {
      openPaperBook(r.account);
      paperNotice = "Replay session account reset";
      return;
    }
    try {
      await paperWrite;
      paper = await invoke<Paper.Account>("reset_paper", { startingCash, costs });
      paperNotice = "Simulated account reset";
    } catch (e) {
      paperError = `Could not reset the simulated account: ${e}`;
    }
  }

  $effect(() => {
    const q = quote;
    if (!q || liveBlock) return;
    untrack(() => {
      if (!paperLoaded || !paper.orders.some((o) => o.symbol === q.symbol)) return;
      const t = quoteTime(q);
      if (t == null) return;
      const r = Paper.processPrice(paper, q.symbol, q.price, t);
      if (!r.events.length) return;
      savePaper(r.account);
      if (!replay) paperNotice = paperEventText(r.events);
    });
  });

  function chartWhen(t: number): string {
    const c = mainChart;
    return c ? fullTime(t, displayOffset(t, chartTimeZone, { timezone: c.meta.timezone, gmtoffset: c.meta.gmtoffset }, c.interval), c.interval) : "";
  }

  function paperWhen(t: number): string {
    if (replay) return replayWhen(t);
    return fullTime(t, localOffset(t), "1m");
  }

  function replayUpdate(next: (s: Replay.ReplayState) => Replay.ReplayState) {
    if (replay) replay = next(replay);
  }

  $effect(() => {
    if (!replayPlaying) return;
    let last = performance.now();
    const id = setInterval(() => {
      const t = performance.now();
      replayUpdate((s) => Replay.tick(s, t - last));
      last = t;
    }, 40);
    return () => clearInterval(id);
  });

  $effect(() => {
    if (replayCursor < 0) return;
    untrack(() => {
      if (replayAnalyzeOn || indicators?.keep_analysis) void runReplayAnalysis(true);
    });
  });

  $effect.pre(() => {
    if (replay && view !== "chart" && view !== "technicals" && (practice || view !== "paper")) view = "chart";
  });

  async function runReplayAnalysis(background = false) {
    if (!replay) return;
    if (!background) replayAnalyzing = true;
    if (replayAnalysisBusy) {
      replayAnalysisAgain = true;
      return;
    }
    replayAnalysisBusy = true;
    const session = replaySession;
    const req = practice
      ? { symbol: practice.symbol, range: Practice.PERIOD_RANGE, interval: practice.setup.interval, extended: false }
      : { symbol, range, interval, extended: chartExtended };
    try {
      let until: number;
      do {
        replayAnalysisAgain = false;
        if (!replay || session !== replaySession) return;
        until = replayBars[replay.cursor].t;
        try {
          const a = await invoke<Analysis>("analyze", { ...req, until });
          if (!replay || session !== replaySession) return;
          if (a.as_of <= replayBars[replay.cursor].t) {
            replayAnalysis = a;
            replayAnalysisError = null;
          }
        } catch (e) {
          if (session === replaySession) replayAnalysisError = String(e);
        }
      } while (replayAnalysisAgain || (replay && session === replaySession && replayBars[replay.cursor].t !== until));
    } finally {
      replayAnalysisBusy = false;
      if (session === replaySession) replayAnalyzing = false;
      else if (replayAnalysisAgain) void runReplayAnalysis(true);
    }
  }

  const activeAnalysis = $derived(analysis && analysisKey === cacheKey() ? analysis : null);
  const techAnalysis = $derived(replay ? shownReplayAnalysis : activeAnalysis);
  const mainChart = $derived(replay ? replayChart : chart);
  const split = $derived(layout.split && !replay);
  const analysisOffset = $derived(
    techAnalysis && mainChart
      ? displayOffset(techAnalysis.as_of, chartTimeZone, { timezone: mainChart.meta.timezone, gmtoffset: mainChart.meta.gmtoffset }, techAnalysis.interval)
      : (mainChart?.meta.gmtoffset ?? 0),
  );
  const chartEarnings = $derived(dots.earnings && !practice ? (replay ? Replay.known(earnings?.history ?? [], (e) => e.reported, replayCutoff) : earnings?.history) : []);
  const chartRatings = $derived(dots.analysts && !practice ? (replay ? Replay.known(ratingChanges, (r) => r.date, replayCutoff) : ratingChanges) : []);
  const chartNews = $derived(dots.news && !practice ? (replay ? Replay.known(news ?? [], (a) => a.published, replayCutoff) : news) : []);
  const backtestReport = $derived.by(() => {
    if (!backtestRules || !mainChart?.candles.length) return null;
    try {
      return Backtest.backtest(mainChart.candles, backtestRules, clockFor(mainChart.meta));
    } catch {
      return null;
    }
  });
  const chartFills = $derived(practice ? Practice.markers(practiceResult, replayBars) : view === "backtest" ? Backtest.markers(backtestReport) : paperFills);

  /** Runs the local technical analysis on the chart on screen. */
  async function runAnalysis(background = false) {
    if (replay) {
      replayAnalyzeOn = true;
      return runReplayAnalysis(background);
    }
    if (!chart || (background && loading)) return;
    const mine = ++analysisSeq;
    const key = cacheKey();
    analyzing = !background;
    analysisError = null;
    try {
      const a = await invoke<Analysis>("analyze", { symbol, range, interval, extended: chartExtended });
      if (mine !== analysisSeq || key !== cacheKey()) return;
      analysis = a;
      analysisKey = key;
    } catch (e) {
      if (mine === analysisSeq) analysisError = String(e);
    } finally {
      if (mine === analysisSeq) analyzing = false;
    }
  }

  /** Drops results; the Analyze button shows again. */
  function clearAnalysis() {
    analysisSeq++;
    analysis = null;
    analysisKey = "";
    analyzing = false;
    analysisError = null;
  }

  async function saveIndicators(config: IndicatorConfig) {
    indicators = await invoke<IndicatorConfig>("set_indicators", { config });
    if (replay) {
      replayIndicatorsChanged = true;
      if (replayAnalyzeOn || indicators.keep_analysis) void runReplayAnalysis(true);
      return;
    }
    if (chart && !loading && shouldAnalyze(!!analysis, indicators.keep_analysis)) void runAnalysis(true);
  }

  async function savePreset(name: string) {
    indicatorPresets = await invoke<IndicatorPreset[]>("save_indicator_preset", { name });
  }

  async function deletePreset(name: string) {
    indicatorPresets = await invoke<IndicatorPreset[]>("delete_indicator_preset", { name });
  }

  async function pickSymbol(next: string): Promise<string | null> {
    if (navigating) return "Still switching symbol";
    const from = symbol;
    picking++;
    try {
      const error = await switchSymbol(next);
      if (!error) history = visit(history, from, symbol);
      return error;
    } finally {
      picking--;
    }
  }

  async function navigate(move: (h: History, current: string) => Move | null) {
    const m = navigating || picking ? null : move(history, symbol);
    if (!m) return;
    navigating = true;
    try {
      const error = await switchSymbol(m.to);
      if (error) console.warn(error);
      else history = m.history;
    } finally {
      navigating = false;
    }
  }

  async function switchSymbol(next: string): Promise<string | null> {
    try {
      qs = await invoke<QuoteState>("set_symbol", { symbol: next });
      exitReplay();
      symbol = qs.quote?.symbol ?? next.toUpperCase();
      recent = pushRecent(recent, symbol);
      clearAnalysis();
      logo = undefined;
      loadChart();
      analyst = undefined;
      loadLogo();
      loadAnalyst();
      earnings = undefined;
      loadEarnings();
      ratingChanges = [];
      loadRatingChanges();
      stats = undefined;
      loadStats();
      financials = undefined;
      financialsSym = "";
      financialsError = null;
      if (view === "financials") loadFinancials();
      loadNews();
      options = undefined;
      if (view === "options") loadOptions();
      return null;
    } catch (e) {
      return String(e);
    }
  }

  async function saveWatchlist(next: string[]) {
    watchlist = next;
    watchlist = await invoke<string[]>("set_watchlist", { symbols: next }).catch(() => next);
    groups = groups.map((g) => ({ ...g, symbols: g.symbols.filter((s) => watchlist.includes(s)) }));
  }

  async function saveGroups(next: Group[]) {
    groups = next;
    groups = await invoke<Group[]>("set_groups", { groups: next }).catch(() => next);
  }

  function saveSort(next: WatchlistSort) {
    watchlistSort = next;
    invoke("set_watchlist_sort", { sort: next }).catch(console.warn);
  }

  function saveWatchlistLayout(next: WatchlistView) {
    watchlistLayout = next;
    invoke("set_watchlist_view", { view: next }).catch(console.warn);
  }

  function saveWatchlistColumns(next: WatchlistColumns) {
    watchlistColumns = next;
    invoke("set_watchlist_columns", { columns: next }).catch(console.warn);
  }

  async function saveScreen(name: string, rules: ScreenRule[]): Promise<string | undefined> {
    try {
      screens = await invoke<SavedScreen[]>("save_screen", { name, rules });
    } catch (e) {
      return String(e);
    }
  }

  async function deleteScreen(name: string) {
    screens = await invoke<SavedScreen[]>("delete_screen", { name }).catch(() => screens);
  }

  function toggleStar() {
    saveWatchlist(watchlist.includes(symbol) ? watchlist.filter((s) => s !== symbol) : [...watchlist, symbol]);
  }

  async function openWatched(next: string) {
    view = "chart";
    if (next !== symbol) await pickSymbol(next);
  }

  function setRange(r: string) {
    // The Technicals view keeps its split chart across range changes.
    if (view !== "technicals" && view !== "paper" && view !== "backtest") view = "chart";
    if (r === range) return;
    exitReplay();
    range = r;
    interval = validInterval(range, interval);
    clearAnalysis();
    chartSettingsWrite = chartSettingsWrite
      .then(() => invoke<void>("set_range", { range: r }))
      .catch(console.warn);
    loadChart();
  }

  function changeInterval(next: string) {
    if (next === interval) return;
    exitReplay();
    const r = Scrollback.rangeFor(range, next);
    const moved = r !== range;
    range = r;
    interval = validInterval(range, next);
    const saved = interval;
    clearAnalysis();
    chartSettingsWrite = chartSettingsWrite
      .then(() => (moved ? invoke<void>("set_range", { range: r }) : undefined))
      .then(() => invoke<void>("set_interval", { interval: saved }))
      .catch(console.warn);
    loadChart(true);
  }

  async function loadMarket(manual = false) {
    marketError = null;
    marketLoading = true;
    try {
      market = await invoke<Market>("get_market");
    } catch (e) {
      if (!manual || !market) marketError = String(e);
      return String(e);
    } finally {
      marketLoading = false;
    }
  }

  const today = $derived(localDay(new Date(now * 1000)));
  const eventsRange = $derived(weekRange(today, eventsWeek));
  const shownEvents = $derived(events?.start === eventsRange.start ? events : undefined);

  async function loadEvents(force = false, manual = false) {
    const mine = ++eventsSeq;
    const start = eventsRange.start;
    eventsError = null;
    eventsLoading = true;
    try {
      const r = await invoke<EventsReport>("get_events", { force, start });
      eventsCache.set(r.start, r);
      if (mine === eventsSeq) events = r;
    } catch (e) {
      if ((!manual || !events) && mine === eventsSeq) eventsError = String(e);
      return String(e);
    } finally {
      if (mine === eventsSeq) eventsLoading = false;
    }
  }

  function showEventsWeek(offset: number) {
    eventsWeek = offset;
    events = eventsCache.get(weekRange(today, offset).start);
  }

  $effect(() => {
    void eventsRange.start;
    untrack(() => {
      if (view === "events" && eventsTab !== "watchlist") loadEvents();
    });
  });

  async function loadWatchCalendar(force = false, manual = false) {
    const mine = ++watchCalSeq;
    watchCalError = null;
    watchCalLoading = true;
    try {
      const r = await invoke<WatchDates[]>("get_watch_calendar", { force });
      if (mine === watchCalSeq) {
        watchCal = r;
        watchCalAt = Date.now() / 1000;
      }
    } catch (e) {
      if ((!manual || !watchCal) && mine === watchCalSeq) watchCalError = String(e);
      return String(e);
    } finally {
      if (mine === watchCalSeq) watchCalLoading = false;
    }
  }

  function loadEventsView() {
    if (eventsTab !== "economic") loadWatchCalendar();
    if (eventsTab !== "watchlist") loadEvents();
  }

  function showEventsTab(tab: EventsTab) {
    eventsTab = tab;
    loadEventsView();
  }

  function saveEventFilter(next: EventFilter) {
    eventFilter = next;
    eventFilterWrite = eventFilterWrite
      .then(() => invoke<EventFilter>("set_event_filter", { filter: next }))
      .then((saved) => {
        savedEventFilter = saved;
      })
      .catch((e) => {
        console.warn(e);
        eventFilter = savedEventFilter;
      });
  }

  function toggleEvents() {
    view = view === "events" ? "chart" : "events";
    if (view === "events") loadEventsView();
  }

  async function loadOptions(date?: number, manual = false) {
    const mine = ++optionsSeq;
    const sym = symbol;
    optionsError = null;
    optionsLoading = true;
    try {
      const o = await invoke<Options>("get_options", { symbol: sym, date: date ?? null });
      if (mine === optionsSeq && sym === symbol) options = o;
    } catch (e) {
      if ((!manual || !options) && mine === optionsSeq && sym === symbol) optionsError = String(e);
      return String(e);
    } finally {
      if (mine === optionsSeq) optionsLoading = false;
    }
  }

  function toggleOptions() {
    view = view === "options" ? "chart" : "options";
    if (view === "options") loadOptions();
  }

  function toggleMarket() {
    view = view === "market" ? "chart" : "market";
    if (view === "market") loadMarket();
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    refreshStatus = null;
    clearTimeout(statusTimer);
    const activeView = view;
    const context = refreshContext;
    const quoteDone = new Promise<string | undefined>((resolve) => {
      finishQuote = (error) => {
        clearTimeout(refreshTimer);
        finishQuote = undefined;
        resolve(error);
      };
      refreshTimer = setTimeout(() => finishQuote?.("Quote refresh timed out"), 15_000);
    });
    invoke("refresh_quote").catch((e) => finishQuote?.(String(e)));
    const chartDone = loadChart(true, true);
    void secondView?.load(true);
    let panelDone: Promise<string | void>;
    switch (activeView) {
      case "news": panelDone = newsScope === "symbol" ? loadNews(true) : loadFeed(newsScope, [...feedSymbols], true); break;
      case "earnings": panelDone = loadEarnings(true); break;
      case "stats": panelDone = loadStats(true); break;
      case "financials": panelDone = loadFinancials(true); break;
      case "analysts": panelDone = Promise.all([loadAnalyst(true), loadRatingChanges(true)]).then((errors) => errors.find(Boolean)); break;
      case "events": panelDone = eventsTab === "watchlist" ? loadWatchCalendar(true, true) : eventsTab === "calendar" ? Promise.all([loadEvents(true, true), loadWatchCalendar(true, true)]).then((errors) => errors.find(Boolean)) : loadEvents(true, true); break;
      case "market": panelDone = loadMarket(true); break;
      case "options": panelDone = loadOptions(options?.expiry ?? undefined, true); break;
      case "watchlist": panelDone = watchlistView?.refresh() ?? Promise.resolve(); break;
      case "alerts": panelDone = Promise.resolve(); break;
      default: panelDone = chartDone;
    }
    const panelError = (await Promise.all([panelDone, quoteDone, chartDone]))[0];
    refreshing = false;
    if (context !== refreshContext) return;
    refreshStatus = refreshOutcome(activeView, panelError || undefined);
    if (!refreshStatus.error) statusTimer = setTimeout(() => (refreshStatus = null), 3_000);
  }

  function setScale(s: ChartScale) {
    scale = s;
    invoke("set_chart_scale", { scale: s }).catch(console.warn);
  }

  function saveChartExtended(enabled: boolean) {
    if (enabled === chartExtended) return;
    if (range === "1d") exitReplay();
    chartExtended = enabled;
    invoke("set_chart_extended_hours", { enabled }).catch(console.warn);
    if (range === "1d") loadChart(true);
  }

  function saveShadeSessions(enabled: boolean) {
    shadeSessions = enabled;
    invoke("set_chart_shade_sessions", { enabled }).catch(console.warn);
  }

  function saveChartTimeZone(zone: ChartTimeZone) {
    chartTimeZone = zone;
    invoke("set_chart_time_zone", { zone }).catch(console.warn);
  }

  function saveLayout(patch: Partial<ChartLayout>) {
    const next = { ...layout, ...patch };
    if (!next.split || !next.sync_range) syncWindow = null;
    if (!next.split) syncHover = null;
    if (next.split && view !== "chart") view = "chart";
    layout = next;
    layoutWrite = layoutWrite.then(() => invoke<ChartLayout>("set_chart_layout", { layout: next })).then(() => undefined, console.warn);
  }

  function hoverFrom(source: Pane, t: number | null) {
    if (t != null) syncHover = { source, t };
    else if (syncHover?.source === source) syncHover = null;
  }

  const DOCKABLE = new Set(["watchlist", "alerts", "analysts", "earnings", "stats", "financials", "market", "events", "options", "news"]);
  const DOCK_MIN = 280;

  function stored(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function store(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  }

  let dockOn = $state(stored("tickr.dock") !== "0");
  let dockWidth = $state(Math.max(DOCK_MIN, Number(stored("tickr.dockWidth")) || 440));
  let dockDrag: { x: number; w: number } | null = null;
  const docked = $derived(dockOn && DOCKABLE.has(view));

  function toggleDock() {
    dockOn = !dockOn;
    store("tickr.dock", dockOn ? "1" : "0");
  }

  function setDockWidth(w: number) {
    dockWidth = Math.round(Math.max(DOCK_MIN, Math.min(w, window.innerWidth * 0.7)));
    store("tickr.dockWidth", String(dockWidth));
  }

  function setMode(m: ChartMode) {
    if (view !== "technicals" && view !== "paper" && view !== "backtest") view = "chart";
    mode = m;
    invoke("set_chart_mode", { mode: m }).catch(console.warn);
  }

  async function onKey(e: KeyboardEvent) {
    if (!ready || settingsOpen || e.defaultPrevented) return;
    if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      if (!e.repeat) navigate(e.key === "ArrowLeft" ? goBack : goForward);
      return;
    }
    if (replay && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (e.key === " ") {
        if (e.target instanceof Element && e.target.closest("button, a")) return;
        e.preventDefault();
        if (!e.repeat) replayUpdate(Replay.toggle);
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        if (e.key === "ArrowRight") replayUpdate(Replay.step);
        else if (!practice) replayUpdate(Replay.stepBack);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (!e.repeat) exitReplay();
        return;
      }
    }
    if (practiceOpen && !replay && e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      cancelPractice();
      return;
    }
    const key = bindKey(e);
    const action = key && actionFor(keybinds, key);
    if (!action || (practice ? !practiceAllows(action) : replay && !replayAllows(action))) return;
    e.preventDefault();
    switch (action) {
      case "chart_replay":
        if (!e.repeat) toggleReplay();
        break;
      case "practice":
        if (!e.repeat) togglePractice();
        break;
      case "settings":
        if (!e.repeat) settingsOpen = true;
        break;
      case "toggle_watchlist":
        if (!e.repeat) view = view === "watchlist" ? "chart" : "watchlist";
        break;
      case "next_group":
        if (!e.repeat) {
          view = "watchlist";
          groupTab = nextGroupTab(groups.map((g) => g.name), groupTab);
        }
        break;
      case "chart_mode":
        setMode(nextMode(mode));
        break;
      case "chart_scale":
        setScale(scale === "linear" ? "log" : scale === "log" ? "percent" : "linear");
        break;
      case "chart_interval":
        changeInterval(nextInterval(range, interval));
        break;
      case "chart_split":
        if (!e.repeat) {
          const split = view !== "chart" || !layout.split;
          view = "chart";
          saveLayout({ split });
        }
        break;
      case "draw_level":
      case "draw_trend":
      case "draw_text":
      case "draw_ruler":
      case "draw_rect":
      case "draw_ray":
      case "draw_fib":
      case "draw_position":
      case "draw_avwap":
      case "draw_pen": {
        if (e.repeat) break;
        if (view !== "chart" && view !== "technicals" && view !== "paper" && view !== "backtest") view = "chart";
        await tick();
        const tools = { draw_level: "hline", draw_trend: "trend", draw_text: "text", draw_ruler: "ruler", draw_pen: "pen", draw_rect: "rect", draw_ray: "ray", draw_fib: "fib", draw_position: "position", draw_avwap: "avwap" } as const;
        chartView?.drawTool(tools[action]);
        break;
      }
      case "refresh":
        refresh();
        break;
      case "range":
        setRange(RANGES[(RANGES.findIndex((r) => r.id === range) + 1) % RANGES.length].id);
        break;
      case "technicals":
      case "analysts":
      case "earnings":
      case "alerts":
        view = view === action ? "chart" : action;
        break;
      case "paper":
        if (!e.repeat) view = view === "paper" ? "chart" : "paper";
        break;
      case "toggle_opening_range":
      case "toggle_levels":
      case "toggle_volume_ma":
      case "toggle_volume_profile": {
        const overlay = overlayFor(action);
        if (!e.repeat && overlay && indicators && overlays) saveIndicators(toggleOverlay(indicators, overlay, !overlays[overlay])).catch(console.warn);
        break;
      }
      case "backtest":
        if (!e.repeat) view = view === "backtest" ? "chart" : "backtest";
        break;
      case "market":
        if (!e.repeat) toggleMarket();
        break;
      case "events":
        if (!e.repeat) toggleEvents();
        break;
      case "options":
        if (!e.repeat) toggleOptions();
        break;
      case "options_side":
        if (!e.repeat && view === "options" && options) optionsSide = optionsSide === "calls" ? "puts" : "calls";
        break;
      case "options_expiry":
        if (view === "options" && options?.expiry != null && options.expirations.length) {
          const i = options.expirations.indexOf(options.expiry);
          loadOptions(options.expirations[(i + 1) % options.expirations.length]);
        }
        break;
      case "add_watchlist":
        if (!e.repeat && symbol && !watchlist.includes(symbol)) toggleStar();
        break;
      case "news":
        if (!e.repeat) toggleNews();
        break;
      case "analyze":
        if (!e.repeat && ["technicals", "chart", "paper", "backtest"].includes(view) && !analyzing) runAnalysis();
        break;
      case "watchlist": {
        const next = watchlist[(watchlist.indexOf(symbol) + 1) % watchlist.length];
        if (next && next !== symbol) pickSymbol(next);
        break;
      }
      case "search":
        search?.focus();
        break;
      case "previous_symbol":
        if (!e.repeat) navigate(previous);
        break;
    }
  }

  function refreshChart() {
    if (refreshMode === "low_power" && (document.hidden || loading)) return;
    if (/^\d+m$/.test(chart?.interval ?? "") && Date.now() - chartAt > FRESH_MS) loadChart(true);
  }

  if (boot) apply(boot);

  onMount(() => {
    const onVisible = () => {
      if (refreshMode === "low_power" && !document.hidden) refreshChart();
    };
    document.addEventListener("visibilitychange", onVisible);
    if (!boot) invoke<Init>("get_init").then(apply);
    const un = listen<QuoteState>("quote", (e) => {
      qs = e.payload;
      finishQuote?.(e.payload.error ?? undefined);
      // Keep intraday-candle charts (1D, 5D, 1M) current; daily ones barely move.
      refreshChart();
    });
    const tick = setInterval(() => (now = Date.now() / 1000), 15_000);
    const unProvider = listen<DataProvider>("data-provider", (e) => {
      dataProvider = e.payload;
      exitReplay();
      cache.clear();
      olderKept.clear();
      olderDone.clear();
      clearAnalysis();
      void loadChart(true);
      secondView?.clearCache();
      void secondView?.load(true);
    });
    const unStream = listen<StreamStatus>("stream-status", (e) => (dataProvider.stream = e.payload));
    invoke<DataProvider>("get_data_provider").then((c) => (dataProvider = c)).catch(console.warn);
    const unAlerts = listen<PriceAlert[]>("alerts", (e) => (alerts = e.payload));
    return () => {
      un.then((f) => f());
      unProvider.then((f) => f());
      unStream.then((f) => f());
      unAlerts.then((f) => f());
      clearInterval(tick);
      clearTimeout(refreshTimer);
      clearTimeout(statusTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  });
</script>

<svelte:window onkeydown={onKey} />

{#if ready}
  <div class="app">
    <main>
      <Left
        symbol={practice?.symbol ?? symbol}
        {quote}
        logo={practice ? null : logo}
        {analyst}
        staleNote={replay ? null : quoteStale}
        starred={watchlist.includes(practice?.symbol ?? symbol)}
        onanalysts={() => {
          if (!replay) view = "analysts";
        }}
        onstar={() => {
          if (!practice) toggleStar();
        }}
        replay={replayHeader}
      />
      <section>
        <div class="toolbar">
          <div class="nav">
            <button title="Back (Alt+←)" aria-label="Back (Alt+←)" disabled={!history.back.length} onclick={() => navigate(goBack)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
            </button>
            <button title="Forward (Alt+→)" aria-label="Forward (Alt+→)" disabled={!history.forward.length} onclick={() => navigate(goForward)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
            </button>
            <Search bind:this={search} onpick={pickSymbol} {recent} current={symbol} />
          </div>
          <div class="views">
            <div class="seg">
              <button class:on={view === "options"} aria-pressed={view === "options"} disabled={!!replay} onclick={toggleOptions}>Options</button>
            </div>
            <div class="seg">
              <button class:on={view === "market"} aria-pressed={view === "market"} disabled={!!replay} onclick={toggleMarket}>Market</button>
            </div>
            <div class="seg">
              <button class:on={view === "events"} aria-pressed={view === "events"} disabled={!!replay} onclick={toggleEvents}>Events</button>
            </div>
            <div class="seg">
              <button class:on={view === "news"} aria-pressed={view === "news"} disabled={!!replay} onclick={toggleNews}>News</button>
            </div>
            <div class="seg">
              <button class:on={dockOn} aria-pressed={dockOn} title="Keep the chart beside the watchlist and panels" onclick={toggleDock}>Dock</button>
            </div>
            <div class="seg" role="group" aria-label="Chart type">
              <select aria-label="Chart type" value={mode} onchange={(event) => setMode(event.currentTarget.value as ChartMode)}>
                {#each CHART_MODES as m}<option value={m.id}>{m.label}</option>{/each}
              </select>
            </div>
            <div class="seg" role="group" aria-label="Price scale">
              {#each ["linear", "log", "percent"] as s}
                <button class:on={scale === s} aria-pressed={scale === s} aria-label={`${s} price scale`} onclick={() => setScale(s as ChartScale)}>{s === "linear" ? "Lin" : s === "log" ? "Log" : "%"}</button>
              {/each}
            </div>
          </div>
        </div>
        <div class="range-controls">
          <div class="ranges jelly" role="tablist">
            {#each RANGES as r (r.id)}
              {@const on = !practice && (view === "chart" || view === "technicals" || view === "paper" || view === "backtest") && range === r.id}
              <button role="tab" aria-selected={on} class:on disabled={!!practice} onclick={() => setRange(r.id)}>
                {r.label}
              </button>
            {/each}
            <span class="sep"></span>
            <button role="tab" aria-selected={view === "alerts"} class:on={view === "alerts"} disabled={!!replay} onclick={() => (view = view === "alerts" ? "chart" : "alerts")}>
              Alerts
            </button>
            <button
              role="tab"
              aria-selected={view === "technicals"}
              class:on={view === "technicals"}
              onclick={() => (view = view === "technicals" ? "chart" : "technicals")}
            >
              Technicals
            </button>
            <button role="tab" aria-selected={view === "analysts"} class:on={view === "analysts"} disabled={!!replay} onclick={() => (view = view === "analysts" ? "chart" : "analysts")}>
              Analysts
            </button>
            <button role="tab" aria-selected={view === "earnings"} class:on={view === "earnings"} disabled={!!replay} onclick={() => (view = view === "earnings" ? "chart" : "earnings")}>
              Earnings
            </button>
            <button role="tab" aria-selected={view === "stats"} class:on={view === "stats"} disabled={!!replay} onclick={() => (view = view === "stats" ? "chart" : "stats")}>
              Stats
            </button>
            <button role="tab" aria-selected={view === "financials"} class:on={view === "financials"} disabled={!!replay} onclick={toggleFinancials}>
              Financials
            </button>
            <button role="tab" aria-selected={view === "paper"} class:on={view === "paper"} title={`Simulated paper trading (${keyLabel(keybinds.paper)})`} disabled={!!practice} onclick={() => (view = view === "paper" ? "chart" : "paper")}>
              Paper
            </button>
            <button role="tab" aria-selected={view === "backtest"} class:on={view === "backtest"} title={`Backtest a rule-based strategy (${keyLabel(keybinds.backtest)})`} disabled={!!replay} onclick={() => (view = view === "backtest" ? "chart" : "backtest")}>
              Strategy
            </button>
            {#if view === "news" ? (newsScope === "symbol" ? newsLoading : feedLoading) : view === "market" ? marketLoading : view === "events" ? (eventsTab === "watchlist" ? watchCalLoading : eventsTab === "calendar" ? eventsLoading || watchCalLoading : eventsLoading) : view === "options" ? optionsLoading : loading || (view === "technicals" && analyzing)}<span
                class="spin"
                aria-label="Loading"
              ></span>{/if}
          </div>
          <select aria-label="Candle interval" value={interval} disabled={!!practice} onchange={(event) => changeInterval(event.currentTarget.value)}>
            <option value="auto">Auto</option>
            {#each Scrollback.ALL_INTERVALS as i (i)}
              <option value={i}>{INTERVAL_LABELS[i] ?? i}</option>
            {/each}
          </select>
          {#if range === "1d"}
            <div class="seg" role="group" aria-label="Extended hours">
              <button class:on={chartExtended} aria-pressed={chartExtended} title="Show pre-market and after-hours candles" disabled={!!practice} onclick={() => saveChartExtended(!chartExtended)}>Ext</button>
            </div>
          {/if}
          <div class="seg" role="group" aria-label="Chart layout">
            {#each [{ id: "single", label: "1", title: "One chart" }, { id: "side", label: "Side", title: "Two charts side by side" }, { id: "stacked", label: "Stack", title: "Two charts stacked" }] as l (l.id)}
              {@const on = view === "chart" && (l.id === "single" ? !layout.split : layout.split && layout.orientation === l.id)}
              <button class:on aria-pressed={on} title={l.title} aria-label={l.title} disabled={!!replay} onclick={() => saveLayout(l.id === "single" ? { split: false } : { split: true, orientation: l.id as ChartLayout["orientation"] })}>{l.label}</button>
            {/each}
          </div>
          {#if layout.split}
            <div class="seg" role="group" aria-label="Chart sync">
              <button class:on={layout.sync_range} aria-pressed={layout.sync_range} title="Pan and zoom both charts together" disabled={!!replay} onclick={() => saveLayout({ sync_range: !layout.sync_range })}>Sync</button>
            </div>
          {/if}
          <div class="seg" role="group" aria-label="Bar replay">
            <button
              class:on={!!replay && !practice}
              aria-pressed={!!replay && !practice}
              title={practice ? "Exit practice first" : replay ? `Exit bar replay (${keyLabel(keybinds.chart_replay)} or Esc)` : canStartReplay ? `Bar replay (${keyLabel(keybinds.chart_replay)})` : "Bar replay needs more candles"}
              disabled={!!practice || (!replay && !canStartReplay)}
              onclick={toggleReplay}>Replay</button>
          </div>
          <div class="seg" role="group" aria-label="Practice">
            <button
              class:on={!!practice || practiceOpen}
              aria-pressed={!!practice || practiceOpen}
              title={practice ? `Exit practice (${keyLabel(keybinds.practice)} or Esc)` : `Practice on a random historical setup (${keyLabel(keybinds.practice)})`}
              onclick={togglePractice}>Practice</button>
          </div>
        </div>
        {#if replay && replayBars.length}
          <ReplayBar
            practice={!!practice}
            state={replay}
            intraday={replayIntraday}
            start={replayInput(replayBars[replay.start].t)}
            min={replayInput(replayBars[Replay.MIN_CONTEXT].t)}
            max={replayInput(replayBars[replayBars.length - 1].t)}
            when={replayHeader?.when ?? ""}
            onstart={restartReplay}
            ontoggle={() => replayUpdate(Replay.toggle)}
            onstep={() => replayUpdate(Replay.step)}
            onback={() => replayUpdate(Replay.stepBack)}
            onspeed={(speed) => replayUpdate((s) => Replay.setSpeed(s, speed))}
            onexit={exitReplay}
          />
        {/if}
        {#if practice || practiceOpen}
          <PracticeView
            setup={practiceSetup}
            {groups}
            count={practiceCount}
            exercise={practice}
            result={practiceResult}
            summary={practiceSummary}
            busy={practiceBusy}
            error={practiceError}
            currency={replayBase?.meta.currency ?? "USD"}
            canDecide={practiceCanDecide}
            canClose={practiceCanClose}
            whenAt={(i) => (replayBars[i] ? replayWhen(replayBars[i].t) : "")}
            onsetup={(next) => (practiceSetup = next)}
            onstart={startPractice}
            oncancel={cancelPractice}
            ondecide={practiceDecide}
            onclose={practiceClose}
            onend={endPractice}
            onnext={startPractice}
            onchange={changePractice}
          />
        {/if}
        {#key docked ? "dock" : view}
          <div class="pane" in:paneIn={view === "watchlist" && !docked ? { y: 16, speed: "slow" } : {}}>
            {#snippet panel()}
            {#if view === "watchlist"}
              <Watchlist bind:this={watchlistView} {refreshMode} symbols={watchlist} {groups} current={symbol} sort={watchlistSort} view={watchlistLayout} columns={watchlistColumns} {screens} bind:tab={groupTab} onopen={openWatched} ongroups={saveGroups} onsort={saveSort} onview={saveWatchlistLayout} oncolumns={saveWatchlistColumns} onsavescreen={saveScreen} ondeletescreen={deleteScreen} />
            {:else if view === "alerts"}
              <Alerts {symbol} {quote} {alerts} onchange={(next) => (alerts = next)} onopen={openWatched} interval={chart?.interval ?? ""} drawings={drawings[symbol.toUpperCase()] ?? []} />
            {:else if view === "analysts"}
              <Analysts {symbol} {quote} {analyst} />
            {:else if view === "earnings"}
              <EarningsView {symbol} {earnings} />
            {:else if view === "stats"}
              <StatsView {symbol} {stats} />
            {:else if view === "financials"}
              <FinancialsView {symbol} {financials} error={financialsError} onretry={() => loadFinancials()} />
            {:else if view === "market"}
              <MarketView {market} error={marketError} onretry={() => loadMarket()} onopen={openWatched} />
            {:else if view === "events"}
              <EventsView
                report={shownEvents}
                error={eventsError}
                loading={eventsLoading}
                {now}
                tab={eventsTab}
                week={eventsRange}
                weekOffset={eventsWeek}
                {today}
                filter={eventFilter}
                watchDates={watchCal}
                watchError={watchCalError}
                watchLoading={watchCalLoading}
                watchAt={watchCalAt}
                watchCount={watchlist.length}
                onrefresh={() => loadEvents(true)}
                onwatchrefresh={() => loadWatchCalendar(true)}
                ontab={showEventsTab}
                onweek={showEventsWeek}
                onfilter={saveEventFilter}
                onopensymbol={openWatched}
              />
            {:else if view === "options"}
              <OptionsView {options} error={optionsError} onretry={() => loadOptions(options?.expiry ?? undefined)} onexpiry={loadOptions} bind:side={optionsSide} />
            {:else if view === "news"}
              <News {symbol} {groups} bind:scope={newsScope} articles={news} {feed}
                emptyScope={feedSymbols.length === 0} error={newsScope === "symbol" ? newsError : feedError}
                {now} onretry={() => newsScope === "symbol" ? loadNews() : loadFeed()} />
            {/if}
            {/snippet}
            {#if docked}
              <div class="dock">
                <div class="dock-chart">
                  {#if mainChart}
                    <ChartView bind:this={chartView} redrawKey={displayKey} chart={mainChart} staleNote={replay ? null : chartStale} {mode} {scale} {shadeSessions} timeZone={chartTimeZone} {drawings} {drawingBusy} {saveDrawings} analysis={techAnalysis} {overlays} earnings={chartEarnings} ratings={chartRatings} news={chartNews} replay={!!replay} fills={chartFills} orderLines={paperLines} onmoveorder={paperMove} onolder={loadOlder} loadingOlder={olderBusy} />
                  {:else if chartError}
                    <div class="msg">
                      {chartError}
                      <button class="retry" onclick={() => loadChart(true)}>Retry</button>
                    </div>
                  {:else}
                    <ChartSkeleton />
                  {/if}
                </div>
                <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
                <div
                  class="dock-grip"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize panel"
                  aria-valuenow={dockWidth}
                  tabindex="0"
                  onpointerdown={(e) => { dockDrag = { x: e.clientX, w: dockWidth }; e.currentTarget.setPointerCapture(e.pointerId); }}
                  onpointermove={(e) => { if (dockDrag) setDockWidth(dockDrag.w + dockDrag.x - e.clientX); }}
                  onpointerup={() => (dockDrag = null)}
                  onpointercancel={() => (dockDrag = null)}
                  onkeydown={(e) => {
                    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                    e.preventDefault();
                    e.stopPropagation();
                    setDockWidth(dockWidth + (e.key === "ArrowLeft" ? 24 : -24));
                  }}
                ></div>
                <div class="dock-panel" style:width="{dockWidth}px">
                  {#key view}
                    <div class="pane" in:paneIn={{}}>{@render panel()}</div>
                  {/key}
                </div>
              </div>
            {:else if DOCKABLE.has(view)}
              {@render panel()}
            {:else if view === "technicals"}
              <div class="split">
                {#if mainChart}
                  <ChartView bind:this={chartView} redrawKey={displayKey} chart={mainChart} staleNote={replay ? null : chartStale} {mode} {scale} {shadeSessions} timeZone={chartTimeZone} {drawings} {drawingBusy} {saveDrawings} analysis={techAnalysis} {overlays} earnings={chartEarnings} ratings={chartRatings} news={chartNews} replay={!!replay} fills={chartFills} orderLines={paperLines} onmoveorder={paperMove} onolder={loadOlder} loadingOlder={olderBusy} />
                {:else if chartError}
                  <div class="msg">
                    {chartError}
                    <button class="retry" onclick={() => loadChart(true)}>Retry</button>
                  </div>
                {:else}
                  <ChartSkeleton />
                {/if}
                <Technicals
                  analysis={techAnalysis}
                  loading={replay ? replayAnalyzing || (replayAnalyzeOn && !shownReplayAnalysis && !replayAnalysisError) : analyzing}
                  error={replay ? replayAnalysisError : analysisError}
                  bars={mainChart?.candles.length ?? 0}
                  gmtoffset={analysisOffset}
                  {overlays}
                  config={indicators!}
                  presets={indicatorPresets}
                  onsave={saveIndicators}
                  onsavepreset={savePreset}
                  ondeletepreset={deletePreset}
                  onanalyze={() => runAnalysis()}
                  onalert={replay ? undefined : async (l) => {
                    alerts = await invoke<PriceAlert[]>("add_alert", { symbol, kind: "price", direction: l.direction, level: l.level, recurring: false, cooldownMins: 15, regularOnly: true });
                  }}
                />
              </div>
            {:else if view === "paper"}
              <div class="split">
                {#if mainChart}
                  <ChartView bind:this={chartView} redrawKey={displayKey} chart={mainChart} staleNote={replay ? null : chartStale} {mode} {scale} {shadeSessions} timeZone={chartTimeZone} {drawings} {drawingBusy} {saveDrawings} analysis={techAnalysis} {overlays} earnings={chartEarnings} ratings={chartRatings} news={chartNews} replay={!!replay} fills={chartFills} orderLines={paperLines} onmoveorder={paperMove} onolder={loadOlder} loadingOlder={olderBusy} />
                {:else if chartError}
                  <div class="msg">
                    {chartError}
                    <button class="retry" onclick={() => loadChart(true)}>Retry</button>
                  </div>
                {:else}
                  <ChartSkeleton />
                {/if}
                {#if paperAccount}
                  <PaperView
                    account={paperAccount}
                    {symbol}
                    currency={mainChart?.meta.currency ?? quote?.currency ?? "USD"}
                    replay={!!replay}
                    mark={paperMark}
                    markLabel={replay ? "Last revealed close" : "Last quote"}
                    marketBlock={paperMarketBlock}
                    error={paperError}
                    notice={paperNotice}
                    when={paperWhen}
                    onorder={paperOrder}
                    oncancel={paperCancel}
                    oncosts={paperCosts}
                    onreset={paperReset}
                  />
                {:else}
                  <div class="msg">{paperError ?? "Loading the simulated account…"}</div>
                {/if}
              </div>
            {:else if view === "backtest"}
              <div class="split">
                {#if mainChart}
                  <ChartView bind:this={chartView} redrawKey={displayKey} chart={mainChart} staleNote={chartStale} {mode} {scale} {shadeSessions} timeZone={chartTimeZone} {drawings} {drawingBusy} {saveDrawings} analysis={techAnalysis} {overlays} earnings={chartEarnings} ratings={chartRatings} news={chartNews} fills={chartFills} orderLines={paperLines} onmoveorder={paperMove} onolder={loadOlder} loadingOlder={olderBusy} />
                {:else if chartError}
                  <div class="msg">
                    {chartError}
                    <button class="retry" onclick={() => loadChart(true)}>Retry</button>
                  </div>
                {:else}
                  <ChartSkeleton />
                {/if}
                <BacktestView report={backtestReport} bars={mainChart?.candles.length ?? 0} currency={mainChart?.meta.currency ?? "USD"} when={chartWhen} onrun={(rules) => (backtestRules = rules)} />
              </div>
            {:else}
              <div class="charts" class:stacked={split && layout.orientation === "stacked"}>
                {#if mainChart}
                  <ChartView
                    bind:this={chartView}
                    redrawKey={displayKey}
                    chart={mainChart}
                    staleNote={replay ? null : chartStale}
                    {mode}
                    {scale}
                    {shadeSessions}
                    timeZone={chartTimeZone}
                    {drawings}
                    {drawingBusy}
                    {saveDrawings}
                    analysis={techAnalysis}
                    {overlays}
                    earnings={chartEarnings}
                    ratings={chartRatings}
                    news={chartNews}
                    linkedTime={split && syncHover?.source === "second" ? syncHover.t : null}
                    onhovertime={split ? (t) => hoverFrom("main", t) : undefined}
                    linkedWindow={split && layout.sync_range && syncWindow?.source === "second" ? syncWindow.w : null}
                    onwindow={split && layout.sync_range ? (w) => (syncWindow = { source: "main", w }) : undefined}
                    replay={!!replay}
                    fills={chartFills}
                    orderLines={paperLines}
                    onmoveorder={paperMove}
                    onolder={loadOlder}
                    loadingOlder={olderBusy}
                  />
                {:else if chartError}
                  <div class="msg">
                    {chartError}
                    <button class="retry" onclick={() => loadChart(true)}>Retry</button>
                  </div>
                {:else}
                  <ChartSkeleton />
                {/if}
                {#if split}
                  <SecondChart
                    bind:this={secondView}
                    {layout}
                    mainSymbol={symbol}
                    mainRange={range}
                    mainInterval={interval}
                    extended={chartExtended}
                    {refreshMode}
                    {recent}
                    redrawKey={displayKey}
                    {mode}
                    {scale}
                    {shadeSessions}
                    timeZone={chartTimeZone}
                    {drawings}
                    {drawingBusy}
                    {saveDrawings}
                    linkedTime={syncHover?.source === "main" ? syncHover.t : null}
                    onhovertime={(t) => hoverFrom("second", t)}
                    linkedWindow={layout.sync_range && syncWindow?.source === "main" ? syncWindow.w : null}
                    onwindow={layout.sync_range ? (w) => (syncWindow = { source: "second", w }) : undefined}
                    onlayout={saveLayout}
                  />
                {/if}
              </div>
            {/if}
          </div>
        {/key}
      </section>
    </main>
    <Footer
      {quote}
      {dataProvider}
      error={hotkeyError}
      {status}
      {quoteLabel}
      {chartLabel}
      {delayText}
      settingsOn={settingsOpen}
      onsettings={() => (settingsOpen = !settingsOpen)}
      watchlistOn={view === "watchlist"}
      onwatchlist={() => {
        if (!replay) view = view === "watchlist" ? "chart" : "watchlist";
      }}
      {refreshing}
      {refreshStatus}
      onrefresh={refresh}
    />
    {#if settingsOpen}
      <Settings bind:custom bind:theme bind:textSize bind:palette bind:refreshMode extended={chartExtended} shade={shadeSessions} timeZone={chartTimeZone} onextended={saveChartExtended} onshade={saveShadeSessions} ontimezone={saveChartTimeZone} bind:hotkey bind:error={hotkeyError} {defaultHotkey} bind:keybinds bind:dots onclose={() => (settingsOpen = false)} />
    {/if}
  </div>
{/if}

<style>
  .app {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  main {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  section {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 12px 12px 6px 14px;
  }
  .pane,
  .split {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .charts {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    gap: 10px;
  }
  .charts.stacked {
    flex-direction: column;
  }
  .dock {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }
  .dock-chart {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .dock-grip {
    flex: none;
    width: 7px;
    margin: 0 2px;
    border-left: 1px solid var(--faint);
    cursor: col-resize;
    touch-action: none;
  }
  .dock-grip:hover,
  .dock-grip:focus-visible {
    border-left-color: var(--accent);
    outline: none;
  }
  .dock-panel {
    flex: none;
    max-width: 70%;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  @media (max-width: 860px) {
    .dock-chart,
    .dock-grip {
      display: none;
    }
    .dock-panel {
      flex: 1;
      width: auto !important;
      max-width: none;
    }
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .views {
    display: flex;
    gap: 6px;
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .nav button {
    width: 24px;
    height: 24px;
    padding: 3px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .nav button:hover:not(:disabled) {
    background: var(--surface);
    color: var(--text);
  }
  .nav button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .nav svg {
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .seg {
    display: flex;
    background: var(--surface);
    border: 1px solid var(--faint);
    border-radius: 7px;
    padding: 2px;
  }
  .seg button {
    border: 0;
    background: none;
    padding: 3px 10px;
    border-radius: 5px;
    cursor: pointer;
    color: var(--muted);
    transition:
      background-color var(--motion-fast) var(--ease-out),
      color var(--motion-fast) var(--ease-out),
      box-shadow var(--motion-fast) var(--ease-out);
  }
  .seg button.on {
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  }
  .seg button:disabled,
  .ranges button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .range-controls {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .range-controls select {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--faint);
    border-radius: 6px;
    padding: 3px;
    font-size: 12px;
  }
  .ranges {
    display: flex;
    align-items: center;
    gap: 2px;
    margin: 10px 0 4px;
  }
  .ranges button {
    border: 0;
    background: none;
    padding: 3px 9px;
    border-radius: 6px;
    cursor: pointer;
    color: var(--muted);
    font-weight: 600;
    font-size: 12px;
    transition:
      background-color var(--motion-fast) var(--ease-out),
      color var(--motion-fast) var(--ease-out);
  }
  .ranges button:hover {
    color: var(--text);
  }
  .ranges button.on {
    background: var(--surface);
    color: var(--text);
  }
  .sep {
    width: 1px;
    height: 14px;
    margin: 0 6px;
    background: var(--faint);
  }
  .spin {
    width: 12px;
    height: 12px;
    margin-left: 8px;
    border: 2px solid var(--faint);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .msg {
    flex: 1;
    display: grid;
    place-content: center;
    gap: 8px;
    color: var(--muted);
    text-align: center;
  }
  .retry {
    border: 1px solid var(--faint);
    background: var(--surface);
    border-radius: 6px;
    padding: 3px 10px;
    cursor: pointer;
  }
</style>
