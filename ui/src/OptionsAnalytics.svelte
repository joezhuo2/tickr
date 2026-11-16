<script module lang="ts">
  const TERM_TTL = 10 * 60 * 1000;
  const TERM_MAX = 8;
  const term = new Map<string, { at: number; iv: number | null }>();
</script>

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { num, volume } from "./lib/format";
  import { atmIv, maxPain, MIN_UNUSUAL_VOLUME, oiByStrike, smile, unusualActivity } from "./lib/optionsStats";
  import type { Options } from "./lib/types";

  let { options, symbol }: { options: Options; symbol: string } = $props();

  const W = 600;
  const H = 150;
  const PAD = 24;

  const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const pain = $derived(maxPain(options));
  const oi = $derived(oiByStrike(options));
  const curve = $derived(smile(options));
  const unusual = $derived(unusualActivity(options));
  const maxOi = $derived(Math.max(1, ...oi.flatMap((r) => [r.calls, r.puts])));
  let version = $state(0);

  const expiries = $derived(options.expirations.slice(0, TERM_MAX));
  const points = $derived.by(() => {
    version;
    return expiries
      .map((e) => ({ expiry: e, iv: e === options.expiry ? atmIv(options) : (term.get(`${symbol}:${e}`)?.iv ?? null) }))
      .filter((p): p is { expiry: number; iv: number } => p.iv != null);
  });
  let loadingTerm = $state(false);

  $effect(() => {
    const sym = symbol;
    const current = options.expiry;
    const wanted = expiries.filter((e) => e !== current);
    let alive = true;
    (async () => {
      loadingTerm = true;
      for (const e of wanted) {
        const hit = term.get(`${sym}:${e}`);
        if (hit && Date.now() - hit.at < TERM_TTL) continue;
        try {
          const o = await invoke<Options>("get_options", { symbol: sym, date: e });
          term.set(`${sym}:${e}`, { at: Date.now(), iv: atmIv(o) });
        } catch (err) {
          console.warn(err);
          break;
        }
        if (!alive) return;
        version++;
      }
      if (alive) loadingTerm = false;
    })();
    return () => {
      alive = false;
      loadingTerm = false;
    };
  });

  function scale(values: number[], size: number) {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return (v: number) => (hi === lo ? size / 2 : PAD + ((v - lo) / (hi - lo)) * (size - 2 * PAD));
  }

  const xs = $derived(scale(oi.map((r) => r.strike), W));
  const painX = $derived(pain != null && oi.length ? xs(pain) : null);
  const priceX = $derived(options.price != null && oi.length && options.price >= oi[0].strike && options.price <= oi[oi.length - 1].strike ? xs(options.price) : null);
  const smileX = $derived(scale(curve.map((p) => p.strike), W));
  const smileY = $derived.by(() => {
    const lo = Math.min(...curve.map((p) => p.iv));
    const hi = Math.max(...curve.map((p) => p.iv));
    return (v: number) => (hi === lo ? H / 2 : H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD));
  });
  const termX = $derived(scale(points.map((p) => p.expiry), W));
  const termY = $derived.by(() => {
    const lo = Math.min(...points.map((p) => p.iv));
    const hi = Math.max(...points.map((p) => p.iv));
    return (v: number) => (hi === lo ? H / 2 : H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD));
  });
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
</script>

<div class="analytics">
  <section>
    <h2>Open interest by strike{#if options.expiry != null} · {iso(options.expiry)}{/if}</h2>
    <div class="stats">
      <span>Max pain <b>{pain == null ? "—" : num(pain)}</b></span>
      <span class="legend"><i class="c"></i>Calls</span>
      <span class="legend"><i class="p"></i>Puts</span>
    </div>
    {#if oi.length}
      <svg viewBox="0 0 {W} {H}" role="img" aria-label="Open interest by strike, calls against puts">
        {#each oi as r (r.strike)}
          {@const x = xs(r.strike)}
          {@const w = Math.max(2, Math.min(10, (W - 2 * PAD) / oi.length / 2.4))}
          <rect x={x - w} y={H - PAD - (r.calls / maxOi) * (H - 2 * PAD)} width={w} height={(r.calls / maxOi) * (H - 2 * PAD)} class="c"><title>{num(r.strike)} calls: {volume(r.calls)}</title></rect>
          <rect {x} y={H - PAD - (r.puts / maxOi) * (H - 2 * PAD)} width={w} height={(r.puts / maxOi) * (H - 2 * PAD)} class="p"><title>{num(r.strike)} puts: {volume(r.puts)}</title></rect>
        {/each}
        {#if priceX != null}<line x1={priceX} x2={priceX} y1={PAD / 2} y2={H - PAD} class="ref" /><text x={priceX} y={PAD / 2 - 2} text-anchor="middle">Price</text>{/if}
        {#if painX != null}<line x1={painX} x2={painX} y1={PAD / 2} y2={H - PAD} class="ref pain" /><text x={painX} y={H - 6} text-anchor="middle">Max pain</text>{/if}
        <text x={PAD} y={H - 6}>{num(oi[0].strike)}</text>
        <text x={W - PAD} y={H - 6} text-anchor="end">{num(oi[oi.length - 1].strike)}</text>
      </svg>
    {:else}
      <div class="sub">No open interest for this expiry.</div>
    {/if}
  </section>

  <section>
    <h2>IV smile</h2>
    {#if curve.length > 1}
      <svg viewBox="0 0 {W} {H}" role="img" aria-label="Implied volatility by strike">
        <polyline points={curve.map((p) => `${smileX(p.strike)},${smileY(p.iv)}`).join(" ")} class="line" />
        {#each curve as p (p.strike)}<circle cx={smileX(p.strike)} cy={smileY(p.iv)} r="2.5" class="dot"><title>{num(p.strike)}: {pct(p.iv)}</title></circle>{/each}
        <text x={PAD} y={H - 6}>{num(curve[0].strike)}</text>
        <text x={W - PAD} y={H - 6} text-anchor="end">{num(curve[curve.length - 1].strike)}</text>
        <text x={PAD} y={12}>{pct(Math.max(...curve.map((p) => p.iv)))}</text>
      </svg>
    {:else}
      <div class="sub">Not enough implied volatility data.</div>
    {/if}
  </section>

  <section>
    <h2>IV term structure (at the money){#if loadingTerm} · loading…{/if}</h2>
    {#if points.length > 1}
      <svg viewBox="0 0 {W} {H}" role="img" aria-label="At-the-money implied volatility by expiry">
        <polyline points={points.map((p) => `${termX(p.expiry)},${termY(p.iv)}`).join(" ")} class="line" />
        {#each points as p (p.expiry)}
          <circle cx={termX(p.expiry)} cy={termY(p.iv)} r="2.5" class="dot"><title>{iso(p.expiry)}: {pct(p.iv)}</title></circle>
        {/each}
        <text x={PAD} y={H - 6}>{iso(points[0].expiry)}</text>
        <text x={W - PAD} y={H - 6} text-anchor="end">{iso(points[points.length - 1].expiry)}</text>
        <text x={PAD} y={12}>{pct(Math.max(...points.map((p) => p.iv)))}</text>
      </svg>
    {:else if !loadingTerm}
      <div class="sub">Not enough expiries with implied volatility.</div>
    {/if}
  </section>

  <section>
    <h2>Unusual activity</h2>
    <div class="sub">Volume above open interest, at least {MIN_UNUSUAL_VOLUME} contracts, for {options.expiry != null ? iso(options.expiry) : "this expiry"}.</div>
    {#if unusual.length}
      <div class="scroll">
        <table>
          <thead><tr><th>Type</th><th>Strike</th><th>Volume</th><th>Open int.</th><th>Vol / OI</th><th>IV</th></tr></thead>
          <tbody>
            {#each unusual as u (u.contract.symbol)}
              <tr>
                <td class={u.kind === "call" ? "up" : "down"}>{u.kind === "call" ? "Call" : "Put"}</td>
                <td>{num(u.contract.strike)}</td>
                <td>{volume(u.contract.volume)}</td>
                <td>{volume(u.contract.open_interest)}</td>
                <td>{u.ratio == null ? "new" : `${u.ratio.toFixed(1)}x`}</td>
                <td>{u.contract.iv == null ? "—" : pct(u.contract.iv)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="sub">None for this expiry.</div>
    {/if}
  </section>
</div>

<style>
  .analytics {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    display: grid;
    align-content: start;
    gap: 18px;
    padding: 6px 10px 10px 4px;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .stats {
    display: flex;
    gap: 14px;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 4px;
  }
  .stats b {
    color: var(--text);
  }
  .legend i {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 4px;
    border-radius: 2px;
  }
  .sub {
    color: var(--muted);
    font-size: 12px;
  }
  svg {
    width: 100%;
    height: auto;
    max-height: 220px;
    font-size: 10px;
    fill: var(--muted);
  }
  .c {
    fill: var(--up);
    background: var(--up);
  }
  .p {
    fill: var(--down);
    background: var(--down);
  }
  .ref {
    stroke: var(--muted);
    stroke-dasharray: 3 3;
  }
  .pain {
    stroke: var(--accent);
  }
  .line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
  }
  .dot {
    fill: var(--accent);
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    margin-top: 6px;
  }
  th {
    color: var(--muted);
    font-weight: 600;
    text-align: right;
    padding: 4px 10px;
  }
  td {
    text-align: right;
    padding: 4px 10px;
    border-top: 1px solid var(--faint);
    white-space: nowrap;
  }
  th:first-child,
  td:first-child {
    text-align: left;
  }
  .up {
    color: var(--up);
  }
  .down {
    color: var(--down);
  }
</style>
