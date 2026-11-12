<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { direction, num, signed, volume } from "./lib/format";
  import { heatColor, tileDetail } from "./lib/heatmap";
  import { HOTLISTS, hotlist, type HotlistId } from "./lib/hotlists";
  import { layoutMarket, SECTOR_HEAD, sectorNames } from "./lib/marketmap";
  import type { HeatQuote, Market, Mover } from "./lib/types";

  let {
    market,
    error,
    onretry,
    onopen,
  }: {
    market: Market | undefined;
    error: string | null;
    onretry: () => void;
    onopen: (symbol: string) => void;
  } = $props();

  const sections = $derived(
    market
      ? [
          { title: "Indices", rows: market.indices, symbols: false },
          { title: "Rates, commodities, FX & crypto", rows: market.macros, symbols: false },
          { title: "Sectors", rows: market.sectors, symbols: true },
        ]
      : [],
  );

  let list = $state<HotlistId>("gainers");
  const hot = $derived(market ? hotlist(market, list) : []);

  let mode = $state<"overview" | "heatmap">("overview");
  let rows = $state.raw<HeatQuote[] | undefined>(undefined);
  let mapError = $state<string | null>(null);
  let sector = $state<string | null>(null);
  let mapW = $state(0);
  let mapH = $state(0);
  const names = $derived(rows ? sectorNames(rows) : []);
  const blocks = $derived(rows ? layoutMarket(rows, sector, mapW, mapH) : []);
  const bySymbol = $derived(new Map((rows ?? []).map((r) => [r.symbol, r])));

  async function loadMap() {
    try {
      rows = await invoke<HeatQuote[]>("get_heatmap");
      mapError = null;
    } catch (e) {
      mapError = String(e);
    }
  }

  $effect(() => {
    if (mode === "heatmap" && market) void loadMap();
  });

  function tip(symbol: string): string {
    const r = bySymbol.get(symbol);
    if (!r) return symbol;
    return `${r.name} (${r.symbol}): ${num(r.price)} (${signed(r.change_pct)}%), market cap $${volume(r.market_cap)}`;
  }
</script>

{#snippet row(m: Mover, showSymbol: boolean, px?: string | null, hotPct?: number | null)}
  {@const pct = hotPct === undefined ? m.change_pct : hotPct}
  <button class="row" title={`${m.name} (${m.symbol})`} onclick={() => onopen(m.symbol)}>
    <span class="name">{#if showSymbol}<b>{m.symbol}</b> {/if}{m.name}</span>
    <span class="px">{px ?? (m.price == null ? "—" : num(m.price))}</span>
    <span class="pct {direction(pct)}">{pct == null ? "—" : `${signed(pct)}%`}</span>
  </button>
{/snippet}

{#if market === undefined && error}
  <div class="msg">
    Could not load the market: {error}
    <button class="retry" onclick={onretry}>Retry</button>
  </div>
{:else if market === undefined}
  <div class="grid" aria-busy="true" aria-label="Loading market">
    {#each [0, 1, 2, 3] as i (i)}
      <section>
        <span class="sk" style="width: 90px; height: 12px"></span>
        {#each [0, 1, 2, 3, 4] as j (j)}
          <span class="sk" style="width: 100%; height: 12px; margin-top: 10px"></span>
        {/each}
      </section>
    {/each}
  </div>
{:else}
  <div class="seg top" role="group" aria-label="Market view">
    <button class:on={mode === "overview"} aria-pressed={mode === "overview"} onclick={() => (mode = "overview")}>Overview</button>
    <button class:on={mode === "heatmap"} aria-pressed={mode === "heatmap"} onclick={() => (mode = "heatmap")}>Heatmap</button>
  </div>
{#if mode === "heatmap"}
  <div class="mapwrap">
    <div class="seg" role="group" aria-label="Sector">
      <button class:on={sector === null} aria-pressed={sector === null} onclick={() => (sector = null)}>All</button>
      {#each names as n (n)}
        <button class:on={sector === n} aria-pressed={sector === n} onclick={() => (sector = n)}>{n}</button>
      {/each}
    </div>
    {#if rows === undefined && mapError}
      <div class="msg">
        Could not load the heatmap: {mapError}
        <button class="retry" onclick={loadMap}>Retry</button>
      </div>
    {:else if rows === undefined}
      <div class="sk mapsk" aria-busy="true" aria-label="Loading heatmap"></div>
    {:else}
      <div class="map" bind:clientWidth={mapW} bind:clientHeight={mapH}>
        {#each blocks as b (b.name)}
          <div class="block" style="left: {b.x}px; top: {b.y}px; width: {b.w}px; height: {b.h}px">
            <span class="blabel">{b.name}</span>
            <div class="inner" style="top: {SECTOR_HEAD}px">
              {#each b.tiles as t (t.id)}
                {@const d = tileDetail(t.w, t.h)}
                {@const pct = bySymbol.get(t.id)?.change_pct}
                <button
                  class="tile"
                  style="left: {t.x}px; top: {t.y}px; width: {t.w}px; height: {t.h}px; background: {heatColor(pct)}"
                  title={tip(t.id)}
                  aria-label={tip(t.id)}
                  onclick={() => onopen(t.id)}
                >
                  {#if d !== "none"}<span class="tsym" class:big={d === "full"}>{t.id}</span>{/if}
                  {#if d === "full"}<span class="tchg">{pct == null ? "—" : `${signed(pct)}%`}</span>{/if}
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{:else}
  <div class="grid">
    {#each sections as s (s.title)}
      {#if s.rows.length}
        <section>
          <h2>{s.title}</h2>
          {#each s.rows as m (m.symbol)}
            {@render row(m, s.symbols)}
          {/each}
        </section>
      {/if}
    {/each}
    <section class="hot">
      <div class="seg" role="group" aria-label="Hotlist">
        {#each HOTLISTS as h (h.id)}
          <button class:on={list === h.id} aria-pressed={list === h.id} onclick={() => (list = h.id)}>{h.label}</button>
        {/each}
      </div>
      <div class="scroll">
        {#each hot as r (r.mover.symbol)}
          {@render row(r.mover, true, r.px, r.pct)}
        {:else}
          <div class="empty">Nothing matches right now.</div>
        {/each}
      </div>
    </section>
  </div>
{/if}
{/if}

<style>
  .top {
    margin: 10px 0 0 4px;
  }
  .mapwrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 10px 8px 4px;
  }
  .mapsk {
    flex: 1;
    min-height: 0;
  }
  .map {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    border-radius: 6px;
  }
  .block {
    position: absolute;
    overflow: hidden;
  }
  .blabel {
    display: block;
    height: 18px;
    padding: 0 3px;
    font-size: 11px;
    font-weight: 600;
    line-height: 18px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .inner {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
  }
  .tile {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    padding: 2px;
    border: 1px solid var(--bg);
    border-radius: 4px;
    color: var(--text);
    cursor: pointer;
    overflow: hidden;
    font-variant-numeric: tabular-nums;
    transition: filter var(--motion-fast) var(--ease-out);
  }
  .tile:hover,
  .tile:focus-visible {
    filter: brightness(1.08) saturate(1.1);
    z-index: 1;
  }
  .tsym {
    max-width: 100%;
    font-weight: 750;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tsym.big {
    font-size: 14px;
  }
  .tchg {
    max-width: 100%;
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .grid {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    align-content: start;
    gap: 18px 28px;
    padding: 14px 10px 8px 4px;
    overflow: auto;
    overscroll-behavior: contain;
  }
  section {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .hot {
    grid-column: 1 / -1;
    gap: 8px;
  }
  .scroll {
    max-height: 420px;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .empty {
    padding: 8px 0;
    color: var(--muted);
    font-size: 12px;
  }
  .seg {
    display: flex;
    flex-wrap: wrap;
    align-self: flex-start;
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
  h2 {
    margin: 0 0 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr auto 64px;
    gap: 10px;
    align-items: baseline;
    width: 100%;
    padding: 4px 6px;
    margin: 0 -6px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .row:hover,
  .row:focus-visible {
    background: var(--surface);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name b {
    font-weight: 650;
  }
  .px,
  .pct {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .pct {
    font-weight: 600;
  }
  .up {
    color: var(--up);
  }
  .down {
    color: var(--down);
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
    justify-self: center;
    border: 1px solid var(--faint);
    background: var(--surface);
    border-radius: 6px;
    padding: 3px 10px;
    cursor: pointer;
  }
</style>
