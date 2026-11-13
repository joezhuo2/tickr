<script lang="ts">
  import { alignTimes, axisTime, candleAt, candlesCsv, fullTime, netSentiment, num, price, quarterLabel, volume } from "./lib/format";
  import { candleCountdown, classifyBars, displayOffset, futureTimes, isExtendedSession, isIntraday, zoneLabel, type Clock } from "./lib/session";
  import type { Analysis, Article, Chart, ChartMode, ChartScale, ChartTimeZone, EarningsReport, Line, Overlays, Pattern, RatingChange } from "./lib/types";
  import { fitScale, forward, inverse, scaleLabel, scaleTicks, shiftRange, stretchRange } from "./lib/scale";
  import type { Drawing, DrawingPoint } from "./lib/types";
  import { DRAWING_COLORS, POINT_COUNT, arrowHead, channelLines, fibExtLevels, pitchforkLines, snapPrice, anchoredVwap, fibLevels, hitBox, positionLevels, rayEnd, timeToIndex, indexToTime, hitTest, hitPolyline, pathBounds, segmentDistance, simplifyPath, undoReducer, rulerMeasurement, type History, type Pixel } from "./lib/drawing";
  import { rr } from "./lib/rrStore.svelte";
  import { legendText, volumeProfile } from "./lib/indicators";
  import { columnPen, columns, type Sink } from "./lib/decimate";
  import { LEFT_SCALES, PANE_NAMES, mergeUp, movePane, paneRects, unmerge, visibleGroups, type PaneId, type Slot } from "./lib/panes";
  import { panes, setPanes } from "./lib/paneStore.svelte";
  import { untrack } from "svelte";
  import { axisRange } from "./lib/scrollback";
  import { clamp } from "./lib/viewport";
  import { cci, donchian, ichimoku, keltner, mfi, obv, parabolicSar, pivotPeriod, pivots, stochastic, supertrend, williamsR } from "./lib/studies";
  import { studies, studySettings as ss } from "./lib/studyStore.svelte";
  import { displayCandles, isOhlc, isReshaped, type Brick } from "./lib/charttypes";
  import { typeSettings } from "./lib/typeStore.svelte";
  import { fadeIn } from "./lib/motion";
  import { patternInfo } from "./lib/patternInfo";
  import type { ChartPattern } from "./lib/chartPatterns";
  import ColorPicker from "./ColorPicker.svelte";
  import { MAIN_PRESETS } from "./lib/display";
  import { NOTE_MAX, noteBar, noteTitle, snapNoteTime } from "./lib/notes";
  import { center, firstAtOrAfter, follow, full, isFull, MAX_FUTURE, pan, reveal, visible, zoom, type View } from "./lib/viewport";
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
    highlight = null,
    chartPatterns = [],
    orderLines = [],
    onmoveorder,
    onolder,
    loadingOlder = false,
  }: {
    onolder?: () => void;
    loadingOlder?: boolean;
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
    highlight?: { from: number; to: number } | null;
    chartPatterns?: ChartPattern[];
    orderLines?: { id: string; price: number; side: "buy" | "sell"; label: string }[];
    onmoveorder?: (id: string, price: number) => void;
  } = $props();

  let orderDrag = $state<{ id: string; price: number } | null>(null);

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

  const PAD = $derived.by(() => ({ l: leftAxis ? 62 : 6, r: 62, t: 38, b: 22 }));

  let nowSec = $state(Date.now() / 1000);
  const countdown = $derived(chart && !replay ? candleCountdown(chart.interval, chart.candles[chart.candles.length - 1]?.t, nowSec) : null);
  $effect(() => {
    if (!chart || replay || !isIntraday(chart.interval)) return;
    const tick = setInterval(() => (nowSec = Date.now() / 1000), 1000);
    return () => clearInterval(tick);
  });

  const candles = $derived(displayCandles(chart?.candles ?? [], mode, typeSettings));
  const ohlc = $derived(isOhlc(mode));
  const isDay = $derived(chart?.range === "1d");
  const prevClose = $derived(isDay ? (chart?.meta.prev_close ?? null) : null);
  const clock = $derived<Clock>({ timezone: chart?.meta.timezone, gmtoffset: chart?.meta.gmtoffset ?? 0 });
  const sessions = $derived(chart ? classifyBars(candles.map((c) => c.t), clock, chart.meta.periods, chart.interval) : []);
  const hasExtended = $derived(sessions.some(isExtendedSession));

  // Analysis overlays: only when there is an analysis and a toggle set.
  const show = $derived(analysis && overlays ? overlays : null);
  const stoch = $derived(studies.stoch ? stochastic(candles, ss.stoch.k, ss.stoch.smooth, ss.stoch.d) : null);
  const ichi = $derived(studies.ichimoku ? ichimoku(candles, ss.ichimoku.conversion, ss.ichimoku.base, ss.ichimoku.spanB, ss.ichimoku.displacement) : null);
  const trendLine = $derived(studies.supertrend ? supertrend(candles, ss.supertrend.length, ss.supertrend.multiplier) : null);
  const trendSides = $derived(trendLine && {
    up: trendLine.value.map((val, i) => (trendLine.up[i] ? val : null)),
    down: trendLine.value.map((val, i) => (trendLine.up[i] ? null : val)),
  });
  const onBalance = $derived(studies.obv ? obv(candles) : null);
  const pivotLevels = $derived(studies.pivots && chart ? pivots(candles, pivotPeriod(chart.interval, chart.meta.gmtoffset ?? 0), ss.pivotType) : null);
  const keltnerBands = $derived(studies.keltner ? keltner(candles, ss.keltner.ema, ss.keltner.atr, ss.keltner.multiplier) : null);
  const donchianBands = $derived(studies.donchian ? donchian(candles, ss.donchian.length) : null);
  const sar = $derived(studies.psar ? parabolicSar(candles, ss.psar.step, ss.psar.max) : null);
  const commodity = $derived(studies.cci ? cci(candles, ss.cci.length) : null);
  const williams = $derived(studies.willr ? williamsR(candles, ss.willr.length) : null);
  const moneyFlow = $derived(studies.mfi ? mfi(candles, ss.mfi.length) : null);
  const sessionKeys = $derived.by(() => {
    if (!studies.svp || !chart) return null;
    const period = pivotPeriod(chart.interval, chart.meta.gmtoffset ?? 0);
    return candles.map((c) => period(c.t));
  });
  let legendY = 0;
  let gotoOpen = $state(false);

  function dateOffset() {
    const last = candles[candles.length - 1]?.t ?? 0;
    return chart ? displayOffset(last, timeZone, clock, chart.interval) : 0;
  }

  function dateValue(t: number | undefined) {
    if (t == null || !chart) return "";
    return new Date((t + dateOffset()) * 1000).toISOString().slice(0, isIntraday(chart.interval) ? 16 : 10);
  }

  function goToDate(value: string) {
    const t = Date.parse(`${value}${value.length === 10 ? "T00:00" : ""}Z`) / 1000 - dateOffset();
    if (!Number.isFinite(t) || !candles.length) return;
    const i = firstAtOrAfter(times, t);
    view = center(view, candles.length, i);
    hover = i;
    gotoOpen = false;
    emitWindow();
    wrap?.focus();
  }

  function drawProfile(ctx: CanvasRenderingContext2D, g: Geo, i0: number, i1: number, v: (name: string) => string, bins = 24) {
    const profile = volumeProfile(candles, i0, i1, bins);
    if (!profile) return;
    const peak = Math.max(...profile.volumes);
    const x0 = g.x(i0) - g.step / 2;
    const maxW = (g.x(i1) + g.step / 2 - x0) * 0.6;
    ctx.save();
    ctx.fillStyle = v("--muted");
    profile.volumes.forEach((vol, k) => {
      const top = g.y(profile.lo + (k + 1) * profile.step);
      const bottom = g.y(profile.lo + k * profile.step);
      ctx.globalAlpha = vol === peak ? 0.45 : 0.2;
      ctx.fillRect(x0, top, peak > 0 ? (vol / peak) * maxW : 0, Math.max(1, bottom - top - 1));
    });
    ctx.restore();
  }
  const rsiOn = $derived(!!show?.rsi);
  const macdOn = $derived(!!show?.macd);
  const paneOn = (id: PaneId) => (id === "rsi" ? rsiOn : id === "macd" ? macdOn : id === "stoch" ? !!stoch : id === "cci" ? !!commodity : id === "willr" ? !!williams : id === "mfi" ? !!moneyFlow : !!onBalance);
  const shownPanes = $derived(visibleGroups(panes.groups, paneOn));
  const leftAxis = $derived(panes.left !== "off" || shownPanes.some((g) => g.length > 1));
  let maxPane = $state<Slot | null>(null);
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
    const lay = paneRects(plotH, shownPanes, maxPane);
    const { priceH, volH } = lay;
    const volTop = PAD.t + lay.volTop;
    const [i0, i1] = visible(view, n);
    const prices: number[] = [];
    const fitValues: number[] = [];
    let vmax = 0;
    for (let i = i0; i <= i1; i++) {
      const c = candles[i];
      if (ohlc) prices.push(c.l, c.h, c.o, c.c);
      else prices.push(c.c);
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
      j1: Math.max(i1, Math.ceil(start + view.count) - 1),
      from: Math.max(0, i0 - 1),
      to: Math.min(n - 1, i1 + 1),
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
      hidePrice: lay.hidePrice,
      overlays: lay.overlays,
      slots: lay.slots.map((r) => ({ ...r, top: PAD.t + r.top })),
      x: (i: number) => PAD.l + step * (i - start + 0.5),
      y: (v: number) => PAD.t + (1 - forward(v, lo, hi, activeScale)) * priceH,
      vy: (v: number) => volTop + volH - (vmax > 0 ? (v / vmax) * volH : 0),
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

    if (highlight) {
      const i = indexOf.get(highlight.from);
      const j = indexOf.get(highlight.to);
      if (i != null && j != null) {
        clipPlot(ctx);
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = v("--accent");
        ctx.fillRect(g.x(i) - g.step / 2, PAD.t, g.step * (j - i + 1), bottom - PAD.t);
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }

    // Extended-hours shading.
    if (shadeSessions && hasExtended) {
      clipPlot(ctx);
      ctx.fillStyle = v("--ext-shade");
      for (let i = g.from; i <= g.to; i++) {
        if (!isExtendedSession(sessions[i])) continue;
        let j = i;
        while (j < g.to && isExtendedSession(sessions[j + 1])) j++;
        ctx.fillRect(g.x(i) - g.step / 2, PAD.t, g.step * (j - i + 1) + 0.5, bottom - PAD.t);
        i = j;
      }
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
      if (panes.left !== "off") {
        ctx.textAlign = "right";
        ctx.fillText(leftLabel(t, g), PAD.l - 6, y);
        ctx.textAlign = "left";
      }
    }

    // Time axis: about one label per 110 px.
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = v("--muted");
    if (g.n > 0 && chart) {
      const labels = axisRange(chart.range, chart.interval, candles[g.i1].t - candles[g.i0].t);
      const every = Math.max(1, Math.ceil(view.count / Math.max(1, Math.floor(g.plotW / 110))));
      const off = Math.floor(every / 2);
      for (let i = off + Math.ceil((g.i0 - off) / every) * every; i <= g.j1; i += every) {
        const x = g.x(i);
        if (x < PAD.l || x > width - PAD.r || axisTimes[i] == null) continue;
        ctx.fillText(axisTime(axisTimes[i], displayOffset(axisTimes[i], timeZone, clock, chart.interval), labels, chart.interval), x, height - 6);
      }
    }

    // Volume.
    clipPlot(ctx);
    const bw = Math.max(1, g.step * 0.65);
    const cols = g.step * dpr < 1 ? columns(candles, g.from, g.to, g.x, dpr) : null;
    if (cols) {
      ctx.globalAlpha = 0.28;
      for (const rising of [true, false]) {
        ctx.beginPath();
        for (const c of cols) {
          if (c.c >= c.o !== rising) continue;
          const y = g.vy(c.v);
          ctx.rect(c.x - 0.5 / dpr, y, 1 / dpr, g.volTop + g.volH - y);
        }
        ctx.fillStyle = rising ? up : down;
        ctx.fill();
      }
    } else {
      for (let i = g.from; i <= g.to; i++) {
        const c = candles[i];
        ctx.fillStyle = c.c >= c.o ? up : down;
        ctx.globalAlpha = 0.28;
        const y = g.vy(c.v);
        ctx.fillRect(g.x(i) - bw / 2, y, bw, g.volTop + g.volH - y);
      }
    }
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

    if (ohlc && cols) {
      ctx.lineWidth = 1 / dpr;
      for (const rising of [true, false]) {
        ctx.beginPath();
        for (const c of cols) {
          if (c.c >= c.o !== rising) continue;
          const top = g.y(c.h);
          ctx.moveTo(c.x, top);
          ctx.lineTo(c.x, Math.max(g.y(c.l), top + 1 / dpr));
        }
        ctx.strokeStyle = rising ? up : down;
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    } else if (mode === "kagi") {
      const stroke = (xa: number, ya: number, xb: number, yb: number, thick: boolean) => {
        ctx.strokeStyle = thick ? up : down;
        ctx.lineWidth = thick ? 3 : 1.2;
        ctx.beginPath();
        ctx.moveTo(xa, ya);
        ctx.lineTo(xb, yb);
        ctx.stroke();
      };
      for (let i = g.from; i <= g.to; i++) {
        const b = candles[i] as Brick;
        const x = g.x(i);
        const y0 = g.y(b.o);
        if (i > 0) stroke(g.x(i - 1), y0, x, y0, !!b.thick);
        if (b.flip === undefined) stroke(x, y0, x, g.y(b.c), !!b.thick);
        else {
          stroke(x, y0, x, g.y(b.flip), !!b.thick);
          stroke(x, g.y(b.flip), x, g.y(b.c), !b.thick);
        }
      }
      ctx.lineWidth = 1;
    } else if (mode === "pointfigure") {
      ctx.lineWidth = 1.2;
      for (let i = g.from; i <= g.to; i++) {
        const b = candles[i] as Brick;
        if (!b.box) continue;
        const x = g.x(i);
        const rising = b.c >= b.o;
        const boxH = Math.abs(g.y(b.l + b.box) - g.y(b.l));
        ctx.strokeStyle = rising ? up : down;
        ctx.beginPath();
        if (boxH < 4) {
          ctx.moveTo(x, g.y(b.h));
          ctx.lineTo(x, g.y(b.l));
        } else {
          const rx = Math.max(1, Math.min(bw / 2, boxH / 2) - 1);
          const ry = boxH / 2 - 1;
          for (let j = 0, n = Math.round((b.h - b.l) / b.box); j < n; j++) {
            const cy = (g.y(b.l + j * b.box) + g.y(b.l + (j + 1) * b.box)) / 2;
            if (cy < PAD.t - boxH || cy > PAD.t + g.priceH + boxH) continue;
            if (rising) {
              ctx.moveTo(x - rx, cy - ry);
              ctx.lineTo(x + rx, cy + ry);
              ctx.moveTo(x + rx, cy - ry);
              ctx.lineTo(x - rx, cy + ry);
            } else {
              ctx.moveTo(x + rx, cy);
              ctx.ellipse(x, cy, rx, ry, 0, 0, Math.PI * 2);
            }
          }
        }
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    } else if (ohlc) {
      for (let i = g.from; i <= g.to; i++) {
        const c = candles[i];
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
      }
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
        const pen = columnPen(ctx, dpr);
        for (let i = g.from; i <= g.to; i++) pen.to(g.x(i), g.y(candles[i].c));
        pen.lift();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.6;
        ctx.lineJoin = "round";
        ctx.stroke();
        ctx.lineTo(g.x(g.to), baseY);
        ctx.lineTo(g.x(g.from), baseY);
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

    for (const line of orderLines) {
      const at = orderDrag?.id === line.id ? orderDrag.price : line.price;
      const y = Math.round(g.y(at)) + 0.5;
      if (y < PAD.t || y > PAD.t + g.priceH) continue;
      const col = v(line.side === "buy" ? "--up" : "--down");
      ctx.strokeStyle = col;
      ctx.lineWidth = orderDrag?.id === line.id ? 2 : 1;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(width - PAD.r, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `10px ${v("--font")}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      const text = `${line.label} @ ${num(at)}`;
      ctx.fillStyle = v("--bg");
      ctx.fillRect(PAD.l + 4, y - 14, ctx.measureText(text).width + 6, 13);
      ctx.fillStyle = col;
      ctx.fillText(text, PAD.l + 7, y - 2);
      ctx.font = `11px ${v("--font")}`;
      axisTag(ctx, y, g.label(at), col, v("--bg"));
    }

    drawPanes(ctx, g, v);

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
      if (!g.hidePrice) {
        ctx.moveTo(PAD.l, y);
        ctx.lineTo(width - PAD.r, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (g.hidePrice) return;
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
      if (panes.left !== "off") {
        ctx.fillStyle = v("--text");
        ctx.fillRect(2, y - 9, PAD.l - 4, 18);
        ctx.fillStyle = v("--bg");
        ctx.textAlign = "right";
        ctx.fillText(leftLabel(c.c, g), PAD.l - 6, y);
      }
    } else if (hover != null && hover >= g.n && chart && axisTimes[hover] != null) {
      const x = Math.round(g.x(hover)) + 0.5;
      ctx.strokeStyle = v("--crosshair");
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, PAD.t);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      const label = fullTime(axisTimes[hover], displayOffset(axisTimes[hover], timeZone, clock, chart.interval), chart.interval);
      const w = ctx.measureText(label).width + 10;
      const left = Math.max(PAD.l, Math.min(width - PAD.r - w, x - w / 2));
      ctx.fillStyle = v("--text");
      ctx.fillRect(left, bottom + 2, w, PAD.b - 4);
      ctx.fillStyle = v("--bg");
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, left + w / 2, bottom + PAD.b / 2);
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

  function linePen(sink: Sink) {
    return columnPen(sink, window.devicePixelRatio || 1);
  }

  function collect(out: [number, number][]): Sink {
    const add = (x: number, y: number) => {
      out.push([x, y]);
    };
    return { moveTo: add, lineTo: add };
  }

  /** Strokes a series in two parts: dashed during warm-up, solid after. */
  function strokeLine(ctx: CanvasRenderingContext2D, line: Line, y: (v: number) => number, g: Geo) {
    for (const warm of [true, false]) {
      ctx.setLineDash(warm ? [3, 3] : []);
      ctx.beginPath();
      const pen = linePen(ctx);
      for (let i = g.from; i <= g.to; i++) {
        const k = align[i];
        const val = valueAt(line, i);
        if (val == null || (y === g.y && g.scale === "log" && val <= 0) || (warm ? k > line.full_from : k < line.full_from)) pen.lift();
        else pen.to(g.x(i), y(val));
      }
      pen.lift();
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
      const pts = (line: Line) => {
        const out: [number, number][] = [];
        const pen = linePen(collect(out));
        for (let i = g.from; i <= g.to; i++) {
          const val = valueAt(line, i);
          if (val != null) pen.to(g.x(i), g.y(val));
        }
        pen.lift();
        return out;
      };
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
      const top: [number, number][] = [];
      const bot: [number, number][] = [];
      const hiPen = linePen(collect(top));
      const loPen = linePen(collect(bot));
      for (let i = g.from; i <= g.to + 1; i++) {
        const hi = i <= g.to ? valueAt(orHigh, i) : null;
        const lo = i <= g.to ? valueAt(orLow, i) : null;
        if (hi != null && lo != null) {
          hiPen.to(g.x(i), g.y(hi));
          loPen.to(g.x(i), g.y(lo));
          continue;
        }
        hiPen.lift();
        loPen.lift();
        if (top.length > 1) {
          ctx.beginPath();
          top.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          for (let k = bot.length - 1; k >= 0; k--) ctx.lineTo(bot[k][0], bot[k][1]);
          ctx.closePath();
          ctx.fill();
        }
        top.length = 0;
        bot.length = 0;
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
        if (i < g.from || i > g.to) continue;
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
    if (s.chart_patterns) {
      ctx.font = `10px ${v("--font")}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      for (const p of chartPatterns) {
        const xs = p.points.map((q) => indexOf.get(q.t));
        if (xs.some((i) => i == null) || xs[xs.length - 1]! < g.from || xs[0]! > g.to) continue;
        const col = v(p.bias === "bullish" ? "--up" : p.bias === "bearish" ? "--down" : "--muted");
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        p.points.forEach((q, k) => (k ? ctx.lineTo(g.x(xs[k]!), g.y(q.price)) : ctx.moveTo(g.x(xs[k]!), g.y(q.price))));
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 3]);
        for (const [a, b] of p.lines) {
          const i = indexOf.get(a.t);
          const j = indexOf.get(b.t);
          if (i == null || j == null) continue;
          ctx.beginPath();
          ctx.moveTo(g.x(i), g.y(a.price));
          ctx.lineTo(g.x(j), g.y(b.price));
          ctx.stroke();
        }
        ctx.setLineDash([]);
        const k = p.points.reduce((best, q, n) => (q.price > p.points[best].price ? n : best), 0);
        ctx.fillText(`${p.name}${p.confirmed ? "" : "?"}`, g.x(xs[k]!), g.y(p.points[k].price) - 6);
      }
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
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
    ctx.font = `11px ${v("--font")}`;
  }

  function plot(ctx: CanvasRenderingContext2D, g: Geo, values: (number | null)[], y: (v: number) => number) {
    ctx.beginPath();
    const pen = linePen(ctx);
    for (let i = Math.max(0, g.i0 - 1); i <= Math.min(values.length - 1, g.j1 + 1); i++) {
      const val = values[i];
      if (val == null || !Number.isFinite(val)) pen.lift();
      else pen.to(g.x(i), y(val));
    }
    pen.lift();
    ctx.stroke();
  }

  function drawStudies(ctx: CanvasRenderingContext2D, g: Geo, v: (name: string) => string) {
    if (g.n === 0 || !(stoch || ichi || trendLine || onBalance || pivotLevels || sessionKeys || keltnerBands || donchianBands || sar)) return;
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
    if (sessionKeys) {
      let i = g.i0;
      while (i > 0 && sessionKeys[i - 1] === sessionKeys[i]) i--;
      for (let drawn = 0; i <= g.i1 && drawn < 80; drawn++) {
        let j = i;
        while (j + 1 < g.n && sessionKeys[j + 1] === sessionKeys[i]) j++;
        drawProfile(ctx, g, i, j, v, 16);
        i = j + 1;
      }
    }
    if (ichi) {
      ctx.globalAlpha = 0.1;
      for (const rising of [true, false]) {
        ctx.beginPath();
        for (let i = Math.max(1, g.i0); i <= Math.min(ichi.spanA.length - 1, g.j1 + 1); i++) {
          const a0 = ichi.spanA[i - 1], a1 = ichi.spanA[i], b0 = ichi.spanB[i - 1], b1 = ichi.spanB[i];
          if (a0 == null || a1 == null || b0 == null || b1 == null || a1 >= b1 !== rising) continue;
          ctx.moveTo(g.x(i - 1), g.y(a0));
          ctx.lineTo(g.x(i), g.y(a1));
          ctx.lineTo(g.x(i), g.y(b1));
          ctx.lineTo(g.x(i - 1), g.y(b0));
          ctx.closePath();
        }
        ctx.fillStyle = v(rising ? "--up" : "--down");
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (const [line, col] of [[ichi.tenkan, "--ma-1"], [ichi.kijun, "--ma-2"], [ichi.spanA, "--up"], [ichi.spanB, "--down"], [ichi.chikou, "--muted"]] as const) {
        ctx.strokeStyle = v(col);
        plot(ctx, g, line, g.y);
      }
      legend(legendText(`Ichimoku ${ss.ichimoku.conversion} ${ss.ichimoku.base} ${ss.ichimoku.spanB} ${ss.ichimoku.displacement}`, [ichi.tenkan[at], ichi.kijun[at], ichi.spanA[at], ichi.spanB[at]]), v("--ma-1"));
    }
    if (trendLine) {
      for (const rising of [true, false]) {
        ctx.strokeStyle = v(rising ? "--up" : "--down");
        plot(ctx, g, rising ? trendSides!.up : trendSides!.down, g.y);
      }
      legend(legendText(`Supertrend ${ss.supertrend.length} ${ss.supertrend.multiplier}`, [trendLine.value[at]]), v(trendLine.up[at] ? "--up" : "--down"));
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
      legend(`Pivots ${ss.pivotType}`, v("--muted"));
    }
    if (keltnerBands) {
      ctx.lineWidth = 1;
      for (const [line, col] of [[keltnerBands.upper, "--ma-2"], [keltnerBands.mid, "--ma-1"], [keltnerBands.lower, "--ma-2"]] as const) {
        ctx.strokeStyle = v(col);
        plot(ctx, g, line, g.y);
      }
      legend(legendText(`Keltner ${ss.keltner.ema} ${ss.keltner.atr} ${ss.keltner.multiplier}`, [keltnerBands.upper[at], keltnerBands.mid[at], keltnerBands.lower[at]]), v("--ma-2"));
    }
    if (donchianBands) {
      ctx.lineWidth = 1;
      for (const [line, col] of [[donchianBands.upper, "--up"], [donchianBands.mid, "--muted"], [donchianBands.lower, "--down"]] as const) {
        ctx.strokeStyle = v(col);
        plot(ctx, g, line, g.y);
      }
      legend(legendText(`Donchian ${ss.donchian.length}`, [donchianBands.upper[at], donchianBands.mid[at], donchianBands.lower[at]]), v("--muted"));
    }
    if (sar) {
      for (const rising of [true, false]) {
        ctx.fillStyle = v(rising ? "--up" : "--down");
        ctx.beginPath();
        for (let i = Math.max(0, g.i0); i <= g.i1; i++) {
          const val = sar.value[i];
          if (val == null || sar.up[i] !== rising) continue;
          ctx.moveTo(g.x(i) + 1.5, g.y(val));
          ctx.arc(g.x(i), g.y(val), 1.5, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      legend(legendText(`SAR ${ss.psar.step} ${ss.psar.max}`, [sar.value[at]]), v(sar.up[at] ? "--up" : "--down"));
    }
    ctx.restore();
    if (lx > PAD.l + 4) legendY += 12;
    ctx.font = `11px ${v("--font")}`;
  }

  function leftLabel(t: number, g: Geo) {
    return panes.left === "percent" ? scaleLabel(t, "percent", g.base) : g.label(t);
  }

  function paneScale(id: PaneId, g: Geo, top: number, h: number): { y: (val: number) => number; ticks: [number, string][] } {
    if (id === "macd") {
      let extent = 1e-9;
      for (const l of analysis?.series.macd ?? []) {
        for (let i = g.i0; i <= g.i1; i++) extent = Math.max(extent, Math.abs(valueAt(l, i) ?? 0));
      }
      return { y: (val) => top + h * (0.5 - val / (extent * 2.4)), ticks: [[0, "0"]] };
    }
    if (id === "obv" && onBalance) {
      let lo = Infinity, hi = -Infinity;
      for (let i = g.i0; i <= g.i1; i++) { lo = Math.min(lo, onBalance[i]); hi = Math.max(hi, onBalance[i]); }
      const span = hi - lo || 1;
      return { y: (val) => top + h * (0.92 - ((val - lo) / span) * 0.84), ticks: [[hi, volume(hi)], [lo, volume(lo)]] };
    }
    if (id === "cci" && commodity) {
      let lo = -100, hi = 100;
      for (let i = g.i0; i <= g.i1; i++) { lo = Math.min(lo, commodity[i] ?? lo); hi = Math.max(hi, commodity[i] ?? hi); }
      return { y: (val) => top + h * (0.92 - ((val - lo) / (hi - lo)) * 0.84), ticks: [[100, "100"], [0, "0"], [-100, "-100"]] };
    }
    if (id === "willr") return { y: (val) => top + (-val / 100) * h, ticks: [[-20, "-20"], [-80, "-80"]] };
    return { y: (val) => top + (1 - val / 100) * h, ticks: (id === "rsi" ? [30, 50, 70] : [20, 80]).map((t) => [t, String(t)]) };
  }

  function drawPane(ctx: CanvasRenderingContext2D, g: Geo, v: (name: string) => string, id: PaneId, top: number, h: number, ly: number, axis: "right" | "left" | null) {
    const a = analysis;
    const at = hover != null && candles[hover] ? hover : g.i1;
    const right = width - PAD.r;
    const { y, ticks } = paneScale(id, g, top, h);
    ctx.font = `10px ${v("--font")}`;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    if (axis) {
      ctx.fillStyle = v("--muted");
      ctx.textBaseline = "middle";
      ctx.textAlign = axis === "right" ? "left" : "right";
      for (const [t, label] of ticks) ctx.fillText(label, axis === "right" ? right + 8 : PAD.l - 6, y(t));
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.l, top, g.plotW, h);
    ctx.clip();
    if (axis === "right" && id !== "obv") {
      for (const [t] of ticks) {
        const solid = id === "macd" || t === 50 || (id === "cci" && t === 0);
        ctx.strokeStyle = v(solid ? "--grid" : "--muted");
        ctx.setLineDash(solid ? [] : [2, 3]);
        ctx.beginPath();
        ctx.moveTo(PAD.l, Math.round(y(t)) + 0.5);
        ctx.lineTo(right, Math.round(y(t)) + 0.5);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.lineWidth = 1.3;
    let legend = "";
    let col = v("--rsi");
    if (id === "rsi" && a) {
      col = a.series.rsi.color || col;
      ctx.strokeStyle = col;
      strokeLine(ctx, a.series.rsi, y, g);
      legend = legendText(a.series.rsi.label, [valueAt(a.series.rsi, at)], 1);
    } else if (id === "macd" && a) {
      const [line, signal, histogram] = a.series.macd;
      ctx.globalAlpha = 0.5;
      for (const rising of [true, false]) {
        ctx.beginPath();
        for (let i = g.i0; i <= g.i1; i++) {
          const value = valueAt(histogram, i);
          if (value == null || value >= 0 !== rising) continue;
          ctx.rect(g.x(i) - g.step * 0.3, Math.min(y(value), y(0)), Math.max(1, g.step * 0.6), Math.abs(y(value) - y(0)));
        }
        ctx.fillStyle = histogram.color || v(rising ? "--up" : "--down");
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      col = line.color || col;
      ctx.strokeStyle = col;
      strokeLine(ctx, line, y, g);
      ctx.strokeStyle = signal.color || v("--ma-2");
      strokeLine(ctx, signal, y, g);
      legend = legendText(line.label, a.series.macd.map((l) => valueAt(l, at)), 2);
    } else if (id === "stoch" && stoch) {
      ctx.strokeStyle = col;
      plot(ctx, g, stoch.k, y);
      ctx.strokeStyle = v("--ma-2");
      plot(ctx, g, stoch.d, y);
      legend = legendText("Stoch 14 3 3", [stoch.k[at], stoch.d[at]], 1);
    } else if (id === "cci" && commodity) {
      col = v("--ma-1");
      ctx.strokeStyle = col;
      plot(ctx, g, commodity, y);
      legend = legendText(`CCI ${ss.cci.length}`, [commodity[at]], 1);
    } else if (id === "willr" && williams) {
      col = v("--ma-2");
      ctx.strokeStyle = col;
      plot(ctx, g, williams, y);
      legend = legendText(`%R ${ss.willr.length}`, [williams[at]], 1);
    } else if (id === "mfi" && moneyFlow) {
      col = v("--accent");
      ctx.strokeStyle = col;
      plot(ctx, g, moneyFlow, y);
      legend = legendText(`MFI ${ss.mfi.length}`, [moneyFlow[at]], 1);
    } else if (id === "obv" && onBalance) {
      col = v("--accent");
      ctx.strokeStyle = col;
      plot(ctx, g, onBalance, y);
      legend = `OBV  ${volume(onBalance[at] ?? 0)}`;
    }
    ctx.restore();
    ctx.fillStyle = col;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(legend, PAD.l + 4, ly);
  }

  function drawPanes(ctx: CanvasRenderingContext2D, g: Geo, v: (name: string) => string) {
    if (g.hidePrice) ctx.clearRect(0, PAD.t, width, height - PAD.t - PAD.b);
    else g.overlays.forEach((id, k) => drawPane(ctx, g, v, id, PAD.t, g.priceH, legendY + 12 * k, k === 0 && panes.left === "off" ? "left" : null));
    for (const slot of g.slots) {
      ctx.strokeStyle = v("--grid");
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(PAD.l, Math.round(slot.top) + 0.5);
      ctx.lineTo(width - PAD.r, Math.round(slot.top) + 0.5);
      ctx.stroke();
      slot.ids.forEach((id, k) => drawPane(ctx, g, v, id, slot.top, slot.h, slot.top + 2 + 12 * k, k === 0 ? "right" : k === 1 ? "left" : null));
    }
    ctx.font = `11px ${v("--font")}`;
  }

  function paneHead(p: Pixel) {
    return geo.slots.find((s) => p.x >= PAD.l && p.x <= width - PAD.r && p.y >= s.top && p.y <= s.top + 14);
  }

  function layoutPanes(next: typeof panes) {
    if (next !== panes) setPanes(next);
  }

  function cycleLeft() {
    layoutPanes({ ...panes, left: LEFT_SCALES[(LEFT_SCALES.indexOf(panes.left) + 1) % LEFT_SCALES.length] });
  }

  const LEFT_LABELS = { off: "Off", same: "Same as right", percent: "Percent from the first visible bar" };

  const paneTools = $derived([
    ...(geo.hidePrice ? [] : [{ ids: ["price", ...geo.overlays] as Slot[], top: PAD.t }]),
    ...geo.slots.map((s) => ({ ids: s.ids as Slot[], top: s.top })),
  ]);

  $effect(() => {
    // Redraw when any of these change.
    void [rr.reward, stoch, ichi, trendLine, onBalance, keltnerBands, donchianBands, sar, commodity, williams, moneyFlow, pivotLevels, sessionKeys, redrawKey, list, preview, selected, tool, hideDrawings, orderLines, orderDrag, candles, mode, width, height, hover, linkedIndex, geo, sessions, shadeSessions, timeZone, analysis, show && { ...show }, earningsAt, ratingsAt, newsAt, dividendsAt, splitsAt, fillMarks, highlight];
    draw();
  });

  $effect(() => {
    const h = highlight;
    if (!h) return;
    untrack(() => {
      const i = indexOf.get(h.from);
      const j = indexOf.get(h.to);
      const [i0, i1] = visible(view, candles.length);
      if (i == null || j == null || (i >= i0 && j <= i1)) return;
      view = center(view, candles.length, Math.round((i + j) / 2));
      emitWindow();
    });
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
  let viewFirst = 0;
  let viewN = 0;
  let savedView: { key: string; view: View; n: number } | null = null;
  $effect(() => {
    const base = chart ? `${chart.meta.symbol} ${chart.range} ${chart.interval}${isReshaped(mode) ? ` ${mode}` : ""}` : "";
    const key = replay ? `${base} replay` : base;
    const n = candles.length;
    const current = untrack(() => view);
    const first = candles[0]?.t ?? 0;
    const added = key === viewKey && first < viewFirst ? candles.findIndex((c) => c.t >= viewFirst) : 0;
    if (added > 0) view = clamp({ start: current.start + added, count: current.count }, n);
    else if (key === viewKey) view = follow(current, viewN, n);
    else if (replay && viewKey === base) {
      savedView = { key: base, view: current, n: viewN };
      view = full(n);
    } else if (!replay && savedView?.key === key) view = follow(savedView.view, savedView.n, n);
    else view = full(n);
    if (key !== viewKey) manual = null;
    if (!replay) savedView = null;
    viewKey = key;
    viewFirst = first;
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
    const panning = !e.ctrlKey && (e.shiftKey || Math.abs(dx) >= Math.abs(e.deltaY));
    if (panning ? view.start + (dx * unit) / geo.step < 0 : e.deltaY > 0 && isFull(view, geo.n)) onolder?.();
    if (panning) view = pan(view, geo.n, (dx * unit) / geo.step);
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
  const tools: { tool: Tool; label: string; icon: string }[] = [
    { tool: "cursor", label: "Cursor", icon: "M5 3l14 8-6 2-2 6z" },
    { tool: "hline", label: "Level", icon: "M3 12h18" },
    { tool: "trend", label: "Trend", icon: "M4 19L20 5M4 19h.01M20 5h.01" },
    { tool: "text", label: "Text", icon: "M6 6V4h12v2M12 4v16M9 20h6" },
    { tool: "note", label: "Note", icon: "M5 4h14v12h-7l-4 4v-4H5z" },
    { tool: "ruler", label: "Ruler", icon: "M3.5 15.5l12-12 5 5-12 12zM7 12l2 2M10 9l2 2M13 6l2 2" },
    { tool: "pen", label: "Pen", icon: "M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" },
    { tool: "rect", label: "Box", icon: "M4 6h16v12H4z" },
    { tool: "ray", label: "Ray", icon: "M5 18L20 7M15 6.5l5 .5-1 5M5 18h.01" },
    { tool: "fib", label: "Fib", icon: "M3 4h18M3 9h18M3 15h18M3 20h18" },
    { tool: "position", label: "R:R", icon: "M4 4h16v7H4zM4 11h16v9H4z" },
    { tool: "avwap", label: "AVWAP", icon: "M4 6v14M4 18c5 0 6-8 11-8 2 0 3 1 5 1" },
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
    { tool: "vprofile", label: "Volume profile (range)" },
  ];
  const multi = (kind: string) => (POINT_COUNT[kind as Drawing["kind"]] ?? 0) >= 2;
  let placed = 0;
  let tool = $state<Tool>("cursor");
  let selected = $state<number | null>(null);
  let hideDrawings = $state(readFlag("tickr.hideDrawings"));
  let magnet = $state(readMagnet());

  function readFlag(key: string) {
    try { return localStorage.getItem(key) === "1"; } catch { return false; }
  }

  function readMagnet() {
    return readFlag("tickr.magnet");
  }

  function toggleHideDrawings() {
    hideDrawings = !hideDrawings;
    selected = null;
    try { localStorage.setItem("tickr.hideDrawings", hideDrawings ? "1" : "0"); } catch { /* storage unavailable */ }
  }

  function toggleMagnet() {
    magnet = !magnet;
    try { localStorage.setItem("tickr.magnet", magnet ? "1" : "0"); } catch { /* storage unavailable */ }
  }
  let history = $state<History>({ past: [], present: [], future: [] });
  let preview = $state<Drawing | null>(null);
  let editing = $state<{ point: DrawingPoint; x: number; y: number } | null>(null);
  let inputText = $state("");
  let noteEdit = $state<{ id: number | null; point: DrawingPoint; text: string; color: string; x: number; y: number } | null>(null);
  let notePicking = $state(false);

  function openNote(d: Drawing, x: number, y: number) {
    cancelDrawing();
    noteEdit = { id: d.id, point: d.points[0], text: d.text, color: d.color ?? "", x, y };
  }

  function saveNote() {
    const e = noteEdit;
    if (!e || drawingBusy) return;
    const text = e.text.trim();
    const now = Date.now();
    if (!text) noteEdit = null;
    else if (e.id == null) addDrawing({ id: 0, kind: "note", points: [e.point], text, color: e.color, created: now, edited: now });
    else { void changeDrawings(list.map((d) => (d.id === e.id ? { ...d, text, color: e.color, edited: now } : d))); noteEdit = null; }
  }

  function deleteNote() {
    const e = noteEdit;
    if (!e || drawingBusy) return;
    if (e.id != null) void changeDrawings(list.filter((d) => d.id !== e.id));
    noteEdit = null;
  }

  export function showNote(id: number) {
    const d = list.find((x) => x.id === id);
    const i = d ? noteBar(axisTimes, d.points[0].t) : null;
    if (i == null) return;
    if (geo.hidePrice) maxPane = null;
    view = reveal(view, geo.n, i);
    emitWindow();
  }
  let gesture: { start: Pixel; original: Drawing | null; endpoint: number; moved: boolean; second: boolean } | null = null;
  const drawingSymbol = $derived(chart?.meta.symbol.toUpperCase() ?? "");
  const list = $derived(drawings[drawingSymbol] ?? []);
  const selectedDrawing = $derived(selected == null ? null : (list.find((d) => d.id === selected) ?? null));
  const times = $derived(candles.map((c) => c.t));
  const axisTimes = $derived([...times, ...futureTimes(times, chart?.interval ?? "", clock, MAX_FUTURE)]);
  const noteMarks = $derived(hideDrawings ? [] : list.flatMap((d) => {
    const i = d.kind === "note" ? noteBar(axisTimes, d.points[0].t) : null;
    if (i == null) return [];
    const at = { x: geo.x(i), y: geo.y(d.points[0].price) };
    return inPlot(at) ? [{ d, ...at }] : [];
  }));
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
    void drawings;
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
    noteEdit = null;
    notePicking = false;
    gesture = null;
    dragX = null;
    axisY = null;
    orderDrag = null;
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
      t: Math.round(indexToTime(axisTimes, at)),
      price: snap ? snapPrice(price, candles[Math.round(at)], Math.abs(priceAt(p.y - 12) - price)) : price,
    };
  }

  function screen(p: DrawingPoint): Pixel {
    return { x: geo.x(timeToIndex(axisTimes, p.t)), y: geo.y(p.price) };
  }

  function avwapPath(d: Drawing): Pixel[] {
    return anchoredVwap(candles, d.points[0].t).flatMap((val, i) => (val == null ? [] : [{ x: geo.x(i), y: geo.y(val) }]));
  }

  function positionTargetY(d: Drawing): number {
    return geo.y(positionLevels(d.points[0].price, d.points[1].price, rr.reward).target);
  }

  function positionRight(a: Pixel, b: Pixel): number {
    return Math.max(a.x, b.x, Math.min(a.x, b.x) + 90);
  }

  function onAxis(p: Pixel) {
    return !geo.hidePrice && p.x > width - PAD.r && p.y >= PAD.t && p.y <= PAD.t + geo.priceH;
  }

  function inPlot(p: Pixel) {
    return !geo.hidePrice && p.x >= PAD.l && p.x <= width - PAD.r && p.y >= PAD.t && p.y <= PAD.t + geo.priceH;
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
          : d.kind === "prange" || d.kind === "drange" || d.kind === "vprofile" ? hitBox(p, a, b)
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
    if (e.button !== 0 || geo.n === 0 || (e.target as Element).closest(".exports, .drawing-tools, .note-marker, .note-pop, .pane-tools, input")) return;
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
      const line = onmoveorder ? orderLines.find((l) => Math.abs(geo.y(l.price) - p.y) <= 5) : undefined;
      if (line) { orderDrag = { id: line.id, price: line.price }; selected = null; return; }
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
    if (tool === "note") {
      tool = "cursor";
      noteEdit = { id: null, point: { ...point, t: snapNoteTime(axisTimes, point.t) }, text: "", color: "", x: p.x, y: p.y };
      return;
    }
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
    if (orderDrag) {
      const line = orderLines.find((l) => l.id === orderDrag!.id);
      if (line && Math.abs(geo.y(line.price) - geo.y(orderDrag.price)) > 1) onmoveorder?.(orderDrag.id, orderDrag.price);
      orderDrag = null;
    }
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
    const items = [...(hideDrawings ? [] : list.filter((d) => d.kind !== "note" && (!preview || !gesture?.original || d.id !== preview.id))), ...(preview ? [preview] : [])];
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
        const pos = positionLevels(d.points[0].price, d.points[1].price, rr.reward);
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
      } else if (d.kind === "vprofile") {
        const clampIndex = (t: number) => Math.max(0, Math.min(geo.n - 1, Math.round(timeToIndex(times, t))));
        const [i0, i1] = [clampIndex(Math.min(d.points[0].t, d.points[1].t)), clampIndex(Math.max(d.points[0].t, d.points[1].t))];
        drawProfile(ctx, geo, i0, i1, v);
        ctx.strokeRect(box.minX, box.minY, Math.max(1, box.maxX - box.minX), Math.max(1, box.maxY - box.minY));
      } else if (d.kind === "prange" || d.kind === "drange") {
        const m = rulerMeasurement(d.points[0], d.points[1], axisTimes);
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
        const label = rulerMeasurement(d.points[0], d.points[1], axisTimes).label;
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
    if (orderDrag) {
      const to = anchor(pixel(e), false).price;
      if (Number.isFinite(to) && to > 0) orderDrag = { ...orderDrag, price: to };
      hover = null;
      return;
    }
    if (moveDrawing(e)) return;
    if (tool !== "cursor" || (e.target instanceof Element && e.target.closest(".drawing-tools, .pane-tools, input"))) { hover = null; return; }
    if (dragX != null) {
      if (view.start + (dragX - e.clientX) / geo.step < 0) onolder?.();
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
    hover = Math.max(geo.i0, Math.min(geo.j1, Math.floor(view.start + (x - PAD.l) / geo.step)));
  }

  function onKey(e: KeyboardEvent) {
    if ((e.target as Element).closest("input, textarea, select, [contenteditable]")) return;
    if (!chart) return;
    if (replay && (["ArrowLeft", "ArrowRight", " "].includes(e.key) || (e.key === "Escape" && tool === "cursor" && selected == null))) return;
    let handled = true;
    if (e.ctrlKey && e.key.toLowerCase() === "z") { cancelDrawing(); void changeDrawings(e.shiftKey ? "redo" : "undo"); }
    else if ((e.key === "Delete" || e.key === "Backspace") && selected != null) removeDrawing();
    else if (e.key === "Escape" && (tool !== "cursor" || selected != null)) { cancelDrawing(); selected = null; hover = null; }
    else if (e.key === "Escape" && maxPane) maxPane = null;
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); return; }

    if (geo.n === 0 || e.ctrlKey || e.altKey || e.metaKey) return;
    const anchor = hover == null ? 1 : (hover + 0.5 - view.start) / view.count;
    if (e.key === "ArrowLeft") hover = hover == null ? geo.i1 : Math.max(0, hover - 1);
    else if (e.key === "ArrowRight") hover = hover == null ? geo.i0 : Math.min(axisTimes.length - 1, hover + 1);
    else if (e.key === "Escape") hover = null;
    else if (e.key === "+" || e.key === "=") view = zoom(view, geo.n, 1 / 1.25, anchor);
    else if (e.key === "-") view = zoom(view, geo.n, 1.25, anchor);
    else if (e.key === "0") resetView();
    else return;
    if (hover != null) {
      view = reveal(view, geo.n, hover);
      hover = Math.min(hover, geo.j1);
    }
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
    const chartPats = show?.chart_patterns ? chartPatterns.filter((p) => p.points[0].t <= c.t && c.t <= p.points[p.points.length - 1].t) : [];
    return { c, x, left, ext: isExtendedSession(sessions[hover]), rsi, macd, pats, chartPats, earn: earningsAt.get(hover), grades: ratingsAt.get(hover) ?? [], heads: newsAt.get(hover) ?? [], div: dividendsAt.get(hover), split: splitsAt.get(hover) };
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
    if ((e.target as Element).closest(".exports, .drawing-tools, .pane-tools, input")) return;
    const head = paneHead(pixel(e));
    if (head) maxPane = maxPane && head.ids.includes(maxPane as PaneId) ? null : head.ids[0];
    else if (onAxis(pixel(e))) manual = null;
    else if (tool === "cursor" && selected == null) resetView();
  }}
  onkeydown={onKey}
>
  <canvas bind:this={canvas} style:width="{width}px" style:height="{height}px"></canvas>
  {#if chart}
    <div class="drawing-bar">
    <div class="drawing-tools" role="toolbar" aria-label="Drawing tools">
      {#each tools as item}
        <button aria-label={item.label} aria-pressed={tool === item.tool} title={item.label} onclick={() => chooseTool(item.tool)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={item.icon} /></svg></button>
      {/each}
      <select aria-label="More drawing tools" value={moreTools.some((m) => m.tool === tool) ? tool : ""} onchange={(e) => chooseTool((e.currentTarget.value || "cursor") as Tool)}>
        <option value="">More</option>
        {#each moreTools as item}<option value={item.tool}>{item.label}</option>{/each}
      </select>
      <button aria-label="Undo" aria-pressed={false} title="Undo (Ctrl+Z); redo (Ctrl+Shift+Z)" disabled={!history.past.length || drawingBusy} onclick={() => { cancelDrawing(); void changeDrawings("undo"); }}>Undo</button>
      <button aria-label="Delete" aria-pressed={false} title="Delete (Delete / Backspace)" disabled={selected == null || drawingBusy || !!selectedDrawing?.locked} onclick={removeDrawing}>Delete</button>
      <button aria-label="Magnet" aria-pressed={magnet} title="Magnet: snap new points and dragged endpoints to the open, high, low or close" onclick={toggleMagnet}>Magnet</button>
      <button aria-label="Hide drawings" aria-pressed={hideDrawings} title="Hide all drawings" onclick={toggleHideDrawings}>Hide</button>
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
    </div>
  {/if}
  {#if candles.length && !geo.hidePrice}
    <div class="axis-grip" style:top="{PAD.t}px" style:width="{PAD.r}px" style:height="{geo.priceH}px"></div>
  {/if}
  {#if candles.length}
    {#each paneTools as p, k (p.ids.join())}
      {@const id = p.ids[0]}
      {@const name = p.ids.map((s) => PANE_NAMES[s]).join(" + ")}
      {@const maxed = maxPane != null && p.ids.includes(maxPane)}
      <div class="pane-tools" class:maxed role="toolbar" aria-label="{name} pane" style:top="{p.top + 2}px" style:right="{PAD.r + 4}px">
        {#if id !== "price" && !geo.hidePrice}
          <button title="Move {name} up" aria-label="Move {name} pane up" disabled={k <= 1} onclick={() => layoutPanes(movePane(panes, id, -1, paneOn))}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
          </button>
          <button title="Move {name} down" aria-label="Move {name} pane down" disabled={k === paneTools.length - 1} onclick={() => layoutPanes(movePane(panes, id, 1, paneOn))}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {#if p.ids.length === 1}
            <button title="Merge {name} into the {k === 1 ? 'price pane' : 'pane above'} on its own scale" aria-label="Merge {name} pane into the {k === 1 ? 'price pane' : 'pane above'}" onclick={() => layoutPanes(mergeUp(panes, id, paneOn))}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16M12 20V9M8 13l4-4 4 4" /></svg>
            </button>
          {/if}
        {/if}
        {#if p.ids.length > 1}
          <button title="Unmerge {name}" aria-label="Unmerge {name}" onclick={() => layoutPanes(unmerge(panes, id))}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M12 3v5M9 6l3 3 3-3M12 21v-5M9 18l3-3 3 3" /></svg>
          </button>
        {/if}
        <button title={maxed ? "Restore panes (Escape)" : `Maximize ${name} (double-click a lower pane's header)`} aria-label={maxed ? "Restore panes" : `Maximize ${name} pane`} aria-pressed={maxed} onclick={() => (maxPane = maxed ? null : id)}>
          {#if maxed}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /></svg>
          {:else}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
          {/if}
        </button>
      </div>
    {/each}
  {/if}
  {#if loadingOlder}
    <div class="older-note" role="status">Loading older candles…</div>
  {/if}
  {#if staleNote}
    <div class="stale-note" role="status">{staleNote}</div>
  {/if}
  {#if countdown}
    <div class="countdown" title="Time until this candle closes">{countdown}</div>
  {/if}
  {#each noteMarks as m (m.d.id)}
    <button class="note-marker" aria-label={`Note: ${noteTitle(m.d.text)}`} title={m.d.text.slice(0, 300)} style:left="{m.x}px" style:top="{m.y}px" style:--note={m.d.color || "var(--accent)"} onclick={() => openNote(m.d, m.x, m.y)}></button>
  {/each}
  {#if noteEdit && !geo.hidePrice}
    <div class="note-pop" role="dialog" aria-label="Note" style:left="{Math.max(4, Math.min(noteEdit.x + 10, width - 244))}px" style:top="{Math.max(4, Math.min(noteEdit.y + 10, height - 170))}px">
      <!-- svelte-ignore a11y_autofocus -->
      <textarea aria-label="Note text" rows="5" maxlength={NOTE_MAX} autofocus bind:value={noteEdit.text} onkeydown={(e) => { if (e.key === "Escape") { e.stopPropagation(); noteEdit = null; } }}></textarea>
      <div class="note-actions">
        <button aria-label="Note color" title="Note color" class="swatch" style:--swatch={noteEdit.color || "var(--accent)"} onclick={() => (notePicking = true)}></button>
        <button onclick={saveNote} disabled={drawingBusy || !noteEdit.text.trim()}>Save</button>
        {#if noteEdit.id != null}<button onclick={deleteNote} disabled={drawingBusy}>Delete</button>{/if}
        <button onclick={() => (noteEdit = null)}>Close</button>
      </div>
    </div>
    {#if notePicking}
      <ColorPicker label="Note color" value={noteEdit.color} presets={MAIN_PRESETS} onchange={(hex) => { if (noteEdit) noteEdit.color = hex; }} onreset={() => { if (noteEdit) noteEdit.color = ""; notePicking = false; }} onclose={() => (notePicking = false)} />
    {/if}
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
      <button title="Go to date" aria-label="Go to date" aria-pressed={gotoOpen} onclick={() => (gotoOpen = !gotoOpen)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
      </button>
      <button title="Left price scale: {LEFT_LABELS[panes.left]} (click to change)" aria-label="Left price scale: {LEFT_LABELS[panes.left]}" aria-pressed={panes.left !== "off"} onclick={cycleLeft}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3v18M9 7h4M9 12h7M9 17h4" /></svg>
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
  {#if gotoOpen && chart && candles.length}
    <input
      class="goto"
      type={isIntraday(chart.interval) ? "datetime-local" : "date"}
      aria-label="Go to date"
      min={dateValue(candles[0].t)}
      max={dateValue(candles[candles.length - 1].t)}
      onchange={(e) => goToDate(e.currentTarget.value)}
      onkeydown={(e) => { e.stopPropagation(); if (e.key === "Escape") gotoOpen = false; }}
      use:focusInput
    />
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
        {#if mode === "kagi" || mode === "linebreak"}
          <dt>From</dt><dd>{price(tip.c.o, chart.meta.currency)}</dd>
          <dt>To</dt><dd class={tip.c.c >= tip.c.o ? "up" : "down"}>{tip.c.c > tip.c.o ? "↑" : "↓"} {price(tip.c.c, chart.meta.currency)}</dd>
        {:else if mode === "pointfigure"}
          <dt>Column</dt><dd class={tip.c.c >= tip.c.o ? "up" : "down"}>{tip.c.c >= tip.c.o ? "X" : "O"} × {Math.round((tip.c.h - tip.c.l) / ((tip.c as Brick).box || 1))}</dd>
          <dt>Low</dt><dd>{price(tip.c.l, chart.meta.currency)}</dd>
          <dt>High</dt><dd>{price(tip.c.h, chart.meta.currency)}</dd>
        {:else}
        <dt>Open</dt><dd>{price(tip.c.o, chart.meta.currency)}</dd>
        <dt>High</dt><dd>{price(tip.c.h, chart.meta.currency)}</dd>
        <dt>Low</dt><dd>{price(tip.c.l, chart.meta.currency)}</dd>
        <dt>Close</dt><dd class={tip.c.c >= tip.c.o ? "up" : "down"}>{tip.c.c > tip.c.o ? "↑" : tip.c.c < tip.c.o ? "↓" : "→"} {price(tip.c.c, chart.meta.currency)}</dd>
        {/if}
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
        {@const info = patternInfo(p.kind)}
        {#if info}<div class="pat-info">{info.bias} · {info.text}</div>{/if}
      {/each}
      {#each tip.chartPats as p, k (k)}
        <div class="pat {p.bias === 'bullish' ? 'up' : p.bias === 'bearish' ? 'down' : ''}">{p.bias === "bullish" ? "▲" : p.bias === "bearish" ? "▼" : "•"} {p.name} <span class="pat-info">{p.confirmed ? "confirmed" : "forming"}</span></div>
        <div class="pat-info">{p.bias} · {patternInfo(p.kind)?.text}</div>
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
  .drawing-bar {
    position: absolute;
    top: 5px;
    left: 6px;
    right: 96px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    pointer-events: none;
  }
  .drawing-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    cursor: default;
    pointer-events: auto;
    background: var(--bg);
    border-radius: 4px;
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
  .drawing-tools button svg {
    display: block;
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .drawing-tools button:disabled { opacity: 0.4; }
  .drawing-tools select { font-size: 10px; padding: 2px 4px; }
  .drawing-style { align-items: center; }
  .drawing-style .swatch { width: 14px; height: 14px; padding: 0; background: var(--swatch); }
  .drawing-style .swatch[aria-pressed="true"] { background: var(--swatch); box-shadow: 0 0 0 2px var(--text); }
  .drawing-input { position: absolute; width: 200px; z-index: 2; }
  .note-marker {
    position: absolute;
    z-index: 2;
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    padding: 0;
    border: 1.5px solid var(--bg);
    border-radius: 50% 50% 50% 0;
    background: var(--note);
  }
  .note-pop {
    position: absolute;
    z-index: 3;
    width: 240px;
    padding: 6px;
    border: 1px solid var(--faint);
    border-radius: 6px;
    background: var(--bg);
    box-shadow: var(--shadow);
  }
  .note-pop textarea { box-sizing: border-box; width: 100%; resize: none; font: inherit; font-size: 12px; }
  .note-actions { display: flex; align-items: center; gap: 4px; margin-top: 4px; }
  .note-actions button { font-size: 11px; padding: 2px 8px; }
  .note-actions .swatch { width: 16px; height: 16px; padding: 0; border-radius: 50%; background: var(--swatch); }
  .goto { position: absolute; top: 34px; right: 8px; z-index: 2; cursor: default; }
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
  .older-note {
    position: absolute;
    left: 8px;
    top: 46px;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--tooltip-bg);
    color: var(--muted);
    font-size: 11px;
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
  .pane-tools {
    position: absolute;
    display: flex;
    gap: 1px;
    z-index: 1;
    cursor: default;
    opacity: 0;
    transition: opacity var(--motion-fast) var(--ease-out);
  }
  .chart:hover .pane-tools,
  .pane-tools:focus-within,
  .pane-tools.maxed {
    opacity: 1;
  }
  .pane-tools button {
    width: 18px;
    height: 18px;
    padding: 2px;
    border: 0;
    border-radius: 4px;
    background: var(--bg);
    color: var(--muted);
    cursor: pointer;
  }
  .pane-tools button:hover:not(:disabled) {
    background: var(--surface);
    color: var(--text);
  }
  .pane-tools button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .pane-tools svg {
    display: block;
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
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
  .pat-info {
    max-width: 260px;
    white-space: normal;
    color: var(--muted);
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
