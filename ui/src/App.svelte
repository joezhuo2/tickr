<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { onMount, tick, untrack } from "svelte";
  import Analysts from "./Analysts.svelte";
  import Alerts from "./Alerts.svelte";
  import ChartView from "./Chart.svelte";
  import ChartSkeleton from "./ChartSkeleton.svelte";
  import EarningsView from "./Earnings.svelte";
  import EventsView from "./Events.svelte";
  import Footer from "./Footer.svelte";
  import MarketView from "./Market.svelte";
  import OptionsView from "./Options.svelte";
  import StatsView from "./Stats.svelte";
  import Left from "./Left.svelte";
  import News from "./News.svelte";
  import Search from "./Search.svelte";
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
    type FeedArticle,
    type Chart,
    type ChartMode,
    type RefreshMode,
    type ChartScale,
    type Market,
    type Options,
    type Consensus,
    type Dots,
    type Earnings,
    type EventsReport,
    type Group,
    type WatchlistSort,
    type Init,
    type Keybinds,
    type IndicatorConfig,
    type IndicatorPreset,
    type QuoteState,
    type PriceAlert,
    type RatingChange,
    type StatSection,
  } from "./lib/types";
  import { actionFor, bindKey, nextGroupTab } from "./lib/keybinds";
  import { overlayVisibility, shouldAnalyze } from "./lib/indicators";
  import { applyDisplay } from "./lib/display";
  import type { Theme, TextSize, Palette } from "./lib/types";
  import { refreshOutcome, type RefreshView } from "./lib/refresh";
  import { paneIn } from "./lib/motion";
  import { emptyHistory, goBack, goForward, previous, pushRecent, visit, type History, type Move } from "./lib/history";
  import { DEFAULT_WATCHLIST_SORT } from "./lib/watchlistSort";

  // Injected before load, so the first frame already has real content.
  const boot = window.__TICKR_INIT__ ?? null;

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
  $effect(() => {
    applyDisplay(document.documentElement, theme, palette);
    void textSize;
    untrack(() => displayKey++);
  });

  let mode = $state<ChartMode>("line");
  let refreshMode = $state<RefreshMode>("balanced");
  let scale = $state<ChartScale>("linear");
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
  let market = $state<Market | undefined>(undefined);
  let marketError = $state<string | null>(null);
  let marketLoading = $state(false);
  let events = $state<EventsReport | undefined>(undefined);
  let eventsError = $state<string | null>(null);
  let eventsLoading = $state(false);
  let eventsSeq = 0;
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
  let groupTab = $state<string | null>(null);
  let alerts = $state<PriceAlert[]>([]);
  let recent = $state<string[]>([]);
  let history = $state<History>(emptyHistory());
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
  const cacheKey = () => `${symbol}|${range}|${interval}`;
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
  }
  if (boot) apply(boot);

  const quote = $derived(qs.quote && qs.quote.symbol === symbol ? qs.quote : null);

  const status = $derived.by(() => {
    if (qs.error && !quote) return { kind: "offline" as const, text: `Offline: ${qs.error}` };
    if (!quote) return { kind: "loading" as const, text: "Loading…" };
    const age = now - qs.updated_at;
    if (qs.error || age > 20 * 60) return { kind: "stale" as const, text: qs.error ? `Stale: ${qs.error}` : "Stale" };
    return { kind: "live" as const, text: age < 90 ? "Live" : `Updated ${Math.round(age / 60)} min ago` };
  });

  /** Shows the cached chart (or a skeleton) at once, then fetches if stale. */
  async function loadChart(force = false, manual = false) {
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
      const c = await invoke<Chart>("get_chart", { symbol, range, interval });
      if (mine !== chartSeq) return;
      cache.set(key, { chart: c, at: Date.now() });
      chart = c;
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

  const activeAnalysis = $derived(analysis && analysisKey === cacheKey() ? analysis : null);

  /** Runs the local technical analysis on the chart on screen. */
  async function runAnalysis(background = false) {
    if (!chart || (background && loading)) return;
    const mine = ++analysisSeq;
    const key = cacheKey();
    analyzing = !background;
    analysisError = null;
    try {
      const a = await invoke<Analysis>("analyze", { symbol, range, interval });
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

  function toggleStar() {
    saveWatchlist(watchlist.includes(symbol) ? watchlist.filter((s) => s !== symbol) : [...watchlist, symbol]);
  }

  async function openWatched(next: string) {
    view = "chart";
    if (next !== symbol) await pickSymbol(next);
  }

  function setRange(r: string) {
    // The Technicals view keeps its split chart across range changes.
    if (view !== "technicals") view = "chart";
    if (r === range) return;
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
    interval = validInterval(range, next);
    const saved = interval;
    clearAnalysis();
    chartSettingsWrite = chartSettingsWrite
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

  async function loadEvents(force = false, manual = false) {
    const mine = ++eventsSeq;
    eventsError = null;
    eventsLoading = true;
    try {
      const r = await invoke<EventsReport>("get_events", { force });
      if (mine === eventsSeq) events = r;
    } catch (e) {
      if ((!manual || !events) && mine === eventsSeq) eventsError = String(e);
      return String(e);
    } finally {
      if (mine === eventsSeq) eventsLoading = false;
    }
  }

  function toggleEvents() {
    view = view === "events" ? "chart" : "events";
    if (view === "events") loadEvents();
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
    let panelDone: Promise<string | void>;
    switch (activeView) {
      case "news": panelDone = newsScope === "symbol" ? loadNews(true) : loadFeed(newsScope, [...feedSymbols], true); break;
      case "earnings": panelDone = loadEarnings(true); break;
      case "stats": panelDone = loadStats(true); break;
      case "analysts": panelDone = Promise.all([loadAnalyst(true), loadRatingChanges(true)]).then((errors) => errors.find(Boolean)); break;
      case "events": panelDone = loadEvents(true, true); break;
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

  function setMode(m: ChartMode) {
    if (view !== "technicals") view = "chart";
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
    const key = bindKey(e);
    const action = key && actionFor(keybinds, key);
    if (!action) return;
    e.preventDefault();
    switch (action) {
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
        setMode(mode === "line" ? "candles" : "line");
        break;
      case "chart_scale":
        setScale(scale === "linear" ? "log" : scale === "log" ? "percent" : "linear");
        break;
      case "chart_interval":
        changeInterval(nextInterval(range, interval));
        break;
      case "draw_level":
      case "draw_trend":
      case "draw_text":
      case "draw_ruler": {
        if (e.repeat) break;
        if (view !== "chart" && view !== "technicals") view = "chart";
        await tick();
        const tools = { draw_level: "hline", draw_trend: "trend", draw_text: "text", draw_ruler: "ruler" } as const;
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
        if (!e.repeat && view === "technicals" && !analyzing) runAnalysis();
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
      cache.clear();
      clearAnalysis();
      void loadChart(true);
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
        {symbol}
        {quote}
        {logo}
        {analyst}
        starred={watchlist.includes(symbol)}
        onanalysts={() => (view = "analysts")}
        onstar={toggleStar}
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
              <button class:on={view === "options"} aria-pressed={view === "options"} onclick={toggleOptions}>Options</button>
            </div>
            <div class="seg">
              <button class:on={view === "market"} aria-pressed={view === "market"} onclick={toggleMarket}>Market</button>
            </div>
            <div class="seg">
              <button class:on={view === "events"} aria-pressed={view === "events"} onclick={toggleEvents}>Events</button>
            </div>
            <div class="seg">
              <button class:on={view === "news"} aria-pressed={view === "news"} onclick={toggleNews}>News</button>
            </div>
            <div class="seg" role="group" aria-label="Chart type">
              <button class:on={view !== "news" && view !== "market" && view !== "events" && view !== "options" && mode === "line"} onclick={() => setMode("line")}>Line</button>
              <button class:on={view !== "news" && view !== "market" && view !== "events" && view !== "options" && mode === "candles"} onclick={() => setMode("candles")}>Candles</button>
            </div>
            <div class="seg" role="group" aria-label="Price scale">
              {#each ["linear", "log", "percent"] as s}
                <button class:on={scale === s} aria-pressed={scale === s} aria-label={`${s} price scale`} onclick={() => setScale(s as ChartScale)}>{s === "linear" ? "Lin" : s === "log" ? "Log" : "%"}</button>
              {/each}
            </div>
          </div>
        </div>
        <div class="range-controls">
          <div class="ranges" role="tablist">
            {#each RANGES as r (r.id)}
              {@const on = (view === "chart" || view === "technicals") && range === r.id}
              <button role="tab" aria-selected={on} class:on onclick={() => setRange(r.id)}>
                {r.label}
              </button>
            {/each}
            <span class="sep"></span>
            <button role="tab" aria-selected={view === "alerts"} class:on={view === "alerts"} onclick={() => (view = view === "alerts" ? "chart" : "alerts")}>
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
            <button role="tab" aria-selected={view === "analysts"} class:on={view === "analysts"} onclick={() => (view = view === "analysts" ? "chart" : "analysts")}>
              Analysts
            </button>
            <button role="tab" aria-selected={view === "earnings"} class:on={view === "earnings"} onclick={() => (view = view === "earnings" ? "chart" : "earnings")}>
              Earnings
            </button>
            <button role="tab" aria-selected={view === "stats"} class:on={view === "stats"} onclick={() => (view = view === "stats" ? "chart" : "stats")}>
              Stats
            </button>
            {#if view === "news" ? (newsScope === "symbol" ? newsLoading : feedLoading) : view === "market" ? marketLoading : view === "events" ? eventsLoading : view === "options" ? optionsLoading : loading || (view === "technicals" && analyzing)}<span
                class="spin"
                aria-label="Loading"
              ></span>{/if}
          </div>
          <select aria-label="Candle interval" value={interval} onchange={(event) => changeInterval(event.currentTarget.value)}>
            <option value="auto">Auto</option>
            {#each intervalsFor(range) as i (i)}
              <option value={i}>{INTERVAL_LABELS[i] ?? i}</option>
            {/each}
          </select>
        </div>
        {#key view}
          <div class="pane" in:paneIn={view === "watchlist" ? { y: 16, speed: "slow" } : {}}>
            {#if view === "watchlist"}
              <Watchlist bind:this={watchlistView} {refreshMode} symbols={watchlist} {groups} current={symbol} sort={watchlistSort} bind:tab={groupTab} onopen={openWatched} ongroups={saveGroups} onsort={saveSort} />
            {:else if view === "alerts"}
              <Alerts {symbol} {quote} {alerts} onchange={(next) => (alerts = next)} />
            {:else if view === "analysts"}
              <Analysts {symbol} {quote} {analyst} />
            {:else if view === "earnings"}
              <EarningsView {symbol} {earnings} />
            {:else if view === "stats"}
              <StatsView {symbol} {stats} />
            {:else if view === "market"}
              <MarketView {market} error={marketError} onretry={() => loadMarket()} onopen={openWatched} />
            {:else if view === "events"}
              <EventsView report={events} error={eventsError} loading={eventsLoading} {now} onrefresh={() => loadEvents(true)} />
            {:else if view === "options"}
              <OptionsView {options} error={optionsError} onretry={() => loadOptions(options?.expiry ?? undefined)} onexpiry={loadOptions} bind:side={optionsSide} />
            {:else if view === "news"}
              <News {symbol} {groups} bind:scope={newsScope} articles={news} {feed}
                emptyScope={feedSymbols.length === 0} error={newsScope === "symbol" ? newsError : feedError}
                {now} onretry={() => newsScope === "symbol" ? loadNews() : loadFeed()} />
            {:else if view === "technicals"}
              <div class="split">
                {#if chart}
                  <ChartView bind:this={chartView} redrawKey={displayKey} {chart} {mode} {scale} {drawings} {drawingBusy} {saveDrawings} analysis={activeAnalysis} {overlays} earnings={dots.earnings ? earnings?.history : []} ratings={dots.analysts ? ratingChanges : []} news={dots.news ? news : []} />
                {:else if chartError}
                  <div class="msg">
                    {chartError}
                    <button class="retry" onclick={() => loadChart(true)}>Retry</button>
                  </div>
                {:else}
                  <ChartSkeleton />
                {/if}
                <Technicals
                  analysis={activeAnalysis}
                  loading={analyzing}
                  error={analysisError}
                  bars={chart?.candles.length ?? 0}
                  gmtoffset={chart?.meta.gmtoffset ?? 0}
                  {overlays}
                  config={indicators!}
                  presets={indicatorPresets}
                  onsave={saveIndicators}
                  onsavepreset={savePreset}
                  ondeletepreset={deletePreset}
                  onanalyze={() => runAnalysis()}
                />
              </div>
            {:else if chart}
              <ChartView bind:this={chartView} redrawKey={displayKey} {chart} {mode} {scale} {drawings} {drawingBusy} {saveDrawings} earnings={dots.earnings ? earnings?.history : []} ratings={dots.analysts ? ratingChanges : []} news={dots.news ? news : []} />
            {:else if chartError}
              <div class="msg">
                {chartError}
                <button class="retry" onclick={() => loadChart(true)}>Retry</button>
              </div>
            {:else}
              <ChartSkeleton />
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
      settingsOn={settingsOpen}
      onsettings={() => (settingsOpen = !settingsOpen)}
      watchlistOn={view === "watchlist"}
      onwatchlist={() => (view = view === "watchlist" ? "chart" : "watchlist")}
      {refreshing}
      {refreshStatus}
      onrefresh={refresh}
    />
    {#if settingsOpen}
      <Settings bind:theme bind:textSize bind:palette bind:refreshMode bind:hotkey bind:error={hotkeyError} {defaultHotkey} bind:keybinds bind:dots onclose={() => (settingsOpen = false)} />
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
