<script lang="ts">
  import { num, price, signed } from "./lib/format";
  import { buildCondition, check, type Condition, type Operand } from "./lib/strategy";
  import type { ExitReason, Report, Rules } from "./lib/backtest";

  let {
    report,
    bars,
    currency,
    when,
    onrun,
  }: {
    report: Report | null;
    bars: number;
    currency: string;
    when: (t: number) => string;
    onrun: (rules: Rules) => void;
  } = $props();

  const STORAGE_KEY = "tickr.backtest";
  const KINDS: { id: Operand["kind"]; label: string; period?: number }[] = [
    { id: "close", label: "Close" },
    { id: "open", label: "Open" },
    { id: "high", label: "High" },
    { id: "low", label: "Low" },
    { id: "volume", label: "Volume" },
    { id: "sma", label: "SMA", period: 50 },
    { id: "ema", label: "EMA", period: 20 },
    { id: "rsi", label: "RSI", period: 14 },
    { id: "atr", label: "ATR", period: 14 },
    { id: "or_high", label: "Opening range high (min)", period: 15 },
    { id: "or_low", label: "Opening range low (min)", period: 15 },
    { id: "vwap", label: "VWAP" },
    { id: "time", label: "Time (HHMM)" },
    { id: "day_high", label: "Day high so far" },
    { id: "day_low", label: "Day low so far" },
    { id: "prev_high", label: "Prior day high" },
    { id: "prev_low", label: "Prior day low" },
    { id: "prev_close", label: "Prior day close" },
    { id: "value", label: "Value", period: 30 },
  ];
  const CONDITIONS: { id: Condition; label: string }[] = [
    { id: ">", label: ">" },
    { id: "<", label: "<" },
    { id: ">=", label: "≥" },
    { id: "<=", label: "≤" },
    { id: "crosses_above", label: "crosses above" },
    { id: "crosses_below", label: "crosses below" },
  ];
  const REASONS: Record<ExitReason, string> = { signal: "Exit signal", stop: "Stop-loss", target: "Take-profit", end: "Open at end" };

  const saved = load();
  let entry = $state(typeof saved.entry === "string" ? saved.entry : "crosses_above(ema(20), sma(50))");
  let exit = $state(typeof saved.exit === "string" ? saved.exit : "crosses_below(ema(20), sma(50))");
  let entryStop = $state(typeof saved.entry_stop === "string" ? saved.entry_stop : "");
  let stop = $state<number | null>(typeof saved.stop_pct === "number" ? saved.stop_pct : null);
  let target = $state<number | null>(typeof saved.target_pct === "number" ? saved.target_pct : null);
  let left = $state<Operand>({ kind: "close", n: 0 });
  let op = $state<Condition>(">");
  let right = $state<Operand>({ kind: "sma", n: 50 });
  let formError = $state<string | null>(null);

  const entryError = $derived(check(entry));
  const exitError = $derived(exit.trim() ? check(exit) : null);
  const stopError = $derived(entryStop.trim() ? check(entryStop, "num") : null);
  const condition = $derived(buildCondition(left, op, right));

  function load(): Partial<Rules> {
    try {
      const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      return v && typeof v === "object" ? v : {};
    } catch {
      return {};
    }
  }

  function pick(o: Operand, kind: Operand["kind"]): Operand {
    return { kind, n: KINDS.find((k) => k.id === kind)?.period ?? o.n };
  }

  function use(which: "entry" | "exit", join: boolean) {
    const cur = (which === "entry" ? entry : exit).trim();
    const next = join && cur ? `${/\bor\b/i.test(cur) ? `(${cur})` : cur} and ${condition}` : condition;
    if (which === "entry") entry = next;
    else exit = next;
  }

  function pctOk(v: number | null): boolean {
    return v == null || (Number.isFinite(v) && v > 0 && v < 100);
  }

  function run(e: SubmitEvent) {
    e.preventDefault();
    formError = entryError ? `Entry: ${entryError}` : stopError ? `Entry stop price: ${stopError}` : exitError ? `Exit: ${exitError}` : !pctOk(stop) ? "Stop-loss must be between 0 and 100%" : !pctOk(target) ? "Take-profit must be between 0 and 100%" : null;
    if (formError) return;
    const rules: Rules = { entry: entry.trim(), entry_stop: entryStop.trim(), exit: exit.trim(), stop_pct: stop ?? null, target_pct: target ?? null };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
    } catch {}
    onrun(rules);
  }

  function tone(v: number): string {
    return v > 0 ? "up" : v < 0 ? "down" : "";
  }
</script>

<div class="backtest" aria-label="Strategy backtest">
  <div class="head">
    <h2>Strategy backtest</h2>
    <span class="muted">Long only, on the {num(bars, 0)} candles on the chart. Signals fill at the next bar's open, or at the entry stop price when one is set; no costs.</span>
  </div>

  <div class="builder" role="group" aria-label="Condition builder">
    {@render operand(left, (o) => (left = o), "Left")}
    <select aria-label="Condition" bind:value={op}>
      {#each CONDITIONS as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
    </select>
    {@render operand(right, (o) => (right = o), "Right")}
    <code>{condition}</code>
    <button type="button" onclick={() => use("entry", false)}>Set entry</button>
    <button type="button" onclick={() => use("entry", true)}>And entry</button>
    <button type="button" onclick={() => use("exit", false)}>Set exit</button>
    <button type="button" onclick={() => use("exit", true)}>And exit</button>
  </div>

  <form onsubmit={run} aria-label="Strategy rules">
    <label class="expr">Entry <input class:bad={!!entryError} bind:value={entry} spellcheck="false" aria-invalid={!!entryError} /></label>
    <label class="expr" title="Optional. While the entry condition holds, buy when the next bar trades up through this price, at that price or the open if it gaps above.">Entry stop price <input class:bad={!!stopError} bind:value={entryStop} spellcheck="false" placeholder="optional, e.g. or_high(15)" aria-invalid={!!stopError} /></label>
    <label class="expr">Exit <input class:bad={!!exitError} bind:value={exit} spellcheck="false" placeholder="optional" aria-invalid={!!exitError} /></label>
    <label>Stop-loss % <input type="number" min="0" max="100" step="any" placeholder="none" bind:value={stop} /></label>
    <label>Take-profit % <input type="number" min="0" max="100" step="any" placeholder="none" bind:value={target} /></label>
    <button type="submit" class="run" disabled={!bars}>Run backtest</button>
  </form>
  {#if entryError}<p class="note">Entry: {entryError}</p>{/if}
  {#if stopError}<p class="note">Entry stop price: {stopError}</p>{/if}
  {#if exitError}<p class="note">Exit: {exitError}</p>{/if}
  <p class="note">
    Opening range breakout:
    <button type="button" class="link" onclick={() => { entry = "time >= 945 and time < 1100"; entryStop = "or_high(15)"; exit = "close < or_low(15) or time >= 1555"; }}>use ORB example</button>
  </p>
  <p class="note">Use close, open, high, low, volume, sma(n), ema(n), rsi(n), atr(n), vwap, time (exchange HHMM, 945 = 9:45), or_high(minutes), or_low(minutes), day_high, day_low, prev_high, prev_low, prev_close, crosses_above(a, b), crosses_below(a, b), + − * /, &gt; &lt; &gt;= &lt;= ==, and, or, not.</p>
  {#if formError}<p class="error" role="alert">{formError}</p>{/if}

  {#if report}
    <div class="stats" role="group" aria-label="Backtest results">
      <div><span>Total return</span><strong class={tone(report.total_return)}>{signed(report.total_return)}%</strong></div>
      <div><span>Buy and hold</span><strong class={tone(report.buy_hold)}>{signed(report.buy_hold)}%</strong></div>
      <div><span>Trades</span><strong>{num(report.count, 0)}</strong></div>
      <div><span>Win rate</span><strong>{report.win_rate != null ? `${num(report.win_rate, 1)}%` : "—"}</strong></div>
      <div><span>Average trade</span><strong class={tone(report.avg_trade ?? 0)}>{report.avg_trade != null ? `${signed(report.avg_trade)}%` : "—"}</strong></div>
      <div><span>Max drawdown</span><strong class={report.max_drawdown > 0 ? "down" : ""}>{report.max_drawdown > 0 ? "−" : ""}{num(report.max_drawdown, 2)}%</strong></div>
    </div>
    <p class="note">Returns compound each trade at full size. Buy and hold runs from the first close to the last close.</p>
    <section aria-label="Backtest trades">
      <h3>Trades</h3>
      {#if report.trades.length}
        <table>
          <thead><tr><th>Entry</th><th>Price</th><th>Exit</th><th>Price</th><th>Return</th><th>Reason</th></tr></thead>
          <tbody>
            {#each report.trades as t, i (i)}
              <tr>
                <td>{when(t.entry_time)}</td>
                <td>{price(t.entry_price, currency)}</td>
                <td>{when(t.exit_time)}</td>
                <td>{price(t.exit_price, currency)}</td>
                <td class={tone(t.return_pct)}>{signed(t.return_pct)}%</td>
                <td>{REASONS[t.reason]}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="muted">No trades: the entry condition never fired.</p>
      {/if}
    </section>
  {/if}
</div>

{#snippet operand(o: Operand, set: (o: Operand) => void, name: string)}
  <select aria-label={`${name} operand`} value={o.kind} onchange={(e) => set(pick(o, e.currentTarget.value as Operand["kind"]))}>
    {#each KINDS as k (k.id)}<option value={k.id}>{k.label}</option>{/each}
  </select>
  {#if KINDS.find((k) => k.id === o.kind)?.period != null}
    <input
      class="n"
      type="number"
      aria-label={`${name} ${o.kind === "value" ? "value" : "period"}`}
      min={o.kind === "value" ? undefined : 1}
      step={o.kind === "value" ? "any" : 1}
      value={o.n}
      oninput={(e) => set({ ...o, n: Number(e.currentTarget.value) || 0 })}
    />
  {/if}
{/snippet}

<style>
  .backtest {
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
  .muted,
  .note,
  .stats span {
    color: var(--muted);
  }
  .link {
    border: 0;
    padding: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .builder,
  form {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    margin: 8px 0 0;
  }
  .builder code {
    color: var(--muted);
  }
  label {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--muted);
  }
  .expr {
    flex: 1 1 260px;
  }
  .expr input {
    flex: 1;
    width: auto;
    font-family: ui-monospace, monospace;
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
    width: 70px;
  }
  .n {
    width: 56px;
  }
  input.bad {
    border-color: var(--down);
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .run {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
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
  .error {
    color: var(--down);
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
