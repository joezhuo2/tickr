<script lang="ts">
  import { change, direction, num, price, ratingLabel, ratingTone, signed, span, upside, volume } from "./lib/format";
  import type { Consensus, Quote } from "./lib/types";

  // logo: undefined while loading, null when the symbol has none.
  // analyst: undefined while loading, null without coverage.
  let {
    symbol,
    quote,
    logo,
    analyst,
    starred,
    onanalysts,
    onstar,
  }: {
    symbol: string;
    quote: Quote | null;
    logo: string | null | undefined;
    analyst: Consensus | null | undefined;
    starred: boolean;
    onanalysts: () => void;
    onstar: () => void;
  } = $props();
  const up = $derived(upside(analyst?.target_mean, quote?.price));
  // Whole numbers once prices reach 100, so the range fits the panel.
  const compact = (v: number) => num(v, Math.abs(v) >= 100 ? 0 : 2);
  const DETAILS = ["Open", "Prev close", "Day range", "52w range", "Volume"];

  const SESSION: Record<string, string> = {
    pre: "Pre-market",
    regular: "Market open",
    post: "After hours",
    closed: "Market closed",
  };
</script>

<aside>
  {#if logo === undefined}
    <span class="icon sk"></span>
  {:else}
    <div class="icon">
      {#if logo}
        <img src={logo} alt="" />
      {:else}
        <span>{symbol.slice(0, 1)}</span>
      {/if}
    </div>
  {/if}
  <div class="title">
    <h1>{symbol}</h1>
    <button
      class="star"
      class:on={starred}
      aria-pressed={starred}
      title={starred ? "Remove from watchlist" : "Add to watchlist"}
      onclick={onstar}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></svg>
    </button>
  </div>
  {#if quote}
    <div class="name" title={quote.name}>
      {quote.name || "—"}{#if quote.exchange}<span> · {quote.exchange}</span>{/if}
    </div>
  {:else}
    <span class="sk" style="width: 150px; height: 14px; margin: 3px 0 13px"></span>
  {/if}

  {#if quote}
    <div class="price">{price(quote.price, quote.currency)}</div>
    <div class="chg {direction(quote.change)}">{change(quote.change, quote.change_pct)}</div>
    <div class="session"><i class={quote.session}></i>{SESSION[quote.session]}</div>
    {#if quote.extended}
      <div class="ext">
        <span class="label">{quote.extended.label}</span>
        <span>{price(quote.extended.price, quote.currency)}</span>
        <span class={direction(quote.extended.change)}>{change(quote.extended.change, quote.extended.change_pct)}</span>
      </div>
    {/if}

    {#if analyst === undefined}
      <span class="sk" style="width: 150px; height: 30px; margin-top: 10px"></span>
    {:else if analyst}
      <button class="consensus" onclick={onanalysts} title="12-month analyst price target. Click for details.">
        <span class="line">
          {#if analyst.rating}<span class="badge {ratingTone(analyst.rating)}">{ratingLabel(analyst.rating)}</span>{/if}
          {#if analyst.target_mean != null}
            <span class="pt">{price(analyst.target_mean, quote.currency)}</span>
            {#if up != null}<span class={direction(up)}>{signed(up, 1)}%</span>{/if}
          {/if}
        </span>
        <span class="line sub">
          Target{#if analyst.analysts} · {analyst.analysts} analysts{/if}{#if analyst.target_low != null && analyst.target_high != null}
            · {compact(analyst.target_low)}–{compact(analyst.target_high)}{/if}
        </span>
      </button>
    {/if}

    <dl>
      <dt>Open</dt><dd>{price(quote.open, quote.currency)}</dd>
      <dt>Prev close</dt><dd>{price(quote.prev_close, quote.currency)}</dd>
      <dt>Day range</dt><dd>{span(quote.day_low, quote.day_high)}</dd>
      <dt>52w range</dt><dd>{span(quote.low_52w, quote.high_52w)}</dd>
      <dt>Volume</dt><dd>{volume(quote.volume)}</dd>
    </dl>
  {:else}
    <div aria-busy="true" aria-label="Loading quote">
      <span class="sk" style="width: 120px; height: 28px"></span>
      <span class="sk" style="width: 110px; height: 14px; margin-top: 6px"></span>
      <span class="sk" style="width: 90px; height: 12px; margin-top: 10px"></span>
    </div>
    <dl>
      {#each DETAILS as d (d)}
        <dt>{d}</dt>
        <dd><span class="sk" style="width: 64px; height: 12px; margin: 2px 0 2px auto"></span></dd>
      {/each}
    </dl>
  {/if}
</aside>

<style>
  aside {
    width: 230px;
    flex: none;
    padding: 18px 18px 12px;
    border-right: 1px solid var(--faint);
    background: var(--surface);
    overflow: hidden auto;
    scrollbar-width: none;
    display: flex;
    flex-direction: column;
  }
  .icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    overflow: hidden;
    /* background-color only, so .sk's shimmer image still applies. */
    background-color: var(--bg);
    border: 1px solid var(--faint);
    display: grid;
    place-items: center;
    font-size: 22px;
    font-weight: 700;
    color: var(--muted);
  }
  .icon.sk {
    border: 0;
    flex: none;
  }
  .icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    min-width: 0;
  }
  .star {
    flex: none;
    width: 26px;
    height: 26px;
    padding: 3px;
    border: 0;
    border-radius: 6px;
    background: none;
    cursor: pointer;
    color: var(--muted);
  }
  .star:hover {
    background: var(--bg);
    color: var(--text);
  }
  .star svg {
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linejoin: round;
  }
  .star.on {
    color: #f5b301;
  }
  .star.on svg {
    fill: currentColor;
  }
  h1 {
    margin: 0;
    min-width: 0;
    font-size: 38px;
    line-height: 1.05;
    font-weight: 800;
    letter-spacing: -0.02em;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name {
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 10px;
  }
  .consensus {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-top: 10px;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .line.sub {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--muted);
    font-size: 11px;
  }
  .pt {
    font-weight: 600;
  }
  .badge {
    padding: 1px 6px;
    border-radius: 4px;
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
  .price {
    font-size: 24px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
  .chg {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .session {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: 12px;
    margin-top: 6px;
  }
  .session i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--flat);
  }
  .session i.regular {
    background: var(--up);
  }
  .session i.pre,
  .session i.post {
    background: #ffb340;
  }
  .ext {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 8px;
    font-size: 12px;
    margin-top: 4px;
    font-variant-numeric: tabular-nums;
  }
  .ext .label {
    color: var(--muted);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 10px;
    margin: auto 0 0;
    padding-top: 12px;
    font-size: 12px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
