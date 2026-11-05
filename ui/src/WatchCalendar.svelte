<script lang="ts">
  import { ago } from "./lib/format";
  import { filterKind, formatDay, groupByDate, watchEntries, failedSymbols, type WatchKindFilter } from "./lib/calendar";
  import type { WatchDates } from "./lib/types";

  let {
    dates,
    error,
    loading,
    at,
    count,
    today,
    now,
    onopen,
    onretry,
  }: {
    dates: WatchDates[] | undefined;
    error: string | null;
    loading: boolean;
    at: number;
    count: number;
    today: string;
    now: number;
    onopen: (symbol: string) => void;
    onretry: () => void;
  } = $props();

  const KINDS: { id: WatchKindFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "earnings", label: "Earnings" },
    { id: "dividend", label: "Ex-dividend" },
  ];

  let kind = $state<WatchKindFilter>("all");

  const entries = $derived(watchEntries(dates ?? [], today));
  const days = $derived(groupByDate(filterKind(entries, kind)));
  const failed = $derived(failedSymbols(dates ?? []));
  const dated = $derived(new Set(entries.map((e) => e.symbol)));
  const quiet = $derived((dates ?? []).filter((d) => !d.error && !dated.has(d.symbol)).length);
  const dayLabel = (d: string) => (d === today ? "Today" : formatDay(d, { weekday: "short", month: "short", day: "numeric" }));
</script>

{#if count === 0}
  <div class="msg">Star symbols to see their upcoming earnings and ex-dividend dates here</div>
{:else if dates === undefined && error}
  <div class="msg">
    Could not load the calendar: {error}
    <button class="btn" onclick={onretry}>Retry</button>
  </div>
{:else if dates === undefined}
  <div class="list" aria-busy="true" aria-label="Loading watchlist calendar">
    {#each [0, 1, 2, 3, 4, 5] as i (i)}
      <div class="row">
        <span class="sk" style="width: {40 + ((i * 17) % 25)}%; height: 13px"></span>
        <span class="sk" style="width: 140px; height: 10px; margin-top: 6px"></span>
      </div>
    {/each}
  </div>
{:else}
  <div class="bar">
    <div class="seg" role="group" aria-label="Show">
      {#each KINDS as k (k.id)}
        <button class:on={kind === k.id} aria-pressed={kind === k.id} onclick={() => (kind = k.id)}>{k.label}</button>
      {/each}
    </div>
    <span class="muted">{at ? `Updated ${ago(at, now)}` : ""}{loading ? " · refreshing…" : ""}</span>
  </div>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
  {#if days.length === 0}
    <div class="msg">
      {entries.length === 0 ? "No upcoming earnings or ex-dividend dates for your watchlist" : "Nothing of this kind coming up"}
    </div>
  {:else}
    <div class="list">
      {#each days as d (d.key)}
        <h3 class="day">{dayLabel(d.key)}</h3>
        <ul>
          {#each d.items as e (e.id)}
            <li>
              <button class="row" onclick={() => onopen(e.symbol)}>
                <span class="title">{e.symbol}</span>
                <span class="meta">
                  <span class="pill {e.kind}">{e.kind === "earnings" ? "Earnings" : "Ex-dividend"}</span>
                  {#if e.estimated}<span>Estimated date</span>{/if}
                  {#if e.eps != null}<span>EPS estimate <b>{e.eps.toFixed(2)}</b></span>{/if}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/each}
    </div>
  {/if}
  {#if failed.length || quiet}
    <p class="note">
      {#if failed.length}Could not load {failed.length === 1 ? failed[0] : `${failed.length} symbols`}.{/if}
      {#if quiet}{quiet} {quiet === 1 ? "symbol has" : "symbols have"} no upcoming dates.{/if}
    </p>
  {/if}
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 6px;
    font-size: 11.5px;
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
  .btn {
    border: 1px solid var(--faint);
    background: var(--surface);
    border-radius: 6px;
    padding: 3px 10px;
    cursor: pointer;
  }
  .btn:focus-visible,
  .seg button:focus-visible,
  .row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .list {
    flex: 1;
    min-height: 0;
    margin: 6px 0 0;
    padding: 0 6px 0 0;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .list ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li + li {
    border-top: 1px solid var(--faint);
  }
  h3.day {
    position: sticky;
    top: 0;
    z-index: 1;
    margin: 0;
    padding: 8px 8px 4px;
    background: var(--bg);
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    padding: 8px 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
  }
  button.row {
    cursor: pointer;
  }
  button.row:hover,
  button.row:focus-visible {
    background: var(--surface);
  }
  .title {
    font-weight: 650;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 10px;
    font-size: 11.5px;
    color: var(--muted);
  }
  .meta b {
    color: var(--text);
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
  .pill {
    padding: 0 7px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 650;
    line-height: 16px;
    color: #fff;
    background: var(--accent);
  }
  .pill.dividend {
    background: var(--dividend);
  }
  .muted {
    color: var(--muted);
  }
  .err {
    margin: 4px 0;
    color: var(--down);
  }
  .note {
    margin: 6px 0 0;
    font-size: 11.5px;
    color: var(--muted);
  }
  .msg {
    flex: 1;
    display: grid;
    place-content: center;
    gap: 8px;
    color: var(--muted);
    text-align: center;
  }
  .msg .btn {
    justify-self: center;
  }
</style>
