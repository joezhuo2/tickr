<script lang="ts">
  import { niceTicks, num } from "./lib/format";
  import {
    MAX_SAVED,
    MULTIPLIER,
    PRESETS,
    analyze,
    cleanLegs,
    makeLeg,
    payoffCurve,
    presetLegs,
    priceRange,
    saveStrategy,
    type Leg,
    type PresetId,
    type PriceMode,
    type SavedStrategy,
  } from "./lib/payoff";
  import type { Options } from "./lib/types";

  let {
    options,
    legs = $bindable(),
    saved = $bindable(),
    mode = $bindable(),
  }: {
    options: Options;
    legs: Leg[];
    saved: SavedStrategy[];
    mode: PriceMode;
  } = $props();

  const W = 560;
  const H = 300;
  const PAD = { l: 62, r: 14, t: 16, b: 30 };
  const SLOT_COLORS = ["var(--ma-1)", "var(--ma-2)", "var(--ma-4)"];

  let name = $state("");
  let preset = $state<{ ids: string; label: string } | null>(null);

  const spot = $derived(options.price);
  const chain = $derived({ calls: options.calls, puts: options.puts });
  const idKey = (list: Leg[]) => list.map((l) => l.id).join();
  const presetName = $derived(preset && preset.ids === idKey(legs) ? preset.label : "");
  const available = $derived(new Map(PRESETS.map((p) => [p.id, presetLegs(p.id, chain, spot, mode) !== null])));
  const clean = $derived(cleanLegs(legs));
  const info = $derived(analyze(clean));
  const shown = $derived(saved.filter((s) => s.visible));
  const full = $derived(saved.length >= MAX_SAVED);

  const view = $derived.by(() => {
    const range = priceRange([clean, ...shown.map((s) => s.legs)], spot);
    if (!range) return null;
    const sets = [
      { key: "current", name: "Current", color: "var(--accent)", legs: clean },
      ...shown.map((s) => ({ key: `s${s.slot}`, name: s.name, color: SLOT_COLORS[s.slot], legs: s.legs })),
    ].filter((s) => s.legs.length > 0);
    if (sets.length === 0) return null;
    const curves = sets.map((s) => ({ ...s, points: payoffCurve(s.legs, range.lo, range.hi) }));
    const values = [0, ...curves.flatMap((c) => c.points.map((p) => p.y))];
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (hi - lo < 1e-9) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
    const iw = W - PAD.l - PAD.r;
    const ih = H - PAD.t - PAD.b;
    const sx = (v: number) => PAD.l + ((v - range.lo) / (range.hi - range.lo)) * iw;
    const sy = (v: number) => PAD.t + ((hi - v) / (hi - lo)) * ih;
    const path = (pts: { x: number; y: number }[]) =>
      pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
    const current = curves.find((c) => c.key === "current");
    const zero = sy(0);
    return {
      curves: curves.map((c) => ({ ...c, d: path(c.points) })),
      area: current
        ? `${path(current.points)} L${sx(range.hi).toFixed(1)} ${zero.toFixed(1)} L${sx(range.lo).toFixed(1)} ${zero.toFixed(1)} Z`
        : null,
      zero,
      iw,
      top: PAD.t,
      bottom: H - PAD.b,
      xTicks: niceTicks(range.lo, range.hi, 5).map((v) => ({ v, at: sx(v) })),
      yTicks: niceTicks(lo, hi, 4).map((v) => ({ v, at: sy(v) })),
      spot: spot != null && spot >= range.lo && spot <= range.hi ? { v: spot, at: sx(spot) } : null,
      evens: current ? info.breakEvens.map((v) => ({ v, at: sx(v) })) : [],
    };
  });

  const usd = (v: number) => `${v < 0 ? "−" : ""}$${num(Math.abs(v), 2)}`;
  const tick = (v: number) => {
    const a = Math.abs(v);
    const s = a >= 1000 ? `${+(a / 1000).toFixed(1)}K` : String(+a.toFixed(2));
    return `${v < 0 ? "−" : ""}$${s}`;
  };
  const level = (v: number) => String(+v.toFixed(2));
  const profitText = (v: number) => (!Number.isFinite(v) ? "Unlimited" : v <= 0 ? "None" : usd(v));
  const lossText = (v: number) => (!Number.isFinite(v) ? "Unlimited" : v >= 0 ? "None" : usd(v));
  const evensText = (list: number[]) => (list.length ? list.map((v) => num(v, 2)).join(", ") : "—");
  const legName = (l: Leg) =>
    l.kind === "stock" ? `Shares ×${MULTIPLIER}` : `${l.strike} ${l.kind === "call" ? "Call" : "Put"}`;
  const net = (v: number) => ({ label: v > 0 ? "Net debit" : v < 0 ? "Net credit" : "Net cost", value: usd(Math.abs(v)) });

  function applyPreset(id: PresetId, label: string) {
    const made = presetLegs(id, chain, spot, mode);
    if (!made) return;
    legs = made.map((l) => makeLeg(l));
    preset = { ids: idKey(legs), label };
  }

  function removeLeg(id: string) {
    legs = legs.filter((l) => l.id !== id);
  }

  function save() {
    const next = saveStrategy(saved, name.trim() || presetName, clean);
    if (!next) return;
    saved = next;
    name = "";
  }

  function load(s: SavedStrategy) {
    legs = s.legs.map((l) => makeLeg({ kind: l.kind, side: l.side, strike: l.strike, quantity: l.quantity, price: l.price }));
    preset = null;
  }

  function drop(slot: number) {
    saved = saved.filter((s) => s.slot !== slot);
  }
</script>

<aside class="strategy" aria-label="Strategy builder">
  <div class="presets" role="group" aria-label="Preset strategies">
    {#each PRESETS as p (p.id)}
      <button class="chip" disabled={!available.get(p.id)} onclick={() => applyPreset(p.id, p.label)}>{p.label}</button>
    {/each}
  </div>

  <div class="row">
    <label class="field">
      New legs at
      <select bind:value={mode} aria-label="Entry price for new legs">
        <option value="mid">Mid</option>
        <option value="natural">Ask to buy, bid to sell</option>
      </select>
    </label>
    {#if legs.length}<button class="chip" onclick={() => (legs = [])}>Clear</button>{/if}
  </div>

  {#if legs.length === 0}
    <p class="hint">Use Buy and Sell on a chain row to add a leg, or pick a preset. All legs share this expiry.</p>
  {:else}
    <ul class="legs" aria-label="Legs">
      {#each legs as l (l.id)}
        <li class="leg">
          <select bind:value={l.side} aria-label="Side" class:up={l.side === "long"} class:down={l.side === "short"}>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
          <input type="number" min="1" step="1" bind:value={l.quantity} aria-label="Quantity" class="qty" />
          <span class="what">{legName(l)}</span>
          <label class="px">
            @
            <input type="number" min="0" step="0.01" bind:value={l.price} aria-label="Entry price" />
          </label>
          <button class="x" onclick={() => removeLeg(l.id)} aria-label="Remove leg">×</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if clean.length}
    {@const cost = net(info.netCost)}
    <dl class="summary">
      <div>
        <dt title={clean.some((l) => l.kind === "stock") ? "Includes the share purchase" : undefined}>{cost.label}</dt>
        <dd>{cost.value}</dd>
      </div>
      <div>
        <dt>Max profit</dt>
        <dd class:up={info.maxProfit > 0}>{profitText(info.maxProfit)}</dd>
      </div>
      <div>
        <dt>Max loss</dt>
        <dd class:down={info.maxLoss < 0}>{lossText(info.maxLoss)}</dd>
      </div>
      <div>
        <dt>Break-even</dt>
        <dd>{evensText(info.breakEvens)}</dd>
      </div>
    </dl>
  {/if}

  {#if view}
    <figure>
      <figcaption>
        {#each view.curves as c (c.key)}
          <span class="key"><i style="background: {c.color}"></i>{c.name}</span>
        {/each}
      </figcaption>
      <svg viewBox="0 0 {W} {H}" role="img" aria-label="Profit and loss at expiration by underlying price">
        <defs>
          <clipPath id="payoff-gain"><rect x={PAD.l} y={view.top} width={view.iw} height={Math.max(0, view.zero - view.top)} /></clipPath>
          <clipPath id="payoff-loss"><rect x={PAD.l} y={view.zero} width={view.iw} height={Math.max(0, view.bottom - view.zero)} /></clipPath>
        </defs>
        {#each view.yTicks as t (t.v)}
          <line class="grid" x1={PAD.l} x2={W - PAD.r} y1={t.at} y2={t.at} />
          <text class="tick" x={PAD.l - 6} y={t.at} text-anchor="end" dominant-baseline="middle">{tick(t.v)}</text>
        {/each}
        {#each view.xTicks as t (t.v)}
          <text class="tick" x={t.at} y={H - PAD.b + 16} text-anchor="middle">{level(t.v)}</text>
        {/each}
        {#if view.area}
          <path class="gain" d={view.area} clip-path="url(#payoff-gain)" />
          <path class="loss" d={view.area} clip-path="url(#payoff-loss)" />
        {/if}
        <line class="zero" x1={PAD.l} x2={W - PAD.r} y1={view.zero} y2={view.zero} />
        {#if view.spot}
          <line class="spot" x1={view.spot.at} x2={view.spot.at} y1={view.top} y2={view.bottom} />
          <text
            class="spot-label"
            x={view.spot.at + (view.spot.at > W * 0.7 ? -5 : 5)}
            y={view.top + 10}
            text-anchor={view.spot.at > W * 0.7 ? "end" : "start"}>Price {num(view.spot.v, 2)}</text
          >
        {/if}
        {#each view.curves as c (c.key)}
          <path class="line" d={c.d} stroke={c.color}><title>{c.name}</title></path>
        {/each}
        {#each view.evens as e (e.v)}
          <circle class="even" cx={e.at} cy={view.zero} r="4"><title>Break-even {num(e.v, 2)}</title></circle>
        {/each}
      </svg>
    </figure>
  {/if}

  <div class="row save">
    <input type="text" placeholder={presetName || "Name (optional)"} aria-label="Strategy name" bind:value={name} maxlength="40" />
    <button class="chip" disabled={clean.length === 0 || full} onclick={save}>Save to compare</button>
    <span class="note">{saved.length} of {MAX_SAVED} saved</span>
  </div>

  {#if saved.length}
    <table class="compare">
      <thead>
        <tr>
          <th scope="col">Show</th>
          <th scope="col" class="l">Strategy</th>
          <th scope="col">Net</th>
          <th scope="col">Max profit</th>
          <th scope="col">Max loss</th>
          <th scope="col">Break-even</th>
          <th scope="col" aria-label="Actions"></th>
        </tr>
      </thead>
      <tbody>
        {#each saved as s (s.slot)}
          {@const a = analyze(s.legs)}
          <tr>
            <td><input type="checkbox" bind:checked={s.visible} aria-label="Show {s.name} on the chart" /></td>
            <th scope="row" class="l"><span class="key"><i style="background: {SLOT_COLORS[s.slot]}"></i>{s.name}</span></th>
            <td>{a.netCost < 0 ? "Cr " : a.netCost > 0 ? "Dr " : ""}{usd(Math.abs(a.netCost))}</td>
            <td class:up={a.maxProfit > 0}>{profitText(a.maxProfit)}</td>
            <td class:down={a.maxLoss < 0}>{lossText(a.maxLoss)}</td>
            <td>{evensText(a.breakEvens)}</td>
            <td class="acts">
              <button class="chip" onclick={() => load(s)}>Load</button>
              <button class="x" onclick={() => drop(s.slot)} aria-label="Remove {s.name}">×</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</aside>

<style>
  .strategy {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 8px 4px;
    overflow: auto;
    overscroll-behavior: contain;
    font-size: 12px;
  }
  .presets,
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .chip,
  select,
  input[type="text"],
  input[type="number"] {
    border: 1px solid var(--faint);
    background: var(--surface);
    color: inherit;
    font: inherit;
    font-size: 12px;
    border-radius: 6px;
    padding: 3px 8px;
  }
  .chip {
    cursor: pointer;
  }
  .chip:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .field {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
  }
  .hint,
  .note {
    margin: 0;
    color: var(--muted);
  }
  .legs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .leg {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .leg select.up {
    color: var(--up);
  }
  .leg select.down {
    color: var(--down);
  }
  .qty {
    width: 56px;
  }
  .what {
    min-width: 76px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
  .px {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--muted);
  }
  .px input {
    width: 76px;
  }
  .x {
    border: 0;
    background: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 2px 6px;
  }
  .x:hover {
    color: var(--text);
  }
  .summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 8px;
    margin: 0;
  }
  .summary div {
    border: 1px solid var(--faint);
    background: var(--surface);
    border-radius: 8px;
    padding: 6px 10px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 2px 0 0;
    font-size: 14px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
  figure {
    margin: 0;
  }
  figcaption {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin-bottom: 4px;
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
    height: auto;
  }
  .grid {
    stroke: var(--grid);
    stroke-width: 1;
  }
  .zero {
    stroke: var(--muted);
    stroke-width: 1;
  }
  .spot {
    stroke: var(--crosshair);
    stroke-width: 1;
    stroke-dasharray: 4 3;
  }
  .tick,
  .spot-label {
    fill: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .gain {
    fill: var(--up);
    fill-opacity: 0.16;
  }
  .loss {
    fill: var(--down);
    fill-opacity: 0.16;
  }
  .line {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .even {
    fill: var(--bg);
    stroke: var(--text);
    stroke-width: 2;
  }
  .save input {
    width: 150px;
  }
  .compare {
    border-collapse: collapse;
    width: 100%;
    font-variant-numeric: tabular-nums;
  }
  .compare th,
  .compare td {
    padding: 4px 6px;
    text-align: right;
    white-space: nowrap;
  }
  .compare thead th {
    color: var(--muted);
    font-weight: 600;
  }
  .compare tbody th {
    font-weight: 650;
  }
  .compare .l {
    text-align: left;
  }
  .compare tbody tr {
    border-top: 1px solid var(--faint);
  }
  .acts {
    display: flex;
    align-items: center;
    gap: 4px;
    justify-content: flex-end;
  }
  .up {
    color: var(--up);
  }
  .down {
    color: var(--down);
  }
</style>
