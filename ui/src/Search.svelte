<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import type { SearchHit } from "./lib/types";
  import { SEARCH_TYPES, exchangesOf, hitLabel, searchView, type SearchType } from "./lib/search";

  let { onpick, recent, current }: { onpick: (symbol: string) => Promise<string | null>; recent: string[]; current: string } = $props();

  let q = $state("");
  let found = $state<SearchHit[]>([]);
  let type = $state<SearchType>("all");
  let exchange = $state("");
  const showRecent = $derived(!q.trim());
  const exchanges = $derived(exchangesOf(found));
  const hits = $derived<SearchHit[]>(
    showRecent
      ? recent.filter((s) => s !== current).map((symbol) => ({ symbol, name: "", exchange: "", kind: "", quote_type: "", currency: "" }))
      : searchView(found, q, type, exchange),
  );
  const listed = $derived(showRecent ? hits.length > 0 : found.length > 0);
  let active = $state(0);
  let open = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLUListElement | undefined = $state();

  $effect(() => {
    void [active, hits.length];
    if (open) list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  });

  export function focus() {
    input?.focus();
  }

  /** Drops the pending debounce and any in-flight search, so a late result can't reopen the list. */
  function cancelSearch() {
    clearTimeout(timer);
    seq++;
  }

  function onInput() {
    error = null;
    cancelSearch();
    const query = q.trim();
    if (!query) {
      found = [];
      active = 0;
      open = true;
      return;
    }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const res = await invoke<SearchHit[]>("search", { q: query });
        if (mine !== seq) return;
        found = res;
        if (exchange && !exchangesOf(res).includes(exchange)) exchange = "";
        active = 0;
        open = true;
      } catch (e) {
        if (mine === seq) error = String(e);
      }
    }, 250);
  }

  async function pick(symbol: string) {
    cancelSearch();
    busy = true;
    open = false;
    error = await onpick(symbol);
    busy = false;
    if (!error) {
      q = "";
      found = [];
      exchange = "";
    }
  }

  function setType(next: SearchType) {
    type = next;
    active = 0;
  }

  function onFocusOut(e: FocusEvent) {
    if (e.relatedTarget instanceof Node && (e.currentTarget as HTMLElement).contains(e.relatedTarget)) return;
    setTimeout(() => (open = false), 120);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" && hits.length) {
      active = (active + 1) % hits.length;
      open = true;
    } else if (e.key === "ArrowUp" && hits.length) {
      active = (active - 1 + hits.length) % hits.length;
    } else if (e.key === "Enter") {
      const sym = open && hits[active] ? hits[active].symbol : q.trim().toUpperCase();
      if (sym) pick(sym);
    } else if (e.key === "Escape") {
      open = false;
    } else {
      return;
    }
    e.preventDefault();
  }
</script>

<div class="search" onfocusout={onFocusOut}>
  <input
    bind:this={input}
    placeholder="Change symbol…"
    spellcheck="false"
    autocomplete="off"
    bind:value={q}
    oninput={onInput}
    onkeydown={onKey}
    onfocus={() => {
      active = 0;
      open = listed;
    }}
    disabled={busy}
    aria-invalid={!!error}
  />
  {#if error}<div class="error">{error}</div>{/if}
  {#if open && listed}
    <div class="pop">
      {#if !showRecent}
        <div class="filters">
          <div class="types jelly" role="group" aria-label="Asset type">
            {#each SEARCH_TYPES as t (t.key)}
              <button
                class="chip"
                class:on={type === t.key}
                aria-pressed={type === t.key}
                onmousedown={(e) => e.preventDefault()}
                onclick={() => setType(t.key)}>{t.label}</button
              >
            {/each}
          </div>
          {#if exchanges.length > 1}
            <select
              aria-label="Exchange"
              bind:value={exchange}
              onchange={() => {
                active = 0;
                input?.focus();
              }}
            >
              <option value="">All exchanges</option>
              {#each exchanges as ex (ex)}<option value={ex}>{ex}</option>{/each}
            </select>
          {/if}
        </div>
      {/if}
      <ul bind:this={list} role="listbox" aria-label={showRecent ? "Recent symbols" : "Search results"}>
        {#if showRecent}<li role="presentation" class="head">Recent</li>{/if}
        {#if !showRecent && !hits.length}<li role="presentation" class="head">No results match these filters</li>{/if}
        {#each hits as h, i (h.symbol)}
          <li role="option" aria-selected={i === active}>
            <button class:active={i === active} onmousedown={(e) => e.preventDefault()} onclick={() => pick(h.symbol)}>
              <b>{h.symbol}</b>
              {#if !showRecent}
                <span class="n">{h.name}</span>
                <span class="x">{hitLabel(h)}</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .search {
    position: relative;
    width: 240px;
  }
  input {
    width: 100%;
    font: inherit;
    padding: 5px 10px;
    border-radius: 7px;
    border: 1px solid var(--faint);
    background: var(--surface);
    color: var(--text);
    outline: none;
  }
  input:focus {
    border-color: var(--accent);
  }
  input[aria-invalid="true"] {
    border-color: var(--down);
  }
  .error {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 3px;
    font-size: 11px;
    color: var(--down);
    z-index: 5;
  }
  .pop {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    width: 340px;
    padding: 4px;
    background: var(--tooltip-bg);
    border: 1px solid var(--faint);
    border-radius: 8px;
    box-shadow: var(--shadow);
    z-index: 10;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: min(60vh, 420px);
    overflow-y: auto;
  }
  .filters {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 3px 4px 6px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--faint);
  }
  .types {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .chip {
    display: inline-block;
    width: auto;
    padding: 2px 8px;
    border: 1px solid var(--faint);
    border-radius: 10px;
    font: inherit;
    font-size: 11px;
    color: var(--muted);
  }
  .chip.on {
    color: var(--text);
    border-color: var(--accent);
    background: var(--surface);
  }
  select {
    font: inherit;
    font-size: 11px;
    padding: 3px 6px;
    border-radius: 6px;
    border: 1px solid var(--faint);
    background: var(--surface);
    color: var(--text);
    outline: none;
  }
  select:focus {
    border-color: var(--accent);
  }
  button {
    display: grid;
    grid-template-columns: 72px 1fr;
    grid-template-rows: auto auto;
    gap: 0 8px;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 6px;
    padding: 5px 8px;
    cursor: pointer;
  }
  button.active,
  button:hover {
    background: var(--surface);
  }
  .head {
    padding: 3px 8px;
    color: var(--muted);
    font-size: 11px;
  }
  b {
    grid-row: span 2;
    align-self: center;
  }
  .n {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .x {
    color: var(--muted);
    font-size: 11px;
  }
</style>
