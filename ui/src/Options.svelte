<script lang="ts">
  import { tick } from "svelte";
  import { change, direction, num, volume } from "./lib/format";
  import { greeks, yearsTo } from "./lib/greeks";
  import { addLeg, entryPrice, makeLeg, type Leg, type LegSide, type PriceMode, type SavedStrategy } from "./lib/payoff";
  import Strategy from "./Strategy.svelte";
  import type { OptionContract, Options } from "./lib/types";

  const STACK_BELOW = 520;
  const ESTIMATE = "Estimates: Black-Scholes from Yahoo's implied volatility, European-style, 4% risk-free rate, no dividends. Theta is per day, vega per 1 vol point.";
  const SPLIT_MIN = 0.2;
  const SPLIT_MAX = 0.8;

  function stored(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function store(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  }

  let {
    options,
    error,
    onretry,
    onexpiry,
    side = $bindable("calls"),
  }: {
    options: Options | undefined;
    error: string | null;
    onretry: () => void;
    onexpiry: (date: number) => void;
    side?: "calls" | "puts" | "both";
  } = $props();

  let tab = $state<"chain" | "strategy">("chain");
  let text = $state("");
  let chainEl = $state<HTMLDivElement>();
  let width = $state(0);
  let showGreeks = $state(stored("tickr.optionsGreeks") === "1");
  let split = $state(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Number(stored("tickr.optionsSplit")) || 0.5)));
  let drag: { p: number; size: number; split: number } | null = null;
  let legs = $state<Leg[]>([]);
  let saved = $state<SavedStrategy[]>([]);
  let mode = $state<PriceMode>("mid");
  let loadedExpiry: number | null | undefined;

  const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const dates = $derived(new Map((options?.expirations ?? []).map((t) => [iso(t), t])));
  const price = $derived(options?.price ?? null);
  const kinds = $derived<("calls" | "puts")[]>(side === "both" ? ["calls", "puts"] : [side]);
  const stacked = $derived(side === "both" && width > 0 && width < STACK_BELOW);
  const years = $derived(yearsTo(options?.expiry ?? null));
  const cols = $derived(9 + (showGreeks ? 4 : 0));

  function sorted(kind: "calls" | "puts") {
    return [...(options?.[kind] ?? [])].sort((a, b) => b.strike - a.strike);
  }

  function setSplit(v: number) {
    split = Math.round(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v)) * 1000) / 1000;
    store("tickr.optionsSplit", String(split));
  }

  function pickSide(v: "calls" | "puts" | "both") {
    side = v;
  }

  function toggleGreeks() {
    showGreeks = !showGreeks;
    store("tickr.optionsGreeks", showGreeks ? "1" : "0");
  }

  function wraps() {
    return [...(chainEl?.querySelectorAll<HTMLElement>(".wrap") ?? [])];
  }

  function syncScroll(e: Event) {
    if (stacked) return;
    const src = e.currentTarget as HTMLElement;
    for (const w of wraps()) if (w !== src && w.scrollTop !== src.scrollTop) w.scrollTop = src.scrollTop;
  }

  function gripDown(e: PointerEvent) {
    const box = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    const size = stacked ? box.height : box.width;
    drag = { p: stacked ? e.clientY : e.clientX, size, split };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function gripMove(e: PointerEvent) {
    if (drag) setSplit(drag.split + ((stacked ? e.clientY : e.clientX) - drag.p) / drag.size);
  }

  function gripKey(e: KeyboardEvent) {
    const keys = stacked ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    setSplit(split + (e.key === keys[1] ? 0.04 : -0.04));
  }

  $effect(() => {
    if (options?.expiry != null) text = iso(options.expiry);
  });

  $effect(() => {
    const expiry = options?.expiry ?? null;
    if (expiry === loadedExpiry) return;
    loadedExpiry = expiry;
    legs = [];
    saved = [];
  });

  function add(c: OptionContract, action: LegSide, kind: "call" | "put") {
    const price = entryPrice(c, action, mode) ?? 0;
    legs = addLeg(legs, makeLeg({ kind, side: action, strike: c.strike, quantity: 1, price }));
  }

  $effect(() => {
    if (!options || !chainEl) return;
    side;
    stacked;
    tick().then(() => {
      for (const wrap of wraps()) {
        const mid = wrap.querySelector<HTMLElement>(".mid");
        if (!mid) continue;
        const w = wrap.getBoundingClientRect();
        const m = mid.getBoundingClientRect();
        wrap.scrollTop += m.top - w.top - (w.height - m.height) / 2;
      }
    });
  });

  function pick() {
    const t = dates.get(text.trim());
    if (t != null && t !== options?.expiry) onexpiry(t);
  }

  function traded(t: number | null) {
    return t == null
      ? "—"
      : new Date(t * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
</script>

{#snippet row(c: OptionContract, kind: "call" | "put")}
  <tr class:itm={c.itm}>
    <th scope="row">{num(c.strike)}{#if c.itm}<span class="badge">ITM</span>{/if}</th>
    <td>{c.last == null ? "—" : num(c.last)}</td>
    <td>{c.bid == null || c.ask == null ? "—" : `${num(c.bid)} / ${num(c.ask)}`}</td>
    <td class={direction(c.change)}>{change(c.change, c.change_pct)}</td>
    <td>{volume(c.volume)}</td>
    <td>{volume(c.open_interest)}</td>
    <td>{c.iv == null ? "—" : `${(c.iv * 100).toFixed(1)}%`}</td>
    {#if showGreeks}
      {@const g = greeks(kind, price, c.strike, years, c.iv)}
      <td>{g ? g.delta.toFixed(3) : "—"}</td>
      <td>{g ? g.gamma.toFixed(4) : "—"}</td>
      <td>{g ? g.theta.toFixed(3) : "—"}</td>
      <td>{g ? g.vega.toFixed(3) : "—"}</td>
    {/if}
    <td class="when">{traded(c.last_trade)}</td>
    <td class="add">
      <button onclick={() => add(c, "long", kind)} aria-label="Buy {kind} at strike {num(c.strike)}">Buy</button>
      <button onclick={() => add(c, "short", kind)} aria-label="Sell {kind} at strike {num(c.strike)}">Sell</button>
    </td>
  </tr>
{/snippet}

{#snippet pane(kind: "calls" | "puts", grow: number)}
  {@const list = sorted(kind)}
  {@const one = kind === "calls" ? "call" : "put"}
  {@const above = list.filter((c) => price == null || c.strike > price)}
  {@const below = list.filter((c) => price != null && c.strike <= price)}
  <div class="pane" style:flex="{grow} 1 0">
    {#if side === "both"}<div class="label">{kind === "calls" ? "Calls" : "Puts"}</div>{/if}
    {#if list.length === 0}
      <div class="msg">No {kind} for this expiry.</div>
    {:else}
      <div class="wrap" onscroll={syncScroll}>
        <table>
          <thead>
            <tr>
              <th scope="col">Strike</th>
              <th scope="col">Last</th>
              <th scope="col">Bid / Ask</th>
              <th scope="col">Change</th>
              <th scope="col">Volume</th>
              <th scope="col">Open int.</th>
              <th scope="col">IV</th>
              {#if showGreeks}
                <th scope="col" title={ESTIMATE}>Delta</th>
                <th scope="col" title={ESTIMATE}>Gamma</th>
                <th scope="col" title={ESTIMATE}>Theta /day</th>
                <th scope="col" title={ESTIMATE}>Vega /vol pt</th>
              {/if}
              <th scope="col">Last trade</th>
              <th scope="col">Strategy</th>
            </tr>
          </thead>
          <tbody>
            {#each above as c (c.symbol)}{@render row(c, one)}{/each}
            <tr class="mid">
              <td colspan={cols}>{price == null ? "—" : num(price)}</td>
            </tr>
            {#each below as c (c.symbol)}{@render row(c, one)}{/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
{/snippet}

{#if options === undefined && error}
  <div class="msg">
    Could not load options: {error}
    <button class="retry" onclick={onretry}>Retry</button>
  </div>
{:else if options === undefined}
  <div class="wrap" aria-busy="true" aria-label="Loading options">
    {#each [0, 1, 2, 3, 4, 5, 6, 7] as i (i)}
      <span class="sk" style="width: 100%; height: 14px; margin-bottom: 10px"></span>
    {/each}
  </div>
{:else}
  <div class="bar">
    <div class="seg" role="tablist" aria-label="Options view">
      <button role="tab" class:on={tab === "chain"} aria-selected={tab === "chain"} onclick={() => (tab = "chain")}>Calls / Puts</button>
      <button role="tab" class:on={tab === "strategy"} aria-selected={tab === "strategy"} onclick={() => (tab = "strategy")}>Strategy</button>
    </div>
    {#if tab === "chain"}
      <div class="seg" role="group" aria-label="Contract type">
        {#each ["calls", "puts", "both"] as v (v)}
          <button class:on={side === v} aria-pressed={side === v} onclick={() => pickSide(v as "calls" | "puts" | "both")}>{v === "calls" ? "Calls" : v === "puts" ? "Puts" : "Both"}</button>
        {/each}
      </div>
      <div class="seg" role="group" aria-label="Greeks">
        <button class:on={showGreeks} aria-pressed={showGreeks} title={ESTIMATE} onclick={toggleGreeks}>Greeks</button>
      </div>
    {/if}
    <input
      type="text"
      list="expiries"
      placeholder="YYYY-MM-DD"
      aria-label="Expiry"
      bind:value={text}
      oninput={pick}
      onchange={pick}
    />
    <datalist id="expiries">
      {#each dates.keys() as d (d)}<option value={d}></option>{/each}
    </datalist>
    {#if error}<span class="err">{error} <button class="retry" onclick={onretry}>Retry</button></span>{/if}
  </div>
  <div class="body">
    {#if tab === "chain"}
    <div class="chain" class:stacked bind:this={chainEl} bind:clientWidth={width}>
      {@render pane(kinds[0], side === "both" ? split : 1)}
      {#if side === "both"}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div
          class="grip"
          role="separator"
          aria-orientation={stacked ? "horizontal" : "vertical"}
          aria-label="Resize calls and puts"
          aria-valuenow={Math.round(split * 100)}
          tabindex="0"
          onpointerdown={gripDown}
          onpointermove={gripMove}
          onpointerup={() => (drag = null)}
          onpointercancel={() => (drag = null)}
          ondblclick={() => setSplit(0.5)}
          onkeydown={gripKey}
        ></div>
        {@render pane("puts", 1 - split)}
      {/if}
    </div>
    {:else}
      <Strategy {options} bind:legs bind:saved bind:mode />
    {/if}
  </div>
{/if}

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 8px 4px;
  }
  input {
    border: 1px solid var(--faint);
    background: var(--surface);
    color: inherit;
    font: inherit;
    font-size: 12px;
    border-radius: 6px;
    padding: 3px 8px;
  }
  input {
    width: 110px;
  }
  .body {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
  }
  .chain {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }
  .chain.stacked {
    flex-direction: column;
  }
  .pane {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .label {
    padding: 2px 8px;
    font-size: 12px;
    font-weight: 650;
    color: var(--muted);
  }
  .grip {
    flex: none;
    width: 7px;
    margin: 0 2px;
    border-left: 1px solid var(--faint);
    cursor: col-resize;
    touch-action: none;
  }
  .stacked .grip {
    width: auto;
    height: 7px;
    margin: 2px 0;
    border-left: 0;
    border-top: 1px solid var(--faint);
    cursor: row-resize;
  }
  .grip:hover,
  .grip:focus-visible {
    border-color: var(--accent);
    outline: none;
  }
  .seg {
    display: flex;
    background: var(--surface);
    border: 1px solid var(--faint);
    border-radius: 7px;
    padding: 2px;
  }
  .seg button {
    border: 0;
    background: none;
    font: inherit;
    font-size: 12px;
    padding: 2px 10px;
    border-radius: 5px;
    cursor: pointer;
    color: var(--muted);
  }
  .seg button.on {
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  }
  .seg button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .add button {
    border: 1px solid var(--faint);
    background: var(--surface);
    color: inherit;
    font: inherit;
    font-size: 11px;
    border-radius: 5px;
    padding: 1px 7px;
    cursor: pointer;
  }
  .add button:first-child {
    color: var(--up);
    margin-right: 4px;
  }
  .add button:last-child {
    color: var(--down);
  }
  .wrap {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 0 4px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 4px 10px;
    text-align: right;
    white-space: nowrap;
  }
  thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--bg, var(--surface));
    color: var(--muted);
    font-weight: 600;
  }
  tbody th {
    position: sticky;
    left: 0;
    z-index: 1;
    background: var(--bg, var(--surface));
    font-weight: 650;
  }
  thead th:first-child {
    left: 0;
    z-index: 3;
  }
  .itm td,
  .itm th {
    background: color-mix(in srgb, var(--up) 10%, var(--bg, var(--surface)));
  }
  .badge {
    margin-left: 6px;
    padding: 0 4px;
    border-radius: 4px;
    font-size: 10px;
    background: var(--up);
    color: var(--bg, #000);
  }
  .mid td {
    text-align: center;
    font-weight: 650;
    background: var(--surface);
    border-block: 1px solid var(--faint);
  }
  .when {
    color: var(--muted);
  }
  .up {
    color: var(--up);
  }
  .down {
    color: var(--down);
  }
  .err {
    color: var(--down);
    font-size: 12px;
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
