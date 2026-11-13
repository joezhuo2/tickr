<script lang="ts">
  import { num, price, signed } from "./lib/format";
  import { buildCondition, check, DEFAULT_CLOCK, type Condition, type Operand, type SessionClock } from "./lib/strategy";
  import { grid, MAX_RUNS, parameters, sweepRow, withParam, type ExitReason, type Param, type Range, type Report, type Rules, type Side, type SweepRow } from "./lib/backtest";
  import type { Candle } from "./lib/types";

  let {
    report,
    bars,
    candles,
    clock = DEFAULT_CLOCK,
    currency,
    when,
    onrun,
  }: {
    report: Report | null;
    bars: number;
    candles: readonly Candle[];
    clock?: SessionClock;
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
    { id: "wma", label: "WMA", period: 20 },
    { id: "hma", label: "Hull MA", period: 20 },
    { id: "vwma", label: "VWMA", period: 20 },
    { id: "macd", label: "MACD (fast)", period: 12 },
    { id: "macd_signal", label: "MACD signal (fast)", period: 12 },
    { id: "macd_hist", label: "MACD histogram (fast)", period: 12 },
    { id: "bb_upper", label: "Bollinger upper", period: 20 },
    { id: "bb_mid", label: "Bollinger middle", period: 20 },
    { id: "bb_lower", label: "Bollinger lower", period: 20 },
    { id: "stoch_k", label: "Stochastic %K", period: 14 },
    { id: "stoch_d", label: "Stochastic %D", period: 14 },
    { id: "stochrsi", label: "Stoch RSI", period: 14 },
    { id: "cci", label: "CCI", period: 20 },
    { id: "mfi", label: "MFI", period: 14 },
    { id: "willr", label: "Williams %R", period: 14 },
    { id: "adx", label: "ADX", period: 14 },
    { id: "aroon_up", label: "Aroon up", period: 25 },
    { id: "aroon_down", label: "Aroon down", period: 25 },
    { id: "cmf", label: "CMF", period: 20 },
    { id: "roc", label: "ROC", period: 9 },
    { id: "supertrend", label: "Supertrend (ATR period)", period: 10 },
    { id: "donchian_high", label: "Donchian high", period: 20 },
    { id: "donchian_low", label: "Donchian low", period: 20 },
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
  let side = $state<Side>(saved.side === "short" ? "short" : "long");
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
    commit(current());
  }

  function current(): Rules {
    return { entry: entry.trim(), entry_stop: entryStop.trim(), exit: exit.trim(), stop_pct: stop ?? null, target_pct: target ?? null, side };
  }

  function commit(rules: Rules) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
    } catch {}
    onrun(rules);
  }

  function tone(v: number): string {
    return v > 0 ? "up" : v < 0 ? "down" : "";
  }

  const W = 600;
  const EH = 110;
  const DH = 36;
  let hover = $state<number | null>(null);
  const curve = $derived(report?.curve ?? []);
  const shape = $derived.by(() => {
    const n = curve.length;
    if (n < 2) return null;
    const lo = Math.min(1, ...curve.map((p) => p.equity));
    const hi = Math.max(1, ...curve.map((p) => p.equity));
    const maxDd = Math.max(...curve.map((p) => p.drawdown), 1e-9);
    const x = (i: number) => (i / (n - 1)) * W;
    const y = (e: number) => 4 + (1 - (e - lo) / (hi - lo || 1)) * (EH - 8);
    const line = curve.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.equity).toFixed(1)}`).join("");
    const area = `M0 0${curve.map((p, i) => `L${x(i).toFixed(1)} ${((p.drawdown / maxDd) * DH).toFixed(1)}`).join("")}L${W} 0Z`;
    return { x, line, area, base: y(1) };
  });
  const point = $derived(curve[hover ?? curve.length - 1]);

  function track(e: PointerEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hover = Math.min(curve.length - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (curve.length - 1))));
  }

  const METRICS = [
    { key: "total_return", label: "Total return" },
    { key: "profit_factor", label: "Profit factor" },
    { key: "sharpe", label: "Sharpe" },
    { key: "max_drawdown", label: "Drawdown" },
    { key: "win_rate", label: "Win rate" },
    { key: "count", label: "Trades" },
  ] as const;
  type Metric = (typeof METRICS)[number]["key"];

  const params = $derived(parameters(current()));
  let pickA = $state("");
  let pickB = $state("");
  let rangeA = $state<Range>({ from: 0, to: 0, step: 1 });
  let rangeB = $state<Range>({ from: 0, to: 0, step: 1 });
  let swept = $state<{ params: Param[]; rows: SweepRow[]; skipped: number } | null>(null);
  let sweeping = $state(false);
  let sortKey = $state<Metric>("total_return");
  let sortDesc = $state(true);

  const chosen = $derived([pickA, pickB].filter((id, i, all) => id && all.indexOf(id) === i && params.some((p) => p.id === id)));
  const plan = $derived(grid(chosen.map((id) => (id === pickA ? rangeA : rangeB))));
  const sorted = $derived.by(() => {
    const rows = swept?.rows ?? [];
    const rank = (v: number | null) => (v == null ? null : Number.isNaN(v) ? null : v);
    return [...rows].sort((a, b) => {
      const x = rank(a[sortKey]);
      const y = rank(b[sortKey]);
      return x == null || y == null ? (x == null ? 1 : 0) - (y == null ? 1 : 0) : sortDesc ? y - x : x - y;
    });
  });
  const heat = $derived.by(() => {
    if (!swept || swept.params.length !== 2) return null;
    const finite = swept.rows.map((r) => r[sortKey]).filter((v): v is number => v != null && Number.isFinite(v));
    const lo = Math.min(...finite);
    const hi = Math.max(...finite);
    const key = (v: number[]) => `${v[0]}|${v[1]}`;
    const cells = new Map(swept.rows.map((r) => [key(r.values), r]));
    const ys = [...new Set(swept.rows.map((r) => r.values[0]))];
    const xs = [...new Set(swept.rows.map((r) => r.values[1]))];
    const shade = (v: number | null) => {
      if (v == null) return "";
      const t = hi === lo ? 0.5 : (Math.min(v, hi) - lo) / (hi - lo);
      const good = sortKey === "max_drawdown" ? 1 - t : t;
      return `background: color-mix(in srgb, var(${good >= 0.5 ? "--up" : "--down"}) ${Math.round(Math.abs(good - 0.5) * 140)}%, transparent)`;
    };
    return { xs, ys, rows: ys.map((y) => xs.map((x) => cells.get(key([y, x])))), shade };
  });

  function pickParam(which: "A" | "B", id: string) {
    const v = params.find((p) => p.id === id)?.value ?? 0;
    const range = { from: v, to: v * 2, step: Math.max(1, Math.round(v / 5)) };
    if (which === "A") (pickA = id), (rangeA = range);
    else (pickB = id), (rangeB = range);
  }

  async function sweep() {
    const base = current();
    const ids = chosen;
    const used = params.filter((p) => ids.includes(p.id));
    const ordered = ids.map((id) => used.find((p) => p.id === id)!);
    sweeping = true;
    swept = { params: ordered, rows: [], skipped: 0 };
    const rows: SweepRow[] = [];
    let skipped = 0;
    for (const [i, values] of plan.points.entries()) {
      try {
        rows.push(sweepRow(candles, base, ids, values, clock));
      } catch {
        skipped++;
      }
      if (i % 10 === 9) await new Promise((r) => setTimeout(r));
    }
    swept = { params: ordered, rows, skipped };
    sweeping = false;
  }

  function sortBy(key: Metric) {
    if (key === sortKey) sortDesc = !sortDesc;
    else (sortKey = key), (sortDesc = true);
  }

  function applyRow(row: SweepRow) {
    if (!swept) return;
    const rules = swept.params.reduce((acc, p, i) => withParam(acc, p.id, row.values[i]), current());
    entry = rules.entry;
    entryStop = rules.entry_stop ?? "";
    exit = rules.exit;
    stop = rules.stop_pct;
    target = rules.target_pct;
    commit(rules);
  }

  function show(key: Metric, v: number | null | undefined): string {
    if (v == null || Number.isNaN(v)) return "–";
    if (v === Infinity) return "∞";
    if (key === "total_return") return `${signed(v)}%`;
    if (key === "max_drawdown") return `${v > 0 ? "−" : ""}${num(v, 2)}%`;
    if (key === "win_rate") return `${num(v, 1)}%`;
    return num(v, key === "count" ? 0 : 2);
  }
</script>

<div class="backtest" aria-label="Strategy backtest">
  <div class="head">
    <h2>Strategy backtest</h2>
    <span class="muted">Long or short, on the {num(bars, 0)} candles on the chart. Signals fill at the next bar's open, or at the entry stop price when one is set; no costs.</span>
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
    <label>Direction <select aria-label="Direction" bind:value={side}><option value="long">Long</option><option value="short">Short</option></select></label>
    <label class="expr" title="Optional. While the entry condition holds, buy when the next bar trades up through this price, at that price or the open if it gaps above. Short: sell when it trades down through it.">Entry stop price <input class:bad={!!stopError} bind:value={entryStop} spellcheck="false" placeholder="optional, e.g. or_high(15)" aria-invalid={!!stopError} /></label>
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
  <p class="note">Use close, open, high, low, volume, sma(n), ema(n), rsi(n), atr(n), wma(n), hma(n), vwma(n), macd(fast, slow, signal), macd_signal(…), macd_hist(…), bb_upper(n, k), bb_mid(n, k), bb_lower(n, k), stoch_k(n, smooth, d), stoch_d(…), stochrsi(rsi, stoch, k, d), cci(n), mfi(n), willr(n), adx(n), aroon_up(n), aroon_down(n), cmf(n), roc(n), supertrend(n, multiplier), donchian_high(n), donchian_low(n) (left-out numbers use the study defaults, so macd() is 12, 26, 9), vwap, time (exchange HHMM, 945 = 9:45), or_high(minutes), or_low(minutes), day_high, day_low, prev_high, prev_low, prev_close, crosses_above(a, b), crosses_below(a, b), + − * /, &gt; &lt; &gt;= &lt;= ==, and, or, not.</p>
  {#if formError}<p class="error" role="alert">{formError}</p>{/if}

  {#if report}
    <div class="stats" role="group" aria-label="Backtest results">
      <div><span>Total return</span><strong class={tone(report.total_return)}>{signed(report.total_return)}%</strong></div>
      <div><span>Buy and hold</span><strong class={tone(report.buy_hold)}>{signed(report.buy_hold)}%</strong></div>
      <div><span>Trades</span><strong>{num(report.count, 0)}</strong></div>
      <div><span>Win rate</span><strong>{report.win_rate != null ? `${num(report.win_rate, 1)}%` : "—"}</strong></div>
      <div><span>Average trade</span><strong class={tone(report.avg_trade ?? 0)}>{report.avg_trade != null ? `${signed(report.avg_trade)}%` : "—"}</strong></div>
      <div><span>Max drawdown</span><strong class={report.max_drawdown > 0 ? "down" : ""}>{report.max_drawdown > 0 ? "−" : ""}{num(report.max_drawdown, 2)}%</strong></div>
      <div><span>Profit factor</span><strong>{show("profit_factor", report.profit_factor)}</strong></div>
      <div><span title="Mean over standard deviation of per-bar equity returns, annualized by the chart's bars per calendar year; no risk-free rate">Sharpe (per-bar, annualized)</span><strong>{show("sharpe", report.sharpe)}</strong></div>
    </div>
    <p class="note">{report.side === "short" ? "Short: entries sell and exits buy back, the stop-loss sits above the entry and the take-profit below, and a trade gains when the price falls. " : ""}Returns compound each trade at full size. Buy and hold runs from the first close to the last close. Sharpe uses per-bar returns of the marked-to-market equity curve, annualized from the bars per year on the chart, with no risk-free rate.</p>
    {#if shape && point}
      <section aria-label="Equity curve">
        <h3>Equity curve</h3>
        <p class="readout">
          {when(point.t)} · Equity <strong class={tone(point.equity - 1)}>{signed((point.equity - 1) * 100)}%</strong> · Drawdown <strong class={point.drawdown > 0 ? "down" : ""}>{point.drawdown > 0 ? "−" : ""}{num(point.drawdown * 100, 2)}%</strong>
        </p>
        <div class="curve" role="presentation" onpointermove={track} onpointerleave={() => (hover = null)}>
          <svg viewBox="0 0 {W} {EH}" preserveAspectRatio="none" role="img" aria-label="Equity curve, starting at 100%">
            <line class="base" x1="0" x2={W} y1={shape.base} y2={shape.base} />
            <path class="eq" d={shape.line} />
            {#if hover != null}<line class="cursor" x1={shape.x(hover)} x2={shape.x(hover)} y1="0" y2={EH} />{/if}
          </svg>
          <svg class="dd" viewBox="0 0 {W} {DH}" preserveAspectRatio="none" role="img" aria-label="Drawdown from the equity peak">
            <path class="under" d={shape.area} />
            {#if hover != null}<line class="cursor" x1={shape.x(hover)} x2={shape.x(hover)} y1="0" y2={DH} />{/if}
          </svg>
        </div>
      </section>
    {/if}
    <section aria-label="Parameter sweep">
      <h3>Parameter sweep</h3>
      {#if params.length}
        <div class="sweep">
          {@render picker("A", pickA, rangeA, (r) => (rangeA = r))}
          {@render picker("B", pickB, rangeB, (r) => (rangeB = r))}
          <button type="button" disabled={sweeping || !plan.points.length || !bars} onclick={sweep}>{sweeping ? "Sweeping…" : `Run sweep${plan.points.length ? ` (${plan.points.length})` : ""}`}</button>
        </div>
        {#if plan.capped}<p class="error" role="alert">That grid is {num(plan.total, 0)} runs; the limit is {MAX_RUNS}. Narrow a range or raise a step.</p>{/if}
        {#if swept && !sweeping}
          {#if swept.skipped}<p class="note">{swept.skipped} of {swept.rows.length + swept.skipped} runs were skipped because the rules failed with those values.</p>{/if}
          {#if heat}
            <p class="note">Heatmap of {METRICS.find((m) => m.key === sortKey)?.label}: rows {swept.params[0].label}, columns {swept.params[1].label}. Click a cell to apply it.</p>
            <table class="heat" aria-label="Sweep heatmap">
              <thead><tr><th></th>{#each heat.xs as x (x)}<th>{x}</th>{/each}</tr></thead>
              <tbody>
                {#each heat.rows as cells, i (i)}
                  <tr>
                    <th>{heat.ys[i]}</th>
                    {#each cells as c, j (j)}
                      <td style={heat.shade(c?.[sortKey] ?? null)}>
                        {#if c}<button type="button" class="cell" title="Apply {heat.ys[i]}, {heat.xs[j]}" onclick={() => applyRow(c)}>{show(sortKey, c[sortKey])}</button>{:else}–{/if}
                      </td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
          <table aria-label="Sweep results">
            <thead>
              <tr>
                {#each swept.params as p (p.id)}<th>{p.label}</th>{/each}
                {#each METRICS as m (m.key)}
                  <th aria-sort={sortKey === m.key ? (sortDesc ? "descending" : "ascending") : "none"}>
                    <button type="button" class="link" onclick={() => sortBy(m.key)}>{m.label}{sortKey === m.key ? (sortDesc ? " ↓" : " ↑") : ""}</button>
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each sorted as row, i (i)}
                <tr class="pick" tabindex="0" title="Apply these parameters" onclick={() => applyRow(row)} onkeydown={(e) => e.key === "Enter" && applyRow(row)}>
                  {#each row.values as v, j (j)}<td>{v}</td>{/each}
                  {#each METRICS as m (m.key)}<td class={m.key === "total_return" ? tone(row.total_return) : ""}>{show(m.key, row[m.key])}</td>{/each}
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      {:else}
        <p class="muted">The rules contain no numbers to sweep.</p>
      {/if}
    </section>
    <section aria-label="Backtest trades">
      <h3>Trades</h3>
      {#if report.trades.length}
        <table>
          <thead><tr><th>{report.side === "short" ? "Sell" : "Entry"}</th><th>Price</th><th>{report.side === "short" ? "Buy back" : "Exit"}</th><th>Price</th><th>Return</th><th>Reason</th></tr></thead>
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

{#snippet picker(name: "A" | "B", id: string, range: Range, set: (r: Range) => void)}
  <div class="pickrow">
    <select aria-label={`Sweep parameter ${name}`} value={id} onchange={(e) => pickParam(name, e.currentTarget.value)}>
      <option value="">{name === "A" ? "Parameter A" : "Parameter B (optional)"}</option>
      {#each params as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
    </select>
    {#if id}
      <label>From <input class="n" type="number" step="any" value={range.from} oninput={(e) => set({ ...range, from: e.currentTarget.valueAsNumber })} /></label>
      <label>To <input class="n" type="number" step="any" value={range.to} oninput={(e) => set({ ...range, to: e.currentTarget.valueAsNumber })} /></label>
      <label>Step <input class="n" type="number" step="any" min="0" value={range.step} oninput={(e) => set({ ...range, step: e.currentTarget.valueAsNumber })} /></label>
    {/if}
  </div>
{/snippet}

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
  .readout {
    color: var(--muted);
  }
  .readout strong {
    color: inherit;
  }
  .readout .up,
  .readout .down {
    color: var(--up);
  }
  .readout .down {
    color: var(--down);
  }
  .curve {
    cursor: crosshair;
    touch-action: none;
  }
  svg {
    display: block;
    width: 100%;
    height: 110px;
    overflow: visible;
  }
  svg.dd {
    height: 36px;
    margin-top: 2px;
  }
  svg path,
  svg line {
    vector-effect: non-scaling-stroke;
  }
  .base,
  .cursor {
    stroke: var(--faint);
    stroke-width: 1;
  }
  .cursor {
    stroke: var(--muted);
  }
  .eq {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-linejoin: round;
  }
  .under {
    fill: var(--down);
    fill-opacity: 0.35;
  }
  .sweep,
  .pickrow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
  }
  .sweep {
    margin: 4px 0;
  }
  .pick {
    cursor: pointer;
  }
  .pick:hover,
  .pick:focus-visible {
    background: var(--grid);
  }
  th .link {
    color: var(--muted);
    text-decoration: none;
    font-weight: 500;
  }
  .heat {
    width: auto;
    margin: 4px 0 8px;
  }
  .heat th {
    padding-right: 10px;
  }
  .heat td {
    padding: 0;
    text-align: center;
  }
  .cell {
    width: 100%;
    border: 0;
    border-radius: 0;
    background: none;
    padding: 3px 8px;
  }
</style>
