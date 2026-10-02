<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { untrack } from "svelte";
  import { byGain, direction, price, sessionMove, signed } from "./lib/format";
  import type { WatchQuote } from "./lib/types";

  let {
    symbols,
    current,
    onopen,
  }: {
    symbols: string[];
    /** The symbol shown in the chart, highlighted. */
    current: string;
    onopen: (symbol: string) => void;
  } = $props();

  const REFRESH_MS = 60_000;

  let quotes = $state<Record<string, WatchQuote>>({});
  const moves = $derived(
    Object.fromEntries(Object.values(quotes).flatMap((w) => (w.quote ? [[w.symbol, sessionMove(w.quote)]] : []))),
  );
  // Biggest gain first, by the move of the session now trading.
  const order = $derived(byGain(symbols, (s) => moves[s]?.pct));

  async function load(list: string[]) {
    if (!list.length) return;
    try {
      const got = await invoke<WatchQuote[]>("get_watch_quotes", { symbols: list });
      const next = { ...quotes };
      for (const q of got) {
        // Keep the last good quote when a refresh fails.
        next[q.symbol] = q.quote || !next[q.symbol]?.quote ? q : { ...next[q.symbol], error: q.error };
      }
      quotes = next;
    } catch {
      // Offline: cards keep what they have.
    }
  }

  // Refetch when the set changes.
  const key = $derived([...symbols].sort().join(","));
  $effect(() => {
    key;
    untrack(() => load(symbols));
    const t = setInterval(() => load(symbols), REFRESH_MS);
    return () => clearInterval(t);
  });
</script>

{#if symbols.length === 0}
  <div class="empty">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></svg>
    <p>No starred stocks yet.</p>
    <p class="hint">Click the star next to a ticker to add it here.</p>
  </div>
{:else}
  <div class="grid">
    {#each order as symbol (symbol)}
      {@const w = quotes[symbol]}
      {@const q = w?.quote}
      <button
        class="card"
        class:current={symbol === current}
        title={w?.error && !q ? w.error : q?.name || symbol}
        onclick={() => onopen(symbol)}
      >
        <span class="top">
          <span class="sym">{symbol}</span>
          {#if q}<span class="dot {q.session}"></span>{/if}
        </span>
        {#if q}
          <span class="name">{q.name || q.exchange || "—"}</span>
          {@const m = moves[symbol]}
          <span class="line">
            <span class="px">{price(m.price, q.currency)}</span>
            <span class="bar">|</span>
            <span class="chg {direction(m.pct)}">{m.pct == null ? "—" : `${signed(m.pct)}%`}</span>
          </span>
        {:else if w?.error}
          <span class="name">Unavailable</span>
          <span class="line"><span class="px">—</span></span>
        {:else}
          <span class="sk" style="width: 70%; height: 11px; margin-top: 3px"></span>
          <span class="sk" style="width: 80%; height: 16px; margin-top: auto"></span>
        {/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .grid {
    --gap: 8px;
    flex: 1;
    min-height: 0;
    margin-top: 6px;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    /* Four rows fill the view; more scroll. */
    grid-auto-rows: calc((100% - 3 * var(--gap)) / 4);
    gap: var(--gap);
    padding-bottom: 2px;
  }
  .card {
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    padding: 9px 11px;
    border: 1px solid var(--faint);
    border-radius: 9px;
    background: var(--surface);
    color: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    font-variant-numeric: tabular-nums;
    transition: border-color 0.12s;
  }
  .card:hover {
    border-color: var(--muted);
  }
  .card.current {
    border-color: var(--accent);
  }
  .top {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sym {
    font-weight: 750;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--flat);
  }
  .dot.regular {
    background: var(--up);
  }
  .dot.pre,
  .dot.post {
    background: #ffb340;
  }
  .name {
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .line {
    margin-top: auto;
    display: flex;
    align-items: baseline;
    gap: 6px;
    white-space: nowrap;
    overflow: hidden;
  }
  .px {
    font-size: 15px;
    font-weight: 650;
  }
  .bar {
    color: var(--muted);
  }
  .chg {
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .empty {
    flex: 1;
    display: grid;
    place-content: center;
    justify-items: center;
    color: var(--muted);
    text-align: center;
  }
  .empty svg {
    width: 28px;
    height: 28px;
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.6;
    stroke-linejoin: round;
  }
  .empty p {
    margin: 6px 0 0;
  }
  .empty .hint {
    font-size: 12px;
  }
</style>
