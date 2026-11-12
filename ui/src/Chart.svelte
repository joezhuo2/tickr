<script lang="ts">
  import { alignTimes, axisTime, candleAt, candlesCsv, fullTime, netSentiment, num, price, quarterLabel, volume } from "./lib/format";
  import { candleCountdown, classifyBars, displayOffset, isExtendedSession, isIntraday, zoneLabel, type Clock } from "./lib/session";
  import type { Analysis, Article, Chart, ChartMode, ChartScale, ChartTimeZone, EarningsReport, Line, Overlays, Pattern, RatingChange } from "./lib/types";
  import { fitScale, forward, inverse, scaleLabel, scaleTicks, shiftRange, stretchRange } from "./lib/scale";
  import type { Drawing, DrawingPoint } from "./lib/types";
  import { DRAWING_COLORS, POINT_COUNT, arrowHead, channelLines, fibExtLevels, pitchforkLines, snapPrice, anchoredVwap, fibLevels, hitBox, positionLevels, rayEnd, timeToIndex, indexToTime, hitTest, hitPolyline, pathBounds, segmentDistance, simplifyPath, undoReducer, rulerMeasurement, type History, type Pixel } from "./lib/drawing";
  import { legendText, volumeProfile, paneLayout } from "./lib/indicators";
  import { untrack } from "svelte";
  import { ichimoku, obv, pivotPeriod, pivots, stochastic, supertrend } from "./lib/studies";
  import { studies } from "./lib/studyStore.svelte";
  import { displayCandles, isOhlc } from "./lib/charttypes";
  import { fadeIn } from "./lib/motion";
  import { follow, full, isFull, pan, reveal, visible, zoom, type View } from "./lib/viewport";
  import { barAt, viewWindow, windowView, type TimeWindow } from "./lib/chartsync";

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
    linkedTime = null,
    onhovertime,
    linkedWindow = null,
    onwindow,
    replay = false,
    fills = [],
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
    linkedTime?: number | null;
    onhovertime?: (t: number | null) => void;
    linkedWindow?: TimeWindow | null;
    onwindow?: (w: TimeWindow) => void;
    replay?: boolean;
    fills?: { t: number; side: "buy" | "sell"; price: number }[];
  } = $props();

  let wrap: HTMLDivElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let width = $state(0);
  let height = $state(0);
  let hover = $state<number | null>(null);
  let copied = $state<"image" | "csv" | null>(null);
  let view = $state<View>(full(0));
  let dragX = $state<number | null>(null);
  let dragY = 0;
  let axisY: number | null = null;
  let manual = $state<{ lo: number; hi: number } | null>(null);

  const PAD = { l: 6, r: 62, t: 38, b: 22 };

  let nowSec = $state(Date.now() / 1000);
  const countdown = $derived(chart && !replay ? candleCountdown(chart.interval, chart.candles[chart.candles.length - 1]?.t, nowSec) : null);
  $effect(() => {
    if (!chart || replay || !isIntraday(chart.interval)) return;
    const tick = setInterval(() => (nowSec = Date.now() / 1000), 1000);
    return () => clearInterval(tick);
  });

  const candles = $derived(displayCandles(chart?.candles ?? [], mode));
  const ohlc = $derived(isOhlc(mode));
  const isDay = $derived(chart?.range === "1d");
  const prevClose = $derived(isDay ? (chart?.meta.prev_close ?? null) : null);
  const clock = $derived<Clock>({ timezone: chart?.meta.timezone, gmtoffset: chart?.meta.gmtoffset ?? 0 });
  const sessions = $derived(chart ? classifyBars(candles.map((c) => c.t), clock, chart.meta.periods, chart.interval) : []);
  const hasExtended = $derived(sessions.some(isExtendedSession));

  // Analysis overlays: only when there is an analysis and a toggle set.
  const show = $derived(analysis && overlays ? overlays : null);
  const stoch = $derived(studies.stoch ? stochastic(candles) : null);
  const ichi = $derived(studies.ichimoku ? ichimoku(candles) : null);
  const trendLine = $derived(studies.supertrend ? supertrend(candles) : null);
  const onBalance = $derived(studies.obv ? obv(candles) : null);
  const pivotLevels = $derived(studies.pivots && chart ? pivots(candles, pivotPeriod(chart.interval, chart.meta.gmtoffset ?? 0)) : null);
  let legendY = 0;
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
  const fillMarks = $derived.by(() => {
    const times = candles.map((c) => c.t);
    return fills.flatMap((f) => {
      const i = candleAt(times, f.t);
      return i >= 0 ? [{ i, buy: f.side === "buy", price: f.price }] : [];
    });
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
    const panes = paneLayout(plotH, rsiOn, macdOn, Number(!!stoch) + Number(!!onBalance));
    const stochTop = PAD.t + (panes.extraTops[0] ?? 0);
    const obvTop = PAD.t + (panes.extraTops[stoch ? 1 : 0] ?? 0);
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
      prices.push(...(ohlc ? [c.l, c.h, c.o, c.c] : [c.c]));
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
        ...(show.opening_range ? analysis.series.opening_range.slice(0, 2) : []),
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
    const fit = fitScale(prices, fitValues, scale, base);
    const activeScale = fit.scale;
    const { lo, hi } = manual ?? fit;
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
      stochTop,
      obvTop,
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

    if (ohlc) {
      candles.forEach((c, i) => {
        if (i < g.i0 - 1 || i > g.i1 + 1) return;
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
        if (mode === "bars") {
          ctx.beginPath();
          ctx.moveTo(x - bw / 2, Math.round(g.y(c.o)) + 0.5);
          ctx.lineTo(x, Math.round(g.y(c.o)) + 0.5);
          ctx.moveTo(x, Math.round(g.y(c.c)) + 0.5);
          ctx.lineTo(x + bw / 2, Math.round(g.y(c.c)) + 0.5);
          ctx.stroke();
        } else if (mode === "hollow" && c.c >= c.o && bw >= 3) {
          ctx.clearRect(x - bw / 2, top, bw, h);
          ctx.strokeRect(Math.round(x - bw / 2) + 0.5, Math.round(top) + 0.5, Math.max(1, Math.round(bw) - 1), Math.max(1, Math.round(h) - 1));
        } else ctx.fillRect(x - bw / 2, top, bw, h);
      });
    } else if (g.n > 0) {
      const priceBottom = PAD.t + g.priceH;
      const baseY = mode === "baseline" ? Math.round(g.y(prevClose ?? g.base)) + 0.5 : priceBottom;
      for (const above of mode === "baseline" ? [true, false] : [true]) {
        const col = mode === "baseline" ? (above ? up : down) : mode === "area" ? v("--accent") : trendUp ? up : down;
        ctx.save();
        if (mode === "baseline") {
          ctx.beginPath();
          ctx.rect(0, above ? 0 : baseY, width, above ? baseY : height - baseY);
          ctx.clip();
        }
        ctx.beginPath();
        candles.forEach((c, i) => (i === 0 ? ctx.moveTo(g.x(i), g.y(c.c)) : ctx.lineTo(g.x(i), g.y(c.c))));
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.6;
        ctx.lineJoin = "round";
        ctx.stroke();
        ctx.lineTo(g.x(g.n - 1), baseY);
        ctx.lineTo(g.x(0), baseY);
        ctx.closePath();
        if (mode === "line") {
          const grad = ctx.createLinearGradient(0, PAD.t, 0, priceBottom);
          grad.addColorStop(0, col);
          grad.addColorStop(1, "transparent");
          ctx.fillStyle = grad;
        } else ctx.fillStyle = col;
        ctx.globalAlpha = 0.18;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();
      }
      if (mode === "baseline") {
        ctx.strokeStyle = v("--muted");
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(PAD.l, baseY);
        ctx.lineTo(width - PAD.r, baseY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();

    if (g.scale === "log") ctx.restore();

    legendY = PAD.t + 2;
    if (show && analysis) drawOverlays(ctx, g, v);
    drawStudies(ctx, g, v);

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

    if (fillMarks.length) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD.l - 4, PAD.t, g.plotW + 8, g.priceH);
      ctx.clip();
      ctx.strokeStyle = v("--bg");
      ctx.lineWidth = 1;
      for (const m of fillMarks) {
        if (m.i < g.i0 || m.i > g.i1) continue;
        const x = g.x(m.i);
        const y = g.y(m.price);
        const dir = m.buy ? 1 : -1;
        ctx.fillStyle = v(m.buy ? "--up" : "--down");
        ctx.beginPath();
        ctx.moveTo(x, y + dir * 2);
        ctx.lineTo(x - 5, y + dir * 10);
        ctx.lineTo(x + 5, y + dir * 10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

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
      if (!ohlc) {
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
    } else if (hover == null && linkedIndex >= g.i0 && linkedIndex <= g.i1) {
      const x = Math.round(g.x(linkedIndex)) + 0.5;
      ctx.strokeStyle = v("--crosshair");
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, PAD.t);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.setLineDash([]);
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
    let ly = PAD.t + 2;
    const at = hover != null && candles[hover] ? hover : g.i1;
    const legend = (label: string, col: string, lines: Line[]) => {
      const text = legendText(label, lines.map((l) => (l.visible ? valueAt(l, at) : null)));
      const w = ctx.measureText(text).width;
      if (lx + w > right && lx > PAD.l + 4) { lx = PAD.l + 4; ly += 12; }
      ctx.fillStyle = col;
      ctx.fillText(text, lx, ly);
      lx += w + 10;
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
      legend(mid.label, mid.color || v("--bb"), [up, mid, lo]);
    }
    if (s.mas) {
      ctx.lineWidth = 1.2;
      a.series.mas.forEach((line, k) => {
        if (!line.visible) return;
        const col = line.color || v(`--ma-${k % 5 + 1}`);
        ctx.strokeStyle = col;
        strokeLine(ctx, line, g.y, g);
        legend(line.label, col, [line]);
      });
    }
    if (s.vwap) {
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = (a.series.vwap.color || v("--vwap"));
      strokeLine(ctx, a.series.vwap, g.y, g);
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.55;
      for (const band of a.series.vwap_bands) if (band.visible) strokeLine(ctx, band, g.y, g);
      ctx.globalAlpha = 1;
      legend(a.series.vwap.label, (a.series.vwap.color || v("--vwap")), [a.series.vwap]);
    }
    if (s.opening_range && a.series.opening_range.some((l) => l.values.some((x) => x != null))) {
      const col = a.series.opening_range[0].color || v("--or");
      const [orHigh, orLow] = a.series.opening_range;
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.08;
      let box: [number, number, number][] = [];
      for (let i = 0; i <= g.n; i++) {
        const hi = i < g.n ? valueAt(orHigh, i) : null;
        const lo = i < g.n ? valueAt(orLow, i) : null;
        if (hi != null && lo != null) {
          box.push([g.x(i), g.y(hi), g.y(lo)]);
          continue;
        }
        if (box.length > 1) {
          ctx.beginPath();
          box.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          for (let k = box.length - 1; k >= 0; k--) ctx.lineTo(box[k][0], box[k][2]);
          ctx.closePath();
          ctx.fill();
        }
        box = [];
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col;
      a.series.opening_range.forEach((line, k) => {
        ctx.lineWidth = k < 2 ? 1.4 : 1;
        ctx.globalAlpha = k < 2 ? 1 : 0.6;
        strokeLine(ctx, line, g.y, g);
      });
      ctx.globalAlpha = 1;
      legend(a.series.opening_range[0].label, col, [orHigh, orLow]);
    }

    legendY = lx > PAD.l + 4 ? ly + 12 : ly;

    const profile = s.volume_profile ? volumeProfile(candles, g.i0, g.i1) : null;
    if (profile) {
      const peak = Math.max(...profile.volumes);
      ctx.fillStyle = v("--muted");
      profile.volumes.forEach((vol, k) => {
        const top = g.y(profile.lo + (k + 1) * profile.step);
        const bottom = g.y(profile.lo + k * profile.step);
        const w = peak > 0 ? (vol / peak) * g.plotW * 0.25 : 0;
        ctx.globalAlpha = vol === peak ? 0.45 : 0.2;
        ctx.fillRect(right - w, top, w, Math.max(1, bottom - top - 1));
      });
      ctx.globalAlpha = 1;
    }
    if (s.levels) {
      ctx.lineWidth = 1;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      for (const line of a.series.levels) {
        const col = line.color || v("--levels");
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        strokeLine(ctx, line, g.y, g);
        let at = -1;
        for (let i = g.i1; i >= g.i0 && at < 0; i--) if (valueAt(line, i) != null) at = i;
        if (at < 0) continue;
        const val = valueAt(line, at)!;
        const y = g.y(val);
        if (y >= PAD.t && y <= priceBottom) ctx.fillText(`${line.label} ${num(val)}`, Math.min(g.x(at), right) - 4, y - 2);
      }
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
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
          const y = g.y(ohlc ? c.l : c.c) + 5;
          ctx.fillStyle = v("--up");
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - sz, y + sz * 1.6);
          ctx.lineTo(x + sz, y + sz * 1.6);
          ctx.fill();
        }
        if (bear) {
          const y = g.y(ohlc ? c.h : c.c) - 5;
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

    if (s.volume_ma) {
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = a.series.volume_ma.color || v("--vol-ma");
      strokeLine(ctx, a.series.volume_ma, (x) => Math.max(g.vy(x), g.volTop), g);
      ctx.setLineDash([]);
    }

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
      ctx.fillStyle = (a.series.rsi.color || v("--rsi"));
      ctx.textBaseline = "top";
      ctx.fillText(legendText(a.series.rsi.label, [valueAt(a.series.rsi, at)], 1), PAD.l + 4, top + 2);
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
      ctx.fillText(legendText(line.label, a.series.macd.map((l) => valueAt(l, at)), 2), PAD.l + 4, g.macdTop + 2);
      ctx.restore();
      ctx.fillStyle = v("--muted");
      ctx.textBaseline = "middle";
      ctx.fillText("0", right + 8, y(0));
    }
    ctx.font = `11px ${v("--font")}`;
  }

  function plot(ctx: CanvasRenderingContext2D, g: Geo, values: (number | null)[], y: (v: number) => number) {
    ctx.beginPath();
    let pen = false;
    for (let i = Math.max(0, g.i0 - 1); i <= Math.min(g.n - 1, g.i1 + 1); i++) {
      const val = values[i];
      if (val == null || !Number.isFinite(val)) { pen = false; continue; }
      if (pen) ctx.lineTo(g.x(i), y(val));
      else ctx.moveTo(g.x(i), y(val));
      pen = true;
    }
    ctx.stroke();
  }

  function drawStudies(ctx: CanvasRenderingContext2D, g: Geo, v: (name: string) => string) {
    if (g.n === 0 || !(stoch || ichi || trendLine || onBalance || pivotLevels)) return;
    const at = hover != null && candles[hover] ? hover : g.i1;
    const right = width - PAD.r;
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.l, PAD.t, g.plotW, g.priceH);
    ctx.clip();
    ctx.font = `10px ${v("--font")}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.lineWidth = 1.2;
    let lx = PAD.l + 4;
    const legend = (text: string, col: string) => {
      const w = ctx.measureText(text).width;
      if (lx + w > right && lx > PAD.l + 4) { lx = PAD.l + 4; legendY += 12; }
      ctx.fillStyle = col;
      ctx.fillText(text, lx, legendY);
      lx += w + 10;
    };
    if (ichi) {
      for (let i = Math.max(1, g.i0); i <= g.i1; i++) {
        const a0 = ichi.spanA[i - 1], a1 = ichi.spanA[i], b0 = ichi.spanB[i - 1], b1 = ichi.spanB[i];
        if (a0 == null || a1 == null || b0 == null || b1 == null) continue;
        ctx.fillStyle = v(a1 >= b1 ? "--up" : "--down");
        ctx.globalAlpha = 0.1;
        ctx.beginPath();
        ctx.moveTo(g.x(i - 1), g.y(a0));
        ctx.lineTo(g.x(i), g.y(a1));
        ctx.lineTo(g.x(i), g.y(b1));
        ctx.lineTo(g.x(i - 1), g.y(b0));
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (const [line, col] of [[ichi.tenkan, "--ma-1"], [ichi.kijun, "--ma-2"], [ichi.spanA, "--up"], [ichi.spanB, "--down"], [ichi.chikou, "--muted"]] as const) {
        ctx.strokeStyle = v(col);
        plot(ctx, g, line, g.y);
      }
      legend(legendText("Ichimoku 9 26 52", [ichi.tenkan[at], ichi.kijun[at], ichi.spanA[at], ichi.spanB[at]]), v("--ma-1"));
    }
    if (trendLine) {
      for (const rising of [true, false]) {
        ctx.strokeStyle = v(rising ? "--up" : "--down");
        plot(ctx, g, trendLine.value.map((val, i) => (trendLine.up[i] === rising ? val : null)), g.y);
      }
      legend(legendText("Supertrend 10 3", [trendLine.value[at]]), v(trendLine.up[at] ? "--up" : "--down"));
    }
    if (pivotLevels) {
      const names = ["p", "r1", "r2", "s1", "s2"] as const;
      ctx.lineWidth = 1;
      for (const name of names) {
        ctx.strokeStyle = v(name === "p" ? "--muted" : name[0] === "r" ? "--down" : "--up");
        ctx.beginPath();
        for (let i = g.i0; i <= g.i1; i++) {
          const level = pivotLevels[i];
          if (!level) continue;
          const y = Math.round(g.y(level[name])) + 0.5;
          ctx.moveTo(g.x(i) - g.step / 2, y);
          ctx.lineTo(g.x(i) + g.step / 2, y);
        }
        ctx.stroke();
        const last = pivotLevels[g.i1];
        if (last) {
          ctx.fillStyle = ctx.strokeStyle;
          ctx.textAlign = "right";
          ctx.textBaseline = "bottom";
          ctx.fillText(`${name.toUpperCase()} ${num(last[name])}`, right - 4, g.y(last[name]) - 2);
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
        }
      }
      legend("Pivots", v("--muted"));
    }
    ctx.restore();

    const pane = (top: number, label: string, col: string) => {
      ctx.strokeStyle = v("--grid");
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(PAD.l, Math.round(top) + 0.5);
      ctx.lineTo(right, Math.round(top) + 0.5);
      ctx.stroke();
      ctx.font = `10px ${v("--font")}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = col;
      ctx.fillText(label, PAD.l + 4, top + 2);
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD.l, top, g.plotW, g.rsiH);
      ctx.clip();
      ctx.lineWidth = 1.3;
    };
    if (stoch) {
      const y = (val: number) => g.stochTop + (1 - val / 100) * g.rsiH;
      pane(g.stochTop, legendText("Stoch 14 3 3", [stoch.k[at], stoch.d[at]], 1), v("--rsi"));
      ctx.strokeStyle = v("--muted");
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      for (const level of [20, 80]) { ctx.moveTo(PAD.l, y(level)); ctx.lineTo(right, y(level)); }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = v("--rsi");
      plot(ctx, g, stoch.k, y);
      ctx.strokeStyle = v("--ma-2");
      plot(ctx, g, stoch.d, y);
      ctx.restore();
    }
    if (onBalance) {
      let lo = Infinity, hi = -Infinity;
      for (let i = g.i0; i <= g.i1; i++) { lo = Math.min(lo, onBalance[i]); hi = Math.max(hi, onBalance[i]); }
      const span = hi - lo || 1;
      pane(g.obvTop, `OBV  ${volume(onBalance[at] ?? 0)}`, v("--accent"));
      ctx.strokeStyle = v("--accent");
      plot(ctx, g, onBalance, (val) => g.obvTop + g.rsiH * (0.92 - ((val - lo) / span) * 0.84));
      ctx.restore();
    }
    ctx.font = `11px ${v("--font")}`;
  }

  $effect(() => {
    // Redraw when any of these change.
    void [stoch, ichi, trendLine, onBalance, pivotLevels, redrawKey, list, preview, selected, tool, hideDrawings, candles, mode, width, height, hover, linkedIndex, geo, sessions, shadeSessions, timeZone, analysis, show && { ...show }, earningsAt, ratingsAt, newsAt, dividendsAt, splitsAt, fillMarks];
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
  let savedView: { key: string; view: View; n: number } | null = null;
  $effect(() => {
    const base = chart ? `${chart.meta.symbol} ${chart.range} ${chart.interval}${mode === "renko" ? " renko" : ""}` : "";
    const key = replay ? `${base} replay` : base;
    const n = candles.length;
    const current = untrack(() => view);
    if (key === viewKey) view = follow(current, viewN, n);
    else if (replay && viewKey === base) {
      savedView = { key: base, view: current, n: viewN };
      view = full(n);
    } else if (!replay && savedView?.key === key) view = follow(savedView.view, savedView.n, n);
    else view = full(n);
    if (key !== viewKey) manual = null;
    if (!replay) savedView = null;
    viewKey = key;
    viewN = n;
  });

  $effect(() => {
    if (!replay) return;
    untrack(() => {
      cancelDrawing();
      selected = null;
      hover = null;
    });
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
    emitWindow();
    onMove(e);
  }

  $effect(() => {
    void scale;
    manual = null;
  });

  function resetView() {
    manual = null;
    view = full(candles.length);
    hover = null;
    emitWindow();
  }

  function emitWindow() {
    if (!onwindow) return;
    const w = viewWindow(times, view);
    if (w) onwindow(w);
  }

  type Tool = "cursor" | "ruler" | Drawing["kind"];
  const tools: { tool: Tool; label: string }[] = [
    { tool: "cursor", label: "Cursor" },
    { tool: "hline", label: "Level" },
    { tool: "trend", label: "Trend" },
    { tool: "text", label: "Text" },
    { tool: "ruler", label: "Ruler" },
    { tool: "pen", label: "Pen" },
    { tool: "rect", label: "Box" },
    { tool: "ray", label: "Ray" },
    { tool: "fib", label: "Fib" },
    { tool: "position", label: "R:R" },
    { tool: "avwap", label: "AVWAP" },
  ];
  const moreTools: { tool: Drawing["kind"]; label: string }[] = [
    { tool: "channel", label: "Channel" },
    { tool: "vline", label: "Vertical line" },
    { tool: "hray", label: "Horizontal ray" },
    { tool: "arrow", label: "Arrow" },
    { tool: "prange", label: "Price range" },
    { tool: "drange", label: "Date range" },
    { tool: "fibext", label: "Fib extension" },
    { tool: "pitchfork", label: "Pitchfork" },
  ];
  const multi = (kind: string) => (POINT_COUNT[kind as Drawing["kind"]] ?? 0) >= 2;
  let placed = 0;
  let tool = $state<Tool>("cursor");
  let selected = $state<number | null>(null);
  let hideDrawings = $state(false);
  let magnet = $state(readMagnet());

  function readMagnet() {
    try { return localStorage.getItem("tickr.magnet") === "1"; } catch { return false; }
  }

  function toggleMagnet() {
    magnet = !magnet;
    try { localStorage.setItem("tickr.magnet", magnet ? "1" : "0"); } catch { /* storage unavailable */ }
  }
  let history = $state<History>({ past: [], present: [], future: [] });
  let preview = $state<Drawing | null>(null);
  let editing = $state<{ point: DrawingPoint; x: number; y: number } | null>(null);
  let inputText = $state("");
  let gesture: { start: Pixel; original: Drawing | null; endpoint: number; moved: boolean; second: boolean } | null = null;
  const drawingSymbol = $derived(chart?.meta.symbol.toUpperCase() ?? "");
  const list = $derived(replay ? [] : (drawings[drawingSymbol] ?? []));
  const selectedDrawing = $derived(selected == null ? null : (list.find((d) => d.id === selected) ?? null));
  const times = $derived(candles.map((c) => c.t));
  const linkedIndex = $derived(linkedTime == null ? -1 : barAt(times, linkedTime));
  $effect(() => {
    const t = hover != null ? (candles[hover]?.t ?? null) : null;
    untrack(() => onhovertime?.(t));
  });
  $effect(() => {
    const w = linkedWindow;
    if (!w) return;
    untrack(() => {
      const next = windowView(times, w);
      if (next) view = next;
    });
  });
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
    placed = 0;
    editing = null;
    gesture = null;
    dragX = null;
    axisY = null;
  }

  export function drawTool(next: Tool) {
    if (!chart || replay) return;
    chooseTool(tool === next ? "cursor" : next);
  }

  function chooseTool(next: Tool) {
    if (replay) return;
    cancelDrawing();
    tool = next;
    selected = null;
    hover = null;
    wrap?.focus();
  }

  async function changeDrawings(action: Drawing[] | "undo" | "redo") {
    if (drawingBusy || replay) return;
    const symbol = drawingSymbol;
    const next = undoReducer({ ...history, present: list }, action);
    if (next.present === list) return;
    if (await saveDrawings(symbol, next.present) && drawingSymbol === symbol) history = next;
  }

  function restyle(patch: Partial<Drawing>) {
    if (selected == null) return;
    void changeDrawings(list.map((d) => (d.id === selected ? { ...d, ...patch } : d)));
  }

  function removeDrawing() {
    if (selected == null || drawingBusy || selectedDrawing?.locked) return;
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

  function anchor(p: Pixel, snap = magnet): DrawingPoint {
    const at = view.start + (p.x - PAD.l) / geo.step - 0.5;
    const priceAt = (y: number) => inverse(1 - (y - PAD.t) / geo.priceH, geo.lo, geo.hi, geo.scale);
    const price = priceAt(p.y);
    return {
      t: Math.round(indexToTime(times, at)),
      price: snap ? snapPrice(price, candles[Math.round(at)], Math.abs(priceAt(p.y - 12) - price)) : price,
    };
  }

  function screen(p: DrawingPoint): Pixel {
    return { x: geo.x(timeToIndex(times, p.t)), y: geo.y(p.price) };
  }

  function avwapPath(d: Drawing): Pixel[] {
    return anchoredVwap(candles, d.points[0].t).flatMap((val, i) => (val == null ? [] : [{ x: geo.x(i), y: geo.y(val) }]));
  }

  function positionTargetY(d: Drawing): number {
    return geo.y(positionLevels(d.points[0].price, d.points[1].price).target);
  }

  function positionRight(a: Pixel, b: Pixel): number {
    return Math.max(a.x, b.x, Math.min(a.x, b.x) + 90);
  }

  function onAxis(p: Pixel) {
    return p.x > width - PAD.r && p.y >= PAD.t && p.y <= PAD.t + geo.priceH;
  }

  function inPlot(p: Pixel) {
    return p.x >= PAD.l && p.x <= width - PAD.r && p.y >= PAD.t && p.y <= PAD.t + geo.priceH;
  }

  function hitDrawing(p: Pixel) {
    if (hideDrawings) return null;
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
      if (d.kind === "avwap" && hitPolyline(p, avwapPath(d))) return { drawing: d, endpoint: -1 };
      if (d.kind === "vline" && Math.abs(p.x - a.x) <= 6) return { drawing: d, endpoint: -1 };
      if (d.kind === "hray" && p.x >= a.x - 6 && Math.abs(p.y - a.y) <= 6) return { drawing: d, endpoint: -1 };
      if (multi(d.kind)) {
        const pts = d.points.map(screen);
        const b = pts[1];
        const c = pts[2] ?? b;
        const right = width - PAD.r;
        if (d.id === selected) {
          for (const [i, point] of pts.entries()) if (segmentDistance(p, point, point) <= 6) return { drawing: d, endpoint: i };
        }
        const left = Math.min(a.x, b.x);
        const hit =
          d.kind === "trend" || d.kind === "arrow" ? hitTest(p, a, b)
          : d.kind === "prange" || d.kind === "drange" ? hitBox(p, a, b)
          : d.kind === "channel" ? channelLines(a, b, c).some(([s, e]) => hitTest(p, s, e))
          : d.kind === "pitchfork" ? pitchforkLines(a, b, c, PAD.l, right).some(([s, e]) => hitTest(p, s, e))
          : d.kind === "fibext" ? p.x >= c.x - 6 && fibExtLevels(d.points[0].price, d.points[1].price, d.points[2].price).some((l) => Math.abs(p.y - geo.y(l.price)) <= 6)
          : d.kind === "ray" ? hitTest(p, a, rayEnd(a, b, PAD.l, right))
          : d.kind === "rect" ? hitBox(p, a, b)
          : d.kind === "fib" ? p.x >= left - 6 && fibLevels(d.points[0].price, d.points[1].price).some((l) => Math.abs(p.y - geo.y(l.price)) <= 6)
          : p.x >= left - 6 && p.x <= positionRight(a, b) + 6 && p.y >= Math.min(b.y, positionTargetY(d)) - 6 && p.y <= Math.max(b.y, positionTargetY(d)) + 6;
        if (hit) return { drawing: d, endpoint: -1 };
      }
    }
    return null;
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0 || geo.n === 0 || (e.target as Element).closest(".exports, .drawing-tools, input")) return;
    wrap!.focus();
    const p = pixel(e);
    if (!inPlot(p)) {
      if (onAxis(p)) axisY = e.clientY;
      else if (tool === "cursor") { dragX = e.clientX; dragY = e.clientY; }
      else return;
      wrap!.setPointerCapture(e.pointerId);
      return;
    }
    if (drawingBusy) return;
    if (tool === "cursor") {
      wrap!.setPointerCapture(e.pointerId);
      hover = null;
      const hit = hitDrawing(p);
      selected = hit?.drawing.id ?? null;
      if (hit && !hit.drawing.locked) gesture = { start: p, original: hit.drawing, endpoint: hit.endpoint, moved: false, second: false };
      else if (!hit) { dragX = e.clientX; dragY = e.clientY; }
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
    if (tool === "hline" || tool === "avwap" || tool === "vline" || tool === "hray") { addDrawing({ id: 0, kind: tool, points: [point], text: "" }); return; }
    if (tool === "text") {
      editing = { point, x: Math.min(p.x, Math.max(PAD.l, width - 220)), y: p.y };
      inputText = "";
      return;
    }
    if (tool === "ruler" || multi(tool)) {
      const kind = tool === "ruler" ? "trend" : (tool as Drawing["kind"]);
      const need = POINT_COUNT[kind] ?? 2;
      if (!preview) {
        preview = { id: 0, kind, points: Array.from({ length: need }, () => point), text: "" };
        placed = 1;
      } else {
        placed = Math.min(placed + 1, need);
        preview = { ...preview, points: preview.points.map((q, i) => (i < placed - 1 ? q : point)) };
      }
      gesture = { start: p, original: null, endpoint: -1, moved: false, second: placed >= need };
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
        return anchor({ x: old.x + p.x - start.x, y: old.y + p.y - start.y }, false);
      });
      if (points.every((a) => a.price > 0 && Number.isFinite(a.price))) preview = { ...original, points };
    } else if (preview) preview = { ...preview, points: preview.points.map((q, i) => (i < placed ? q : point)) };
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
      else if (preview && (gesture.second || (gesture.moved && preview.points.length === 2))) addDrawing(preview);
      else if (preview && gesture.moved) placed = Math.max(placed, 2);
      gesture = null;
    }
    dragX = null;
    axisY = null;
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
    const items = [...(hideDrawings ? [] : list.filter((d) => !preview || !gesture?.original || d.id !== preview.id)), ...(preview ? [preview] : [])];
    for (const d of items) {
      const a = screen(d.points[0]);
      const two = multi(d.kind);
      const pts = d.points.map(screen);
      const b = two ? pts[1] : a;
      const c = pts[2] ?? b;
      const wide = d.kind !== "hline" && d.kind !== "trend" && d.kind !== "rect" && d.kind !== "text" && d.kind !== "pen" && d.kind !== "arrow";
      const path = d.kind === "pen" ? d.points.map(screen) : null;
      const box = path ? pathBounds(path) : { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) };
      const bottom = PAD.t + geo.priceH, right = width - PAD.r;
      if (!wide && (box.maxY < PAD.t || box.minY > bottom)) continue;
      if (d.kind !== "hline" && !wide && (box.maxX < PAD.l || box.minX > right)) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD.l, PAD.t, geo.plotW, geo.priceH);
      ctx.clip();
      ctx.strokeStyle = d.color || v(d.id === selected ? "--text" : "--muted");
      ctx.fillStyle = d.color || v("--text");
      ctx.lineWidth = (d.width || 1) + (d.id === selected ? 1 : 0);
      if (d.dashed) ctx.setLineDash([6, 4]);
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
      } else if (d.kind === "avwap") {
        const line = avwapPath(d);
        ctx.strokeStyle = d.color || v("--vwap");
        ctx.beginPath();
        line.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
        if (line.length) ctx.fillText("AVWAP", line[0].x + 3, line[0].y - 3);
      } else if (d.kind === "rect") {
        ctx.globalAlpha = 0.08;
        ctx.fillRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
        ctx.globalAlpha = 1;
        ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
      } else if (d.kind === "fib") {
        for (const l of fibLevels(d.points[0].price, d.points[1].price)) {
          const y = Math.round(geo.y(l.price)) + 0.5;
          ctx.beginPath();
          ctx.moveTo(box.minX, y);
          ctx.lineTo(right, y);
          ctx.stroke();
          ctx.fillText(`${l.ratio} ${num(l.price)}`, box.minX + 3, y - 1);
        }
      } else if (d.kind === "position") {
        const pos = positionLevels(d.points[0].price, d.points[1].price);
        const targetY = positionTargetY(d);
        const x1 = positionRight(a, b);
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = v("--down");
        ctx.fillRect(box.minX, Math.min(a.y, b.y), x1 - box.minX, Math.abs(a.y - b.y));
        ctx.fillStyle = v("--up");
        ctx.fillRect(box.minX, Math.min(a.y, targetY), x1 - box.minX, Math.abs(a.y - targetY));
        ctx.globalAlpha = 1;
        ctx.fillStyle = v("--text");
        for (const [y, label] of [[a.y, `${pos.long ? "Long" : "Short"} ${num(d.points[0].price)}`], [b.y, `Stop ${num(d.points[1].price)} (${num(pos.riskPct, 2)}%)`], [targetY, `${pos.reward}R ${num(pos.target)}`]] as const) {
          ctx.beginPath();
          ctx.moveTo(box.minX, y);
          ctx.lineTo(x1, y);
          ctx.stroke();
          ctx.fillText(label, box.minX + 3, y - 2);
        }
      } else if (d.kind === "vline") {
        ctx.beginPath();
        ctx.moveTo(Math.round(a.x) + 0.5, PAD.t);
        ctx.lineTo(Math.round(a.x) + 0.5, bottom);
        ctx.stroke();
      } else if (d.kind === "hray") {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(right, a.y);
        ctx.stroke();
        ctx.fillText(num(d.points[0].price), a.x + 3, a.y - 2);
      } else if (d.kind === "prange" || d.kind === "drange") {
        const m = rulerMeasurement(d.points[0], d.points[1], times);
        const x0 = box.minX, x1 = box.maxX;
        const y0 = d.kind === "drange" ? PAD.t : box.minY, y1 = d.kind === "drange" ? bottom : box.maxY;
        const fill = ctx.fillStyle;
        ctx.globalAlpha = 0.1;
        ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
        ctx.globalAlpha = 1;
        ctx.beginPath();
        if (d.kind === "prange") {
          ctx.moveTo(x0, a.y); ctx.lineTo(x1, a.y);
          ctx.moveTo(x0, b.y); ctx.lineTo(x1, b.y);
          ctx.moveTo((x0 + x1) / 2, a.y); ctx.lineTo((x0 + x1) / 2, b.y);
        } else {
          ctx.moveTo(a.x, y0); ctx.lineTo(a.x, y1);
          ctx.moveTo(b.x, y0); ctx.lineTo(b.x, y1);
          ctx.moveTo(a.x, (a.y + b.y) / 2); ctx.lineTo(b.x, (a.y + b.y) / 2);
        }
        ctx.stroke();
        ctx.fillStyle = fill;
        const sign = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
        const label = d.kind === "prange" ? `${sign(m.delta)} (${sign(m.percent)}%)` : `${m.bars} bars · ${m.elapsed}`;
        ctx.fillText(label, x0 + 3, d.kind === "prange" ? box.minY - 2 : Math.max(PAD.t + 14, (a.y + b.y) / 2 - 3));
      } else if (d.kind === "channel" || d.kind === "pitchfork") {
        const lines = d.kind === "channel" ? channelLines(a, b, c) : pitchforkLines(a, b, c, PAD.l, right);
        if (d.kind === "channel") {
          ctx.globalAlpha = 0.07;
          ctx.beginPath();
          ctx.moveTo(lines[0][0].x, lines[0][0].y);
          ctx.lineTo(lines[0][1].x, lines[0][1].y);
          ctx.lineTo(lines[1][1].x, lines[1][1].y);
          ctx.lineTo(lines[1][0].x, lines[1][0].y);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        for (const [s, e] of lines) { ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); }
        ctx.stroke();
      } else if (d.kind === "fibext") {
        ctx.save();
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
        ctx.restore();
        for (const l of fibExtLevels(d.points[0].price, d.points[1].price, d.points[2].price)) {
          const y = Math.round(geo.y(l.price)) + 0.5;
          ctx.beginPath();
          ctx.moveTo(c.x, y);
          ctx.lineTo(right, y);
          ctx.stroke();
          ctx.fillText(`${l.ratio} ${num(l.price)}`, c.x + 3, y - 1);
        }
      } else {
        if (d.kind === "arrow") {
          const [l, r] = arrowHead(a, b);
          ctx.beginPath();
          ctx.moveTo(l.x, l.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(r.x, r.y);
          ctx.stroke();
        }
        const end = d.kind === "ray" ? rayEnd(a, b, PAD.l, right) : b;
        ctx.beginPath();
        ctx.moveTo(d.kind === "hline" ? PAD.l : a.x, a.y);
        ctx.lineTo(d.kind === "hline" ? right : end.x, end.y);
        ctx.stroke();
      }
      if (two && d.id === selected) for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); }
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
      if (d.kind === "hline") axisTag(ctx, a.y, geo.label(d.points[0].price), d.color || v("--muted"), v("--bg"));
    }
  }

  function onMove(e: MouseEvent) {
    if (axisY != null) {
      manual = stretchRange(geo.lo, geo.hi, geo.scale, Math.exp((e.clientY - axisY) * 0.006));
      axisY = e.clientY;
      hover = null;
      return;
    }
    if (moveDrawing(e)) return;
    if (tool !== "cursor" || (e.target instanceof Element && e.target.closest(".drawing-tools, input"))) { hover = null; return; }
    if (dragX != null) {
      view = pan(view, geo.n, (dragX - e.clientX) / geo.step);
      if (manual) manual = shiftRange(geo.lo, geo.hi, geo.scale, (e.clientY - dragY) / geo.priceH);
      dragX = e.clientX;
      dragY = e.clientY;
      hover = null;
      emitWindow();
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
    if (replay && ["ArrowLeft", "ArrowRight", "Escape", " ", "Delete", "Backspace"].includes(e.key)) return;
    if (replay && e.ctrlKey && e.key.toLowerCase() === "z") return;
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
    emitWindow();
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
    navigator.clipboard.writeText(candlesCsv(chart?.candles ?? [])).then(() => flash("csv"), console.warn);
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
    if ((e.target as Element).closest(".exports, .drawing-tools, input")) return;
    if (onAxis(pixel(e))) manual = null;
    else if (tool === "cursor" && selected == null) resetView();
  }}
  onkeydown={onKey}
>
  <canvas bind:this={canvas} style:width="{width}px" style:height="{height}px"></canvas>
  {#if chart && !replay}
    <div class="drawing-tools" role="toolbar" aria-label="Drawing tools">
      {#each tools as item}
        <button aria-label={item.label} aria-pressed={tool === item.tool} title={item.label} onclick={() => chooseTool(item.tool)}>{item.label}</button>
      {/each}
      <select aria-label="More drawing tools" value={moreTools.some((m) => m.tool === tool) ? tool : ""} onchange={(e) => chooseTool((e.currentTarget.value || "cursor") as Tool)}>
        <option value="">More</option>
        {#each moreTools as item}<option value={item.tool}>{item.label}</option>{/each}
      </select>
      <button aria-label="Undo" aria-pressed={false} title="Undo (Ctrl+Z); redo (Ctrl+Shift+Z)" disabled={!history.past.length || drawingBusy} onclick={() => { cancelDrawing(); void changeDrawings("undo"); }}>Undo</button>
      <button aria-label="Delete" aria-pressed={false} title="Delete (Delete / Backspace)" disabled={selected == null || drawingBusy || !!selectedDrawing?.locked} onclick={removeDrawing}>Delete</button>
      <button aria-label="Magnet" aria-pressed={magnet} title="Magnet: snap new points and dragged endpoints to the open, high, low or close" onclick={toggleMagnet}>Magnet</button>
      <button aria-label="Hide drawings" aria-pressed={hideDrawings} title="Hide all drawings" onclick={() => { hideDrawings = !hideDrawings; selected = null; }}>Hide</button>
    </div>
    {#if selectedDrawing}
      {@const d = selectedDrawing}
      <div class="drawing-tools drawing-style" role="toolbar" aria-label="Drawing style">
        {#each DRAWING_COLORS as color}
          <button class="swatch" aria-label={color ? `Color ${color}` : "Default color"} aria-pressed={(d.color ?? "") === color} disabled={drawingBusy} style:--swatch={color || "var(--muted)"} onclick={() => restyle({ color })}></button>
        {/each}
        {#each [1, 2, 3] as w}
          <button aria-label={`Width ${w}`} aria-pressed={(d.width || 1) === w} disabled={drawingBusy} onclick={() => restyle({ width: w })}>{w}px</button>
        {/each}
        <button aria-label="Dashed" aria-pressed={!!d.dashed} disabled={drawingBusy} onclick={() => restyle({ dashed: !d.dashed })}>Dash</button>
        <button aria-label="Lock" aria-pressed={!!d.locked} title="Locked drawings cannot be moved or deleted" disabled={drawingBusy} onclick={() => restyle({ locked: !d.locked })}>Lock</button>
      </div>
    {/if}
  {/if}
  {#if candles.length}
    <div class="axis-grip" style:top="{PAD.t}px" style:width="{PAD.r}px" style:height="{geo.priceH}px"></div>
  {/if}
  {#if staleNote}
    <div class="stale-note" role="status">{staleNote}</div>
  {/if}
  {#if countdown}
    <div class="countdown" title="Time until this candle closes">{countdown}</div>
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
      {#if manual}
        <button title="Auto price scale (double-click the price axis)" aria-label="Auto price scale" onclick={() => (manual = null)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4" /></svg>
        </button>
      {/if}
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
  .axis-grip {
    position: absolute;
    right: 0;
    cursor: ns-resize;
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
  .drawing-tools select { font-size: 10px; padding: 2px 4px; }
  .drawing-style { top: 25px; align-items: center; }
  .drawing-style .swatch { width: 14px; height: 14px; padding: 0; background: var(--swatch); }
  .drawing-style .swatch[aria-pressed="true"] { background: var(--swatch); box-shadow: 0 0 0 2px var(--text); }
  .drawing-input { position: absolute; width: 200px; z-index: 2; }
  .countdown {
    position: absolute;
    right: 4px;
    bottom: 26px;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--tooltip-bg);
    color: var(--muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
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
