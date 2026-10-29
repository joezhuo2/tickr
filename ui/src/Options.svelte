<script lang="ts">
  import { tick } from "svelte";
  import { change, direction, num, volume } from "./lib/format";
  import type { OptionContract, Options } from "./lib/types";

  let {
    options,
    error,
    onretry,
    onexpiry,
  }: {
    options: Options | undefined;
    error: string | null;
    onretry: () => void;
    onexpiry: (date: number) => void;
  } = $props();

  let side = $state<"calls" | "puts">("calls");
  let text = $state("");
  let wrap = $state<HTMLDivElement>();
  let mid = $state<HTMLElement>();

  const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const dates = $derived(new Map((options?.expirations ?? []).map((t) => [iso(t), t])));
  const price = $derived(options?.price ?? null);
  const rows = $derived([...(options?.[side] ?? [])].sort((a, b) => b.strike - a.strike));
  const above = $derived(rows.filter((c) => price == null || c.strike > price));
  const below = $derived(rows.filter((c) => price != null && c.strike <= price));

  $effect(() => {
    if (options?.expiry != null) text = iso(options.expiry);
  });

  $effect(() => {
    if (!options || !wrap) return;
    side;
    tick().then(() => {
      if (!wrap || !mid) return;
      const w = wrap.getBoundingClientRect();
      const m = mid.getBoundingClientRect();
      wrap.scrollTop += m.top - w.top - (w.height - m.height) / 2;
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

{#snippet row(c: OptionContract)}
  <tr class:itm={c.itm}>
    <th scope="row">{num(c.strike)}{#if c.itm}<span class="badge">ITM</span>{/if}</th>
    <td>{c.last == null ? "—" : num(c.last)}</td>
    <td>{c.bid == null || c.ask == null ? "—" : `${num(c.bid)} / ${num(c.ask)}`}</td>
    <td class={direction(c.change)}>{change(c.change, c.change_pct)}</td>
    <td>{volume(c.volume)}</td>
    <td>{volume(c.open_interest)}</td>
    <td>{c.iv == null ? "—" : `${(c.iv * 100).toFixed(1)}%`}</td>
    <td class="when">{traded(c.last_trade)}</td>
  </tr>
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
    <select bind:value={side} aria-label="Contract type">
      <option value="calls">Calls</option>
      <option value="puts">Puts</option>
    </select>
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
  {#if rows.length === 0}
    <div class="msg">No {side} for this expiry.</div>
  {:else}
    <div class="wrap" bind:this={wrap}>
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
            <th scope="col">Last trade</th>
          </tr>
        </thead>
        <tbody>
          {#each above as c (c.symbol)}{@render row(c)}{/each}
          <tr class="mid" bind:this={mid}>
            <td colspan="8">{price == null ? "—" : num(price)}</td>
          </tr>
          {#each below as c (c.symbol)}{@render row(c)}{/each}
        </tbody>
      </table>
    </div>
  {/if}
{/if}

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 8px 4px;
  }
  select,
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
  .wrap {
    flex: 1;
    min-height: 0;
    overflow: auto;
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
