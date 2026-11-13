<script lang="ts">
  import { rangeFor } from "./lib/scrollback";
  import { invoke } from "@tauri-apps/api/core";
  import { untrack } from "svelte";
  import ChartView from "./Chart.svelte";
  import ChartSkeleton from "./ChartSkeleton.svelte";
  import IntervalPicker from "./IntervalPicker.svelte";
  import Search from "./Search.svelte";
  import { aggregateChart } from "./lib/aggregate";
  import { secondaryDefaults, type TimeWindow } from "./lib/chartsync";
  import { chartAt } from "./lib/replay";
  import { isIntraday } from "./lib/session";
  import { RANGES, baseFor, validInterval, type Candle, type Chart, type ChartLayout, type ChartMode, type ChartScale, type ChartTimeZone, type Drawing, type RefreshMode } from "./lib/types";

  let {
    layout,
    mainSymbol,
    mainRange,
    mainInterval,
    extended,
    refreshMode,
    recent,
    recentIntervals = [],
    redrawKey = 0,
    mode,
    scale,
    shadeSessions,
    timeZone,
    drawings,
    drawingBusy,
    saveDrawings,
    replayAt = null,
    finer = [],
    linkedTime = null,
    onhovertime,
    linkedWindow = null,
    onwindow,
    onlayout,
  }: {
    layout: ChartLayout;
    mainSymbol: string;
    mainRange: string;
    mainInterval: string;
    extended: boolean;
    refreshMode: RefreshMode;
    recent: string[];
    recentIntervals?: string[];
    redrawKey?: number;
    mode: ChartMode;
    scale: ChartScale;
    shadeSessions: boolean;
    timeZone: ChartTimeZone;
    drawings: Record<string, Drawing[]>;
    drawingBusy: boolean;
    saveDrawings: (symbol: string, drawings: Drawing[]) => Promise<boolean>;
    replayAt?: number | null;
    finer?: Candle[];
    linkedTime?: number | null;
    onhovertime?: (t: number | null) => void;
    linkedWindow?: TimeWindow | null;
    onwindow?: (w: TimeWindow) => void;
    onlayout: (patch: Partial<ChartLayout>) => void;
  } = $props();

  const FRESH_MS = 60_000;
  const symbol = $derived(layout.symbol || mainSymbol);
  const defaults = $derived(secondaryDefaults(mainRange, mainInterval));
  const range = $derived(layout.range || defaults.range);
  const interval = $derived(validInterval(range, layout.range ? layout.interval : defaults.interval));
  const key = $derived(`${symbol}|${range}|${interval}|${extended && range === "1d"}`);

  let chart = $state<Chart | null>(null);
  const shown = $derived(chart && replayAt != null ? chartAt(chart, replayAt, layout.symbol ? [] : finer) : chart);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let at = 0;
  let seq = 0;
  const cache = new Map<string, { chart: Chart; at: number }>();

  async function fetchChart(sym: string) {
    const shown = interval;
    const c = await invoke<Chart>("get_chart", { symbol: sym, range, interval: baseFor(shown, range) ?? shown, extended, secondary: true });
    return aggregateChart(c, shown);
  }

  export async function load(force = false): Promise<string | undefined> {
    const mine = ++seq;
    const k = key;
    const hit = cache.get(k);
    if (!force) chart = hit?.chart ?? null;
    error = null;
    if (hit && !force && Date.now() - hit.at < FRESH_MS) {
      at = hit.at;
      loading = false;
      return;
    }
    loading = true;
    try {
      const c = await fetchChart(symbol);
      if (mine !== seq) return;
      cache.set(k, { chart: c, at: Date.now() });
      chart = c;
      at = Date.now();
    } catch (e) {
      if (mine === seq && (!force || !chart)) error = String(e);
      return String(e);
    } finally {
      if (mine === seq) loading = false;
    }
  }

  export function clearCache() {
    cache.clear();
  }

  $effect(() => {
    void key;
    untrack(() => load());
  });

  $effect(() => {
    const every = refreshMode === "low_power" ? 600_000 : 300_000;
    const timer = setInterval(() => {
      if (document.hidden || loading || !isIntraday(chart?.interval ?? "")) return;
      if (Date.now() - at >= every) void load(true);
    }, 60_000);
    return () => clearInterval(timer);
  });

  async function pick(next: string): Promise<string | null> {
    const sym = next.trim().toUpperCase();
    if (!sym) return "empty symbol";
    if (sym === symbol) return null;
    try {
      const c = await fetchChart(sym);
      cache.set(`${sym}|${range}|${interval}|${extended && range === "1d"}`, { chart: c, at: Date.now() });
      onlayout({ symbol: sym === mainSymbol.toUpperCase() ? "" : sym });
      return null;
    } catch (e) {
      return String(e);
    }
  }

  function setRange(r: string) {
    onlayout({ range: r, interval: validInterval(r, interval) });
  }

  function chooseInterval(i: string) {
    const r = rangeFor(range, i);
    onlayout({ range: r, interval: validInterval(r, i) });
  }
</script>

<div class="second">
  <div class="head">
    <Search onpick={pick} {recent} current={symbol} />
    <span class="sym" title={layout.symbol ? "Second chart symbol" : "Follows the main chart symbol"}>{symbol}</span>
    {#if layout.symbol}
      <button class="follow" title="Follow the main chart symbol" aria-label="Follow the main chart symbol" onclick={() => onlayout({ symbol: "" })}>Follow</button>
    {/if}
    <select aria-label="Second chart range" value={range} onchange={(e) => setRange(e.currentTarget.value)}>
      {#each RANGES as r (r.id)}
        <option value={r.id}>{r.label}</option>
      {/each}
    </select>
    <IntervalPicker label="Second chart interval" value={interval} recent={recentIntervals} onchange={chooseInterval} />
    {#if loading}<span class="spin" aria-label="Loading"></span>{/if}
  </div>
  {#if shown}
    <ChartView {redrawKey} chart={shown} {mode} {scale} {shadeSessions} {timeZone} {drawings} {drawingBusy} {saveDrawings} {linkedTime} {onhovertime} {linkedWindow} {onwindow} replay={replayAt != null} />
  {:else if chart}
    <div class="msg">No {symbol} candles at the replay moment</div>
  {:else if error}
    <div class="msg">
      {error}
      <button class="retry" onclick={() => load(true)}>Retry</button>
    </div>
  {:else}
    <ChartSkeleton />
  {/if}
</div>

<style>
  .second {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0 4px;
  }
  .head :global(.search) {
    width: 140px;
  }
  .sym {
    font-weight: 600;
    font-size: 12px;
  }
  select,
  .follow,
  .retry {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--faint);
    border-radius: 6px;
    padding: 3px;
    font-size: 12px;
  }
  .follow {
    padding: 3px 8px;
    color: var(--muted);
    cursor: pointer;
  }
  .follow:hover {
    color: var(--text);
  }
  .spin {
    width: 12px;
    height: 12px;
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
    padding: 3px 10px;
    cursor: pointer;
  }
</style>
