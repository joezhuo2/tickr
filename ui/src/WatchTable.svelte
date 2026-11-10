<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { untrack } from "svelte";
  import { biasLabel, biasTone, direction, num, price, signed } from "./lib/format";
  import { daysUntil, localDay } from "./lib/calendar";
  import type { IvRank, ScreenRow, WatchDates, WatchQuote, WatchlistColumns } from "./lib/types";

  let {
    symbols,
    quotes,
    moves,
    current,
    columns,
    onopen,
    oncolumns,
  }: {
    symbols: string[];
    quotes: Record<string, WatchQuote>;
    moves: Record<string, { price: number; pct: number | null }>;
    current: string;
    columns: WatchlistColumns;
    onopen: (symbol: string) => void;
    oncolumns: (columns: WatchlistColumns) => void;
  } = $props();

  const IV_TIP =
    "Estimated IV rank: today's at-the-money implied volatility (nearest expiry at least a week out) placed within the past year's range of 30-day realized volatility, 0 to 100. Yahoo has no implied volatility history, so this is an approximation.";

  const OPTIONAL: { key: keyof WatchlistColumns; label: string; title: string }[] = [
    { key: "score", label: "Score", title: "Technical score from -100 to +100, from a 1-year daily analysis" },
    { key: "rsi", label: "RSI", title: "RSI 14 on daily closes" },
    { key: "earnings", label: "Earnings", title: "Days until the next earnings date" },
    { key: "iv_rank", label: "IV rank", title: IV_TIP },
  ];

  let screen = $state<Record<string, ScreenRow>>({});
  let ivs = $state<Record<string, IvRank>>({});
  let earnings = $state<Record<string, string | null>>({});
  const today = localDay();

  const key = $derived([...symbols].sort().join(","));
  const bySymbol = <T extends { symbol: string }>(rows: T[]) => Object.fromEntries(rows.map((r) => [r.symbol, r]));

  $effect(() => {
    const list = key ? key.split(",") : [];
    if (!list.length || !(columns.score || columns.rsi)) return;
    untrack(() => invoke<ScreenRow[]>("get_screener_data", { symbols: list }).then((r) => (screen = { ...screen, ...bySymbol(r) }), console.warn));
  });

  $effect(() => {
    const list = key ? key.split(",") : [];
    if (!list.length || !columns.iv_rank) return;
    untrack(() => invoke<IvRank[]>("get_iv_ranks", { symbols: list }).then((r) => (ivs = { ...ivs, ...bySymbol(r) }), console.warn));
  });

  $effect(() => {
    void key;
    if (!columns.earnings) return;
    untrack(() =>
      invoke<WatchDates[]>("get_watch_calendar", {}).then(
        (r) => (earnings = { ...earnings, ...Object.fromEntries(r.filter((d) => !d.error).map((d) => [d.symbol, d.earnings?.date ?? null])) }),
        console.warn,
      ),
    );
  });

  function toggle(k: keyof WatchlistColumns) {
    oncolumns({ ...columns, [k]: !columns[k] });
  }
</script>

<div class="cols" role="group" aria-label="Table columns">
  {#each OPTIONAL as c (c.key)}
    <button class:on={columns[c.key]} aria-pressed={columns[c.key]} title={c.title} onclick={() => toggle(c.key)}>{c.label}</button>
  {/each}
</div>
<div class="wrap">
  <table>
    <thead>
      <tr>
        <th scope="col">Symbol</th>
        <th scope="col">Price</th>
        <th scope="col">Chg %</th>
        {#each OPTIONAL.filter((c) => columns[c.key]) as c (c.key)}
          <th scope="col" title={c.title}>{c.key === "earnings" ? "Earn. (d)" : c.label}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each symbols as symbol (symbol)}
        {@const w = quotes[symbol]}
        {@const q = w?.quote}
        {@const m = moves[symbol]}
        {@const s = screen[symbol]}
        {@const iv = ivs[symbol]}
        {@const due = earnings[symbol]}
        <tr class:current={symbol === current}>
          <th scope="row"><button title={w?.error && !q ? w.error : q?.name || symbol} onclick={() => onopen(symbol)}>{symbol}</button></th>
          <td>{q && m ? price(m.price, q.currency) : ""}</td>
          <td class={direction(m?.pct)}>{m?.pct == null ? "" : `${signed(m.pct)}%`}</td>
          {#if columns.score}
            <td class={s?.bias ? biasTone(s.bias) : ""} title={s?.bias ? biasLabel(s.bias) : (s?.error ?? "")}>{s?.score == null ? "" : signed(s.score, 0)}</td>
          {/if}
          {#if columns.rsi}
            <td title={s?.error ?? ""}>{s?.rsi == null ? "" : num(s.rsi, 1)}</td>
          {/if}
          {#if columns.earnings}
            <td title={due ?? ""}>{due ? (daysUntil(due, today) ?? "") : ""}</td>
          {/if}
          {#if columns.iv_rank}
            <td title={iv?.error ?? (iv?.iv == null ? "" : `ATM IV ${(iv.iv * 100).toFixed(1)}% (estimate)`)}>{iv?.rank == null ? "" : Math.round(iv.rank)}</td>
          {/if}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .cols {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    margin-top: 6px;
    flex: none;
  }
  .cols button {
    border: 1px solid var(--faint);
    background: none;
    padding: 1px 8px;
    border-radius: 6px;
    cursor: pointer;
    color: var(--muted);
    font-weight: 600;
    font-size: 11px;
  }
  .cols button:hover {
    color: var(--text);
  }
  .cols button.on {
    background: var(--surface);
    color: var(--text);
    border-color: var(--muted);
  }
  .wrap {
    flex: 1;
    min-height: 0;
    margin-top: 6px;
    overflow: auto;
    overscroll-behavior: contain;
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
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--bg, var(--surface));
    color: var(--muted);
    font-weight: 600;
  }
  thead th:first-child,
  tbody th {
    text-align: left;
  }
  tbody tr {
    border-top: 1px solid var(--faint);
  }
  tbody tr:hover {
    background: var(--surface);
  }
  tbody th button {
    border: 0;
    background: none;
    padding: 0;
    color: inherit;
    font: inherit;
    font-weight: 750;
    cursor: pointer;
  }
  tr.current th button {
    color: var(--accent);
  }
  .up {
    color: var(--up);
  }
  .down {
    color: var(--down);
  }
</style>
