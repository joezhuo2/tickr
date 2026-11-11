<script lang="ts">
  import { num, price, signed } from "./lib/format";
  import { LIMITS, cashError, costsError, positionOf, positionSize, qtyError, summary, unrealized, type Account, type Costs, type OrderKind, type OrderRequest, type Side } from "./lib/paper";

  let {
    account,
    symbol,
    currency,
    replay,
    mark,
    markLabel,
    marketBlock,
    disabled = null,
    error = null,
    notice = null,
    when,
    onorder,
    oncancel,
    oncosts,
    onreset,
  }: {
    account: Account;
    symbol: string;
    currency: string;
    replay: boolean;
    mark: number | null;
    markLabel: string;
    marketBlock: string | null;
    disabled?: string | null;
    error?: string | null;
    notice?: string | null;
    when: (t: number) => string;
    onorder: (req: OrderRequest) => void;
    oncancel: (id: number) => void;
    oncosts: (costs: Costs) => void;
    onreset: (startingCash: number) => void;
  } = $props();

  let side = $state<Side>("buy");
  let kind = $state<OrderKind>("market");
  let qty = $state<number | undefined>(1);
  let limit = $state<number | undefined>(undefined);
  let confirming = $state(false);
  let showSettings = $state(false);
  let startCash = $state<number | undefined>(undefined);
  let commission = $state<number | undefined>(undefined);
  let commissionBps = $state<number | undefined>(undefined);
  let slippageBps = $state<number | undefined>(undefined);
  let formError = $state<string | null>(null);
  let sizeAccount = $state<number | undefined>(undefined);
  let riskPct = $state<number | undefined>(1);
  let sizeEntry = $state<number | undefined>(undefined);
  let sizeStop = $state<number | undefined>(undefined);

  const marks = $derived<Record<string, number>>(mark != null ? { [symbol]: mark } : {});
  const sum = $derived(summary(account, marks));
  const pos = $derived(positionOf(account, symbol));
  const orders = $derived(account.orders.filter((o) => o.symbol === symbol));
  const otherOrders = $derived(account.orders.length - orders.length);
  const trades = $derived([...account.trades].reverse());
  const marketOff = $derived(kind === "market" && !!marketBlock);
  const ticketOff = $derived(!!disabled || marketOff);
  const sizing = $derived(positionSize(Number(sizeAccount ?? sum.equity), Number(riskPct), Number(sizeEntry ?? mark), Number(sizeStop)));

  function useSizing() {
    if (!sizing || sizing.shares < 1) return;
    side = sizing.side;
    qty = Math.min(sizing.shares, LIMITS.maxQty);
  }

  function money(v: number): string {
    return `${v < 0 ? "−" : ""}${price(Math.abs(v), "USD")}`;
  }

  function tone(v: number): string {
    return v > 0 ? "up" : v < 0 ? "down" : "";
  }

  function openSettings() {
    showSettings = !showSettings;
    if (showSettings) {
      startCash = account.starting_cash;
      commission = account.costs.commission;
      commissionBps = account.costs.commission_bps;
      slippageBps = account.costs.slippage_bps;
      formError = null;
    }
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    formError = qtyError(Number(qty));
    if (!formError && kind !== "market" && !(Number(limit) > 0)) formError = `${kind === "limit" ? "Limit" : "Stop"} price must be a positive number`;
    if (formError || ticketOff) return;
    onorder({ symbol, side, qty: Number(qty), kind, price: kind === "market" ? null : Number(limit) });
  }

  function saveCosts(e: SubmitEvent) {
    e.preventDefault();
    const costs = { commission: Number(commission ?? 0), commission_bps: Number(commissionBps ?? 0), slippage_bps: Number(slippageBps ?? 0) };
    formError = costsError(costs);
    if (!formError) oncosts(costs);
  }

  function askReset() {
    const cash = Number(startCash ?? account.starting_cash);
    formError = cashError(cash);
    if (!formError) confirming = true;
  }

  function doReset() {
    confirming = false;
    onreset(Number(startCash ?? account.starting_cash));
  }
</script>

<div class="paper" aria-label="Simulated paper trading">
  <div class="head">
    <span class="sim">Simulated</span>
    <h2>Paper trading</h2>
    <span class="scope">{replay ? "Replay session account: not saved, discarded when replay exits" : "Live simulated account: saved on this computer"}</span>
    <button class="ghost" aria-expanded={showSettings} onclick={openSettings}>Settings</button>
  </div>

  <div class="stats" role="group" aria-label="Simulated account">
    <div><span>Equity</span><strong>{money(sum.equity)}</strong><em class={tone(sum.return_pct)}>{signed(sum.return_pct)}%</em></div>
    <div><span>Cash</span><strong>{money(sum.cash)}</strong></div>
    <div><span>Buying power</span><strong>{money(sum.buying_power)}</strong></div>
    <div><span>Realized P&amp;L</span><strong class={tone(sum.realized)}>{signed(sum.realized)}</strong></div>
    <div><span>Unrealized P&amp;L</span><strong class={tone(sum.unrealized)}>{signed(sum.unrealized)}</strong></div>
  </div>
  {#if sum.unmarked.length}
    <p class="note">Valued at cost (no current price): {sum.unmarked.join(", ")}</p>
  {/if}

  {#if showSettings}
    <form class="settings" onsubmit={saveCosts} aria-label="Simulation settings">
      <label>Commission per trade <input type="number" min="0" max={LIMITS.maxCommission} step="any" bind:value={commission} /></label>
      <label>Commission (bps of notional) <input type="number" min="0" max={LIMITS.maxBps} step="any" bind:value={commissionBps} /></label>
      <label>Slippage (bps) <input type="number" min="0" max={LIMITS.maxBps} step="any" bind:value={slippageBps} /></label>
      <button type="submit">Save costs</button>
      <label>Starting cash <input type="number" min={LIMITS.minCash} max={LIMITS.maxCash} step="any" bind:value={startCash} /></label>
      {#if confirming}
        <span class="confirm" role="alert">
          Reset the {replay ? "replay session" : "simulated"} account to {money(Number(startCash ?? account.starting_cash))}? Positions, orders and history are cleared.
          <button type="button" class="danger" onclick={doReset}>Confirm reset</button>
          <button type="button" onclick={() => (confirming = false)}>Cancel</button>
        </span>
      {:else}
        <button type="button" class="danger" onclick={askReset}>Reset…</button>
      {/if}
    </form>
  {/if}

  <div class="settings" role="group" aria-label="Position size calculator">
    <strong>Position size</strong>
    <label>Account <input type="number" min="0" step="any" placeholder={num(sum.equity, 0)} bind:value={sizeAccount} /></label>
    <label>Risk % <input type="number" min="0" max="100" step="any" bind:value={riskPct} /></label>
    <label>Entry <input type="number" min="0" step="any" placeholder={mark != null ? String(mark) : ""} bind:value={sizeEntry} /></label>
    <label>Stop <input type="number" min="0" step="any" bind:value={sizeStop} /></label>
    {#if sizing}
      <span role="status">
        <strong class={sizing.side === "buy" ? "up" : "down"}>{sizing.side === "buy" ? "Buy" : "Short"} {num(sizing.shares, 0)} shares</strong>
        · risk {money(sizing.risk)} ({price(sizing.per_share, currency)} a share) · cost {money(sizing.cost)} · 2R target {price(sizing.target, currency)}
      </span>
      <button type="button" disabled={sizing.shares < 1} onclick={useSizing}>Use in ticket</button>
    {:else}
      <span class="muted">Enter a stop to size the trade.</span>
    {/if}
  </div>

  <div class="row">
    <section class="position" aria-label="Simulated position">
      <h3>{symbol} position</h3>
      {#if pos}
        <p>
          <strong class={pos.qty > 0 ? "up" : "down"}>{pos.qty > 0 ? "Long" : "Short"} {num(Math.abs(pos.qty), 0)}</strong>
          @ {price(pos.avg_price, currency)}
          {#if mark != null}· <span class={tone(unrealized(pos, mark))}>{signed(unrealized(pos, mark))}</span> unrealized{/if}
        </p>
      {:else}
        <p class="muted">Flat</p>
      {/if}
      <p class="muted">{markLabel}: {mark != null ? price(mark, currency) : "—"}</p>
    </section>

    <form class="ticket" onsubmit={submit} aria-label="Simulated order ticket">
      <div class="seg" role="group" aria-label="Side">
        <button type="button" class:on={side === "buy"} class:buy={side === "buy"} aria-pressed={side === "buy"} onclick={() => (side = "buy")}>Buy</button>
        <button type="button" class:on={side === "sell"} class:sell={side === "sell"} aria-pressed={side === "sell"} onclick={() => (side = "sell")}>Sell</button>
      </div>
      <label>Qty <input class="qty" type="number" min="1" max={LIMITS.maxQty} step="1" required bind:value={qty} /></label>
      <label>
        Type
        <select bind:value={kind}>
          <option value="market">Market</option>
          <option value="limit">Limit</option>
          <option value="stop">Stop</option>
        </select>
      </label>
      {#if kind !== "market"}
        <label>{kind === "limit" ? "Limit" : "Stop"} <input class="px" type="number" min="0" step="any" required bind:value={limit} /></label>
      {/if}
      <button type="submit" class="place" disabled={ticketOff} title={disabled ?? (marketOff ? marketBlock : undefined) ?? undefined}>Place simulated order</button>
    </form>
  </div>
  {#if disabled}
    <p class="note">{disabled}</p>
  {:else if marketOff}
    <p class="note">Market orders unavailable: {marketBlock}</p>
  {:else if replay && kind === "market"}
    <p class="note">Simulated market orders fill at the next bar's open.</p>
  {/if}
  {#if formError}<p class="error" role="alert">{formError}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}

  <section aria-label="Open simulated orders">
    <h3>Open orders{otherOrders ? ` (${otherOrders} on other symbols)` : ""}</h3>
    {#if orders.length}
      <table>
        <thead><tr><th>Side</th><th>Qty</th><th>Type</th><th>Price</th><th></th></tr></thead>
        <tbody>
          {#each orders as o (o.id)}
            <tr>
              <td class={o.side === "buy" ? "up" : "down"}>{o.side === "buy" ? "Buy" : "Sell"}</td>
              <td>{num(o.qty, 0)}</td>
              <td>{o.kind === "market" ? "Market (next open)" : o.kind === "limit" ? "Limit" : "Stop"}</td>
              <td>{o.price != null ? price(o.price, currency) : "—"}</td>
              <td><button class="ghost" aria-label={`Cancel ${o.side} ${o.qty} ${o.kind} order`} onclick={() => oncancel(o.id)}>Cancel</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="muted">None</p>
    {/if}
  </section>

  <section aria-label="Simulated trade history">
    <h3>Closed trades</h3>
    {#if trades.length}
      <table>
        <thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>P&amp;L</th><th>Costs</th><th>Opened</th><th>Closed</th></tr></thead>
        <tbody>
          {#each trades as t (t.id)}
            <tr>
              <td>{t.symbol}</td>
              <td>{t.direction === "long" ? "Long" : "Short"}</td>
              <td>{num(t.qty, 0)}</td>
              <td>{num(t.entry_price)}</td>
              <td>{num(t.exit_price)}</td>
              <td class={tone(t.pnl)}>{signed(t.pnl)}</td>
              <td>{num(t.costs, 2)}</td>
              <td>{when(t.opened)}</td>
              <td>{when(t.closed)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="muted">No closed trades yet</p>
    {/if}
  </section>
</div>

<style>
  .paper {
    flex: 0 1 auto;
    max-height: 56%;
    min-height: 120px;
    overflow: auto;
    overscroll-behavior: contain;
    border-top: 1px solid var(--faint);
    padding: 8px 4px 2px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .sim {
    padding: 1px 6px;
    border: 1px solid var(--accent);
    border-radius: 4px;
    color: var(--accent);
    font-weight: 700;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  h3 {
    margin: 10px 0 4px;
    font-size: 12px;
    font-weight: 600;
  }
  p {
    margin: 2px 0;
  }
  .scope,
  .muted,
  .note,
  .stats span {
    color: var(--muted);
  }
  .head .ghost {
    margin-left: auto;
  }
  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    margin: 8px 0 2px;
  }
  .stats div {
    display: flex;
    flex-direction: column;
  }
  .stats strong {
    font-size: 14px;
    font-weight: 600;
  }
  .stats em {
    font-style: normal;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 8px 24px;
  }
  form {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    margin: 8px 0 0;
  }
  label {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--muted);
  }
  input,
  select,
  button {
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--faint);
    border-radius: 6px;
    padding: 3px 7px;
  }
  input {
    width: 90px;
  }
  .qty {
    width: 70px;
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .ghost {
    background: none;
  }
  .seg {
    display: flex;
    gap: 2px;
  }
  .seg button.buy {
    background: var(--up);
    border-color: var(--up);
    color: white;
  }
  .seg button.sell {
    background: var(--down);
    border-color: var(--down);
    color: white;
  }
  .place {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  .danger {
    color: var(--down);
    border-color: var(--down);
  }
  .confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .error {
    color: var(--down);
  }
  .notice {
    color: var(--text);
  }
  .up {
    color: var(--up);
  }
  .down {
    color: var(--down);
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    padding: 3px 8px 3px 0;
    text-align: left;
    white-space: nowrap;
  }
  th {
    color: var(--muted);
    font-weight: 500;
    border-bottom: 1px solid var(--faint);
  }
  td {
    border-bottom: 1px solid var(--grid);
  }
</style>
