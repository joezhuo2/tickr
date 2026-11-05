<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { untrack } from "svelte";
  import { direction, price, sessionMove, signed, volume } from "./lib/format";
  import { WATCHLIST_SORT_KEYS, nextSort, sortSymbols } from "./lib/watchlistSort";
  import { heatColor, heatWeights, layoutHeatmap, tileDetail } from "./lib/heatmap";
  import type { Group, RefreshMode, SavedScreen, ScreenRule, WatchQuote, WatchlistSort, WatchlistView } from "./lib/types";
  import Screener from "./Screener.svelte";

  let {
    symbols,
    refreshMode,
    groups,
    current,
    sort,
    view,
    screens,
    tab = $bindable(),
    onopen,
    ongroups,
    onsort,
    onview,
    onsavescreen,
    ondeletescreen,
  }: {
    symbols: string[];
    refreshMode: RefreshMode;
    groups: Group[];
    /** The symbol shown in the chart, highlighted. */
    current: string;
    sort: WatchlistSort;
    view: WatchlistView;
    screens: SavedScreen[];
    tab: string | null;
    onopen: (symbol: string) => void;
    ongroups: (groups: Group[]) => void;
    onsort: (sort: WatchlistSort) => void;
    onview: (view: WatchlistView) => void;
    onsavescreen: (name: string, rules: ScreenRule[]) => Promise<string | undefined>;
    ondeletescreen: (name: string) => void;
  } = $props();

  let screening = $state(false);

  const REFRESH_MS = 60_000;

  let quotes = $state<Record<string, WatchQuote>>({});
  const moves = $derived(
    Object.fromEntries(Object.values(quotes).flatMap((w) => (w.quote ? [[w.symbol, sessionMove(w.quote)]] : []))),
  );
  const group = $derived(groups.find((g) => g.name === tab) ?? null);
  /** Name typed for a new group; null when the field is closed. */
  let draft = $state<string | null>(null);

  function addGroup() {
    const name = draft?.trim() ?? "";
    draft = null;
    if (!name || groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) return;
    ongroups([...groups, { name, symbols: [] }]);
    tab = shownTab = name;
    editing = true;
  }

  /** In a group tab: show every starred stock and toggle membership on click. */
  let editing = $state(false);
  let shownTab = tab;
  $effect(() => {
    if (tab === shownTab) return;
    shownTab = tab;
    editing = false;
  });
  const shown = $derived(group && !editing ? group.symbols : symbols);

  function pick(g: Group | null) {
    tab = shownTab = g?.name ?? null;
    editing = false;
  }

  function rename(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const name = input.value.trim();
    if (!group || name === group.name) return;
    if (!name || groups.some((g) => g.name !== group.name && g.name.toLowerCase() === name.toLowerCase())) {
      input.value = group.name;
      return;
    }
    ongroups(groups.map((g) => (g.name === group.name ? { ...g, name } : g)));
    tab = shownTab = name;
  }

  function remove() {
    if (!group) return;
    ongroups(groups.filter((g) => g.name !== group.name));
    pick(null);
  }

  function toggle(symbol: string) {
    if (!group) return;
    const has = group.symbols.includes(symbol);
    const next = has ? group.symbols.filter((s) => s !== symbol) : [...group.symbols, symbol];
    ongroups(groups.map((g) => (g.name === group.name ? { ...g, symbols: next } : g)));
  }
  const order = $derived(
    sortSymbols(
      shown,
      (s, key) => (key === "volume" ? quotes[s]?.quote?.volume : key === "price" ? moves[s]?.price : moves[s]?.pct),
      sort,
    ),
  );

  const mapOn = $derived(view === "heatmap" && !editing && !screening);
  let mapW = $state(0);
  let mapH = $state(0);
  const tiles = $derived.by(() => {
    const weights = heatWeights(shown.map((s) => moves[s]?.pct));
    return layoutHeatmap(
      shown.map((id, i) => ({ id, weight: weights[i] })),
      mapW,
      mapH,
    );
  });

  function toggleMap() {
    if (screening) {
      screening = false;
      if (view !== "heatmap") onview("heatmap");
      return;
    }
    onview(view === "heatmap" ? "cards" : "heatmap");
  }

  function tip(symbol: string): string {
    const w = quotes[symbol];
    const q = w?.quote;
    if (!q) return w?.error ? `${symbol}: ${w.error}` : symbol;
    const m = moves[symbol];
    return `${q.name || symbol}: ${price(m.price, q.currency)} (${m.pct == null ? "—" : `${signed(m.pct)}%`})`;
  }

  let loadedAt = 0;
  let loading = false;

  export function refresh() {
    return load([...symbols], true);
  }

  async function load(list: string[], manual = false) {
    if (!list.length) return;
    loading = true;
    try {
      const got = await invoke<WatchQuote[]>("get_watch_quotes", { symbols: list });
      const next = { ...quotes };
      for (const q of got) {
        // Keep the last good quote when a refresh fails.
        next[q.symbol] = q.quote || !next[q.symbol]?.quote ? q : { ...next[q.symbol], error: q.error };
      }
      quotes = next;
      loadedAt = Date.now();
      if (manual) return got.find((q) => q.error)?.error ?? undefined;
    } catch (e) {
      // Offline: cards keep what they have.
      return String(e);
    } finally {
      loading = false;
    }
  }

  // Refetch when the set changes.
  const key = $derived([...symbols].sort().join(","));
  $effect(() => {
    key;
    const refresh = () => {
      if (refreshMode === "low_power" && document.hidden) return;
      if (refreshMode === "balanced" || !loading) load(symbols);
    };
    const onVisible = () => {
      if (refreshMode === "low_power" && !document.hidden && Date.now() - loadedAt > REFRESH_MS) refresh();
    };
    untrack(() => {
      if (refreshMode !== "low_power" || !document.hidden) load(symbols);
    });
    const t = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  });
</script>

{#if symbols.length === 0}
  <div class="empty">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></svg>
    <p>No starred stocks yet.</p>
    <p class="hint">Click the star next to a ticker to add it here.</p>
  </div>
{:else}
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={!group} class:on={!group} onclick={() => pick(null)}>All</button>
    {#each groups as g (g.name)}
      <button role="tab" aria-selected={tab === g.name} class:on={tab === g.name} onclick={() => pick(g)}>{g.name}</button>
    {/each}
    {#if draft != null}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="new"
        placeholder="Group name"
        aria-label="New group name"
        maxlength="24"
        autofocus
        bind:value={draft}
        onblur={addGroup}
        onkeydown={(e) => {
          if (e.key === "Enter") addGroup();
          else if (e.key === "Escape") draft = null;
        }}
      />
    {:else}
      <button class="add" title="New group" aria-label="New group" onclick={() => (draft = "")}>+</button>
    {/if}
    {#if group && editing}
      <input
        class="new rename"
        aria-label="Group name"
        maxlength="24"
        value={group.name}
        onchange={rename}
        onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <button class="delete" onclick={remove}>Delete</button>
    {/if}
    {#if group}
      <button class="edit" class:on={editing} aria-pressed={editing} onclick={() => (editing = !editing)}>{editing ? "Done" : "Edit"}</button>
    {/if}
  </div>
  {#if !shown.length}
    <div class="empty">
      <p>No stocks in {group?.name} yet.</p>
      <p class="hint">Click Edit to pick some from your starred stocks.</p>
    </div>
  {:else}
    <div class="sort">
      {#if !mapOn}
        <span class="keys" role="group" aria-label="Sort watchlist">
          {#each WATCHLIST_SORT_KEYS as k (k.key)}
            {@const on = sort.key === k.key}
            <button
              class:on
              aria-pressed={on}
              aria-label={on ? `${k.label}, sorted ${sort.dir === "desc" ? "high to low" : "low to high"}` : `Sort by ${k.label}`}
              onclick={() => onsort(nextSort(sort, k.key))}
            >{k.label}{on ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}</button>
          {/each}
        </span>
      {/if}
      {#if !editing}
        <span class="tools">
          <button class:on={mapOn} aria-pressed={mapOn} onclick={toggleMap}>Heatmap</button>
          <button class:on={screening} aria-pressed={screening} onclick={() => (screening = !screening)}>Screen</button>
        </span>
      {/if}
    </div>
    {#if screening && !editing}
      <Screener symbols={order} {screens} {onopen} onsave={onsavescreen} ondelete={ondeletescreen} />
    {:else if mapOn}
      <div class="map" bind:clientWidth={mapW} bind:clientHeight={mapH}>
        {#each tiles as t (t.id)}
          {@const d = tileDetail(t.w, t.h)}
          {@const pct = moves[t.id]?.pct}
          <button
            class="tile"
            class:current={t.id === current}
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
    {:else}
      <div class="grid" class:editing>
        {#each order as symbol (symbol)}
          {@const w = quotes[symbol]}
          {@const q = w?.quote}
          <button
            class="card"
            class:current={symbol === current && !editing}
            class:in={editing && group?.symbols.includes(symbol)}
            aria-pressed={editing ? !!group?.symbols.includes(symbol) : undefined}
            title={w?.error && !q ? w.error : q?.name || symbol}
            onclick={() => (editing ? toggle(symbol) : onopen(symbol))}
          >
            <span class="top">
              <span class="sym">{symbol}</span>
              {#if q}<span class="dot {q.session}"></span>{/if}
              {#if q && sort.key === "volume"}<span class="vol">{volume(q.volume)}</span>{/if}
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
  {/if}
{/if}

<style>
  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-top: 6px;
    overflow-x: auto;
    overscroll-behavior: contain;
    flex: none;
  }
  .tabs button {
    border: 0;
    background: none;
    padding: 3px 9px;
    border-radius: 6px;
    cursor: pointer;
    color: var(--muted);
    font-weight: 600;
    font-size: 12px;
    white-space: nowrap;
  }
  .tabs button:hover {
    color: var(--text);
  }
  .new {
    width: 110px;
    padding: 2px 7px;
    border: 1px solid var(--faint);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 12px;
  }
  .rename {
    margin-left: auto;
  }
  .edit {
    margin-left: auto;
  }
  .rename ~ .edit {
    margin-left: 0;
  }
  .tabs .delete:hover {
    color: var(--down);
  }
  .editing .card:not(.in) {
    opacity: 0.55;
  }
  .card.in {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .tabs button.on {
    background: var(--surface);
    color: var(--text);
  }
  .sort {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-top: 6px;
    flex: none;
  }
  .sort button {
    border: 0;
    background: none;
    padding: 2px 8px;
    border-radius: 6px;
    cursor: pointer;
    color: var(--muted);
    font-weight: 600;
    font-size: 11px;
    white-space: nowrap;
  }
  .sort button:hover {
    color: var(--text);
  }
  .sort button.on {
    background: var(--surface);
    color: var(--text);
  }
  .keys,
  .tools {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .tools {
    margin-left: auto;
  }
  .map {
    flex: 1;
    min-height: 0;
    margin-top: 6px;
    position: relative;
    overflow: hidden;
    border-radius: 6px;
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
  .tile:hover {
    filter: brightness(1.08) saturate(1.1);
    z-index: 1;
  }
  .tile.current {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
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
  .vol {
    margin-left: auto;
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
  }
  .grid {
    --gap: 8px;
    flex: 1;
    min-height: 0;
    margin-top: 6px;
    overflow-y: auto;
    overscroll-behavior: contain;
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
    transition: border-color var(--motion-fast) var(--ease-out);
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
