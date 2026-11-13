<script lang="ts">
  import { PRESETS, type ChartAlert, type LineSpec } from "./lib/chartAlerts";
  import { addChartAlert, chartAlerts, setChartAlerts } from "./lib/chartAlertStore.svelte";
  import { inBackground } from "./lib/chartAlertSchedule";
  import { fireTime } from "./lib/alerts";
  import { num } from "./lib/format";
  import type { Drawing } from "./lib/types";

  let { symbol, interval, drawings }: { symbol: string; interval: string; drawings: Drawing[] } = $props();

  let expr = $state(PRESETS[0].expr);
  let lineId = $state("");
  let direction = $state<"above" | "below">("above");
  let error = $state<string | null>(null);

  const lines = $derived(drawings.filter((d) => d.kind === "trend" || d.kind === "ray"));

  function add(label: string, condition: string | null, line: LineSpec | null) {
    const r = addChartAlert(symbol, interval, label, condition, line);
    error = "error" in r ? r.error : null;
  }

  function addLine() {
    const d = lines.find((x) => String(x.id) === lineId);
    if (!d) { error = "Pick a trendline or ray drawn on this symbol"; return; }
    add(`Close crosses ${direction} line ${num(d.points[0].price)} → ${num(d.points[1].price)}`, null, { a: d.points[0], b: d.points[1], direction });
  }

  function patch(id: number, change: Partial<ChartAlert>) {
    setChartAlerts(chartAlerts.list.map((a) => (a.id === id ? { ...a, ...change } : a)));
  }
</script>

<section aria-label="Chart alerts">
  <h3>Indicator and drawing alerts</h3>
  <form onsubmit={(e) => { e.preventDefault(); add(expr.trim(), expr.trim(), null); }}>
    <select aria-label="Condition preset" onchange={(e) => { if (e.currentTarget.value) expr = e.currentTarget.value; }}>
      {#each PRESETS as p}<option value={p.expr}>{p.label}</option>{/each}
    </select>
    <input class="expr" aria-label="Condition" maxlength="200" spellcheck="false" bind:value={expr} />
    <button type="submit">Add for {symbol} {interval}</button>
  </form>
  <form onsubmit={(e) => { e.preventDefault(); addLine(); }}>
    <select aria-label="Trendline" bind:value={lineId} disabled={!lines.length}>
      <option value="">{lines.length ? "Trendline or ray" : "No trendlines on this symbol"}</option>
      {#each lines as d (d.id)}<option value={String(d.id)}>{d.kind === "ray" ? "Ray" : "Trend"} {num(d.points[0].price)} → {num(d.points[1].price)}</option>{/each}
    </select>
    <select aria-label="Break direction" bind:value={direction}>
      <option value="above">Close crosses above</option>
      <option value="below">Close crosses below</option>
    </select>
    <button type="submit" disabled={!lines.length}>Add line alert</button>
  </form>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <p class="hint">Conditions use the Strategy syntax (sma, ema, rsi, atr, vwap, crosses_above, crosses_below). They are checked each time the chart refreshes while this symbol and candle interval are on the main chart, and fire once. Turn on Settings, Chart, "Check indicator and drawing alerts in the background" to check every symbol and interval while tickr runs, even with the window hidden. A line alert keeps the line as it was when added.</p>
  {#if chartAlerts.list.length}
    <ul aria-label="Saved chart alerts">
      {#each chartAlerts.list as a (a.id)}
        <li>
          <div class="details">
            <strong>{a.symbol}</strong> <span class="muted">{a.interval}</span> {a.label}
            <span class="muted">{a.enabled ? "Armed" : a.fired_at != null ? `Triggered ${fireTime(a.fired_at)}` : "Paused"}</span>
            {#if a.enabled}<span class="muted">{chartAlerts.background && inBackground(a) ? "Checked in the background" : "Checked only on screen"}</span>{/if}
          </div>
          <button type="button" onclick={() => patch(a.id, { enabled: !a.enabled })}>{a.enabled ? "Pause" : "Rearm"}</button>
          <button type="button" aria-label={`Delete ${a.symbol} ${a.label}`} onclick={() => setChartAlerts(chartAlerts.list.filter((x) => x.id !== a.id))}>Delete</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  section { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--faint); }
  h3 { margin: 0 0 8px; font-size: 13px; }
  form { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
  .expr { flex: 1; min-width: 220px; font-family: var(--font-mono); }
  .hint, .muted { color: var(--muted); font-size: 12px; }
  .error { color: var(--down); font-size: 12px; }
  ul { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 4px; }
  li { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .details { flex: 1; display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
</style>
