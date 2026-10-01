<script lang="ts">
  import { axisTime, fullTime, niceTicks, num, price, volume } from "./lib/format";
  import type { Chart, ChartMode } from "./lib/types";

  let { chart, mode }: { chart: Chart | null; mode: ChartMode } = $props();

  let wrap: HTMLDivElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let width = $state(0);
  let height = $state(0);
  let hover = $state<number | null>(null);

  const PAD = { l: 6, r: 62, t: 10, b: 22 };

  const candles = $derived(chart?.candles ?? []);
  const isDay = $derived(chart?.range === "1d");
  const prevClose = $derived(isDay ? (chart?.meta.prev_close ?? null) : null);

  // Geometry shared by drawing and hit-testing.
  const geo = $derived.by(() => {
    const n = candles.length;
    const plotW = Math.max(1, width - PAD.l - PAD.r);
    const plotH = Math.max(1, height - PAD.t - PAD.b);
    const priceH = plotH * 0.8;
    const volTop = PAD.t + plotH * 0.84;
    const volH = plotH - (volTop - PAD.t);
    let lo = Infinity;
    let hi = -Infinity;
    let vmax = 0;
    for (const c of candles) {
      lo = Math.min(lo, mode === "candles" ? c.l : c.c);
      hi = Math.max(hi, mode === "candles" ? c.h : c.c);
      vmax = Math.max(vmax, c.v);
    }
    if (prevClose != null) {
      lo = Math.min(lo, prevClose);
      hi = Math.max(hi, prevClose);
    }
    if (!(hi > lo)) {
      hi = lo + 1;
      lo = lo - 1;
    }
    const pad = (hi - lo) * 0.06;
    lo -= pad;
    hi += pad;
    const step = plotW / Math.max(n, 1);
    return {
      n,
      step,
      lo,
      hi,
      vmax,
      volTop,
      volH,
      x: (i: number) => PAD.l + step * (i + 0.5),
      y: (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * priceH,
      vy: (v: number) => volTop + volH - (vmax > 0 ? (v / vmax) * volH : 0),
    };
  });

  const trendUp = $derived.by(() => {
    if (candles.length === 0) return true;
    const base = prevClose ?? candles[0].o;
    return candles[candles.length - 1].c >= base;
  });

  function isExtended(t: number): boolean {
    const p = chart?.meta.periods;
    return isDay && !!p && (t < p.regular.start || t >= p.regular.end);
  }

  function draw() {
    if (!canvas || width === 0 || height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const css = getComputedStyle(canvas);
    const v = (name: string) => css.getPropertyValue(name).trim();
    const up = v("--up");
    const down = v("--down");
    const g = geo;
    const bottom = height - PAD.b;
    ctx.font = `11px ${v("--font")}`;

    // Extended-hours shading.
    if (isDay) {
      ctx.fillStyle = v("--ext-shade");
      candles.forEach((c, i) => {
        if (isExtended(c.t)) ctx.fillRect(g.x(i) - g.step / 2, PAD.t, g.step + 0.5, bottom - PAD.t);
      });
    }

    // Grid and price axis.
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (const t of niceTicks(g.lo, g.hi, 4)) {
      const y = Math.round(g.y(t)) + 0.5;
      if (y < PAD.t || y > g.volTop) continue;
      ctx.strokeStyle = v("--grid");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(width - PAD.r, y);
      ctx.stroke();
      ctx.fillStyle = v("--muted");
      ctx.fillText(num(t), width - PAD.r + 8, y);
    }

    // Time axis: about one label per 110 px.
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = v("--muted");
    if (g.n > 0 && chart) {
      const every = Math.max(1, Math.ceil(g.n / Math.max(1, Math.floor((width - PAD.l - PAD.r) / 110))));
      for (let i = Math.floor(every / 2); i < g.n; i += every) {
        ctx.fillText(axisTime(candles[i].t, chart.meta.gmtoffset, chart.range), g.x(i), height - 6);
      }
    }

    // Volume.
    const bw = Math.max(1, g.step * 0.65);
    candles.forEach((c, i) => {
      ctx.fillStyle = c.c >= c.o ? up : down;
      ctx.globalAlpha = 0.28;
      const y = g.vy(c.v);
      ctx.fillRect(g.x(i) - bw / 2, y, bw, g.volTop + g.volH - y);
    });
    ctx.globalAlpha = 1;

    // Previous close.
    if (prevClose != null) {
      const y = Math.round(g.y(prevClose)) + 0.5;
      ctx.strokeStyle = v("--muted");
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(width - PAD.r, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (mode === "candles") {
      candles.forEach((c, i) => {
        const x = Math.round(g.x(i)) + 0.5;
        const col = c.c >= c.o ? up : down;
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, g.y(c.h));
        ctx.lineTo(x, g.y(c.l));
        ctx.stroke();
        const top = g.y(Math.max(c.o, c.c));
        const h = Math.max(1, g.y(Math.min(c.o, c.c)) - top);
        ctx.fillRect(x - bw / 2, top, bw, h);
      });
    } else if (g.n > 0) {
      const col = trendUp ? up : down;
      ctx.beginPath();
      candles.forEach((c, i) => (i === 0 ? ctx.moveTo(g.x(i), g.y(c.c)) : ctx.lineTo(g.x(i), g.y(c.c))));
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";
      ctx.stroke();
      // Area fill under the line.
      const priceBottom = g.y(g.lo);
      ctx.lineTo(g.x(g.n - 1), priceBottom);
      ctx.lineTo(g.x(0), priceBottom);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, PAD.t, 0, priceBottom);
      grad.addColorStop(0, col);
      grad.addColorStop(1, "transparent");
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Crosshair.
    if (hover != null && candles[hover]) {
      const c = candles[hover];
      const x = Math.round(g.x(hover)) + 0.5;
      const y = Math.round(g.y(c.c)) + 0.5;
      ctx.strokeStyle = v("--crosshair");
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, PAD.t);
      ctx.lineTo(x, bottom);
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(width - PAD.r, y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (mode === "line") {
        ctx.fillStyle = trendUp ? up : down;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Price tag on the axis.
      const label = num(c.c);
      ctx.fillStyle = v("--text");
      ctx.fillRect(width - PAD.r + 2, y - 9, PAD.r - 4, 18);
      ctx.fillStyle = v("--bg");
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label, width - PAD.r + 8, y);
    }
  }

  $effect(() => {
    // Redraw when any of these change.
    void [candles, mode, width, height, hover, geo];
    draw();
  });

  $effect(() => {
    if (!wrap) return;
    const ro = new ResizeObserver(([e]) => {
      width = e.contentRect.width;
      height = e.contentRect.height;
    });
    ro.observe(wrap);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const redraw = () => draw();
    mq.addEventListener("change", redraw);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", redraw);
    };
  });

  // Reset hover when the data changes.
  $effect(() => {
    void chart;
    hover = null;
  });

  function onMove(e: PointerEvent) {
    const r = wrap!.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (geo.n === 0 || x < PAD.l || x > width - PAD.r) {
      hover = null;
      return;
    }
    hover = Math.max(0, Math.min(geo.n - 1, Math.floor((x - PAD.l) / geo.step)));
  }

  function onKey(e: KeyboardEvent) {
    if (geo.n === 0) return;
    if (e.key === "ArrowLeft") hover = hover == null ? geo.n - 1 : Math.max(0, hover - 1);
    else if (e.key === "ArrowRight") hover = hover == null ? 0 : Math.min(geo.n - 1, hover + 1);
    else if (e.key === "Escape") hover = null;
    else return;
    e.preventDefault();
  }

  const tip = $derived.by(() => {
    if (hover == null || !chart || !candles[hover]) return null;
    const c = candles[hover];
    const x = geo.x(hover);
    const left = x > width / 2;
    return { c, x, left, ext: isExtended(c.t) };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="chart"
  bind:this={wrap}
  tabindex="0"
  role="img"
  aria-label={chart ? `${chart.meta.symbol} ${chart.range} chart` : "chart"}
  onpointermove={onMove}
  onpointerleave={() => (hover = null)}
  onkeydown={onKey}
>
  <canvas bind:this={canvas} style:width="{width}px" style:height="{height}px"></canvas>
  {#if tip && chart}
    <div
      class="tip"
      style:left={tip.left ? "auto" : `${tip.x + 14}px`}
      style:right={tip.left ? `${width - tip.x + 14}px` : "auto"}
    >
      <div class="when">
        {fullTime(tip.c.t, chart.meta.gmtoffset, chart.interval)}{#if tip.ext}<span class="ext">ext</span>{/if}
      </div>
      <dl>
        <dt>Open</dt><dd>{price(tip.c.o, chart.meta.currency)}</dd>
        <dt>High</dt><dd>{price(tip.c.h, chart.meta.currency)}</dd>
        <dt>Low</dt><dd>{price(tip.c.l, chart.meta.currency)}</dd>
        <dt>Close</dt><dd class={tip.c.c >= tip.c.o ? "up" : "down"}>{price(tip.c.c, chart.meta.currency)}</dd>
        <dt>Volume</dt><dd>{volume(tip.c.v)}</dd>
      </dl>
    </div>
  {/if}
</div>

<style>
  .chart {
    position: relative;
    flex: 1;
    min-height: 0;
    outline: none;
    cursor: crosshair;
  }
  .chart:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent);
    border-radius: 6px;
  }
  canvas {
    position: absolute;
    inset: 0;
  }
  .tip {
    position: absolute;
    top: 8px;
    pointer-events: none;
    background: var(--tooltip-bg);
    border: 1px solid var(--faint);
    box-shadow: var(--shadow);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 12px;
    min-width: 150px;
  }
  .when {
    color: var(--muted);
    margin-bottom: 4px;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .ext {
    font-size: 10px;
    padding: 0 4px;
    border-radius: 3px;
    background: var(--surface);
  }
  dl {
    display: grid;
    grid-template-columns: auto auto;
    gap: 1px 14px;
    margin: 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    text-align: right;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
</style>
