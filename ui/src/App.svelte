<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import Analysts from "./Analysts.svelte";
  import ChartView from "./Chart.svelte";
  import ChartSkeleton from "./ChartSkeleton.svelte";
  import HotkeyBar from "./HotkeyBar.svelte";
  import Left from "./Left.svelte";
  import News from "./News.svelte";
  import Search from "./Search.svelte";
  import Technicals from "./Technicals.svelte";
  import Watchlist from "./Watchlist.svelte";
  import {
    RANGES,
    type Analysis,
    type Article,
    type Chart,
    type ChartMode,
    type Consensus,
    type Init,
    type Overlays,
    type QuoteState,
  } from "./lib/types";

  // Injected before load, so the first frame already has real content.
  const boot = window.__TICKR_INIT__ ?? null;

  let ready = $state(false);
  let symbol = $state("");
  let range = $state("1d");
  let mode = $state<ChartMode>("line");
  let hotkey = $state("");
  let defaultHotkey = $state("");
  let hotkeyError = $state<string | null>(null);
  let qs = $state<QuoteState>({ quote: null, error: null, updated_at: 0 });
  let chart = $state<Chart | null>(null);
  let chartError = $state<string | null>(null);
  let loading = $state(false);
  // undefined while loading (skeleton), null when there is no logo.
  let logo = $state<string | null | undefined>(undefined);
  // undefined while loading, null when there is no coverage (or it failed).
  let analyst = $state<Consensus | null | undefined>(undefined);
  let view = $state<"chart" | "technicals" | "analysts" | "news" | "watchlist">("chart");
  // Technical analysis: computed only when the user clicks Analyze, and
  // cleared when the symbol or range changes. A chart refresh keeps it.
  const ALL_OVERLAYS: Overlays = { mas: true, fib: true, targets: true, patterns: true, rsi: true };
  let analysis = $state<Analysis | null>(null);
  /** cacheKey() the analysis belongs to. */
  let analysisKey = $state("");
  let analyzing = $state(false);
  let analysisError = $state<string | null>(null);
  let overlays = $state<Overlays>({ ...ALL_OVERLAYS });
  let analysisSeq = 0;
  // undefined while loading with nothing cached for the symbol.
  let news = $state<Article[] | undefined>(undefined);
  let newsError = $state<string | null>(null);
  let newsLoading = $state(false);
  let watchlist = $state<string[]>([]);
  let now = $state(Date.now() / 1000);

  let chartSeq = 0;
  let chartAt = 0;
  /** Charts fetched this session, keyed "SYMBOL|range". */
  const cache = new Map<string, { chart: Chart; at: number }>();
  const FRESH_MS = 60_000;
  const cacheKey = () => `${symbol}|${range}`;
  /** Headlines fetched this session, keyed by symbol. */
  const newsCache = new Map<string, Article[]>();
  let newsSeq = 0;

  function apply(init: Init) {
    symbol = init.symbol;
    range = init.range;
    mode = init.chart_mode;
    hotkey = init.hotkey;
    defaultHotkey = init.default_hotkey;
    hotkeyError = init.hotkey_error;
    qs = init.quote;
    watchlist = init.watchlist ?? [];
    if (init.logo_known) logo = init.logo;
    if (init.analyst_known) analyst = init.analyst;
    // Shown at once, refreshed by loadChart (at = 0 marks it stale).
    if (init.chart) cache.set(cacheKey(), { chart: init.chart, at: 0 });
    ready = true;
    loadChart();
    if (!init.logo_known) loadLogo();
    if (!init.analyst_known) loadAnalyst();
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
  async function loadChart(force = false) {
    const mine = ++chartSeq;
    const key = cacheKey();
    const hit = cache.get(key);
    chart = hit?.chart ?? null;
    chartError = null;
    if (hit && !force && Date.now() - hit.at < FRESH_MS) {
      loading = false;
      chartAt = hit.at;
      return;
    }
    loading = true;
    try {
      const c = await invoke<Chart>("get_chart", { symbol, range });
      cache.set(key, { chart: c, at: Date.now() });
      if (mine !== chartSeq) return;
      chart = c;
      chartAt = Date.now();
    } catch (e) {
      if (mine === chartSeq) chartError = String(e);
    } finally {
      if (mine === chartSeq) loading = false;
    }
  }

  async function loadLogo() {
    const sym = symbol;
    const l = await invoke<string | null>("get_logo", { symbol: sym }).catch(() => null);
    if (sym === symbol) logo = l;
  }

  async function loadAnalyst() {
    const sym = symbol;
    const a = await invoke<Consensus | null>("get_analyst", { symbol: sym }).catch(() => null);
    if (sym === symbol) analyst = a;
  }

  /** Shows cached headlines at once, then refetches. Only runs when News opens. */
  async function loadNews() {
    const mine = ++newsSeq;
    const sym = symbol;
    news = newsCache.get(sym);
    newsError = null;
    newsLoading = true;
    try {
      const list = await invoke<Article[]>("get_news", { symbol: sym });
      newsCache.set(sym, list);
      if (mine === newsSeq) news = list;
    } catch (e) {
      if (mine === newsSeq) newsError = String(e);
    } finally {
      if (mine === newsSeq) newsLoading = false;
    }
  }

  function openNews() {
    view = "news";
    loadNews();
  }

  const activeAnalysis = $derived(analysis && analysisKey === cacheKey() ? analysis : null);

  /** Runs the local technical analysis on the chart on screen. */
  async function runAnalysis() {
    const mine = ++analysisSeq;
    const key = cacheKey();
    analyzing = true;
    analysisError = null;
    try {
      const a = await invoke<Analysis>("analyze", { symbol, range });
      if (mine !== analysisSeq || key !== cacheKey()) return;
      analysis = a;
      analysisKey = key;
    } catch (e) {
      if (mine === analysisSeq) analysisError = String(e);
    } finally {
      if (mine === analysisSeq) analyzing = false;
    }
  }

  /** Drops results and overlays; the Analyze button shows again. */
  function clearAnalysis() {
    analysisSeq++;
    analysis = null;
    analysisKey = "";
    analyzing = false;
    analysisError = null;
    overlays = { ...ALL_OVERLAYS };
  }

  async function pickSymbol(next: string): Promise<string | null> {
    try {
      qs = await invoke<QuoteState>("set_symbol", { symbol: next });
      symbol = qs.quote?.symbol ?? next.toUpperCase();
      clearAnalysis();
      logo = undefined;
      loadChart();
      analyst = undefined;
      loadLogo();
      loadAnalyst();
      if (view === "news") loadNews();
      return null;
    } catch (e) {
      return String(e);
    }
  }

  async function saveWatchlist(next: string[]) {
    watchlist = next;
    watchlist = await invoke<string[]>("set_watchlist", { symbols: next }).catch(() => next);
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
    clearAnalysis();
    invoke("set_range", { range: r });
    loadChart();
  }

  function setMode(m: ChartMode) {
    if (view !== "technicals") view = "chart";
    mode = m;
    invoke("set_chart_mode", { mode: m });
  }

  onMount(() => {
    if (!boot) invoke<Init>("get_init").then(apply);
    // Reveal after the first frame. A hidden window may throttle rAF, so a
    // short timer races it.
    let revealed = false;
    const reveal = () => {
      if (!revealed) invoke("window_ready");
      revealed = true;
    };
    requestAnimationFrame(() => requestAnimationFrame(reveal));
    setTimeout(reveal, 60);
    const un = listen<QuoteState>("quote", (e) => {
      qs = e.payload;
      // Keep the intraday chart current; longer ranges barely move.
      if (range === "1d" && Date.now() - chartAt > FRESH_MS) loadChart(true);
    });
    const tick = setInterval(() => (now = Date.now() / 1000), 15_000);
    return () => {
      un.then((f) => f());
      clearInterval(tick);
    };
  });
</script>

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
          <Search onpick={pickSymbol} />
          <div class="views">
            <div class="seg">
              <button class:on={view === "news"} aria-pressed={view === "news"} onclick={openNews}>News</button>
            </div>
            <div class="seg" role="group" aria-label="Chart type">
              <button class:on={view !== "news" && mode === "line"} onclick={() => setMode("line")}>Line</button>
              <button class:on={view !== "news" && mode === "candles"} onclick={() => setMode("candles")}>Candles</button>
            </div>
          </div>
        </div>
        <div class="ranges" role="tablist">
          {#each RANGES as r (r.id)}
            {@const on = (view === "chart" || view === "technicals") && range === r.id}
            <button role="tab" aria-selected={on} class:on onclick={() => setRange(r.id)}>
              {r.label}
            </button>
          {/each}
          <span class="sep"></span>
          <button
            role="tab"
            aria-selected={view === "technicals"}
            class:on={view === "technicals"}
            onclick={() => (view = "technicals")}
          >
            Technicals
          </button>
          <button role="tab" aria-selected={view === "analysts"} class:on={view === "analysts"} onclick={() => (view = "analysts")}>
            Analysts
          </button>
          {#if view === "news" ? newsLoading : loading || (view === "technicals" && analyzing)}<span
              class="spin"
              aria-label="Loading"
            ></span>{/if}
        </div>
        {#if view === "watchlist"}
          <Watchlist symbols={watchlist} current={symbol} onopen={openWatched} />
        {:else if view === "analysts"}
          <Analysts {symbol} {quote} {analyst} />
        {:else if view === "news"}
          <News {symbol} articles={news} error={newsError} {now} onretry={loadNews} />
        {:else if view === "technicals"}
          <div class="split">
            {#if chart}
              <ChartView {chart} {mode} analysis={activeAnalysis} {overlays} />
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
              bind:overlays
              onanalyze={runAnalysis}
            />
          </div>
        {:else if chart}
          <ChartView {chart} {mode} />
        {:else if chartError}
          <div class="msg">
            {chartError}
            <button class="retry" onclick={() => loadChart(true)}>Retry</button>
          </div>
        {:else}
          <ChartSkeleton />
        {/if}
      </section>
    </main>
    <HotkeyBar
      bind:hotkey
      bind:error={hotkeyError}
      {defaultHotkey}
      {status}
      watchlistOn={view === "watchlist"}
      onwatchlist={() => (view = view === "watchlist" ? "chart" : "watchlist")}
    />
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
  }
  .seg button.on {
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
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
