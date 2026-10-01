<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import ChartView from "./Chart.svelte";
  import HotkeyBar from "./HotkeyBar.svelte";
  import Left from "./Left.svelte";
  import Search from "./Search.svelte";
  import { RANGES, type Chart, type ChartMode, type Init, type QuoteState } from "./lib/types";

  let ready = $state(false);
  let symbol = $state("");
  let range = $state("1d");
  let mode = $state<ChartMode>("line");
  let hotkey = $state("");
  let defaultHotkey = $state("");
  let qs = $state<QuoteState>({ quote: null, error: null, updated_at: 0 });
  let chart = $state<Chart | null>(null);
  let chartError = $state<string | null>(null);
  let loading = $state(false);
  let logo = $state<string | null>(null);
  let now = $state(Date.now() / 1000);

  let chartSeq = 0;
  let chartAt = 0;

  const quote = $derived(qs.quote && qs.quote.symbol === symbol ? qs.quote : null);

  const status = $derived.by(() => {
    if (qs.error && !quote) return { kind: "offline" as const, text: `Offline: ${qs.error}` };
    const age = now - qs.updated_at;
    if (qs.error || age > 20 * 60) return { kind: "stale" as const, text: qs.error ? `Stale: ${qs.error}` : "Stale" };
    return { kind: "live" as const, text: age < 90 ? "Live" : `Updated ${Math.round(age / 60)} min ago` };
  });

  async function loadChart() {
    const mine = ++chartSeq;
    loading = true;
    try {
      const c = await invoke<Chart>("get_chart", { symbol, range });
      if (mine !== chartSeq) return;
      chart = c;
      chartError = null;
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

  async function pickSymbol(next: string): Promise<string | null> {
    try {
      qs = await invoke<QuoteState>("set_symbol", { symbol: next });
      symbol = qs.quote?.symbol ?? next.toUpperCase();
      chart = null;
      logo = null;
      loadChart();
      loadLogo();
      return null;
    } catch (e) {
      return String(e);
    }
  }

  function setRange(r: string) {
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
    invoke<Init>("get_init").then((init) => {
      symbol = init.symbol;
      range = init.range;
      mode = init.chart_mode;
      hotkey = init.hotkey;
      defaultHotkey = init.default_hotkey;
      qs = init.quote;
      ready = true;
      loadChart();
      loadLogo();
    });
    const un = listen<QuoteState>("quote", (e) => {
      qs = e.payload;
      // Keep the intraday chart current; longer ranges barely move.
      if (range === "1d" && Date.now() - chartAt > 60_000) loadChart();
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
      <Left {symbol} {quote} {logo} />
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
            <button role="tab" aria-selected={range === r.id} class:on={range === r.id} onclick={() => setRange(r.id)}>
              {r.label}
            </button>
          {/each}
          {#if loading}<span class="spin" aria-label="Loading"></span>{/if}
        </div>
        {#if chartError && !chart}
          <div class="msg">
            {chartError}
            <button class="retry" onclick={loadChart}>Retry</button>
          </div>
        {:else}
          <ChartView {chart} {mode} />
        {/if}
      </section>
    </main>
    <HotkeyBar bind:hotkey {defaultHotkey} {status} />
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
