<script lang="ts">
  import { alignTimes, axisTime, candleAt, candlesCsv, fullTime, netSentiment, num, price, quarterLabel, volume } from "./lib/format";
  import { classifyBars, displayOffset, isExtendedSession, isIntraday, zoneLabel, type Clock } from "./lib/session";
  import type { Analysis, Article, Chart, ChartMode, ChartScale, ChartTimeZone, EarningsReport, Line, Overlays, Pattern, RatingChange } from "./lib/types";
  import { fitScale, forward, inverse, scaleLabel, scaleTicks } from "./lib/scale";
  import type { Drawing, DrawingPoint } from "./lib/types";
  import { timeToIndex, indexToTime, hitTest, hitPolyline, pathBounds, segmentDistance, simplifyPath, undoReducer, rulerMeasurement, type History, type Pixel } from "./lib/drawing";
  import { paneLayout } from "./lib/indicators";
  import { untrack } from "svelte";
  import { fadeIn } from "./lib/motion";
  import { follow, full, isFull, pan, reveal, visible, zoom, type View } from "./lib/viewport";

  let {
    chart,
    redrawKey = 0,
    drawings,
    drawingBusy,
    saveDrawings,
    mode,
    scale = "linear",
    shadeSessions = true,
    timeZone = "exchange",
    analysis = null,
    overlays = null,
    earnings = [],
    ratings = [],
    news = [],
    staleNote = null,
  }: {
    chart: Chart | null;
    redrawKey?: number;
    drawings: Record<string, Drawing[]>;
    drawingBusy: boolean;
    saveDrawings: (symbol: string, drawings: Drawing[]) => Promise<boolean>;
    mode: ChartMode;
    scale?: ChartScale;
    shadeSessions?: boolean;
    timeZone?: ChartTimeZone;
    analysis?: Analysis | null;
    overlays?: Overlays | null;
    earnings?: EarningsReport[];
    ratings?: RatingChange[];
    news?: Article[];
    staleNote?: string | null;
  } = $props();

  let wrap: HTMLDivElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let width = $state(0);
  let height = $state(0);
  let hover = $state<number | null>(null);
  let copied = $state<"image" | "csv" | null>(null);
  let view = $state<View>(full(0));
  let dragX = $state<number | null>(null);

  const PAD = { l: 6, r: 62, t: 38, b: 22 };

  const candles = $derived(chart?.candles ?? []);
  const isDay = $derived(chart?.range === "1d");
  const prevClose = $derived(isDay ? (chart?.meta.prev_close ?? null) : null);
  const clock = $derived<Clock>({ timezone: chart?.meta.timezone, gmtoffset: chart?.meta.gmtoffset ?? 0 });
  const sessions = $derived(chart ? classifyBars(candles.map((c) => c.t), clock, chart.meta.periods, chart.interval) : []);
  const hasExtended = $derived(sessions.some(isExtendedSession));

  // Analysis overlays: only when there is an analysis and a toggle set.
  const show = $derived(analysis && overlays ? overlays : null);
  const rsiOn = $derived(!!show?.rsi);
  const macdOn = $derived(!!show?.macd);
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
  const earningsAt = $derived.by(() => {
    const times = candles.map((c) => c.t);
    const m = new Map<number, EarningsReport>();
    for (const e of earnings) {
      const i = candleAt(times, e.reported);
      if (i >= 0) m.set(i, e);
    }
    return m;
  });
  const ratingsAt = $derived.by(() => {
    const times = candles.map((c) => c.t);
    const m = new Map<number, RatingChange[]>();
    for (const r of ratings) {
      const i = candleAt(times, r.date);
      if (i >= 0) m.set(i, [...(m.get(i) ?? []), r]);
    }
    return m;
  });
  const newsAt = $derived.by(() => {
    const times = candles.map((c) => c.t);
    const m = new Map<number, Article[]>();
    for (const a of news) {
      const i = candleAt(times, a.published);
      if (i >= 0) m.set(i, [...(m.get(i) ?? []), a]);
    }
    return m;
  });
  const dividendsAt = $derived.by(() => {
    const times = candles.map((c) => c.t);
    const m = new Map<number, number>();
    for (const d of chart?.dividends ?? []) {
      const i = candleAt(times, d.t);
      if (i >= 0) m.set(i, d.amount);
    }
    return m;
  });
  const splitsAt = $derived.by(() => {
    const times = candles.map((c) => c.t);
    const m = new Map<number, string>();
    for (const s of chart?.splits ?? []) {
      const i = candleAt(times, s.t);
      if (i >= 0) m.set(i, s.ratio);
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
    const panes = paneLayout(plotH, rsiOn, macdOn);
    const { priceH, volH, rsiH, macdH } = panes;
    const volTop = PAD.t + panes.volTop;
    const rsiTop = PAD.t + panes.rsiTop;
    const macdTop = PAD.t + panes.macdTop;
    const [i0, i1] = visible(view, n);
    const prices: number[] = [];
    const fitValues: number[] = [];
    let vmax = 0;
    for (let i = i0; i <= i1; i++) {
      const c = candles[i];
      prices.push(...(mode === "candles" ? [c.l, c.h, c.o, c.c] : [c.c]));
      vmax = Math.max(vmax, c.v);
    }
    if (prevClose != null) {
      fitValues.push(prevClose);
    }
    // Keep overlays in view.
    if (analysis && show) {
      const fit = [
        ...(show.mas ? analysis.series.mas : []),
        ...(show.bollinger ? analysis.series.bollinger : []),
        ...(show.vwap ? [analysis.series.vwap] : []),
      ];
      for (const line of fit.filter((l) => l.visible)) {
        for (let i = i0; i <= i1; i++) {
          const v = valueAt(line, i);
          if (v != null) {
            fitValues.push(v);
          }
        }
      }
    }
    for (const t of targetLevels) fitValues.push(t.price);
    const base = candles[i0]?.c ?? 0;
    const { lo, hi, scale: activeScale } = fitScale(prices, fitValues, scale, base);
    const step = plotW / Math.max(view.count, 1);
    const start = view.start;
    return {
      n,
      i0,
      i1,
      step,
      lo,
      hi,
      vmax,
      scale: activeScale,
      base,
      label: (v: number) => scaleLabel(v, activeScale, base),
      plotW,
      priceH,
      volTop,
      volH,
      rsiTop,
      rsiH,
      macdTop,
      macdH,
      x: (i: number) => PAD.l + step * (i - start + 0.5),
      y: (v: number) => PAD.t + (1 - forward(v, lo, hi, activeScale)) * priceH,
      vy: (v: number) => volTop + volH - (vmax > 0 ? (v / vmax) * volH : 0),
      ry: (v: number) => rsiTop + (1 - v / 100) * rsiH,
    };
  });

  const trendUp = $derived.by(() => {
    if (candles.length === 0) return true;
    const base = prevClose ?? candles[0].o;
    return candles[candles.length - 1].c >= base;
  });

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
    if (shadeSessions && hasExtended) {
      clipPlot(ctx);
      ctx.fillStyle = v("--ext-shade");
      candles.forEach((_, i) => {
        if (isExtendedSession(sessions[i])) ctx.fillRect(g.x(i) - g.step / 2, PAD.t, g.step + 0.5, bottom - PAD.t);
      });
      ctx.restore();
    }

    // Grid and price axis.
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (const t of scaleTicks(g.lo, g.hi, g.scale, g.base, 4)) {
      const y = Math.round(g.y(t)) + 0.5;
      if (y < PAD.t || y > g.volTop) continue;
      ctx.strokeStyle = v("--grid");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(width - PAD.r, y);
      ctx.stroke();
      ctx.fillStyle = v("--muted");
      ctx.fillText(g.label(t), width - PAD.r + 8, y);
    }

    // Time axis: about one label per 110 px.
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = v("--muted");
    if (g.n > 0 && chart) {
      const every = Math.max(1, Math.ceil(view.count / Math.max(1, Math.floor(g.plotW / 110))));
      const off = Math.floor(every / 2);
      for (let i = off + Math.ceil((g.i0 - off) / every) * every; i <= g.i1; i += every) {
        const x = g.x(i);
        if (x < PAD.l || x > width - PAD.r) continue;
        ctx.fillText(axisTime(candles[i].t, displayOffset(candles[i].t, timeZone, clock, chart.interval), chart.range, chart.interval), x, height - 6);
      }
    }

    // Volume.
    clipPlot(ctx);
    const bw = Math.max(1, g.step * 0.65);
    candles.forEach((c, i) => {
      ctx.fillStyle = c.c >= c.o ? up : down;
      ctx.globalAlpha = 0.28;
      const y = g.vy(c.v);
      ctx.fillRect(g.x(i) - bw / 2, y, bw, g.volTop + g.volH - y);
    });
    ctx.globalAlpha = 1;

    if (g.scale === "log") {
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD.l - 4, PAD.t, g.plotW + 8, g.priceH);
      ctx.clip();
    }

    if (g.scale === "percent") {
      const y = Math.round(g.y(g.base)) + 0.5;
      ctx.strokeStyle = v("--muted");
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(width - PAD.r, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

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
    ctx.restore();

    if (g.scale === "log") ctx.restore();

    if (show && analysis) drawOverlays(ctx, g, v);

    clipPlot(ctx);
    const stacked = new Map<number, number>();
    for (const [color, at] of [
      ["--accent", earningsAt],
      ["--rating", ratingsAt],
      ["--news", newsAt],
      ["--dividend", dividendsAt],
      ["--split", splitsAt],
    ] as const) {
      ctx.fillStyle = v(color);
      for (const i of at.keys()) {
        const k = stacked.get(i) ?? 0;
        stacked.set(i, k + 1);
        ctx.beginPath();
        const y = PAD.t + g.priceH - 5 - 10 * k;
        ctx.arc(g.x(i), y, 4, 0, Math.PI * 2);
        ctx.fill();
        const tone = at === newsAt ? netSentiment(newsAt.get(i)!.map((a) => a.sentiment)) : "neutral";
        if (tone !== "neutral") {
          ctx.fillStyle = v(tone === "positive" ? "--up" : "--down");
          ctx.beginPath();
          ctx.arc(g.x(i), y, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = v(color);
        }
      }
    }
    ctx.restore();

    drawDrawings(ctx, v);

    // Crosshair.
    if (hover != null && candles[hover] && (g.scale !== "log" || candles[hover].c > 0)) {
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
      const label = g.label(c.c);
      ctx.fillStyle = v("--text");
      ctx.fillRect(width - PAD.r + 2, y - 9, PAD.r - 4, 18);
      ctx.fillStyle = v("--bg");
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label, width - PAD.r + 8, y);
    }
  }

  type Geo = typeof geo;

  function clipPlot(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.l - 4, 0, geo.plotW + 8, height);
    ctx.clip();
  }

  /** Strokes a series in two parts: dashed during warm-up, solid after. */
  function strokeLine(ctx: CanvasRenderingContext2D, line: Line, y: (v: number) => number, g: Geo) {
    for (const warm of [true, false]) {
      ctx.setLineDash(warm ? [3, 3] : []);
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < g.n; i++) {
        const k = align[i];
        const val = valueAt(line, i);
        if (val == null || (y === g.y && g.scale === "log" && val <= 0) || (warm ? k > line.full_from : k < line.full_from)) {
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

    // Moving averages, bands and VWAP, with a legend.
    ctx.font = `10px ${v("--font")}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let lx = PAD.l + 4;
    const legend = (label: string, col: string) => {
      ctx.fillStyle = col;
      ctx.fillText(label, lx, PAD.t + 2);
      lx += ctx.measureText(label).width + 10;
    };
    if (s.bollinger) {
      const [up, mid, lo] = a.series.bollinger;
      const pts = (line: Line) =>
        [...Array(g.n).keys()].flatMap((i) => {
          const val = valueAt(line, i);
          return val == null ? [] : [[g.x(i), g.y(val)]];
        });
      const band = [...pts(up), ...pts(lo).reverse()];
      if (band.length) {
        ctx.beginPath();
        band.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = up.color ? `${up.color}18` : v("--bb-fill");
        ctx.fill();
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = mid.color || v("--bb");
      for (const line of [up, mid, lo]) strokeLine(ctx, line, g.y, g);
      legend(mid.label, mid.color || v("--bb"));
    }
    if (s.mas) {
      ctx.lineWidth = 1.2;
      a.series.mas.forEach((line, k) => {
        if (!line.visible) return;
        const col = line.color || v(`--ma-${k % 5 + 1}`);
        ctx.strokeStyle = col;
        strokeLine(ctx, line, g.y, g);
        legend(line.label, col);
      });
    }
    if (s.vwap) {
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = (a.series.vwap.color || v("--vwap"));
      strokeLine(ctx, a.series.vwap, g.y, g);
      legend(a.series.vwap.label, (a.series.vwap.color || v("--vwap")));
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
      if (y >= PAD.t && y <= priceBottom) axisTag(ctx, y, g.label(t.price), v(t.color), v("--bg"));
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
      ctx.strokeStyle = (a.series.rsi.color || v("--rsi"));
      ctx.lineWidth = 1.3;
      strokeLine(ctx, a.series.rsi, g.ry, g);
      ctx.restore();
      const lastRsi = a.series.rsi.values[a.series.rsi.values.length - 1];
      ctx.fillStyle = (a.series.rsi.color || v("--rsi"));
      ctx.textBaseline = "top";
      ctx.fillText(`${a.series.rsi.label}${lastRsi != null ? `  ${num(lastRsi, 1)}` : ""}`, PAD.l + 4, top + 2);
    }
    if (s.macd) {
      const [line, signal, histogram] = a.series.macd;
      let extent = 1e-9;
      for (const l of a.series.macd) {
        for (let i = g.i0; i <= g.i1; i++) extent = Math.max(extent, Math.abs(valueAt(l, i) ?? 0));
      }
      const y = (value: number) => g.macdTop + g.macdH * (0.5 - value / (extent * 2.4));
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD.l, g.macdTop, g.plotW, g.macdH);
      ctx.clip();
      ctx.strokeStyle = v("--grid");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.l, g.macdTop);
      ctx.lineTo(right, g.macdTop);
      ctx.moveTo(PAD.l, y(0));
      ctx.lineTo(right, y(0));
      ctx.stroke();
      for (let i = g.i0; i <= g.i1; i++) {
        const value = valueAt(histogram, i);
        if (value == null) continue;
        ctx.fillStyle = histogram.color || v(value >= 0 ? "--up" : "--down");
        ctx.globalAlpha = 0.5;
        ctx.fillRect(g.x(i) - g.step * 0.3, Math.min(y(value), y(0)), Math.max(1, g.step * 0.6), Math.abs(y(value) - y(0)));
      }
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = line.color || v("--rsi");
      strokeLine(ctx, line, y, g);
      ctx.strokeStyle = signal.color || v("--ma-2");
      strokeLine(ctx, signal, y, g);
      ctx.fillStyle = line.color || v("--rsi");
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(line.label, PAD.l + 4, g.macdTop + 2);
      ctx.restore();
      ctx.fillStyle = v("--muted");
      ctx.textBaseline = "middle";
      ctx.fillText("0", right + 8, y(0));
    }
    ctx.font = `11px ${v("--font")}`;
  }

  $effect(() => {
    // Redraw when any of these change.
    void [redrawKey, list, preview, selected, tool, candles, mode, width, height, hover, geo, sessions, shadeSessions, timeZone, analysis, show && { ...show }, earningsAt, ratingsAt, newsAt, dividendsAt, splitsAt];
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

  let shownMode: ChartMode | null = null;
  $effect(() => {
    if (shownMode && shownMode !== mode) fadeIn(canvas);
    shownMode = mode;
  });

  // Reset hover when the data changes.
  $effect(() => {
    void chart;
    hover = null;
  });

  let viewKey = "";
  let viewN = 0;
  $effect(() => {
    const key = chart ? `${chart.meta.symbol} ${chart.range} ${chart.interval}` : "";
    const n = candles.length;
    view = key === viewKey ? follow(untrack(() => view), viewN, n) : full(n);
    viewKey = key;
    viewN = n;
  });

  $effect(() => {
    const el = wrap;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  function onWheel(e: WheelEvent) {
    if (geo.n === 0) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? width : 1;
    const dx = e.deltaX || (e.shiftKey ? e.deltaY : 0);
    const r = wrap!.getBoundingClientRect();
    if (!e.ctrlKey && (e.shiftKey || Math.abs(dx) >= Math.abs(e.deltaY))) view = pan(view, geo.n, (dx * unit) / geo.step);
    else view = zoom(view, geo.n, Math.exp(e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015)), (e.clientX - r.left - PAD.l) / geo.plotW);
    onMove(e);
  }

  function resetView() {
    view = full(candles.length);
    hover = null;
  }

  type Tool = "cursor" | "hline" | "trend" | "text" | "ruler" | "pen";
  const tools: { tool: Tool; label: string }[] = [
    { tool: "cursor", label: "Cursor" },
    { tool: "hline", label: "Level" },
    { tool: "trend", label: "Trend" },
    { tool: "text", label: "Text" },
    { tool: "ruler", label: "Ruler" },
    { tool: "pen", label: "Pen" },
  ];
  let tool = $state<Tool>("cursor");
  let selected = $state<number | null>(null);
  let history = $state<History>({ past: [], present: [], future: [] });
  let preview = $state<Drawing | null>(null);
  let editing = $state<{ point: DrawingPoint; x: number; y: number } | null>(null);
  let inputText = $state("");
  let gesture: { start: Pixel; original: Drawing | null; endpoint: number; moved: boolean; second: boolean } | null = null;
  const drawingSymbol = $derived(chart?.meta.symbol.toUpperCase() ?? "");
  const list = $derived(drawings[drawingSymbol] ?? []);
  const times = $derived(candles.map((c) => c.t));
  $effect(() => {
    void drawingSymbol;
    untrack(() => {
      history = { past: [], present: list, future: [] };
      cancelDrawing();
      selected = null;
    });
  });

  function cancelDrawing() {
    tool = "cursor";
    preview = null;
    editing = null;
    gesture = null;
    dragX = null;
  }

  export function drawTool(next: Tool) {
    if (!chart) return;
    chooseTool(tool === next ? "cursor" : next);
  }

  function chooseTool(next: Tool) {
    cancelDrawing();
    tool = next;
    selected = null;
    hover = null;
    wrap?.focus();
  }

  async function changeDrawings(action: Drawing[] | "undo" | "redo") {
    if (drawingBusy) return;
    const symbol = drawingSymbol;
    const next = undoReducer({ ...history, present: list }, action);
    if (next.present === list) return;
    if (await saveDrawings(symbol, next.present) && drawingSymbol === symbol) history = next;
  }

  function removeDrawing() {
    if (selected == null || drawingBusy) return;
    void changeDrawings(list.filter((d) => d.id !== selected));
    selected = null;
  }

  function addDrawing(d: Drawing) {
    if (list.length >= 200) { cancelDrawing(); return; }
    const ids = new Set(list.map((d) => d.id));
    let id = 0;
    while (ids.has(id)) id++;
    void changeDrawings([...list, { ...d, id }]);
    cancelDrawing();
  }

  function pixel(e: MouseEvent): Pixel {
    const r = wrap!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function anchor(p: Pixel): DrawingPoint {
    return {
      t: Math.round(indexToTime(times, view.start + (p.x - PAD.l) / geo.step - 0.5)),
      price: inverse(1 - (p.y - PAD.t) / geo.priceH, geo.lo, geo.hi, geo.scale),
    };
  }

  function screen(p: DrawingPoint): Pixel {
    return { x: geo.x(timeToIndex(times, p.t)), y: geo.y(p.price) };
  }

  function inPlot(p: Pixel) {
    return p.x >= PAD.l && p.x <= width - PAD.r && p.y >= PAD.t && p.y <= PAD.t + geo.priceH;
  }

  function hitDrawing(p: Pixel) {
    const ctx = canvas?.getContext("2d");
    if (ctx) ctx.font = `11px ${getComputedStyle(canvas!).getPropertyValue("--font")}`;
    for (const d of [...list].reverse()) {
      if (d.kind === "pen") {
        if (hitPolyline(p, d.points.map(screen))) return { drawing: d, endpoint: -1 };
        continue;
      }
      const a = screen(d.points[0]);
      if (d.kind === "hline" && hitTest(p, a)) return { drawing: d, endpoint: -1 };
      if (d.kind === "text" && inPlot(a) && p.x >= a.x - 6 && p.x <= a.x + (ctx?.measureText(d.text).width ?? 0) + 6 && Math.abs(p.y - a.y) <= 12) return { drawing: d, endpoint: -1 };
      if (d.kind === "trend") {
        const b = screen(d.points[1]);
        if (d.id === selected) {
          for (const [i, point] of [a, b].entries()) if (segmentDistance(p, point, point) <= 6) return { drawing: d, endpoint: i };
        }
        if (hitTest(p, a, b)) return { drawing: d, endpoint: -1 };
      }
    }
    return null;
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0 || geo.n === 0 || (e.target as Element).closest(".exports, .drawing-tools, input")) return;
    wrap!.focus();
    const p = pixel(e);
    if (!inPlot(p)) {
      if (tool === "cursor") { dragX = e.clientX; wrap!.setPointerCapture(e.pointerId); }
      return;
    }
    if (drawingBusy) return;
    if (tool === "cursor") {
      wrap!.setPointerCapture(e.pointerId);
      hover = null;
      const hit = hitDrawing(p);
      selected = hit?.drawing.id ?? null;
      if (hit) gesture = { start: p, original: hit.drawing, endpoint: hit.endpoint, moved: false, second: false };
      else dragX = e.clientX;
      return;
    }
    const point = anchor(p);
    if (!Number.isFinite(point.price) || point.price <= 0) return;
    wrap!.setPointerCapture(e.pointerId);
    hover = null;
    if (tool === "pen") {
      preview = { id: 0, kind: "pen", points: [point], text: "" };
      gesture = { start: p, original: null, endpoint: -1, moved: false, second: false };
      return;
    }
    if (tool === "hline") { addDrawing({ id: 0, kind: "hline", points: [point], text: "" }); return; }
    if (tool === "text") {
      editing = { point, x: Math.min(p.x, Math.max(PAD.l, width - 220)), y: p.y };
      inputText = "";
      return;
    }
    if (tool === "trend" || tool === "ruler") {
      const second = preview != null;
      if (!preview) preview = { id: 0, kind: "trend", points: [point, point], text: "" };
      else preview = { ...preview, points: [preview.points[0], point] };
      gesture = { start: p, original: null, endpoint: -1, moved: false, second };
      return;
    }
  }

  function extendStroke(p: Pixel) {
    if (!preview || !gesture) return;
    gesture.moved ||= Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > 3;
    const c = { x: Math.max(PAD.l, Math.min(width - PAD.r, p.x)), y: Math.max(PAD.t, Math.min(PAD.t + geo.priceH, p.y)) };
    const from = screen(preview.points[preview.points.length - 1]);
    if (Math.hypot(c.x - from.x, c.y - from.y) < 1 || preview.points.length >= 2000) return;
    const point = anchor(c);
    if (!Number.isFinite(point.price) || point.price <= 0) return;
    preview = { ...preview, points: [...preview.points, point] };
  }

  function finishStroke() {
    const stroke = preview;
    const moved = gesture?.moved;
    preview = null;
    gesture = null;
    if (!stroke || !moved) return;
    const points = simplifyPath(stroke.points, screen);
    if (points.length < 2) return;
    addDrawing({ ...stroke, points });
    tool = "pen";
  }

  function moveDrawing(e: MouseEvent): boolean {
    if (!gesture && !preview) return false;
    const p = pixel(e);
    if (tool === "pen" && preview && !gesture?.original) {
      extendStroke(p);
      hover = null;
      return true;
    }
    const point = anchor(p);
    if (!Number.isFinite(point.price) || point.price <= 0) return true;
    if (gesture) gesture.moved ||= Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > 3;
    if (gesture?.original) {
      if (!gesture.moved) return true;
      const { original, endpoint, start } = gesture;
      const points = original.points.map((a, i) => {
        if (endpoint >= 0) return i === endpoint ? point : a;
        const old = screen(a);
        return anchor({ x: old.x + p.x - start.x, y: old.y + p.y - start.y });
      });
      if (points.every((a) => a.price > 0 && Number.isFinite(a.price))) preview = { ...original, points };
    } else if (preview) preview = { ...preview, points: [preview.points[0], point] };
    hover = null;
    return true;
  }

  function onUp(e: PointerEvent) {
    if (gesture) {
      moveDrawing(e);
      if (gesture.original) {
        if (gesture.moved && preview) void changeDrawings(list.map((d) => d.id === preview!.id ? preview! : d));
        preview = null;
      } else if (tool === "pen") finishStroke();
      else if (tool === "ruler") cancelDrawing();
      else if (preview && (gesture.moved || gesture.second)) addDrawing(preview);
      gesture = null;
    }
    dragX = null;
    if (wrap?.hasPointerCapture(e.pointerId)) wrap.releasePointerCapture(e.pointerId);
  }

  function focusInput(input: HTMLInputElement) { input.focus(); }

  function textKey(e: KeyboardEvent) {
    if (e.key !== "Enter" && e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Enter" && editing && inputText.trim() && Array.from(inputText).length <= 200) addDrawing({ id: 0, kind: "text", points: [editing.point], text: inputText });
    else if (e.key === "Escape") cancelDrawing();
    if (!editing) wrap?.focus();
  }

  function drawDrawings(ctx: CanvasRenderingContext2D, v: (name: string) => string) {
    ctx.font = `11px ${v("--font")}`;
    const items = [...list.filter((d) => !preview || !gesture?.original || d.id !== preview.id), ...(preview ? [preview] : [])];
    for (const d of items) {
      const a = screen(d.points[0]);
      const b = d.kind === "trend" ? screen(d.points[1]) : a;
      const path = d.kind === "pen" ? d.points.map(screen) : null;
      const box = path ? pathBounds(path) : { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) };
      const bottom = PAD.t + geo.priceH, right = width - PAD.r;
      if (box.maxY < PAD.t || box.minY > bottom) continue;
      if (d.kind !== "hline" && (box.maxX < PAD.l || box.minX > right)) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD.l, PAD.t, geo.plotW, geo.priceH);
      ctx.clip();
      ctx.strokeStyle = v(d.id === selected ? "--text" : "--muted");
      ctx.fillStyle = v("--text");
      ctx.lineWidth = d.id === selected ? 2 : 1;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      if (d.kind === "text") {
        ctx.fillText(d.text, a.x, a.y);
        if (d.id === selected) ctx.strokeRect(a.x - 2, a.y - 13, ctx.measureText(d.text).width + 4, 16);
      } else if (path) {
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length - 1; i++) ctx.quadraticCurveTo(path[i].x, path[i].y, (path[i].x + path[i + 1].x) / 2, (path[i].y + path[i + 1].y) / 2);
        ctx.lineTo(path[path.length - 1].x, path[path.length - 1].y);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(d.kind === "hline" ? PAD.l : a.x, a.y);
        ctx.lineTo(d.kind === "hline" ? right : b.x, b.y);
        ctx.stroke();
        if (d.kind === "trend" && d.id === selected) for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); }
      }
      if (tool === "ruler" && d === preview) {
        const label = rulerMeasurement(d.points[0], d.points[1], times).label;
        const x = Math.max(PAD.l + 3, Math.min(b.x, right - ctx.measureText(label).width - 3));
        const y = Math.max(PAD.t + 16, Math.min(b.y - 6, bottom));
        ctx.fillStyle = v("--bg");
        ctx.fillRect(x - 2, y - 14, ctx.measureText(label).width + 4, 16);
        ctx.fillStyle = v("--text");
        ctx.fillText(label, x, y);
      }
      ctx.restore();
      if (d.kind === "hline") axisTag(ctx, a.y, geo.label(d.points[0].price), v("--muted"), v("--bg"));
    }
  }

  function onMove(e: MouseEvent) {
    if (moveDrawing(e)) return;
    if (tool !== "cursor" || (e.target instanceof Element && e.target.closest(".drawing-tools, input"))) { hover = null; return; }
    if (dragX != null) {
      view = pan(view, geo.n, (dragX - e.clientX) / geo.step);
      dragX = e.clientX;
      hover = null;
      return;
    }
    const r = wrap!.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (geo.n === 0 || x < PAD.l || x > width - PAD.r) {
      hover = null;
      return;
    }
    hover = Math.max(geo.i0, Math.min(geo.i1, Math.floor(view.start + (x - PAD.l) / geo.step)));
  }

  function onKey(e: KeyboardEvent) {
    if ((e.target as Element).closest("input, textarea, select, [contenteditable]")) return;
    if (!chart) return;
    let handled = true;
    if (e.ctrlKey && e.key.toLowerCase() === "z") { cancelDrawing(); void changeDrawings(e.shiftKey ? "redo" : "undo"); }
    else if ((e.key === "Delete" || e.key === "Backspace") && selected != null) removeDrawing();
    else if (e.key === "Escape" && (tool !== "cursor" || selected != null)) { cancelDrawing(); selected = null; hover = null; }
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); return; }

    if (geo.n === 0 || e.ctrlKey || e.altKey || e.metaKey) return;
    const anchor = hover == null ? 1 : (hover + 0.5 - view.start) / view.count;
    if (e.key === "ArrowLeft") hover = hover == null ? geo.i1 : Math.max(0, hover - 1);
    else if (e.key === "ArrowRight") hover = hover == null ? geo.i0 : Math.min(geo.n - 1, hover + 1);
    else if (e.key === "Escape") hover = null;
    else if (e.key === "+" || e.key === "=") view = zoom(view, geo.n, 1 / 1.25, anchor);
    else if (e.key === "-") view = zoom(view, geo.n, 1.25, anchor);
    else if (e.key === "0") resetView();
    else return;
    if (hover != null) view = reveal(view, geo.n, hover);
    e.preventDefault();
    if (/^[-+=0]$/.test(e.key)) e.stopPropagation();
  }

  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  function flash(kind: "image" | "csv") {
    copied = kind;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (copied = null), 1200);
  }

  function copyCsv() {
    navigator.clipboard.writeText(candlesCsv(candles)).then(() => flash("csv"), console.warn);
  }

  function copyImage() {
    if (!canvas) return;
    hover = null;
    draw();
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--bg").trim();
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    const png = new Promise<Blob>((ok, fail) => out.toBlob((b) => (b ? ok(b) : fail(new Error("toBlob failed")))));
    navigator.clipboard.write([new ClipboardItem({ "image/png": png })]).then(() => flash("image"), console.warn);
  }

  const tip = $derived.by(() => {
    if (hover == null || !chart || !candles[hover]) return null;
    const c = candles[hover];
    const x = geo.x(hover);
    const left = x > width / 2;
    const rsi = show?.rsi && analysis ? valueAt(analysis.series.rsi, hover) : null;
    const macd = show?.macd && analysis ? analysis.series.macd.map((line) => ({ label: line.label, value: valueAt(line, hover!) })) : [];
    const pats = show?.patterns ? (patternsAt.get(hover) ?? []) : [];
    return { c, x, left, ext: isExtendedSession(sessions[hover]), rsi, macd, pats, earn: earningsAt.get(hover), grades: ratingsAt.get(hover) ?? [], heads: newsAt.get(hover) ?? [], div: dividendsAt.get(hover), split: splitsAt.get(hover) };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="chart"
  class:dragging={dragX != null}
  bind:this={wrap}
  tabindex="0"
  role="img"
  aria-label={chart ? `${chart.meta.symbol} ${chart.range} chart` : "chart"}
  onpointerdown={onDown}
  onpointermove={onMove}
  onpointerup={onUp}
  onpointercancel={cancelDrawing}
  onpointerleave={() => (hover = null)}
  ondblclick={(e) => {
    if (!(e.target as Element).closest(".exports, .drawing-tools, input") && tool === "cursor" && selected == null) resetView();
  }}
  onkeydown={onKey}
>
  <canvas bind:this={canvas} style:width="{width}px" style:height="{height}px"></canvas>
  {#if chart}
    <div class="drawing-tools" role="toolbar" aria-label="Drawing tools">
      {#each tools as item}
        <button aria-label={item.label} aria-pressed={tool === item.tool} title={item.label} onclick={() => chooseTool(item.tool)}>{item.label}</button>
      {/each}
      <button aria-label="Undo" aria-pressed={false} title="Undo (Ctrl+Z); redo (Ctrl+Shift+Z)" disabled={!history.past.length || drawingBusy} onclick={() => { cancelDrawing(); void changeDrawings("undo"); }}>Undo</button>
      <button aria-label="Delete" aria-pressed={false} title="Delete (Delete / Backspace)" disabled={selected == null || drawingBusy} onclick={removeDrawing}>Delete</button>
    </div>
  {/if}
  {#if staleNote}
    <div class="stale-note" role="status">{staleNote}</div>
  {/if}
  {#if editing}
    <input class="drawing-input" aria-label="Drawing text" maxlength="200" style:left={`${editing.x}px`} style:top={`${editing.y}px`} bind:value={inputText} onkeydown={textKey} use:focusInput />
  {/if}
  {#if candles.length}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="exports"
      onpointermove={(e) => {
        e.stopPropagation();
        hover = null;
      }}
    >
      <button class:done={copied === "image"} title="Copy chart image" aria-label="Copy chart image" onclick={copyImage}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M21 16l-5-5-8 8" /></svg>
      </button>
      <button class:done={copied === "csv"} title="Copy candles as CSV" aria-label="Copy candles as CSV" onclick={copyCsv}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h8" /></svg>
      </button>
      {#if !isFull(view, candles.length)}
        <button title="Reset zoom (double-click)" aria-label="Reset zoom" onclick={resetView}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
        </button>
      {/if}
    </div>
  {/if}
  {#if tip && chart}
    <div
      class="tip"
      style:left={tip.left ? "auto" : `${tip.x + 14}px`}
      style:right={tip.left ? `${width - tip.x + 14}px` : "auto"}
    >
      <div class="when">
        {fullTime(tip.c.t, displayOffset(tip.c.t, timeZone, clock, chart.interval), chart.interval)}{#if timeZone === "local" && isIntraday(chart.interval)} {zoneLabel(tip.c.t, timeZone, clock, chart.interval)}{/if}{#if tip.ext}<span class="ext">ext</span>{/if}
      </div>
      <dl>
        <dt>Open</dt><dd>{price(tip.c.o, chart.meta.currency)}</dd>
        <dt>High</dt><dd>{price(tip.c.h, chart.meta.currency)}</dd>
        <dt>Low</dt><dd>{price(tip.c.l, chart.meta.currency)}</dd>
        <dt>Close</dt><dd class={tip.c.c >= tip.c.o ? "up" : "down"}>{tip.c.c > tip.c.o ? "↑" : tip.c.c < tip.c.o ? "↓" : "→"} {price(tip.c.c, chart.meta.currency)}</dd>
        <dt>Volume</dt><dd>{volume(tip.c.v)}</dd>
        {#if tip.rsi != null}<dt>RSI</dt><dd>{num(tip.rsi, 1)}</dd>{/if}
        {#each tip.macd as line}{#if line.value != null}<dt>{line.label}</dt><dd>{num(line.value, 2)}</dd>{/if}{/each}
      </dl>
      {#if tip.earn}
        <div class="earn">
          ● Earnings {quarterLabel(tip.earn.quarter)}{#if tip.earn.eps_actual != null}: EPS {num(tip.earn.eps_actual)}{#if tip.earn.eps_estimate != null}
              vs {num(tip.earn.eps_estimate)} est{/if}{/if}
        </div>
      {/if}
      {#each tip.grades as r, k (k)}
        <div class="grade">
          ● {r.firm}: {r.from && r.action !== "init" ? `${r.from} → ${r.to}` : `initiates ${r.to}`}{#if r.target != null}
            · PT {price(r.target, chart.meta.currency)}{/if}
        </div>
      {/each}
      {#each tip.heads as a (a.link)}
        <div class="head">● {a.title}</div>
      {/each}
      {#if tip.div != null}<div class="div">● Dividend {price(tip.div, chart.meta.currency)}</div>{/if}
      {#if tip.split}<div class="split">● Split {tip.split}</div>{/if}
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
    touch-action: none;
    user-select: none;
  }
  .chart.dragging {
    cursor: grabbing;
  }
  .chart:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent);
    border-radius: 6px;
  }
  canvas {
    position: absolute;
    inset: 0;
  }
  .drawing-tools {
    position: absolute;
    top: 5px;
    left: 6px;
    display: flex;
    gap: 2px;
    cursor: default;
  }
  .drawing-tools button {
    border: 0;
    border-radius: 4px;
    padding: 3px 5px;
    font-size: 10px;
    background: var(--bg);
    color: var(--muted);
  }
  .drawing-tools button[aria-pressed="true"] { background: var(--surface); color: var(--text); }
  .drawing-tools button:disabled { opacity: 0.4; }
  .drawing-input { position: absolute; width: 200px; z-index: 2; }
  .stale-note {
    position: absolute;
    left: 8px;
    bottom: 30px;
    max-width: min(420px, calc(100% - 16px));
    padding: 3px 8px;
    border-left: 2px solid #ffb340;
    border-radius: 4px;
    background: var(--tooltip-bg);
    color: var(--muted);
    font-size: 11px;
    line-height: 1.35;
    pointer-events: none;
  }
  .exports {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 2px;
    cursor: default;
    opacity: 0;
    transition: opacity var(--motion-fast) var(--ease-out);
  }
  .chart:hover .exports,
  .exports:focus-within {
    opacity: 1;
  }
  .exports button {
    width: 22px;
    height: 22px;
    padding: 3px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .exports button.done,
  .exports button.done:hover {
    color: var(--up);
  }
  .exports button:hover {
    background: var(--surface);
    color: var(--text);
  }
  .exports svg {
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .tip {
    position: absolute;
    top: 38px;
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
  .earn {
    margin-top: 3px;
    font-weight: 600;
    color: var(--accent);
  }
  .grade {
    margin-top: 3px;
    font-weight: 600;
    color: var(--rating);
  }
  .div,
  .split {
    margin-top: 3px;
    font-weight: 600;
    color: var(--dividend);
  }
  .split {
    color: var(--split);
  }
  .head {
    margin-top: 3px;
    max-width: 280px;
    font-weight: 600;
    color: var(--news);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
