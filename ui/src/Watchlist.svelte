<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { untrack } from "svelte";
  import { change, direction, price } from "./lib/format";
  import type { WatchQuote } from "./lib/types";

  let {
    symbols,
    current,
    onopen,
    onreorder,
  }: {
    symbols: string[];
    /** The symbol shown in the chart, highlighted. */
    current: string;
    onopen: (symbol: string) => void;
    onreorder: (symbols: string[]) => void;
  } = $props();

  const REFRESH_MS = 60_000;
  // Pointer travel before a press becomes a drag instead of a click.
  const DRAG_PX = 5;
  const EDGE_PX = 36;

  let quotes = $state<Record<string, WatchQuote>>({});
  // Order while dragging; null otherwise.
  let draft = $state<string[] | null>(null);
  const order = $derived(draft ?? symbols);
  let dragging = $state<string | null>(null);
  let grid: HTMLElement | undefined = $state();

  let press: { symbol: string; x: number; y: number } | null = null;
  let suppressClick = false;

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

  // Refetch when the set changes, not when it is only reordered.
  const key = $derived([...symbols].sort().join(","));
  $effect(() => {
    key;
    untrack(() => load(symbols));
    const t = setInterval(() => load(symbols), REFRESH_MS);
    return () => clearInterval(t);
  });

  function down(e: PointerEvent, symbol: string) {
    if (e.button !== 0) return;
    press = { symbol, x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    if (!press) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_PX) return;
      dragging = press.symbol;
      draft = [...symbols];
    }
    if (grid) {
      const r = grid.getBoundingClientRect();
      if (e.clientY < r.top + EDGE_PX) grid.scrollBy(0, -12);
      else if (e.clientY > r.bottom - EDGE_PX) grid.scrollBy(0, 12);
    }
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-symbol]");
    const target = over?.dataset.symbol;
    if (!draft || !target || target === dragging) return;
    const next = draft.filter((s) => s !== dragging);
    next.splice(draft.indexOf(target), 0, dragging);
    draft = next;
  }

  function up() {
    if (dragging && draft) {
      suppressClick = true;
      onreorder(draft);
    }
    press = null;
    dragging = null;
    draft = null;
  }

  function click(symbol: string) {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    onopen(symbol);
  }
</script>

{#if symbols.length === 0}
  <div class="empty">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></svg>
    <p>No starred stocks yet.</p>
    <p class="hint">Click the star next to a ticker to add it here.</p>
  </div>
{:else}
  <div class="grid" bind:this={grid} class:dragging={dragging !== null}>
    {#each order as symbol (symbol)}
      {@const w = quotes[symbol]}
      {@const q = w?.quote}
      <button
        class="card"
        class:current={symbol === current}
        class:lifted={symbol === dragging}
        data-symbol={symbol}
        title={w?.error && !q ? w.error : q?.name || symbol}
        onpointerdown={(e) => down(e, symbol)}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={up}
        onclick={() => click(symbol)}
      >
        <span class="top">
          <span class="sym">{symbol}</span>
          {#if q}<span class="dot {q.session}"></span>{/if}
        </span>
        {#if q}
          <span class="name">{q.name || q.exchange || "—"}</span>
          <span class="px">{price(q.price, q.currency)}</span>
          <span class="chg {direction(q.change)}">{change(q.change, q.change_pct)}</span>
        {:else if w?.error}
          <span class="name">Unavailable</span>
          <span class="px">—</span>
        {:else}
          <span class="sk" style="width: 70%; height: 11px; margin-top: 3px"></span>
          <span class="sk" style="width: 55%; height: 18px; margin-top: auto"></span>
          <span class="sk" style="width: 65%; height: 12px; margin-top: 5px"></span>
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
    touch-action: none;
    transition: border-color 0.12s, transform 0.12s, box-shadow 0.12s;
  }
  .card:hover {
    border-color: var(--muted);
  }
  .card.current {
    border-color: var(--accent);
  }
  .grid.dragging .card {
    cursor: grabbing;
  }
  .card.lifted {
    transform: scale(1.03);
    box-shadow: var(--shadow);
    border-color: var(--accent);
    opacity: 0.92;
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
  .px {
    margin-top: auto;
    font-size: 16px;
    font-weight: 650;
  }
  .chg {
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
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
