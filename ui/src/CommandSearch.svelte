<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import type { SearchHit } from "./lib/types";
  import { backdrop, dialog } from "./lib/motion";
  import { MAX_RECENT } from "./lib/history";
  import { SEARCH_TYPES, exchangesOf, hitLabel, searchView, type SearchType } from "./lib/search";
  import { EXAMPLES, normalize, parse, searchable, type Command, type CommandRow } from "./lib/command";

  let { recent, current, groups, onrun, onclose }: {
    recent: string[];
    current: string;
    groups: string[];
    onrun: (command: Command, label: string) => Promise<string | null>;
    onclose: () => void;
  } = $props();

  let q = $state("");
  let found = $state<SearchHit[]>([]);
  let searched = $state("");
  let type = $state<SearchType>("all");
  let exchange = $state("");
  let active = $state(0);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLUListElement | undefined = $state();
  let panel: HTMLDivElement | undefined = $state();

  const parsed = $derived(parse(q, { symbol: current, groups }));
  const remote = $derived(searchable(q, parsed));
  const results = $derived(remote && searched === normalize(q) ? found : []);
  const exchanges = $derived(exchangesOf(results));
  const plain = (r: CommandRow) => r.command?.kind === "open" && !r.command.range && !r.command.interval;
  const rows = $derived.by<CommandRow[]>(() => {
    if (!q.trim()) {
      const recents = recent.filter((s) => s !== current).slice(0, MAX_RECENT).map((s) => ({ command: { kind: "open", symbol: s }, tag: "Recent", title: s, detail: `Opens ${s}` }) as CommandRow);
      return [...recents, ...EXAMPLES.map((x) => ({ command: null, tag: "Try", title: x, detail: "Fills in this example", fill: x }))];
    }
    const hits = searchView(results, q, type, exchange).map((h) => ({ command: { kind: "open", symbol: h.symbol }, tag: "Symbol", title: h.symbol, detail: [h.name, hitLabel(h)].filter(Boolean).join(" · ") || `Opens ${h.symbol}` }) as CommandRow);
    const typed = parsed.find(plain);
    const commands = parsed.filter((r) => !plain(r) && !(hits.length && r.tag === "Search"));
    const extra = typed && !hits.some((h) => h.title === typed.title) ? [typed] : [];
    return [...commands, ...hits, ...extra];
  });

  $effect(() => {
    void [active, rows.length];
    list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  });

  onMount(() => {
    const before = document.activeElement;
    const root = panel;
    input?.focus();
    return () => {
      clearTimeout(timer);
      seq++;
      const now = document.activeElement;
      const free = !now || now === document.body || !!root?.contains(now);
      if (free && before instanceof HTMLElement && before.isConnected) before.focus();
    };
  });

  function onInput() {
    error = null;
    active = 0;
    clearTimeout(timer);
    seq++;
    const query = q.trim();
    if (!remote) return;
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const res = await invoke<SearchHit[]>("search", { q: query });
        if (mine !== seq) return;
        found = res;
        searched = normalize(query);
        if (exchange && !exchangesOf(res).includes(exchange)) exchange = "";
        active = 0;
      } catch (e) {
        if (mine === seq) error = String(e);
      }
    }, 250);
  }

  async function choose(r: CommandRow | undefined) {
    if (!r || busy) return;
    if (r.fill) {
      q = r.fill;
      onInput();
      input?.focus();
      return;
    }
    if (!r.command) return;
    busy = true;
    error = await onrun(r.command, r.title);
    busy = false;
    if (error) input?.focus();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" && rows.length) active = (active + 1) % rows.length;
    else if (e.key === "ArrowUp" && rows.length) active = (active - 1 + rows.length) % rows.length;
    else if (e.key === "Enter") void choose(rows[active]);
    else return;
    e.preventDefault();
  }

  function onWindowKey(e: KeyboardEvent) {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    onclose();
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose} transition:backdrop>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="panel" bind:this={panel} role="dialog" tabindex="-1" aria-modal="true" aria-label="Search and commands" onclick={(e) => e.stopPropagation()} transition:dialog>
    <div class="field">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
      <input
        bind:this={input}
        placeholder="Symbol or command, e.g. nvda 1y or alert nvda >= 170"
        aria-label="Symbol or command"
        role="combobox"
        aria-expanded={rows.length > 0}
        aria-controls="command-rows"
        aria-activedescendant={rows[active] ? `command-row-${active}` : undefined}
        spellcheck="false"
        autocomplete="off"
        bind:value={q}
        oninput={onInput}
        onkeydown={onKey}
        disabled={busy}
        aria-invalid={!!error}
      />
    </div>
    {#if error}<div class="error" role="alert">{error}</div>{/if}
    {#if remote && results.length}
      <div class="filters">
        <div class="types jelly" role="group" aria-label="Asset type">
          {#each SEARCH_TYPES as t (t.key)}
            <button
              class="chip"
              class:on={type === t.key}
              aria-pressed={type === t.key}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => {
                type = t.key;
                active = 0;
              }}>{t.label}</button
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
    {#if rows.length}
      <ul id="command-rows" bind:this={list} role="listbox" aria-label={q.trim() ? "Results" : "Recent symbols and examples"}>
        {#each rows as r, i (i)}
          <li id="command-row-{i}" role="option" aria-selected={i === active} aria-disabled={!r.command && !r.fill}>
            <button
              tabindex="-1"
              class:active={i === active}
              class:dead={!r.command && !r.fill}
              onmousedown={(e) => e.preventDefault()}
              onmouseenter={() => (active = i)}
              onclick={() => choose(r)}
            >
              <span class="tag">{r.tag}</span>
              <span class="title">{r.title}</span>
              <span class="detail">{r.detail}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 11;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 12vh;
    background: color-mix(in srgb, var(--bg) 25%, transparent);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
  }
  .panel {
    width: min(560px, 90vw);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    padding: 8px;
    border: 1px solid var(--faint);
    border-radius: 12px;
    background: var(--bg);
    box-shadow: var(--shadow);
  }
  .field {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    border: 1px solid var(--faint);
    border-radius: 8px;
    background: var(--surface);
  }
  .field:focus-within {
    border-color: var(--accent);
  }
  .field svg {
    flex: none;
    width: 16px;
    height: 16px;
    fill: none;
    stroke: var(--muted);
    stroke-width: 2;
    stroke-linecap: round;
  }
  input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 14px;
    padding: 9px 0;
    border: 0;
    background: none;
    color: var(--text);
    outline: none;
  }
  .error {
    margin: 6px 4px 0;
    font-size: 11px;
    color: var(--down);
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 8px 4px 6px;
    border-bottom: 1px solid var(--faint);
  }
  .types {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .chip {
    padding: 2px 8px;
    border: 1px solid var(--faint);
    border-radius: 10px;
    background: none;
    font: inherit;
    font-size: 11px;
    color: var(--muted);
    cursor: pointer;
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
  ul {
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
    min-height: 0;
  }
  li button {
    display: grid;
    grid-template-columns: 64px 1fr;
    gap: 1px 10px;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 7px;
    padding: 6px 8px;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  li button.active {
    background: var(--surface);
  }
  li button.dead {
    cursor: default;
  }
  .tag {
    grid-row: span 2;
    align-self: center;
    justify-self: start;
    padding: 1px 6px;
    border: 1px solid var(--faint);
    border-radius: 5px;
    font-size: 10px;
    color: var(--muted);
  }
  .active .tag {
    border-color: var(--accent);
    color: var(--text);
  }
  .title {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dead .title {
    font-weight: 500;
    color: var(--muted);
  }
  .detail {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dead .detail {
    color: var(--down);
    white-space: normal;
  }
</style>
