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
    onopen,
    onsave,
    ondelete,
    oncolumns,
  }: {
    symbols: string[];
    screens: SavedScreen[];
    columns: string[];
    onopen: (symbol: string) => void;
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

  let nextId = 0;
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
  const loaded = $derived(symbols.flatMap((s) => bySymbol.get(s) ?? []));
  const items = $derived(mergeItems(loaded, funds));
  const failed = $derived(loaded.filter((r) => r.error));
  const matches = $derived(screenRows(items, rules));
  const shown = $derived(sortItems(matches, sortKey, sortDir));
  const savable = $derived(canSave(name, rules));
  const wantsFunds = $derived(needsFundamentals(cleanColumns(columns), rules));
  const fundFailed = $derived(symbols.filter((s) => funds.get(s)?.error).length);

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

  async function loadFunds() {
    const mine = ++fundSeq;
    const want = symbols.filter((s) => !funds.has(s));
    if (!want.length) {
      fundLoading = false;
      return;
    }
    fundLoading = true;
    try {
      const got = await invoke<ScreenFundamentals[]>("get_screener_fundamentals", { symbols: want });
      if (mine === fundSeq) funds = new Map([...funds, ...got.map((f): [string, ScreenFundamentals] => [f.symbol, f])]);
    } catch (e) {
      console.warn(e);
    } finally {
      if (mine === fundSeq) fundLoading = false;
    }
  }

  const key = $derived([...symbols].sort().join(","));
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
      Loading daily bars…
    {:else if loadError}
      Could not load: {loadError}
    {:else}
      {matches.length} of {loaded.length - failed.length} match{drafts.length ? "" : " (no filters yet)"}{#if loading} · updating…{/if}
      {#if fundLoading} · loading fundamentals…{/if}
      {#if failed.length}
        · <span title={failed.map((r) => `${r.symbol}: ${r.error}`).join("\n")}>{failed.length} unavailable</span>
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
            <th scope="row"><button onclick={() => onopen(r.symbol)}>{r.symbol}</button></th>
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
