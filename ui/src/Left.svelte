<script lang="ts">
  import { change, direction, price, span, volume } from "./lib/format";
  import type { Quote } from "./lib/types";

  let { symbol, quote, logo }: { symbol: string; quote: Quote | null; logo: string | null } = $props();

  const SESSION: Record<string, string> = {
    pre: "Pre-market",
    regular: "Market open",
    post: "After hours",
    closed: "Market closed",
  };
</script>

<aside>
  <div class="icon">
    {#if logo}
      <img src={logo} alt="" />
    {:else}
      <span>{symbol.slice(0, 1)}</span>
    {/if}
  </div>
  <h1>{symbol}</h1>
  <div class="name" title={quote?.name}>
    {quote?.name || "—"}{#if quote?.exchange}<span> · {quote.exchange}</span>{/if}
  </div>

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

    <dl>
      <dt>Open</dt><dd>{price(quote.open, quote.currency)}</dd>
      <dt>Prev close</dt><dd>{price(quote.prev_close, quote.currency)}</dd>
      <dt>Day range</dt><dd>{span(quote.day_low, quote.day_high)}</dd>
      <dt>52w range</dt><dd>{span(quote.low_52w, quote.high_52w)}</dd>
      <dt>Volume</dt><dd>{volume(quote.volume)}</dd>
    </dl>
  {:else}
    <div class="price muted">—</div>
  {/if}
</aside>

<style>
  aside {
    width: 230px;
    flex: none;
    padding: 18px 18px 12px;
    border-right: 1px solid var(--faint);
    background: var(--surface);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    overflow: hidden;
    background: var(--bg);
    border: 1px solid var(--faint);
    display: grid;
    place-items: center;
    font-size: 22px;
    font-weight: 700;
    color: var(--muted);
  }
  .icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  h1 {
    margin: 10px 0 0;
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
  .price {
    font-size: 24px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
  .muted {
    color: var(--muted);
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
