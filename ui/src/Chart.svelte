<script lang="ts">
  import { alignTimes, axisTime, fullTime, niceTicks, num, price, volume } from "./lib/format";
  import type { Analysis, Chart, ChartMode, Line, Overlays, Pattern } from "./lib/types";

  let {
    chart,
    mode,
    analysis = null,
    overlays = null,
  }: { chart: Chart | null; mode: ChartMode; analysis?: Analysis | null; overlays?: Overlays | null } = $props();

  let wrap: HTMLDivElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let width = $state(0);
  let height = $state(0);
  let hover = $state<number | null>(null);

  const PAD = { l: 6, r: 62, t: 10, b: 22 };

  const candles = $derived(chart?.candles ?? []);
  const isDay = $derived(chart?.range === "1d");
  const prevClose = $derived(isDay ? (chart?.meta.prev_close ?? null) : null);

  // Analysis overlays: only when there is an analysis and a toggle set.
  const show = $derived(analysis && overlays ? overlays : null);
  const rsiOn = $derived(!!show?.rsi);
  /** Series index for each candle on screen (-1 for candles newer than the analysis). */
  const align = $derived(
    analysis ? alignTimes(
        candles.map((c) => c.t),
        analysis.series.t,
      ) : [],
  );
  /** Chart index for a candle time. */
  const indexOf = $derived(new Map(candles.map((c, i) => [c.t, i])));
  /** Scored patterns by chart index, for markers and the tooltip. */
  const patternsAt = $derived.by(() => {
    const m = new Map<number, Pattern[]>();
    if (!analysis) return m;
    for (const p of analysis.patterns) {
      if (!p.context_ok) continue;
      const i = indexOf.get(p.t);
      if (i == null) continue;
      m.set(i, [...(m.get(i) ?? []), p]);
    }
    return m;
  });
  const targetLevels = $derived.by(() => {
    if (!analysis || !show?.targets) return [];
    const t = analysis.targets;
    const out = [
      { label: "Upside", price: t.upside.price, color: "--up", dash: [6, 3] },
      { label: "Downside", price: t.downside.price, color: "--down", dash: [6, 3] },
    ];
    if (t.invalidation) out.push({ label: "Invalidation", price: t.invalidation.price, color: "--muted", dash: [2, 3] });
    return out;
  });

  function valueAt(line: Line, i: number): number | null {
    const k = align[i];
    return k == null || k < 0 ? null : (line.values[k] ?? null);
  }

  // Geometry shared by drawing and hit-testing.
  const geo = $derived.by(() => {
    const n = candles.length;
    const plotW = Math.max(1, width - PAD.l - PAD.r);
    const plotH = Math.max(1, height - PAD.t - PAD.b);
    // With the RSI pane: price 60%, volume 62-74%, RSI 78-100%.
    const priceH = plotH * (rsiOn ? 0.6 : 0.8);
    const volTop = PAD.t + plotH * (rsiOn ? 0.62 : 0.84);
    const volH = rsiOn ? plotH * 0.12 : plotH - (volTop - PAD.t);
    const rsiTop = PAD.t + plotH * 0.78;
    const rsiH = plotH - (rsiTop - PAD.t);
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
    // Keep overlays in view.
    if (analysis && show?.mas) {
      for (const line of analysis.series.mas) {
        for (let i = 0; i < n; i++) {
          const v = valueAt(line, i);
          if (v != null) {
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
        }
      }
    }
    for (const t of targetLevels) {
      lo = Math.min(lo, t.price);
      hi = Math.max(hi, t.price);
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
      plotW,
      priceH,
      volTop,
      volH,
      rsiTop,
      rsiH,
      x: (i: number) => PAD.l + step * (i + 0.5),
      y: (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * priceH,
      vy: (v: number) => volTop + volH - (vmax > 0 ? (v / vmax) * volH : 0),
      ry: (v: number) => rsiTop + (1 - v / 100) * rsiH,
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

    if (show && analysis) drawOverlays(ctx, g, v);

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

  type Geo = typeof geo;

  /** Strokes a series in two parts: dashed during warm-up, solid after. */
  function strokeLine(ctx: CanvasRenderingContext2D, line: Line, y: (v: number) => number, g: Geo) {
    for (const warm of [true, false]) {
      ctx.setLineDash(warm ? [3, 3] : []);
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < g.n; i++) {
        const k = align[i];
        const val = valueAt(line, i);
        if (val == null || (warm ? k > line.full_from : k < line.full_from)) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(g.x(i), y(val));
        else ctx.moveTo(g.x(i), y(val));
        pen = true;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  /** Tag on the price axis, like the crosshair's. */
  function axisTag(ctx: CanvasRenderingContext2D, y: number, text: string, bg: string, fg: string) {
    ctx.fillStyle = bg;
    ctx.fillRect(width - PAD.r + 2, y - 8, PAD.r - 4, 16);
    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, width - PAD.r + 6, y);
  }

  function drawOverlays(ctx: CanvasRenderingContext2D, g: Geo, v: (name: string) => string) {
    const a = analysis!;
    const s = show!;
    const right = width - PAD.r;
    const priceBottom = PAD.t + g.priceH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.l, PAD.t, g.plotW, g.priceH);
    ctx.clip();
    ctx.lineWidth = 1;

    // Fibonacci: swing line plus levels from the swing start rightwards.
    if (s.fib && a.fib) {
      const f = a.fib;
      const x0 = indexOf.has(f.from.t) ? g.x(indexOf.get(f.from.t)!) : PAD.l;
      const x1 = indexOf.has(f.to.t) ? g.x(indexOf.get(f.to.t)!) : right;
      ctx.strokeStyle = v("--fib");
      ctx.fillStyle = v("--fib");
      ctx.setLineDash([1, 3]);
      ctx.beginPath();
      ctx.moveTo(x0, g.y(f.from.price));
      ctx.lineTo(x1, g.y(f.to.price));
      ctx.stroke();
      ctx.setLineDash([4, 4]);
      ctx.font = `10px ${v("--font")}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      for (const l of f.levels) {
        const y = Math.round(g.y(l.price)) + 0.5;
        if (y < PAD.t || y > priceBottom) continue;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.fillText(`${l.label}${l.kind === "extension" ? " ext" : ""} ${num(l.price)}`, x0 + 3, y - 1);
      }
      ctx.setLineDash([]);
    }

    // Moving averages, with a legend.
    if (s.mas) {
      ctx.lineWidth = 1.2;
      ctx.font = `10px ${v("--font")}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      let lx = PAD.l + 4;
      a.series.mas.forEach((line, k) => {
        const col = v(`--ma-${k + 1}`);
        ctx.strokeStyle = col;
        strokeLine(ctx, line, g.y, g);
        ctx.fillStyle = col;
        ctx.fillText(line.label, lx, PAD.t + 2);
        lx += ctx.measureText(line.label).width + 10;
      });
    }

    // Targets: full-width levels, labeled inside the plot.
    ctx.font = `10px ${v("--font")}`;
    for (const t of targetLevels) {
      const y = Math.round(g.y(t.price)) + 0.5;
      ctx.strokeStyle = v(t.color);
      ctx.fillStyle = v(t.color);
      ctx.lineWidth = 1.2;
      ctx.setLineDash(t.dash);
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(t.label, right - 4, y - 2);
    }

    // Pattern markers: ▲ under bullish candles, ▼ over bearish ones.
    if (s.patterns) {
      for (const [i, list] of patternsAt) {
        const c = candles[i];
        const bull = list.some((p) => p.direction === "bullish");
        const bear = list.some((p) => p.direction === "bearish");
        const x = g.x(i);
        const sz = 4;
        if (bull) {
          const y = g.y(mode === "candles" ? c.l : c.c) + 5;
          ctx.fillStyle = v("--up");
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - sz, y + sz * 1.6);
          ctx.lineTo(x + sz, y + sz * 1.6);
          ctx.fill();
        }
        if (bear) {
          const y = g.y(mode === "candles" ? c.h : c.c) - 5;
          ctx.fillStyle = v("--down");
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - sz, y - sz * 1.6);
          ctx.lineTo(x + sz, y - sz * 1.6);
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // Target prices on the axis (outside the clip).
    ctx.font = `11px ${v("--font")}`;
    for (const t of targetLevels) {
      const y = Math.round(g.y(t.price)) + 0.5;
      if (y >= PAD.t && y <= priceBottom) axisTag(ctx, y, num(t.price), v(t.color), v("--bg"));
    }

    // RSI pane: 30/50/70 guides and the line.
    if (s.rsi) {
      const top = g.rsiTop;
      ctx.strokeStyle = v("--grid");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.l, Math.round(top) + 0.5);
      ctx.lineTo(right, Math.round(top) + 0.5);
      ctx.stroke();
      ctx.font = `10px ${v("--font")}`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      for (const lvl of [30, 50, 70]) {
        const y = Math.round(g.ry(lvl)) + 0.5;
        ctx.strokeStyle = lvl === 50 ? v("--grid") : v("--muted");
        ctx.setLineDash(lvl === 50 ? [] : [2, 3]);
        ctx.beginPath();
        ctx.moveTo(PAD.l, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.fillStyle = v("--muted");
        ctx.fillText(String(lvl), right + 8, y);
      }
      ctx.setLineDash([]);
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD.l, top, g.plotW, g.rsiH);
      ctx.clip();
      ctx.strokeStyle = v("--rsi");
      ctx.lineWidth = 1.3;
      strokeLine(ctx, a.series.rsi, g.ry, g);
      ctx.restore();
      const lastRsi = a.series.rsi.values[a.series.rsi.values.length - 1];
      ctx.fillStyle = v("--rsi");
      ctx.textBaseline = "top";
      ctx.fillText(`${a.series.rsi.label}${lastRsi != null ? `  ${num(lastRsi, 1)}` : ""}`, PAD.l + 4, top + 2);
    }
    ctx.font = `11px ${v("--font")}`;
  }

  $effect(() => {
    // Redraw when any of these change.
    void [candles, mode, width, height, hover, geo, analysis, show && { ...show }];
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
    const rsi = show && analysis ? valueAt(analysis.series.rsi, hover) : null;
    const pats = show?.patterns ? (patternsAt.get(hover) ?? []) : [];
    return { c, x, left, ext: isExtended(c.t), rsi, pats };
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
        {#if tip.rsi != null}<dt>RSI</dt><dd>{num(tip.rsi, 1)}</dd>{/if}
      </dl>
      {#each tip.pats as p (p.kind)}
        <div class="pat {p.direction === 'bullish' ? 'up' : 'down'}">{p.direction === "bullish" ? "▲" : "▼"} {p.name}</div>
      {/each}
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
  .pat {
    margin-top: 3px;
    font-weight: 600;
  }
</style>
