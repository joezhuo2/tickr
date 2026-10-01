<script lang="ts">
  import { direction, num, price, ratingLabel, ratingTone, signed, upside } from "./lib/format";
  import type { Consensus, Quote } from "./lib/types";

  // analyst: undefined while loading, null without coverage.
  let {
    symbol,
    quote,
    analyst,
  }: { symbol: string; quote: Quote | null; analyst: Consensus | null | undefined } = $props();

  const currency = $derived(quote?.currency ?? "USD");
  const current = $derived(quote?.price ?? null);
  const up = $derived(upside(analyst?.target_mean, current));

  // Target range bar: spans low..high, widened to include the current price.
  const bar = $derived.by(() => {
    const a = analyst;
    if (!a || a.target_low == null || a.target_high == null) return null;
    let lo = Math.min(a.target_low, current ?? a.target_low);
    let hi = Math.max(a.target_high, current ?? a.target_high);
    if (!(hi > lo)) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.04;
    lo -= pad;
    hi += pad;
    const at = (v: number) => ((v - lo) / (hi - lo)) * 100;
    return {
      from: at(a.target_low),
      to: at(a.target_high),
      mean: a.target_mean != null ? at(a.target_mean) : null,
      now: current != null ? at(current) : null,
    };
  });

  const rows = $derived.by(() => {
    const r = analyst?.ratings;
    if (!r) return [];
    const list = [
      { label: "Strong buy", n: r.strong_buy, tone: "up" },
      { label: "Buy", n: r.buy, tone: "up" },
      { label: "Hold", n: r.hold, tone: "flat" },
      { label: "Sell", n: r.sell, tone: "down" },
      { label: "Strong sell", n: r.strong_sell, tone: "down" },
    ];
    const max = Math.max(1, ...list.map((x) => x.n));
    return list.map((x) => ({ ...x, w: (x.n / max) * 100 }));
  });
</script>

{#if analyst === undefined}
  <div class="panel" aria-busy="true" aria-label="Loading analyst consensus">
    <div class="col">
      <span class="sk" style="width: 120px; height: 12px"></span>
      <span class="sk" style="width: 140px; height: 30px; margin-top: 10px"></span>
      <span class="sk" style="width: 100%; height: 8px; margin-top: 30px"></span>
    </div>
    <div class="col">
      <span class="sk" style="width: 80px; height: 12px"></span>
      {#each [0, 1, 2, 3, 4] as i (i)}
        <span class="sk" style="width: 100%; height: 10px; margin-top: 12px"></span>
      {/each}
    </div>
  </div>
{:else if analyst === null}
  <div class="msg">No analyst coverage for {symbol}</div>
{:else}
  <div class="panel">
    <div class="col">
      <h2>12-month price target</h2>
      {#if analyst.target_mean != null}
        <div class="target">
          <span class="big">{price(analyst.target_mean, currency)}</span>
          {#if up != null}<span class="pct {direction(up)}">{signed(up, 1)}%</span>{/if}
        </div>
        <div class="sub">
          Average{#if analyst.analysts} of {analyst.analysts} analysts{/if}{#if analyst.target_median != null}
            · median {price(analyst.target_median, currency)}{/if}
        </div>
      {:else}
        <div class="sub">No price target</div>
      {/if}

      {#if bar}
        <div class="range" role="img" aria-label="Target range with current price">
          <div class="track"></div>
          <div class="fill" style:left="{bar.from}%" style:width="{bar.to - bar.from}%"></div>
          {#if bar.mean != null}<div class="mark mean" style:left="{bar.mean}%" title="Average target"></div>{/if}
          {#if bar.now != null}
            <div class="mark now" style:left="{bar.now}%"></div>
            <div class="now-label" style:left="{Math.min(88, Math.max(12, bar.now))}%">
              Now {price(current, currency)}
            </div>
          {/if}
        </div>
        <div class="ends">
          <span><span class="muted">Low</span> {price(analyst.target_low, currency)}</span>
          <span><span class="muted">High</span> {price(analyst.target_high, currency)}</span>
        </div>
      {/if}
    </div>

    <div class="col">
      <h2>Analyst consensus</h2>
      <div class="target">
        {#if analyst.rating}
          <span class="badge {ratingTone(analyst.rating)}">{ratingLabel(analyst.rating)}</span>
        {/if}
        {#if analyst.score != null}
          <span class="sub" title="1 = strong buy, 5 = strong sell">{num(analyst.score, 1)} / 5</span>
        {/if}
      </div>
      {#if rows.length}
        <div class="rows">
          {#each rows as r (r.label)}
            <span class="muted">{r.label}</span>
            <span class="bar"><i class={r.tone} style:width="{r.w}%"></i></span>
            <span class="n">{r.n}</span>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .panel {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 28px;
    padding: 14px 10px 8px 4px;
    overflow: auto;
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
  .target {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-height: 32px;
  }
  .big {
    font-size: 26px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .pct {
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
  .sub,
  .muted {
    color: var(--muted);
    font-size: 12px;
  }
  .range {
    position: relative;
    height: 40px;
    margin-top: 22px;
  }
  .track,
  .fill {
    position: absolute;
    top: 6px;
    height: 6px;
    border-radius: 3px;
  }
  .track {
    left: 0;
    right: 0;
    background: var(--surface);
  }
  .fill {
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .mark {
    position: absolute;
    top: 0;
    width: 2px;
    height: 18px;
    margin-left: -1px;
    border-radius: 1px;
  }
  .mark.mean {
    background: var(--accent);
  }
  .mark.now {
    background: var(--text);
  }
  .now-label {
    position: absolute;
    top: 21px;
    transform: translateX(-50%);
    font-size: 11px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .ends {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .badge {
    align-self: center;
    padding: 2px 8px;
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
  .rows {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 7px 10px;
    margin-top: 10px;
  }
  .bar {
    height: 8px;
    border-radius: 4px;
    background: var(--surface);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    border-radius: 4px;
    background: var(--flat);
  }
  .bar i.up {
    background: var(--up);
  }
  .bar i.down {
    background: var(--down);
  }
  .n {
    font-size: 12px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .msg {
    flex: 1;
    display: grid;
    place-content: center;
    color: var(--muted);
  }
</style>
