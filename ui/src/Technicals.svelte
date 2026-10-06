<script lang="ts">
  import { biasLabel, biasTone, direction, fullTime, num, price, signed, upside } from "./lib/format";
  import type { Analysis, Direction, Overlays, Target } from "./lib/types";

  let {
    analysis,
    loading,
    error,
    bars,
    gmtoffset,
    overlays = $bindable(),
    onanalyze,
  }: {
    analysis: Analysis | null;
    loading: boolean;
    error: string | null;
    /** Candles in the chart on screen. */
    bars: number;
    gmtoffset: number;
    overlays: Overlays;
    onanalyze: () => void;
  } = $props();

  const tone = (d: Direction) => (d === "bullish" ? "up" : d === "bearish" ? "down" : "flat");
  const mark = (d: Direction) => (d === "bullish" ? "▲" : d === "bearish" ? "▼" : "•");
  const cur = $derived(analysis?.currency ?? "USD");
  // Gauge position, 0..100 from -100..+100.
  const gauge = $derived(analysis ? (analysis.score + 100) / 2 : 50);

  function pct(t: Target | null | undefined): string {
    const u = upside(t?.price, analysis?.close);
    return u == null ? "" : `${signed(u, 1)}%`;
  }

  function reading(key: string, v: number | null): string {
    if (v == null) return "—";
    if (key === "rsi") return num(v, 1);
    if (key === "sigma") return `${num(v, 2)}%`;
    return price(v, cur);
  }

  const TOGGLES: { key: keyof Overlays; label: string }[] = [
    { key: "mas", label: "Moving averages" },
    { key: "fib", label: "Fibonacci" },
    { key: "targets", label: "Targets" },
    { key: "patterns", label: "Patterns" },
    { key: "rsi", label: "RSI pane" },
  ];
</script>

<div class="tech" aria-busy={loading}>
  {#if !analysis}
    <div class="start">
      <p>
        Runs RSI, moving averages, candlestick patterns and volatility/Fibonacci targets on the {bars} candles in this chart.
        Computed locally; nothing runs until you ask.
      </p>
      <button class="primary" onclick={onanalyze} disabled={loading || bars === 0}>
        {loading ? "Analyzing…" : "Analyze"}
      </button>
      {#if error}<p class="err" role="alert">{error}</p>{/if}
    </div>
  {:else}
    {@const a = analysis}
    {@const t = a.targets}
    <div class="head">
      <span class="badge {biasTone(a.bias)}">{biasLabel(a.bias)}</span>
      <span class="score {direction(a.score)}" title="Composite score, −100 to +100">{signed(a.score, 0)}</span>
      <div class="gauge" role="img" aria-label="Score {a.score} of −100 to +100">
        <div class="track"></div>
        <div class="zero"></div>
        <div class="needle" style:left="{gauge}%"></div>
      </div>
      <span class="muted" title="Agreement between signals and score strength, reduced for short data">
        Confidence <b class="conf-{a.confidence_label}">{a.confidence_label}</b> {a.confidence}%
      </span>
      <span class="grow"></span>
      <span class="muted asof">as of {fullTime(a.as_of, gmtoffset, a.interval)}</span>
      <button onclick={onanalyze} disabled={loading}>{loading ? "Analyzing…" : "Re-analyze"}</button>
    </div>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    {#if a.limited}
      <div class="warn" role="status">
        ⚠ Limited data ({a.bars} bars): results may be less accurate. A full warm-up needs {a.full_warmup} bars; values
        marked * are estimates.
      </div>
    {/if}

    <div class="grid">
      <div class="col">
        <h3>Targets · next {t.horizon} bars ({a.interval})</h3>
        <dl>
          <dt>Upside</dt>
          <dd class="up">{price(t.upside.price, cur)} <small>{pct(t.upside)}</small></dd>
          {#if t.upside.fib}<dd class="fib">Fib {t.upside.fib}</dd>{/if}
          <dt>Downside</dt>
          <dd class="down">{price(t.downside.price, cur)} <small>{pct(t.downside)}</small></dd>
          {#if t.downside.fib}<dd class="fib">Fib {t.downside.fib}</dd>{/if}
          {#if t.invalidation}
            <dt>Invalidation</dt>
            <dd>{price(t.invalidation.price, cur)} <small>{pct(t.invalidation)}</small></dd>
          {/if}
          <dt title="Average true range × √horizon">ATR move</dt>
          <dd>±{price(t.atr_move, cur)}</dd>
          {#if t.sigma_move != null}
            <dt title="One standard deviation of returns over the horizon">1σ move</dt>
            <dd>±{price(t.sigma_move, cur)}</dd>
          {/if}
        </dl>
        <h3>Score breakdown</h3>
        <div class="comps">
          {#each a.components as c (c.key)}
            {@const w = Math.abs(c.value) * 50}
            <span class="muted">{c.label} <small>{Math.round(c.weight * 100)}%</small></span>
            <span class="cbar" title="{signed(c.value, 2)}">
              <i class={direction(c.value)} style:left="{c.value >= 0 ? 50 : 50 - w}%" style:width="{w}%"></i>
            </span>
          {/each}
        </div>
      </div>

      <div class="col">
        <h3>Indicators</h3>
        <dl>
          {#each a.readings as r (r.key)}
            <dt title={r.limited ? `Needs ${r.needed} bars for a full warm-up` : undefined}>
              {r.label}{#if r.limited}<span class="lim">*</span>{/if}
            </dt>
            <dd>{reading(r.key, r.value)}</dd>
          {/each}
          {#if a.fib}
            <dt title={a.fib.confirmed ? undefined : "No confirmed pivots; using the chart's extremes"}>
              Fib swing{#if !a.fib.confirmed}<span class="lim">*</span>{/if}
            </dt>
            <dd>{price(a.fib.from.price, cur)} → {price(a.fib.to.price, cur)}</dd>
          {/if}
        </dl>
      </div>

      <div class="col">
        <h3>Signals</h3>
        <ul>
          {#each a.signals as s, i (i)}
            <li>
              <span class={tone(s.direction)} aria-label={s.direction}>{mark(s.direction)}</span>
              {s.label}{#if s.limited}<span class="lim" title="Based on limited data">*</span>{/if}
            </li>
          {/each}
        </ul>
      </div>
    </div>

    <div class="foot">
      <fieldset>
        <legend class="sr">Chart overlays</legend>
        {#each TOGGLES as o (o.key)}
          <label><input type="checkbox" bind:checked={overlays[o.key]} /> {o.label}</label>
        {/each}
      </fieldset>
      <span class="muted">Deterministic, computed on this device. Not investment advice.</span>
    </div>
  {/if}
</div>

<style>
  .tech {
    flex: 0 1 auto;
    max-height: 52%;
    min-height: 92px;
    overflow: auto;
    border-top: 1px solid var(--faint);
    padding: 8px 4px 2px;
    font-size: 12px;
  }
  .start {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
    padding: 6px 0;
  }
  .start p {
    margin: 0;
    flex: 1 1 260px;
    color: var(--muted);
  }
  button {
    border: 1px solid var(--faint);
    background: var(--surface);
    border-radius: 6px;
    padding: 3px 10px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
    padding: 5px 16px;
  }
  .err {
    margin: 4px 0;
    color: var(--down);
    flex-basis: 100%;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
  }
  .grow {
    flex: 1;
  }
  .badge {
    padding: 1px 8px;
    border-radius: 5px;
    font-weight: 650;
    color: #fff;
    background: var(--flat);
  }
  .badge.up {
    background: var(--up);
  }
  .badge.down {
    background: var(--down);
  }
  .score {
    font-size: 16px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .gauge {
    position: relative;
    width: 110px;
    height: 12px;
  }
  .track {
    position: absolute;
    inset: 4px 0;
    border-radius: 2px;
    background: linear-gradient(90deg, var(--down), var(--flat) 50%, var(--up));
    opacity: 0.55;
  }
  .zero {
    position: absolute;
    left: 50%;
    top: 2px;
    bottom: 2px;
    width: 1px;
    background: var(--muted);
  }
  .needle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 3px;
    margin-left: -1.5px;
    border-radius: 1px;
    background: var(--text);
  }
  .muted,
  small {
    color: var(--muted);
  }
  .asof {
    font-variant-numeric: tabular-nums;
  }
  .conf-high {
    color: var(--up);
  }
  .conf-low {
    color: var(--down);
  }
  .warn {
    margin-top: 6px;
    padding: 4px 8px;
    border-radius: 6px;
    background: var(--warn-bg);
    color: var(--warn-text);
  }
  .grid {
    display: grid;
    grid-template-columns: 1.1fr 1fr 1.3fr;
    gap: 14px;
    margin-top: 6px;
  }
  .col {
    min-width: 0;
  }
  h3 {
    margin: 4px 0 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1px 10px;
    margin: 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  dd.fib {
    grid-column: 1 / -1;
    font-size: 11px;
    color: var(--muted);
  }
  .comps {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 3px 8px;
  }
  .cbar {
    position: relative;
    height: 6px;
    border-radius: 3px;
    background: var(--surface);
  }
  .cbar i {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 3px;
    background: var(--flat);
  }
  .cbar i.up {
    background: var(--up);
  }
  .cbar i.down {
    background: var(--down);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 1px;
  }
  .lim {
    color: var(--warn-text);
    margin-left: 1px;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 12px;
    margin-top: 6px;
    padding-top: 4px;
    border-top: 1px solid var(--faint);
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
  }
  label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
