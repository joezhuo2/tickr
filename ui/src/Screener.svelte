<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { untrack } from "svelte";
  import { direction, num, signed } from "./lib/format";
  import {
    MAX_NAME,
    MAX_RULES,
    RSI_LENGTH,
    SCREEN_KINDS,
    SMA_LENGTHS,
    canSave,
    newRule,
    ruleValid,
    sameRules,
    screenRows,
  } from "./lib/screener";
  import type { SavedScreen, ScreenKind, ScreenOp, ScreenRow, ScreenRule } from "./lib/types";

  let {
    symbols,
    screens,
    onopen,
    onsave,
    ondelete,
  }: {
    symbols: string[];
    screens: SavedScreen[];
    onopen: (symbol: string) => void;
    onsave: (name: string, rules: ScreenRule[]) => Promise<string | undefined>;
    ondelete: (name: string) => void;
  } = $props();

  interface Draft {
    id: number;
    kind: ScreenKind;
    op: ScreenOp;
    text: string;
  }

  let nextId = 0;
  let drafts = $state<Draft[]>([]);
  let name = $state("");
  let saveError = $state<string | null>(null);
  let rows = $state<ScreenRow[]>([]);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let seq = 0;

  function toDraft(rule: ScreenRule): Draft {
    return { id: nextId++, kind: rule.kind, op: rule.op, text: String(rule.value) };
  }

  const rules = $derived<ScreenRule[]>(
    drafts.map((d) => ({ kind: d.kind, op: d.op, value: d.text.trim() === "" ? NaN : Number(d.text) })),
  );
  const bySymbol = $derived(new Map(rows.map((r) => [r.symbol, r])));
  const loaded = $derived(symbols.flatMap((s) => bySymbol.get(s) ?? []));
  const failed = $derived(loaded.filter((r) => r.error));
  const matches = $derived(screenRows(loaded, rules));
  const savable = $derived(canSave(name, rules));

  function add(kind: ScreenKind) {
    if (drafts.length >= MAX_RULES) return;
    drafts.push(toDraft(newRule(kind)));
  }

  function remove(id: number) {
    drafts = drafts.filter((d) => d.id !== id);
  }

  function apply(screen: SavedScreen) {
    drafts = screen.rules.map(toDraft);
    name = screen.name;
    saveError = null;
  }

  async function save() {
    if (!savable) return;
    saveError = (await onsave(name.trim(), rules)) ?? null;
  }

  async function load() {
    const mine = ++seq;
    if (!symbols.length) {
      rows = [];
      loading = false;
      return;
    }
    loading = true;
    loadError = null;
    try {
      const got = await invoke<ScreenRow[]>("get_screener_data", { symbols: [...symbols] });
      if (mine === seq) rows = got;
    } catch (e) {
      if (mine === seq) loadError = String(e);
    } finally {
      if (mine === seq) loading = false;
    }
  }

  const key = $derived([...symbols].sort().join(","));
  $effect(() => {
    key;
    untrack(load);
  });
</script>

<div class="screener">
  {#if screens.length}
    <div class="saved" role="group" aria-label="Saved filters">
      {#each screens as s (s.name)}
        <span class="chip" class:on={sameRules(rules, s.rules)}>
          <button class="pick" onclick={() => apply(s)}>{s.name}</button>
          <button class="del" aria-label={`Delete filter ${s.name}`} title="Delete" onclick={() => ondelete(s.name)}>×</button>
        </span>
      {/each}
    </div>
  {/if}

  <div class="rules">
    {#each drafts as d, i (d.id)}
      {@const ok = ruleValid(rules[i])}
      <div class="rule">
        <span class="kind">{d.kind === "rsi" ? `RSI ${RSI_LENGTH}` : d.kind === "sma" ? "Price" : "Change"}</span>
        <select aria-label="Condition" bind:value={d.op}>
          <option value="above">above</option>
          <option value="below">below</option>
        </select>
        {#if d.kind === "sma"}
          <select aria-label="Moving average" bind:value={d.text}>
            {#each SMA_LENGTHS as n (n)}
              <option value={String(n)}>SMA {n}</option>
            {/each}
          </select>
        {:else}
          <input
            class:bad={!ok}
            aria-label={d.kind === "rsi" ? "RSI value" : "Change percent"}
            aria-invalid={!ok}
            inputmode="decimal"
            maxlength="8"
            bind:value={d.text}
          />
          {#if d.kind === "change"}<span class="unit">%</span>{/if}
        {/if}
        <button class="x" aria-label="Remove filter" title="Remove" onclick={() => remove(d.id)}>×</button>
      </div>
    {/each}
    {#if drafts.length < MAX_RULES}
      <div class="adds">
        <span class="label">Add</span>
        {#each SCREEN_KINDS as k (k.kind)}
          <button onclick={() => add(k.kind)}>{k.label}</button>
        {/each}
      </div>
    {/if}
  </div>

  {#if drafts.length}
    <form
      class="save"
      onsubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input placeholder="Name this filter" aria-label="Filter name" maxlength={MAX_NAME} bind:value={name} oninput={() => (saveError = null)} />
      <button type="submit" disabled={!savable}>Save</button>
    </form>
    {#if saveError}<p class="error" role="alert">{saveError}</p>{/if}
  {/if}

  <p class="status" aria-live="polite">
    {#if loading && !loaded.length}
      Loading daily bars…
    {:else if loadError}
      Could not load: {loadError}
    {:else}
      {matches.length} of {loaded.length - failed.length} match{drafts.length ? "" : " (no filters yet)"}{#if loading} · updating…{/if}
      {#if failed.length}
        · <span title={failed.map((r) => `${r.symbol}: ${r.error}`).join("\n")}>{failed.length} unavailable</span>
      {/if}
    {/if}
  </p>

  <div class="results">
    {#each matches as r (r.symbol)}
      <button class="row" onclick={() => onopen(r.symbol)}>
        <span class="sym">{r.symbol}</span>
        <span class="px">{r.price == null ? "—" : num(r.price)}</span>
        <span class="chg {direction(r.change_pct)}">{r.change_pct == null ? "—" : `${signed(r.change_pct)}%`}</span>
        <span class="rsi">RSI {r.rsi == null ? "—" : r.rsi.toFixed(0)}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .screener {
    flex: 1;
    min-height: 0;
    margin-top: 6px;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .saved {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--faint);
    border-radius: 6px;
    background: var(--surface);
  }
  .chip.on {
    border-color: var(--accent);
  }
  .chip button {
    border: 0;
    background: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
  }
  .chip .pick {
    padding: 2px 4px 2px 8px;
  }
  .chip .del {
    padding: 2px 6px 2px 2px;
  }
  .chip button:hover {
    color: var(--text);
  }
  .chip .del:hover {
    color: var(--down);
  }
  .rules {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .rule,
  .adds,
  .save {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
  .kind {
    min-width: 52px;
    font-weight: 650;
  }
  .unit,
  .label {
    color: var(--muted);
  }
  select,
  input {
    padding: 2px 6px;
    border: 1px solid var(--faint);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 12px;
  }
  input {
    width: 70px;
    font-variant-numeric: tabular-nums;
  }
  .save input {
    flex: 1;
    min-width: 0;
    width: auto;
  }
  input.bad {
    border-color: var(--down);
  }
  .x {
    margin-left: auto;
  }
  .rule button,
  .adds button,
  .save button {
    border: 0;
    border-radius: 6px;
    background: none;
    padding: 2px 8px;
    color: var(--muted);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    font-weight: 600;
  }
  .adds button,
  .save button {
    background: var(--surface);
  }
  .rule button:hover,
  .adds button:hover,
  .save button:hover:not(:disabled) {
    color: var(--text);
  }
  .save button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .error {
    margin: 0;
    color: var(--down);
    font-size: 12px;
  }
  .status {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
  }
  .results {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-bottom: 2px;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    align-items: baseline;
    gap: 12px;
    padding: 7px 11px;
    border: 1px solid var(--faint);
    border-radius: 9px;
    background: var(--surface);
    color: inherit;
    text-align: left;
    cursor: pointer;
    font-variant-numeric: tabular-nums;
    transition: border-color var(--motion-fast) var(--ease-out);
  }
  .row:hover {
    border-color: var(--muted);
  }
  .sym {
    font-weight: 750;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .px {
    font-weight: 650;
  }
  .chg {
    font-size: 13px;
    font-weight: 600;
  }
  .rsi {
    min-width: 46px;
    text-align: right;
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
  }
</style>
