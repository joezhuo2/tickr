<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import Analysts from "./Analysts.svelte";
  import ChartView from "./Chart.svelte";
  import ChartSkeleton from "./ChartSkeleton.svelte";
  import HotkeyBar from "./HotkeyBar.svelte";
  import Left from "./Left.svelte";
  import Search from "./Search.svelte";
  import Watchlist from "./Watchlist.svelte";
  import { RANGES, type Chart, type ChartMode, type Consensus, type Init, type QuoteState } from "./lib/types";

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
  let view = $state<"chart" | "analysts" | "watchlist">("chart");
  let watchlist = $state<string[]>([]);
  let now = $state(Date.now() / 1000);

  let chartSeq = 0;
  let chartAt = 0;
  /** Charts fetched this session, keyed "SYMBOL|range". */
  const cache = new Map<string, { chart: Chart; at: number }>();
  const FRESH_MS = 60_000;
  const cacheKey = () => `${symbol}|${range}`;

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

  async function pickSymbol(next: string): Promise<string | null> {
    try {
      qs = await invoke<QuoteState>("set_symbol", { symbol: next });
      symbol = qs.quote?.symbol ?? next.toUpperCase();
      logo = undefined;
      loadChart();
      analyst = undefined;
      loadLogo();
      loadAnalyst();
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
    view = "chart";
    if (r === range) return;
    range = r;
    invoke("set_range", { range: r });
    loadChart();
  }

  function setMode(m: ChartMode) {
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
          <div class="seg" role="group" aria-label="Chart type">
            <button class:on={mode === "line"} onclick={() => setMode("line")}>Line</button>
            <button class:on={mode === "candles"} onclick={() => setMode("candles")}>Candles</button>
          </div>
        </div>
        <div class="ranges" role="tablist">
          {#each RANGES as r (r.id)}
            {@const on = view === "chart" && range === r.id}
            <button role="tab" aria-selected={on} class:on onclick={() => setRange(r.id)}>
              {r.label}
            </button>
          {/each}
          <span class="sep"></span>
          <button role="tab" aria-selected={view === "analysts"} class:on={view === "analysts"} onclick={() => (view = "analysts")}>
            Analysts
          </button>
          {#if loading}<span class="spin" aria-label="Loading"></span>{/if}
        </div>
        {#if view === "watchlist"}
          <Watchlist symbols={watchlist} current={symbol} onopen={openWatched} onreorder={saveWatchlist} />
        {:else if view === "analysts"}
          <Analysts {symbol} {quote} {analyst} />
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
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
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
