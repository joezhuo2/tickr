<script lang="ts">
  import { direction, num, signed } from "./lib/format";
  import { HOTLISTS, hotlist, type HotlistId } from "./lib/hotlists";
  import type { Market, Mover } from "./lib/types";

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

<style>
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
