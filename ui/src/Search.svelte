<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import type { SearchHit } from "./lib/types";

  let { onpick }: { onpick: (symbol: string) => Promise<string | null> } = $props();

  let q = $state("");
  let hits = $state<SearchHit[]>([]);
  let active = $state(0);
  let open = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function onInput() {
    error = null;
    clearTimeout(timer);
    const query = q.trim();
    if (!query) {
      hits = [];
      open = false;
      return;
    }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const res = await invoke<SearchHit[]>("search", { q: query });
        if (mine !== seq) return;
        hits = res;
        active = 0;
        open = true;
      } catch (e) {
        if (mine === seq) error = String(e);
      }
    }, 250);
  }

  async function pick(symbol: string) {
    busy = true;
    open = false;
    error = await onpick(symbol);
    busy = false;
    if (!error) {
      q = "";
      hits = [];
    }
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

<div class="search">
  <input
    placeholder="Change symbol…"
    spellcheck="false"
    autocomplete="off"
    bind:value={q}
    oninput={onInput}
    onkeydown={onKey}
    onfocus={() => (open = hits.length > 0)}
    onblur={() => setTimeout(() => (open = false), 120)}
    disabled={busy}
    aria-invalid={!!error}
  />
  {#if error}<div class="error">{error}</div>{/if}
  {#if open && hits.length}
    <ul role="listbox">
      {#each hits as h, i (h.symbol)}
        <li role="option" aria-selected={i === active}>
          <button class:active={i === active} onmousedown={(e) => e.preventDefault()} onclick={() => pick(h.symbol)}>
            <b>{h.symbol}</b>
            <span class="n">{h.name}</span>
            <span class="x">{h.exchange}{h.kind ? ` · ${h.kind}` : ""}</span>
          </button>
        </li>
      {/each}
    </ul>
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
  ul {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    width: 320px;
    margin: 0;
    padding: 4px;
    list-style: none;
    background: var(--tooltip-bg);
    border: 1px solid var(--faint);
    border-radius: 8px;
    box-shadow: var(--shadow);
    z-index: 10;
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
