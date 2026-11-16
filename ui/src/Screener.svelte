<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { untrack } from "svelte";
  import { direction } from "./lib/format";
  import {
    FIELDS,
    FIELD_GROUPS,
    MAX_NAME,
    MAX_RULES,
    SECTORS,
    canSave,
    cleanColumns,
    fieldOf,
    formatField,
    mergeItems,
    migrateRule,
    needsFundamentals,
    newRule,
    opsFor,
    ruleValid,
    sameRules,
    screenRows,
    sortItems,
    type FieldDef,
    type SortDir,
  } from "./lib/screener";
  import type { SavedScreen, ScreenFundamentals, ScreenOp, ScreenRow, ScreenRule } from "./lib/types";

  let {
    symbols,
    screens,
    columns,
    starred,
    onopen,
    onstar,
    onsave,
    ondelete,
    oncolumns,
  }: {
    symbols: string[];
    screens: SavedScreen[];
    columns: string[];
    starred: string[];
    onopen: (symbol: string) => void;
    onstar: (symbol: string) => void;
    onsave: (name: string, rules: ScreenRule[]) => Promise<string | undefined>;
    ondelete: (name: string) => void;
    oncolumns: (columns: string[]) => void;
  } = $props();

  interface Draft {
    id: number;
    kind: string;
    op: ScreenOp;
    text: string;
    text2: string;
    values: string[];
  }

  const OP_LABEL: Record<ScreenOp, string> = { above: "above", below: "below", between: "between", is: "is", any: "is any of" };

  const BATCH = 25;
  const UNIVERSE_KEY = "tickr.screenUniverse";
  type Universe = "watchlist" | "sp500";

  function storedUniverse(): Universe {
    try {
      return localStorage.getItem(UNIVERSE_KEY) === "sp500" ? "sp500" : "watchlist";
    } catch {
      return "watchlist";
    }
  }

  let nextId = 0;
  let universe = $state<Universe>(storedUniverse());
  let sp500 = $state<string[]>([]);
  let done = $state(0);
  let fundDone = $state(0);
  let fundTotal = $state(0);
  let cancelled = $state(false);
  let drafts = $state<Draft[]>([]);
  let name = $state("");
  let saveError = $state<string | null>(null);
  let rows = $state<ScreenRow[]>([]);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let funds = $state(new Map<string, ScreenFundamentals>());
  let fundLoading = $state(false);
  let sortKey = $state<string | null>(null);
  let sortDir = $state<SortDir>("desc");
  let seq = 0;
  let fundSeq = 0;

  function toDraft(raw: ScreenRule): Draft {
    const rule = migrateRule(raw);
    return {
      id: nextId++,
      kind: rule.kind,
      op: rule.op,
      text: String(rule.value),
      text2: rule.value2 == null ? "" : String(rule.value2),
      values: [...(rule.values ?? [])],
    };
  }

  const number = (text: string) => (text.trim() === "" ? NaN : Number(text));
  const rules = $derived<ScreenRule[]>(
    drafts.map((d) =>
      fieldOf(d.kind)?.text
        ? { kind: d.kind, op: d.op, value: 0, values: [...d.values] }
        : { kind: d.kind, op: d.op, value: number(d.text), ...(d.op === "between" ? { value2: number(d.text2) } : {}) },
    ),
  );
  const cols = $derived(cleanColumns(columns).flatMap((k) => fieldOf(k) ?? []));
  const bySymbol = $derived(new Map(rows.map((r) => [r.symbol, r])));
  const pool = $derived(universe === "sp500" ? sp500 : symbols);
  const loaded = $derived(pool.flatMap((s) => bySymbol.get(s) ?? []));
  const items = $derived(mergeItems(loaded, funds));
  const failed = $derived(loaded.filter((r) => r.error));
  const matches = $derived(screenRows(items, rules));
  const shown = $derived(sortItems(matches, sortKey, sortDir));
  const savable = $derived(canSave(name, rules));
  const wantsFunds = $derived(needsFundamentals(cleanColumns(columns), rules));
  const fundFailed = $derived(pool.filter((s) => funds.get(s)?.error).length);

  function add(kind: string) {
    if (!kind || drafts.length >= MAX_RULES) return;
    drafts.push(toDraft(newRule(kind)));
  }

  function remove(id: number) {
    drafts = drafts.filter((d) => d.id !== id);
  }

  function setKind(d: Draft, kind: string) {
    Object.assign(d, { ...toDraft(newRule(kind)), id: d.id });
  }

  function setOp(d: Draft, op: ScreenOp) {
    d.op = op;
    if (op === "is") d.values = d.values.slice(0, 1);
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

  function toggleColumn(key: string, on: boolean) {
    const current = cleanColumns(columns);
    oncolumns(on ? [...current, key] : current.filter((k) => k !== key));
  }

  function sortBy(key: string) {
    const first: SortDir = key === "symbol" ? "asc" : "desc";
    if (sortKey !== key) {
      sortKey = key;
      sortDir = first;
    } else if (sortDir === first) {
      sortDir = first === "asc" ? "desc" : "asc";
    } else {
      sortKey = null;
    }
  }

  const ariaSort = (key: string) => (sortKey !== key ? "none" : sortDir === "asc" ? "ascending" : "descending");
  const arrow = (key: string) => (sortKey !== key ? "" : sortDir === "asc" ? " ▲" : " ▼");

  function cell(def: FieldDef, r: (typeof items)[number]): string {
    return def.fund && fundLoading && !funds.has(r.symbol) ? "…" : formatField(def, r);
  }

  function tone(def: FieldDef, r: (typeof items)[number]): string {
    const v = def.get(r);
    return def.signed && typeof v === "number" ? direction(v) : "";
  }

  function setUniverse(next: Universe) {
    if (next === universe) return;
    universe = next;
    rows = [];
    try {
      localStorage.setItem(UNIVERSE_KEY, next);
    } catch {
      /* storage unavailable */
    }
  }

  function retry() {
    funds = new Map([...funds].filter(([, f]) => !f.error));
    load();
    if (wantsFunds) loadFunds();
  }

  function cancel() {
    seq++;
    fundSeq++;
    cancelled = true;
    loading = false;
    fundLoading = false;
  }

  async function batches<T>(list: string[], mine: () => boolean, fetch: (chunk: string[]) => Promise<T[]>, take: (got: T[], done: number) => void) {
    for (let i = 0; i < list.length; i += BATCH) {
      const got = await fetch(list.slice(i, i + BATCH));
      if (!mine()) return;
      take(got, Math.min(list.length, i + BATCH));
    }
  }

  async function load() {
    const mine = ++seq;
    cancelled = false;
    if (universe === "sp500" && !sp500.length) {
      try {
        sp500 = await invoke<string[]>("get_sp500_symbols");
      } catch (e) {
        if (mine === seq) loadError = String(e);
        return;
      }
      return;
    }
    const list = [...pool];
    if (!list.length) {
      rows = [];
      loading = false;
      return;
    }
    loading = true;
    loadError = null;
    done = 0;
    try {
      await batches(
        list,
        () => mine === seq,
        (chunk) => invoke<ScreenRow[]>("get_screener_data", { symbols: chunk, universe }),
        (got, n) => {
          const fresh = new Set(got.map((r) => r.symbol));
          rows = [...got, ...rows.filter((r) => !fresh.has(r.symbol))];
          done = n;
        },
      );
    } catch (e) {
      if (mine === seq) loadError = String(e);
    } finally {
      if (mine === seq) loading = false;
    }
  }

  async function loadFunds() {
    const mine = ++fundSeq;
    const want = pool.filter((s) => !funds.has(s));
    if (!want.length) {
      fundLoading = false;
      return;
    }
    fundLoading = true;
    fundDone = 0;
    fundTotal = want.length;
    try {
      await batches(
        want,
        () => mine === fundSeq,
        (chunk) => invoke<ScreenFundamentals[]>("get_screener_fundamentals", { symbols: chunk, universe }),
        (got, n) => {
          funds = new Map([...funds, ...got.map((f): [string, ScreenFundamentals] => [f.symbol, f])]);
          fundDone = n;
        },
      );
    } catch (e) {
      console.warn(e);
    } finally {
      if (mine === fundSeq) fundLoading = false;
    }
  }

  const key = $derived(`${universe}:${[...pool].sort().join(",")}`);
  $effect(() => {
    key;
    untrack(load);
  });
  $effect(() => {
    key;
    if (wantsFunds) untrack(loadFunds);
  });
</script>

<div class="screener">
  <div class="universe" role="group" aria-label="Universe">
    <button class:on={universe === "watchlist"} aria-pressed={universe === "watchlist"} onclick={() => setUniverse("watchlist")}>Watchlist</button>
    <button class:on={universe === "sp500"} aria-pressed={universe === "sp500"} onclick={() => setUniverse("sp500")}>S&amp;P 500</button>
  </div>

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
      {@const def = fieldOf(d.kind)}
      <div class="rule">
        <select aria-label="Field" value={d.kind} onchange={(e) => setKind(d, e.currentTarget.value)}>
          {#each FIELD_GROUPS as g (g)}
            <optgroup label={g}>
              {#each FIELDS.filter((f) => f.group === g) as f (f.key)}
                <option value={f.key}>{f.label}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
        {#if def}
          <select aria-label="Condition" value={d.op} onchange={(e) => setOp(d, e.currentTarget.value as ScreenOp)}>
            {#each opsFor(def) as op (op)}
              <option value={op}>{OP_LABEL[op]}</option>
            {/each}
          </select>
          {#if def.text && d.op === "any"}
            <select
              multiple
              size="4"
              aria-label="Sectors"
              aria-invalid={!ok}
              class:bad={!ok}
              onchange={(e) => (d.values = [...e.currentTarget.selectedOptions].map((o) => o.value))}
            >
              {#each SECTORS as s (s)}
                <option value={s} selected={d.values.includes(s)}>{s}</option>
              {/each}
            </select>
          {:else if def.text}
            <select aria-label="Sector" aria-invalid={!ok} class:bad={!ok} value={d.values[0] ?? ""} onchange={(e) => (d.values = e.currentTarget.value ? [e.currentTarget.value] : [])}>
              <option value="">Choose…</option>
              {#each SECTORS as s (s)}
                <option value={s}>{s}</option>
              {/each}
            </select>
          {:else}
            <input class:bad={!ok} aria-label="Value" aria-invalid={!ok} inputmode="decimal" maxlength="12" bind:value={d.text} />
            {#if d.op === "between"}
              <span class="unit">and</span>
              <input class:bad={!ok} aria-label="Upper value" aria-invalid={!ok} inputmode="decimal" maxlength="12" bind:value={d.text2} />
            {/if}
            {#if def.unit}<span class="unit">{def.unit}</span>{/if}
          {/if}
        {/if}
        <button class="x" aria-label="Remove filter" title="Remove" onclick={() => remove(d.id)}>×</button>
      </div>
    {/each}
    <div class="adds">
      {#if drafts.length < MAX_RULES}
        <select aria-label="Add filter" value="" onchange={(e) => { add(e.currentTarget.value); e.currentTarget.value = ""; }}>
          <option value="">Add filter…</option>
          {#each FIELD_GROUPS as g (g)}
            <optgroup label={g}>
              {#each FIELDS.filter((f) => f.group === g) as f (f.key)}
                <option value={f.key}>{f.label}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
      {/if}
      <details class="picker">
        <summary>Columns</summary>
        {#each FIELD_GROUPS as g (g)}
          <div class="group">
            <span class="label">{g}</span>
            {#each FIELDS.filter((f) => f.group === g) as f (f.key)}
              <label><input type="checkbox" checked={cols.some((c) => c.key === f.key)} onchange={(e) => toggleColumn(f.key, e.currentTarget.checked)} />{f.label}</label>
            {/each}
          </div>
        {/each}
      </details>
    </div>
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
      Loading daily bars… {done} of {pool.length}
      <button class="link" onclick={cancel}>Cancel</button>
    {:else if loadError}
      Could not load: {loadError}
    {:else}
      {matches.length} of {loaded.length - failed.length} match{drafts.length ? "" : " (no filters yet)"}{#if loading} · loading {done} of {pool.length}…{/if}
      {#if fundLoading} · loading fundamentals {fundDone} of {fundTotal}…{/if}
      {#if loading || fundLoading}<button class="link" onclick={cancel}>Cancel</button>{/if}
      {#if cancelled && !loading} · cancelled{/if}
      {#if failed.length}
        · <span title={failed.map((r) => `${r.symbol}: ${r.error}`).join("\n")}>{failed.length} unavailable</span>
      {/if}
      {#if (failed.length || cancelled) && !loading}
        <button class="link" onclick={retry}>Retry</button>
      {/if}
      {#if fundFailed && !fundLoading}
        · <span title="Yahoo returned no fundamentals for these symbols">{fundFailed} without fundamentals</span>
      {/if}
    {/if}
  </p>

  <div class="wrap">
    <table>
      <thead>
        <tr>
          <th scope="col" aria-sort={ariaSort("symbol")}><button onclick={() => sortBy("symbol")}>Symbol{arrow("symbol")}</button></th>
          {#each cols as c (c.key)}
            <th scope="col" aria-sort={ariaSort(c.key)}><button onclick={() => sortBy(c.key)}>{c.label}{arrow(c.key)}</button></th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each shown as r (r.symbol)}
          <tr>
            <th scope="row">
              <button class="star" class:on={starred.includes(r.symbol)} aria-pressed={starred.includes(r.symbol)} aria-label={`${starred.includes(r.symbol) ? "Unstar" : "Star"} ${r.symbol}`} title={starred.includes(r.symbol) ? "Remove from watchlist" : "Add to watchlist"} onclick={() => onstar(r.symbol)}>{starred.includes(r.symbol) ? "★" : "☆"}</button>
              <button onclick={() => onopen(r.symbol)}>{r.symbol}</button>
            </th>
            {#each cols as c (c.key)}
              <td class:text={c.text} class={tone(c, r)}>{cell(c, r)}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
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
  .universe {
    display: flex;
    gap: 4px;
  }
  .universe button,
  .link {
    border: 1px solid var(--faint);
    border-radius: 6px;
    background: var(--surface);
    padding: 2px 8px;
    color: var(--muted);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    font-weight: 600;
  }
  .universe button.on {
    border-color: var(--accent);
    color: var(--text);
  }
  .link {
    margin-left: 4px;
  }
  .universe button:hover,
  .link:hover {
    color: var(--text);
  }
  tbody th .star {
    margin-right: 4px;
    color: var(--muted);
    font-size: 12px;
  }
  tbody th .star.on {
    color: var(--accent);
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
  .rule,
  .adds {
    flex-wrap: wrap;
  }
  .unit,
  .label {
    color: var(--muted);
  }
  select,
  input:not([type="checkbox"]) {
    padding: 2px 6px;
    border: 1px solid var(--faint);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 12px;
  }
  input:not([type="checkbox"]) {
    width: 70px;
    font-variant-numeric: tabular-nums;
  }
  .save input {
    flex: 1;
    min-width: 0;
    width: auto;
  }
  select.bad,
  input.bad {
    border-color: var(--down);
  }
  .x {
    margin-left: auto;
  }
  .rule button,
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
  .save button {
    background: var(--surface);
  }
  .rule button:hover,
  .save button:hover:not(:disabled) {
    color: var(--text);
  }
  .save button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .picker {
    font-size: 11px;
  }
  .picker summary {
    cursor: pointer;
    color: var(--muted);
    font-weight: 600;
  }
  .picker summary:hover {
    color: var(--text);
  }
  .group {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    margin-top: 4px;
  }
  .group label {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--text);
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
  .wrap {
    overflow-x: auto;
    padding-bottom: 2px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 4px 8px;
    text-align: right;
    white-space: nowrap;
  }
  thead th {
    color: var(--muted);
    font-weight: 600;
  }
  thead th:first-child,
  tbody th {
    text-align: left;
  }
  td.text {
    text-align: left;
  }
  thead button,
  tbody th button {
    border: 0;
    background: none;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  thead button:hover {
    color: var(--text);
  }
  tbody th button {
    font-weight: 750;
    font-size: 13px;
  }
  tbody tr {
    border-top: 1px solid var(--faint);
  }
  tbody tr:hover {
    background: var(--surface);
  }
  .up {
    color: var(--up);
  }
  .down {
    color: var(--down);
  }
</style>
