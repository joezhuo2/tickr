<script lang="ts">
  import { STUDIES } from "./lib/studies";
  import { addInstance, changeSettings, removeInstance, studies, studySettings, toggleStudy } from "./lib/studyStore.svelte";
  import { MAX_EXTRAS, NO_TIMEFRAME, PIVOT_TYPES, SETTING_FIELDS, SETTING_LABELS, STUDY_TIMEFRAMES, type PivotType, type SettingGroup } from "./lib/studySettings";
  import { biasLabel, biasTone, direction, fullTime, num, price, signed, upside } from "./lib/format";
  import type { Analysis, Direction, Overlays, Target, IndicatorConfig, IndicatorPreset } from "./lib/types";

  import { alertLevels, clampPanel, OVERLAY_TOGGLES, toggleOverlay, type AlertLevel } from "./lib/indicators";
  import type { ChartPattern } from "./lib/chartPatterns";
  import { patternInfo } from "./lib/patternInfo";

  let {
    analysis,
    loading,
    error,
    bars,
    gmtoffset,
    overlays, config, presets, onsave, onsavepreset, ondeletepreset,
    onanalyze,
    onalert,
    chartPatterns = [],
    onpattern,
  }: {
    chartPatterns?: ChartPattern[];
    onpattern?: (p: ChartPattern) => void;
    analysis: Analysis | null;
    loading: boolean;
    error: string | null;
    /** Candles in the chart on screen. */
    bars: number;
    gmtoffset: number;
    overlays: Overlays | null;
    config: IndicatorConfig;
    presets: IndicatorPreset[];
    onsave: (config: IndicatorConfig) => Promise<void>;
    onsavepreset: (name: string) => Promise<void>;
    ondeletepreset: (name: string) => Promise<void>;
    onanalyze: () => void;
    onalert?: (level: AlertLevel) => Promise<void>;
  } = $props();

  const levels = $derived(analysis ? alertLevels(analysis.series) : []);
  let alerted = $state<string | null>(null);

  function addAlert(l: AlertLevel) {
    void edit(async () => {
      await onalert?.(l);
      alerted = `Alert set: ${l.label} ${l.direction} ${price(l.level, cur)}`;
    });
  }

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
    if (key === "rsi" || key === "adx") return num(v, 1);
    if (key === "rvol") return `${num(v, 2)}×`;
    if (key === "sigma") return `${num(v, 2)}%`;
    return price(v, cur);
  }

  const HEIGHT_KEY = "tickr.technicalsHeight";
  let panel = $state<HTMLDivElement>();
  let height = $state<number | null>(savedHeight());
  let dragFrom: { y: number; h: number } | null = null;

  function savedHeight(): number | null {
    try {
      const h = Number(localStorage.getItem(HEIGHT_KEY));
      return h > 0 ? h : null;
    } catch {
      return null;
    }
  }

  function resize(h: number | null) {
    const total = panel?.parentElement?.clientHeight ?? 0;
    height = h == null || !total ? null : clampPanel(h, total);
    try {
      if (height == null) localStorage.removeItem(HEIGHT_KEY);
      else localStorage.setItem(HEIGHT_KEY, String(height));
    } catch {}
  }

  function gripDown(e: PointerEvent) {
    if (!panel) return;
    dragFrom = { y: e.clientY, h: panel.offsetHeight };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function gripKey(e: KeyboardEvent) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    resize((panel?.offsetHeight ?? 0) + (e.key === "ArrowUp" ? 16 : -16));
  }

  const SETTINGS_KEY = "tickr.technicalsSettingsOpen";
  let settingsOpen = $state(readSettingsOpen());

  function readSettingsOpen() {
    try { return localStorage.getItem(SETTINGS_KEY) === "1"; } catch { return false; }
  }

  function rememberSettings(open: boolean) {
    settingsOpen = open;
    try { localStorage.setItem(SETTINGS_KEY, open ? "1" : "0"); } catch { /* storage unavailable */ }
  }

  let settingsError = $state<string | null>(null);
  let saving = $state(false);
  let presetName = $state("");
  let selectedPreset = $state("");

  async function edit(action: () => Promise<void>) {
    saving = true;
    settingsError = null;
    try { await action(); }
    catch (e) { settingsError = String(e); }
    finally { saving = false; }
  }

  function change(editConfig: (next: IndicatorConfig) => void) {
    const next: IndicatorConfig = JSON.parse(JSON.stringify(config));
    editConfig(next);
    void edit(() => onsave(next));
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="grip"
  role="separator"
  aria-orientation="horizontal"
  aria-label="Resize Technicals"
  title="Drag to resize; double-click to reset"
  tabindex="0"
  onpointerdown={gripDown}
  onpointermove={(e) => dragFrom && resize(dragFrom.h + dragFrom.y - e.clientY)}
  onpointerup={() => (dragFrom = null)}
  onpointercancel={() => (dragFrom = null)}
  ondblclick={() => resize(null)}
  onkeydown={gripKey}
></div>
<div class="tech" class:sized={height != null} style:height={height == null ? undefined : `${height}px`} bind:this={panel} aria-busy={loading}>
  {#if !analysis}
    <div class="start">
      <p>
        Runs RSI, moving averages, candlestick and chart patterns and volatility/Fibonacci targets on the {bars} candles in this chart.
        Computed locally; refreshes with the chart once enabled.
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
        {#if chartPatterns.length}
          <h3>Chart patterns</h3>
          <ul>
            {#each [...chartPatterns].reverse() as p, i (i)}
              <li>
                <button class="pat" title={patternInfo(p.kind)?.text} onclick={() => onpattern?.(p)}>
                  <span class={tone(p.bias)} aria-label={p.bias}>{mark(p.bias)}</span>
                  {p.name} <small>{p.confirmed ? "confirmed" : "forming"} · quality {Math.round(p.quality * 100)}%</small>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>

    {#if onalert && levels.length}
      <div class="indicator-row" role="group" aria-label="Alerts at key levels">
        <span class="muted">Alert when price crosses</span>
        {#each levels as l (l.label)}
          <button disabled={saving} title={`Price alert when ${analysis.symbol} is at or ${l.direction} ${price(l.level, cur)} (regular session, fires once)`} onclick={() => addAlert(l)}>{l.label} {price(l.level, cur)}</button>
        {/each}
        {#if alerted}<span class="muted" role="status">{alerted}</span>{/if}
      </div>
    {/if}

    <div class="foot">
      <fieldset>
        <legend class="sr">Chart overlays</legend>
        {#each OVERLAY_TOGGLES as o (o.key)}
          <label><input type="checkbox" checked={overlays?.[o.key] ?? false} disabled={saving} onchange={(e) => edit(() => onsave(toggleOverlay(config, o.key, e.currentTarget.checked)))} /> {o.label}</label>
        {/each}
      </fieldset>
      <span class="muted">Deterministic, computed on this device. Not investment advice.</span>
    </div>
  {/if}
  <fieldset class="studies">
    <legend>Studies (drawn without Analyze)</legend>
    {#each STUDIES as s (s.id)}
      <label><input type="checkbox" checked={studies[s.id]} onchange={(e) => toggleStudy(s.id, e.currentTarget.checked)} /> {s.label}</label>
    {/each}
  </fieldset>
  <details class="indicator-settings" open={settingsOpen} ontoggle={(e) => rememberSettings(e.currentTarget.open)}>
    <summary>Indicator settings</summary>
    <fieldset disabled={saving}>
      <legend class="sr">Indicator settings</legend>
      {#each ["sma", "ema"] as kind}
        {@const group = kind as "sma" | "ema"}
        {#each config[group] as line, i}
          <div class="indicator-row">
            <label>{group.toUpperCase()} {i + 1} length <input type="number" min="1" max="500" value={line.length} onchange={(e) => change((c) => c[group][i].length = e.currentTarget.valueAsNumber)} /></label>
            <label>Color <input type="color" aria-label={`${group.toUpperCase()} ${i + 1} color`} value={line.color || "#808080"} onchange={(e) => change((c) => c[group][i].color = e.currentTarget.value)} /></label>
            <button aria-label={`Reset ${group.toUpperCase()} ${i + 1} color to theme`} onclick={() => change((c) => c[group][i].color = "")}>Theme</button>
            <label><input type="checkbox" aria-label={`${group.toUpperCase()} ${i + 1} visible`} checked={line.visible} onchange={(e) => change((c) => c[group][i].visible = e.currentTarget.checked)} /> Visible</label>
            <button aria-label={`Remove ${group.toUpperCase()} ${i + 1}`} onclick={() => change((c) => c[group].splice(i, 1))}>Remove</button>
          </div>
        {/each}
        <button disabled={config[group].length >= 8} onclick={() => change((c) => c[group].push({ length: 20, color: "", visible: true }))}>Add {group.toUpperCase()}</button>
      {/each}
      {#each ["bollinger", "vwap", "levels", "volume_ma", "rsi", "macd"] as kind}
        {@const group = kind as "bollinger" | "vwap" | "levels" | "volume_ma" | "rsi" | "macd"}
        <div class="indicator-row">
          <b>{group === "levels" ? "KEY LEVELS" : group === "volume_ma" ? "VOLUME AVERAGE" : group.toUpperCase()}</b>
          {#if group === "bollinger" || group === "rsi" || group === "volume_ma"}
            <label>Length <input type="number" aria-label={`${group} length`} min="1" max="500" value={config[group].length} onchange={(e) => change((c) => c[group].length = e.currentTarget.valueAsNumber)} /></label>
          {/if}
          {#if group === "bollinger"}
            <label>Multiplier <input type="number" min="0.5" max="5" step="0.1" value={config.bollinger.k} onchange={(e) => change((c) => c.bollinger.k = e.currentTarget.valueAsNumber)} /></label>
          {/if}
          {#if group === "vwap"}
            <label title="Bands this many volume-weighted standard deviations from VWAP; 0 hides them">Bands σ <input type="number" aria-label="VWAP bands deviations" min="0" max="5" step="0.5" value={config.vwap_bands} onchange={(e) => change((c) => c.vwap_bands = e.currentTarget.valueAsNumber)} /></label>
          {/if}
          {#if group === "macd"}
            {#each ["fast", "slow", "signal"] as field}
              {@const key = field as "fast" | "slow" | "signal"}
              <label>{field} <input type="number" aria-label={`MACD ${field} length`} min="1" max="500" value={config.macd[key]} onchange={(e) => change((c) => c.macd[key] = e.currentTarget.valueAsNumber)} /></label>
            {/each}
            <label>Signal color <input type="color" value={config.macd.signal_color || "#808080"} onchange={(e) => change((c) => c.macd.signal_color = e.currentTarget.value)} /></label>
            <button onclick={() => change((c) => c.macd.signal_color = "")}>Signal theme</button>
          {/if}
          <label>Color <input type="color" aria-label={`${group} color`} value={config[group].color || "#808080"} onchange={(e) => change((c) => c[group].color = e.currentTarget.value)} /></label>
          <button aria-label={`Reset ${group} color to theme`} onclick={() => change((c) => c[group].color = "")}>Theme</button>
          <label><input type="checkbox" aria-label={`${group} visible`} checked={config[group].visible} onchange={(e) => change((c) => c[group].visible = e.currentTarget.checked)} /> Visible</label>
        </div>
      {/each}
      <div class="indicator-row">
        <b>OPENING RANGE</b>
        <label>Minutes <input type="number" aria-label="Opening range minutes" min="1" max="240" value={config.opening_range.minutes} onchange={(e) => change((c) => c.opening_range.minutes = e.currentTarget.valueAsNumber)} /></label>
        <label title="Target lines this many range heights beyond the high and low; 0 hides them">Extension <input type="number" aria-label="Opening range extension" min="0" max="5" step="0.5" value={config.opening_range.extension} onchange={(e) => change((c) => c.opening_range.extension = e.currentTarget.valueAsNumber)} /></label>
        <label>Color <input type="color" aria-label="Opening range color" value={config.opening_range.color || "#808080"} onchange={(e) => change((c) => c.opening_range.color = e.currentTarget.value)} /></label>
        <button aria-label="Reset opening range color to theme" onclick={() => change((c) => c.opening_range.color = "")}>Theme</button>
        <label><input type="checkbox" aria-label="Opening range visible" checked={config.opening_range.visible} onchange={(e) => change((c) => c.opening_range.visible = e.currentTarget.checked)} /> Visible</label>
      </div>
      {#each Object.keys(SETTING_FIELDS) as name}
        {@const group = name as SettingGroup}
        {#each [{ key: group, label: SETTING_LABELS[group], params: studySettings[group] as Record<string, number>, tf: studySettings.timeframes[group] ?? "chart" }, ...studySettings.extras.filter((x) => x.study === group).map((x) => ({ ...x, label: `${SETTING_LABELS[group]} ${x.key.slice(group.length + 1)}` }))] as inst (inst.key)}
          {@const edit = (f: (p: Record<string, number>) => void) => changeSettings((s) => f(inst.key === group ? (s[group] as Record<string, number>) : s.extras.find((x) => x.key === inst.key)!.params))}
          <div class="indicator-row">
            <b>{inst.label.toUpperCase()}</b>
            {#each Object.entries(SETTING_FIELDS[group]) as [key, f]}
              <label>{f.label} <input type="number" aria-label={`${inst.label} ${f.label}`} min={f.min} max={f.max} step={f.step} value={inst.params[key]} onchange={(e) => edit((p) => (p[key] = e.currentTarget.valueAsNumber))} /></label>
            {/each}
            {#if !NO_TIMEFRAME.includes(group)}
              <label title="Compute on a higher timeframe built from the chart's bars">Timeframe <select aria-label={`${inst.label} timeframe`} value={inst.tf} onchange={(e) => { const tf = e.currentTarget.value; changeSettings((s) => { if (inst.key === group) s.timeframes[group] = tf; else s.extras.find((x) => x.key === inst.key)!.tf = tf; }); }}><option value="chart">Chart</option>{#each STUDY_TIMEFRAMES as t (t)}<option value={t}>{t}</option>{/each}</select></label>
            {/if}
            {#if inst.key !== group || studies[group]}
              <button aria-label={`Remove ${inst.label}`} onclick={() => removeInstance(inst.key)}>Remove</button>
            {/if}
            {#if inst.key === group}
              <button aria-label={`Add ${SETTING_LABELS[group]}`} disabled={studySettings.extras.length >= MAX_EXTRAS} onclick={() => addInstance(group)}>Add</button>
            {/if}
          </div>
        {/each}
      {/each}
      <div class="indicator-row">
        <b>VOLUME PROFILE</b>
        <label>Value area % <input type="number" aria-label="Volume profile Value area %" min="50" max="95" step="1" value={studySettings.vpArea} onchange={(e) => changeSettings((s) => (s.vpArea = e.currentTarget.valueAsNumber))} /></label>
        <label><input type="checkbox" aria-label="Show POC and value area" checked={studySettings.showPoc} onchange={(e) => changeSettings((s) => (s.showPoc = e.currentTarget.checked))} /> Show POC and value area</label>
      </div>
      <div class="indicator-row">
        <b>PIVOT POINTS</b>
        <label>Type <select aria-label="Pivot points type" value={studySettings.pivotType} onchange={(e) => changeSettings((s) => (s.pivotType = e.currentTarget.value as PivotType))}>{#each PIVOT_TYPES as t (t)}<option value={t}>{t}</option>{/each}</select></label>
      </div>
      <div class="indicator-row">
        <label>Preset <select bind:value={selectedPreset}><option value="">Select preset</option>{#each presets as p (p.name)}<option value={p.name}>{p.name}</option>{/each}</select></label>
        <button disabled={!presets.some((p) => p.name === selectedPreset)} onclick={() => edit(() => onsave(presets.find((p) => p.name === selectedPreset)!.config))}>Apply</button>
        <button disabled={!selectedPreset} onclick={() => edit(() => ondeletepreset(selectedPreset))}>Delete</button>
        <label>Preset name <input bind:value={presetName} /></label>
        <button onclick={() => edit(() => onsavepreset(presetName))}>Save</button>
        <label><input type="checkbox" checked={config.keep_analysis} onchange={(e) => change((c) => c.keep_analysis = e.currentTarget.checked)} /> Auto analyze</label>
      </div>
    </fieldset>
    {#if settingsError}<p class="err" role="alert">{settingsError}</p>{/if}
  </details>
</div>

<style>
  .studies { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 8px 0 0; padding: 6px 10px; border: 1px solid var(--faint); border-radius: 6px; font-size: 12px; }
  .studies legend { padding: 0 4px; color: var(--muted); font-size: 11px; }
  .indicator-settings { margin-top: 6px; }
  .indicator-settings fieldset { display: block; }
  .indicator-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 4px 0; }
  input[type="number"] { width: 64px; }
  input[type="color"] { width: 28px; height: 22px; padding: 0; }

  .tech {
    flex: 0 1 auto;
    max-height: 52%;
    min-height: 92px;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 6px 4px 2px;
    font-size: 12px;
  }
  .tech.sized {
    flex: 0 0 auto;
    max-height: 85%;
  }
  .grip {
    flex: 0 0 7px;
    border-top: 1px solid var(--faint);
    cursor: ns-resize;
    touch-action: none;
  }
  .grip:hover,
  .grip:focus-visible {
    border-top: 2px solid var(--accent);
    outline: none;
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
  .pat {
    border: 0;
    background: none;
    padding: 0;
    color: inherit;
    text-align: left;
  }
  .pat:hover {
    text-decoration: underline;
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
