<script lang="ts">
  import { alignTimes, axisTime, candleAt, candlesCsv, fullTime, netSentiment, niceTicks, num, price, quarterLabel, volume } from "./lib/format";
  import type { Analysis, Article, Chart, ChartMode, EarningsReport, Line, Overlays, Pattern, RatingChange } from "./lib/types";
  import { untrack } from "svelte";
  import { fadeIn } from "./lib/motion";
  import { follow, full, isFull, pan, reveal, visible, zoom, type View } from "./lib/viewport";

  let {
    chart,
    mode,
    analysis = null,
    overlays = null,
    earnings = [],
    ratings = [],
    news = [],
  }: {
    chart: Chart | null;
    mode: ChartMode;
    analysis?: Analysis | null;
    overlays?: Overlays | null;
    earnings?: EarningsReport[];
    ratings?: RatingChange[];
    news?: Article[];
  } = $props();

  let wrap: HTMLDivElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let width = $state(0);
  let height = $state(0);
  let hover = $state<number | null>(null);
  let copied = $state<"image" | "csv" | null>(null);
  let view = $state<View>(full(0));
  let dragX = $state<number | null>(null);

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
    // With the RSI pane: price 60%, volume 62-74%, RSI 78-100%.
    const priceH = plotH * (rsiOn ? 0.6 : 0.8);
    const volTop = PAD.t + plotH * (rsiOn ? 0.62 : 0.84);
    const volH = rsiOn ? plotH * 0.12 : plotH - (volTop - PAD.t);
    const rsiTop = PAD.t + plotH * 0.78;
    const rsiH = plotH - (rsiTop - PAD.t);
    const [i0, i1] = visible(view, n);
    let lo = Infinity;
    let hi = -Infinity;
    let vmax = 0;
    for (let i = i0; i <= i1; i++) {
      const c = candles[i];
      lo = Math.min(lo, mode === "candles" ? c.l : c.c);
      hi = Math.max(hi, mode === "candles" ? c.h : c.c);
      vmax = Math.max(vmax, c.v);
    }
    if (prevClose != null) {
      lo = Math.min(lo, prevClose);
      hi = Math.max(hi, prevClose);
    }
    // Keep overlays in view.
    if (analysis && show) {
      const fit = [
        ...(show.mas ? analysis.series.mas : []),
        ...(show.bollinger ? analysis.series.bollinger : []),
        ...(show.vwap ? [analysis.series.vwap] : []),
      ];
      for (const line of fit) {
        for (let i = i0; i <= i1; i++) {
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
      plotW,
      priceH,
      volTop,
      volH,
      rsiTop,
      rsiH,
      x: (i: number) => PAD.l + step * (i - start + 0.5),
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
      clipPlot(ctx);
      ctx.fillStyle = v("--ext-shade");
      candles.forEach((c, i) => {
        if (isExtended(c.t)) ctx.fillRect(g.x(i) - g.step / 2, PAD.t, g.step + 0.5, bottom - PAD.t);
      });
      ctx.restore();
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
      const every = Math.max(1, Math.ceil(view.count / Math.max(1, Math.floor(g.plotW / 110))));
      const off = Math.floor(every / 2);
      for (let i = off + Math.ceil((g.i0 - off) / every) * every; i <= g.i1; i += every) {
        const x = g.x(i);
        if (x < PAD.l || x > width - PAD.r) continue;
        ctx.fillText(axisTime(candles[i].t, chart.meta.gmtoffset, chart.range), x, height - 6);
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
        ctx.fillStyle = v("--bb-fill");
        ctx.fill();
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = v("--bb");
      for (const line of [up, mid, lo]) strokeLine(ctx, line, g.y, g);
      legend(mid.label, v("--bb"));
    }
    if (s.mas) {
      ctx.lineWidth = 1.2;
      a.series.mas.forEach((line, k) => {
        const col = v(`--ma-${k + 1}`);
        ctx.strokeStyle = col;
        strokeLine(ctx, line, g.y, g);
        legend(line.label, col);
      });
    }
    if (s.vwap) {
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = v("--vwap");
      strokeLine(ctx, a.series.vwap, g.y, g);
      legend(a.series.vwap.label, v("--vwap"));
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
    void [candles, mode, width, height, hover, geo, analysis, show && { ...show }, earningsAt, ratingsAt, newsAt, dividendsAt, splitsAt];
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
    const key = chart ? `${chart.meta.symbol} ${chart.range}` : "";
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

  function onDown(e: PointerEvent) {
    if (e.button !== 0 || geo.n === 0 || (e.target as Element).closest(".exports")) return;
    dragX = e.clientX;
    wrap!.setPointerCapture(e.pointerId);
  }

  function onMove(e: MouseEvent) {
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
    const rsi = show && analysis ? valueAt(analysis.series.rsi, hover) : null;
    const pats = show?.patterns ? (patternsAt.get(hover) ?? []) : [];
    return { c, x, left, ext: isExtended(c.t), rsi, pats, earn: earningsAt.get(hover), grades: ratingsAt.get(hover) ?? [], heads: newsAt.get(hover) ?? [], div: dividendsAt.get(hover), split: splitsAt.get(hover) };
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
  onpointerup={() => (dragX = null)}
  onpointercancel={() => (dragX = null)}
  onpointerleave={() => (hover = null)}
  ondblclick={(e) => {
    if (!(e.target as Element).closest(".exports")) resetView();
  }}
  onkeydown={onKey}
>
  <canvas bind:this={canvas} style:width="{width}px" style:height="{height}px"></canvas>
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
  .exports {
    position: absolute;
    top: 8px;
    left: 8px;
    display: flex;
    gap: 2px;
    cursor: default;
    opacity: 0;
    transition: opacity 0.15s;
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
