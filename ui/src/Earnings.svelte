<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { direction, fullTime, num, price, quarterLabel, signed, volume } from "./lib/format";
  import { periodLabel } from "./lib/financials";
  import { averageAbs, expiryAfter, pastMoves, straddle, type Move, type Straddle } from "./lib/optionsStats";
  import type { Chart, Earnings, Options } from "./lib/types";

  let { symbol, earnings }: { symbol: string; earnings: Earnings | null | undefined } = $props();

  const offset = -new Date().getTimezoneOffset() * 60;
  const day = (t: number) => fullTime(t, offset, "1d");
  const until = (t: number) => Math.ceil((t - Date.now() / 1000) / 86400);
  const currency = $derived(earnings?.currency ?? "USD");

  let implied = $state<{ straddle: Straddle | null; moves: Move[]; price: number | null } | undefined>(undefined);
  let impliedError = $state<string | null>(null);

  $effect(() => {
    const sym = symbol;
    const date = earnings?.upcoming?.date ?? null;
    const reported = (earnings?.history ?? []).map((r) => r.reported);
    implied = undefined;
    impliedError = null;
    if (!earnings) return;
    let alive = true;
    (async () => {
      let found: Straddle | null = null;
      let last: number | null = null;
      let failure: string | null = null;
      if (date != null) {
        try {
          const first = await invoke<Options>("get_options", { symbol: sym, date: null });
          last = first.price;
          const expiry = expiryAfter(first.expirations, date);
          if (expiry != null) found = straddle(expiry === first.expiry ? first : await invoke<Options>("get_options", { symbol: sym, date: expiry }));
        } catch (e) {
          failure = String(e);
        }
      }
      let moves: Move[] = [];
      try {
        const chart = await invoke<Chart>("get_chart", { symbol: sym, range: "5y", interval: "1d", extended: false, secondary: true });
        moves = pastMoves(chart.candles, reported);
      } catch (e) {
        failure ??= String(e);
      }
      if (!alive) return;
      implied = { straddle: found, moves, price: last };
      impliedError = failure;
    })();
    return () => {
      alive = false;
    };
  });

  const avg = $derived(implied ? averageAbs(implied.moves) : null);
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
        <div class="sub">
          {u.estimated ? "Estimated date" : "Confirmed"}{#if until(u.date) >= 0}
            · {until(u.date) === 0 ? "today" : `in ${until(u.date)} day${until(u.date) === 1 ? "" : "s"}`}{/if}
        </div>
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
      <h2>Implied move</h2>
      {#if implied === undefined}
        <span class="sk" style="width: 160px; height: 30px"></span>
      {:else}
        {#if implied.straddle}
          {@const s = implied.straddle}
          <div class="big">±{s.pct.toFixed(1)}%</div>
          <div class="sub">±{price(s.cost, currency)} from the {num(s.strike)} straddle expiring {new Date(s.expiry * 1000).toISOString().slice(0, 10)}</div>
        {:else if u}
          <div class="sub">{impliedError ? `Options unavailable: ${impliedError}` : "No options expiring after the report"}</div>
        {:else}
          <div class="sub">No upcoming report to price</div>
        {/if}
        {#if implied.moves.length}
          <dl>
            <dt>Average past move</dt>
            <dd>±{avg?.toFixed(1)}%</dd>
          </dl>
          <div class="scroll"><table>
            <thead><tr><th>Reported</th><th>Move</th></tr></thead>
            <tbody>
              {#each implied.moves as m (m.reported)}
                <tr><td>{day(m.reported)}</td><td class={direction(m.pct)}>{signed(m.pct)}%</td></tr>
              {/each}
            </tbody>
          </table></div>
          <div class="sub note">Close before to close after the report.</div>
        {:else}
          <div class="sub">No past moves available</div>
        {/if}
      {/if}
    </div>
    <div class="col">
      <h2>Past reports</h2>
      {#if earnings.history.length || earnings.older.length}
        <div class="scroll"><table>
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
            {#each earnings.older as o (o.date)}
              <tr>
                <td>{periodLabel(o.date, "quarterly")}</td>
                <td>—</td>
                <td>—</td>
                <td>{price(o.eps_actual, currency)}</td>
                <td>—</td>
                <td>{volume(o.revenue)}</td>
              </tr>
            {/each}
          </tbody>
        </table></div>
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
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    gap: 22px;
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
  .note {
    margin-top: 6px;
  }
  .scroll {
    overflow-x: auto;
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
