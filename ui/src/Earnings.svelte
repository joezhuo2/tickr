<script lang="ts">
  import { direction, fullTime, price, quarterLabel, signed, volume } from "./lib/format";
  import type { Earnings } from "./lib/types";

  let { symbol, earnings }: { symbol: string; earnings: Earnings | null | undefined } = $props();

  const offset = -new Date().getTimezoneOffset() * 60;
  const day = (t: number) => fullTime(t, offset, "1d");
  const currency = $derived(earnings?.currency ?? "USD");
</script>

{#if earnings === undefined}
  <div class="panel" aria-busy="true" aria-label="Loading earnings">
    <div class="col">
      <span class="sk" style="width: 100px; height: 12px"></span>
      <span class="sk" style="width: 160px; height: 30px; margin-top: 10px"></span>
      <span class="sk" style="width: 120px; height: 12px; margin-top: 10px"></span>
    </div>
    <div class="col">
      <span class="sk" style="width: 100px; height: 12px"></span>
      {#each [0, 1, 2, 3] as i (i)}
        <span class="sk" style="width: 100%; height: 12px; margin-top: 12px"></span>
      {/each}
    </div>
  </div>
{:else if earnings === null}
  <div class="msg">No earnings data for {symbol}</div>
{:else}
  {@const u = earnings.upcoming}
  <div class="panel">
    <div class="col">
      <h2>Next report</h2>
      {#if u}
        <div class="big">{day(u.date)}</div>
        <div class="sub">{u.estimated ? "Estimated date" : "Confirmed"}</div>
        <dl>
          <dt>EPS estimate</dt>
          <dd>{price(u.eps_estimate, currency)}</dd>
          {#if u.eps_low != null && u.eps_high != null}
            <dt>EPS range</dt>
            <dd>{price(u.eps_low, currency)} – {price(u.eps_high, currency)}</dd>
          {/if}
          {#if u.revenue_estimate != null}
            <dt>Revenue estimate</dt>
            <dd>{volume(u.revenue_estimate)}</dd>
          {/if}
        </dl>
      {:else}
        <div class="sub">No date announced</div>
      {/if}
    </div>
    <div class="col">
      <h2>Past reports</h2>
      {#if earnings.history.length}
        <table>
          <thead>
            <tr><th>Quarter</th><th>Reported</th><th>Estimate</th><th>Actual</th><th>Surprise</th><th>Revenue</th></tr>
          </thead>
          <tbody>
            {#each earnings.history as r (r.reported)}
              <tr>
                <td>{quarterLabel(r.quarter)}</td>
                <td>{day(r.reported)}</td>
                <td>{price(r.eps_estimate, currency)}</td>
                <td>{price(r.eps_actual, currency)}</td>
                <td class={direction(r.surprise_pct)}>{r.surprise_pct == null ? "—" : `${signed(r.surprise_pct)}%`}</td>
                <td>{volume(r.revenue)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <div class="sub">No past reports</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .panel {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 28px;
    padding: 14px 10px 8px 4px;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .col {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .big {
    font-size: 22px;
    font-weight: 700;
  }
  .sub {
    color: var(--muted);
    font-size: 12px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 10px;
    margin: 14px 0 0;
    font-size: 12px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  table {
    border-collapse: collapse;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  th {
    color: var(--muted);
    font-weight: 600;
    text-align: right;
    padding: 4px 6px;
  }
  td {
    text-align: right;
    padding: 5px 6px;
    border-top: 1px solid var(--faint);
    white-space: nowrap;
  }
  th:first-child,
  td:first-child {
    text-align: left;
  }
  .up {
    color: var(--up);
  }
  .down {
    color: var(--down);
  }
  .msg {
    flex: 1;
    display: grid;
    place-content: center;
    color: var(--muted);
  }
</style>
