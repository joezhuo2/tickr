<script lang="ts">
  import { barLayout, hasData, lineLayout, marginSeries, money, percent, periodLabel, statementRows, STATEMENTS, volumeSeries, type Frequency, type Statement } from "./lib/financials";
  import type { Financials } from "./lib/types";

  let {
    symbol,
    financials,
    error,
    onretry,
  }: { symbol: string; financials: Financials | null | undefined; error: string | null; onretry: () => void } = $props();

  const W = 300;
  const H = 120;
  const COLORS: Record<string, string> = {
    revenue: "var(--accent)",
    net_income: "var(--ma-1)",
    free_cash_flow: "var(--ma-4)",
    gross_margin: "var(--ma-5)",
    operating_margin: "var(--ma-2)",
    net_margin: "var(--ma-1)",
  };

  let chosen = $state<Frequency | null>(null);
  let statement = $state<Statement>("overview");
  const frequency = $derived<Frequency>(chosen ?? (financials && !hasData(financials.annual) && hasData(financials.quarterly) ? "quarterly" : "annual"));
  const periods = $derived(financials ? financials[frequency] : []);
  const labels = $derived(periods.map((p) => periodLabel(p.date, frequency)));
  const rows = $derived(statementRows(periods, statement));
  const flows = $derived(volumeSeries(periods).filter((s) => s.values.some((v) => v != null)));
  const margins = $derived(marginSeries(periods));
  const bars = $derived(barLayout(flows.map((s) => s.values), W, H));
  const lines = $derived(lineLayout(margins.map((s) => s.values), W, H));
  const empty = $derived(!financials || (!hasData(financials.annual) && !hasData(financials.quarterly)));
</script>

{#if financials === undefined && error}
  <div class="msg">
    Could not load financials: {error}
    <button class="retry" onclick={onretry}>Retry</button>
  </div>
{:else if financials === undefined}
  <div class="panel" aria-busy="true" aria-label="Loading financials">
    <span class="sk" style="width: 160px; height: 22px"></span>
    <div class="charts">
      <span class="sk" style="width: 100%; height: {H}px"></span>
      <span class="sk" style="width: 100%; height: {H}px"></span>
    </div>
    {#each [0, 1, 2, 3, 4] as i (i)}
      <span class="sk" style="width: 100%; height: 12px"></span>
    {/each}
  </div>
{:else if empty}
  <div class="msg">No financial history for {symbol}</div>
{:else}
  <div class="panel">
    <div class="head">
      <div class="seg" role="group" aria-label="Statement">
        {#each STATEMENTS as s (s.key)}
          <button class:on={statement === s.key} aria-pressed={statement === s.key} onclick={() => (statement = s.key)}>{s.label}</button>
        {/each}
      </div>
      <div class="seg" role="group" aria-label="Period">
        <button class:on={frequency === "annual"} aria-pressed={frequency === "annual"} onclick={() => (chosen = "annual")}>Annual</button>
        <button class:on={frequency === "quarterly"} aria-pressed={frequency === "quarterly"} onclick={() => (chosen = "quarterly")}>Quarterly</button>
      </div>
      {#if financials?.currency}<span class="note">{financials.currency}</span>{/if}
    </div>
    {#if rows.length === 0}
      <div class="none">No {frequency} data for {symbol}</div>
    {:else}
      {#key frequency}
      {#if statement === "overview"}
      <div class="charts">
        <figure>
          <figcaption>
            {#each flows as s (s.key)}<span class="key"><i style="background: {COLORS[s.key]}"></i>{s.label}</span>{/each}
          </figcaption>
          <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="Revenue, net income and free cash flow by period">
            <line class="base" x1="0" x2={W} y1={bars.baseline} y2={bars.baseline} />
            {#each bars.bars as b (`${b.series}-${b.index}`)}
              <rect class:neg={b.value < 0} style="animation-delay: {b.index * 20}ms" x={b.x} y={b.y} width={b.width} height={b.height} fill={COLORS[flows[b.series].key]}>
                <title>{flows[b.series].label} {labels[b.index]}: {money(b.value)}</title>
              </rect>
            {/each}
          </svg>
          <div class="axis" style="grid-template-columns: repeat({periods.length}, 1fr)">
            {#each labels as l, i (i)}<span>{l}</span>{/each}
          </div>
        </figure>
        {#if margins.length}
          <figure>
            <figcaption>
              {#each margins as s (s.key)}<span class="key"><i style="background: {COLORS[s.key]}"></i>{s.label}</span>{/each}
            </figcaption>
            <svg class="wipe" viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="Margins by period">
              <line class="base" x1="0" x2={W} y1={lines.baseline} y2={lines.baseline} />
              {#each margins as s, i (s.key)}
                <path d={lines.paths[i]} stroke={COLORS[s.key]}>
                  <title>{s.label}: {s.values.map((v, j) => `${labels[j]} ${percent(v)}`).join(", ")}</title>
                </path>
              {/each}
            </svg>
            <div class="axis" style="grid-template-columns: repeat({periods.length}, 1fr)">
              {#each labels as l, i (i)}<span>{l}</span>{/each}
            </div>
          </figure>
        {/if}
      </div>
      {/if}
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th scope="col"></th>
              {#each periods as p, i (p.date)}<th scope="col" title={p.date}>{labels[i]}</th>{/each}
            </tr>
          </thead>
          <tbody>
            {#each rows as r (r.key)}
              <tr>
                <th scope="row">{r.label}</th>
                {#each r.cells as c, i (i)}
                  <td class:down={(r.values[i] ?? 0) < 0}>{c}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {/key}
    {/if}
  </div>
{/if}

<style>
  .panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 14px 10px 8px 4px;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
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
    padding: 3px 10px;
    border-radius: 5px;
    cursor: pointer;
    color: var(--muted);
  }
  .seg button.on {
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  }
  .note {
    color: var(--muted);
    font-size: 12px;
  }
  .charts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 20px;
  }
  figure {
    margin: 0;
    min-width: 0;
  }
  figcaption {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin-bottom: 6px;
    font-size: 12px;
    color: var(--muted);
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .key i {
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }
  svg {
    display: block;
    width: 100%;
    height: 120px;
    overflow: visible;
  }
  .base {
    stroke: var(--faint);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  path {
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  rect {
    transform-box: fill-box;
    transform-origin: bottom;
    animation: grow var(--motion-slow) var(--ease-out) backwards;
  }
  rect.neg {
    transform-origin: top;
  }
  .wipe {
    animation: wipe 400ms var(--ease-out);
  }
  .axis,
  .scroll {
    animation: fade var(--motion-slow) var(--ease-out);
  }
  @keyframes grow {
    from {
      transform: scaleY(0);
    }
  }
  @keyframes wipe {
    from {
      clip-path: inset(-4px 100% -4px -4px);
    }
    to {
      clip-path: inset(-4px);
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    rect,
    .wipe,
    .axis,
    .scroll {
      animation: none;
    }
  }
  .axis {
    display: grid;
    margin-top: 4px;
    font-size: 11px;
    color: var(--muted);
    text-align: center;
  }
  .axis span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    min-width: 100%;
  }
  th {
    color: var(--muted);
    font-weight: 600;
    text-align: right;
    padding: 4px 8px;
    white-space: nowrap;
  }
  td {
    text-align: right;
    padding: 5px 8px;
    border-top: 1px solid var(--faint);
    white-space: nowrap;
  }
  tbody th {
    text-align: left;
    font-weight: 400;
    border-top: 1px solid var(--faint);
  }
  thead th:first-child,
  tbody th {
    padding-left: 0;
    position: sticky;
    left: 0;
    background: var(--bg);
  }
  .down {
    color: var(--down);
  }
  .none,
  .msg {
    color: var(--muted);
  }
  .msg {
    flex: 1;
    display: grid;
    place-content: center;
    gap: 8px;
    text-align: center;
  }
  .none {
    padding: 20px 0;
  }
  .retry {
    border: 1px solid var(--faint);
    background: var(--surface);
    border-radius: 6px;
    padding: 3px 10px;
    cursor: pointer;
  }
</style>
