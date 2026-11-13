import type { Candle, ChartMode } from "./types";

export const CHART_MODES: { id: ChartMode; label: string }[] = [
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
  { id: "baseline", label: "Baseline" },
  { id: "candles", label: "Candles" },
  { id: "hollow", label: "Hollow" },
  { id: "bars", label: "Bars" },
  { id: "heikin", label: "Heikin Ashi" },
  { id: "renko", label: "Renko" },
  { id: "range", label: "Range bars" },
  { id: "linebreak", label: "Line break" },
  { id: "kagi", label: "Kagi" },
  { id: "pointfigure", label: "Point & Figure" },
];

export function nextMode(mode: ChartMode): ChartMode {
  const i = CHART_MODES.findIndex((m) => m.id === mode);
  return CHART_MODES[(i + 1) % CHART_MODES.length].id;
}

export function isOhlc(mode: ChartMode): boolean {
  return mode !== "line" && mode !== "area" && mode !== "baseline";
}

export function heikinAshi(candles: readonly Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const k of candles) {
    const prev = out[out.length - 1];
    const c = (k.o + k.h + k.l + k.c) / 4;
    const o = prev ? (prev.o + prev.c) / 2 : (k.o + k.c) / 2;
    out.push({ ...k, o, c, h: Math.max(k.h, o, c), l: Math.min(k.l, o, c) });
  }
  return out;
}

export function brickSize(candles: readonly Candle[], length = 14): number {
  const n = candles.length;
  if (n === 0) return 0;
  let sum = 0;
  let count = 0;
  for (let i = Math.max(1, n - length); i < n; i++) {
    const k = candles[i];
    const pc = candles[i - 1].c;
    sum += Math.max(k.h - k.l, Math.abs(k.h - pc), Math.abs(k.l - pc));
    count++;
  }
  const atr = count ? sum / count : 0;
  return atr > 0 ? atr : Math.abs(candles[n - 1].c) * 0.01;
}

export const RENKO_MAX = 5000;

export function renko(candles: readonly Candle[], size = brickSize(candles)): Candle[] {
  const out: Candle[] = [];
  if (!candles.length || !(size > 0)) return out;
  let top = candles[0].c;
  let bottom = top;
  let v = 0;
  for (const k of candles) {
    v += k.v;
    while (k.c >= top + size || k.c <= bottom - size) {
      const up = k.c >= top + size;
      const o = up ? top : bottom;
      const c = up ? top + size : bottom - size;
      out.push({ ...k, o, c, h: Math.max(o, c), l: Math.min(o, c), v });
      v = 0;
      if (up) { bottom = top; top = c; } else { top = bottom; bottom = c; }
      if (out.length >= RENKO_MAX) return out;
    }
  }
  return out;
}

export interface Brick extends Candle {
  box?: number;
  thick?: boolean;
  flip?: number;
}

export interface TypeSettings {
  rangeSize: number;
  lineBreak: number;
  kagiAmount: number;
  kagiPercent: boolean;
  pfBox: number;
  pfReversal: number;
}

export const TYPE_DEFAULTS: TypeSettings = { rangeSize: 0, lineBreak: 3, kagiAmount: 0, kagiPercent: false, pfBox: 0, pfReversal: 3 };

export function cleanTypeSettings(v: unknown): TypeSettings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const num = (key: keyof TypeSettings, min: number, max: number, int: boolean) => {
    const n = Number(o[key]);
    if (o[key] == null || !Number.isFinite(n)) return TYPE_DEFAULTS[key] as number;
    return Math.min(max, Math.max(min, int ? Math.round(n) : n));
  };
  return {
    rangeSize: num("rangeSize", 0, 1e9, false),
    lineBreak: num("lineBreak", 2, 5, true),
    kagiAmount: num("kagiAmount", 0, 1e9, false),
    kagiPercent: o.kagiPercent === true,
    pfBox: num("pfBox", 0, 1e9, false),
    pfReversal: num("pfReversal", 1, 9, true),
  };
}

export const RESHAPED: ChartMode[] = ["renko", "range", "linebreak", "kagi", "pointfigure"];

export function isReshaped(mode: ChartMode): boolean {
  return RESHAPED.includes(mode);
}

export function rangeBars(candles: readonly Candle[], size = brickSize(candles)): Candle[] {
  const out: Candle[] = [];
  if (!candles.length || !(size > 0)) return out;
  const eps = size * 1e-9;
  let pend = 0;
  for (const k of candles) {
    pend += k.v;
    for (const p of k.c >= k.o ? [k.o, k.l, k.h, k.c] : [k.o, k.h, k.l, k.c]) {
      let cur = out[out.length - 1];
      if (!cur) {
        cur = { t: k.t, o: p, h: p, l: p, c: p, v: 0 };
        out.push(cur);
      }
      while (Math.max(cur.h, p) - Math.min(cur.l, p) > size + eps) {
        const up = p > cur.h;
        if (up) cur.h = cur.l + size;
        else cur.l = cur.h - size;
        cur.c = up ? cur.h : cur.l;
        cur = { t: k.t, o: cur.c, h: cur.c, l: cur.c, c: cur.c, v: 0 };
        out.push(cur);
        if (out.length >= RENKO_MAX) return out;
      }
      cur.h = Math.max(cur.h, p);
      cur.l = Math.min(cur.l, p);
      cur.c = p;
    }
    out[out.length - 1].v += pend;
    pend = 0;
  }
  return out;
}

export function lineBreak(candles: readonly Candle[], count = 3): Candle[] {
  const out: Candle[] = [];
  if (candles.length < 2) return out;
  const first = candles[0].c;
  let pend = 0;
  for (let i = 1; i < candles.length; i++) {
    const k = candles[i];
    pend += k.v;
    const last = out[out.length - 1];
    let open: number | undefined;
    if (!last) {
      if (k.c !== first) open = first;
    } else {
      const up = last.c > last.o;
      if (up ? k.c > last.c : k.c < last.c) open = last.c;
      else {
        const win = out.slice(-count);
        if (up ? k.c < Math.min(...win.map((l) => l.l)) : k.c > Math.max(...win.map((l) => l.h))) open = last.o;
      }
    }
    if (open !== undefined) out.push({ t: k.t, o: open, h: Math.max(open, k.c), l: Math.min(open, k.c), c: k.c, v: 0 });
    if (out.length) {
      out[out.length - 1].v += pend;
      pend = 0;
    }
  }
  return out;
}

export function kagi(candles: readonly Candle[], amount = brickSize(candles), percent = false): Brick[] {
  const out: Brick[] = [];
  if (candles.length < 2 || !(amount > 0)) return out;
  const first = candles[0].c;
  const need = (at: number) => (percent ? (Math.abs(at) * amount) / 100 : amount) * (1 - 1e-9);
  const line = (t: number, o: number, c: number, thick: boolean): Brick => ({ t, o, c, h: Math.max(o, c), l: Math.min(o, c), v: 0, thick });
  let level: number | undefined;
  let pend = 0;
  const settle = (b: Brick) => {
    if (level === undefined || b.flip !== undefined) return;
    if (b.c > b.o ? !b.thick && b.c > level : b.thick && b.c < level) b.flip = level;
  };
  for (let i = 1; i < candles.length; i++) {
    const k = candles[i];
    pend += k.v;
    const last = out[out.length - 1];
    if (!last) {
      if (Math.abs(k.c - first) >= need(first)) out.push(line(k.t, first, k.c, false));
    } else if (last.c > last.o ? k.c > last.c : k.c < last.c) {
      last.c = k.c;
      last.h = Math.max(last.o, k.c);
      last.l = Math.min(last.o, k.c);
      settle(last);
    } else if (Math.abs(k.c - last.c) >= need(last.c)) {
      const next = line(k.t, last.c, k.c, last.flip === undefined ? !!last.thick : !last.thick);
      level = last.o;
      out.push(next);
      settle(next);
    }
    if (out.length) {
      out[out.length - 1].v += pend;
      pend = 0;
    }
  }
  return out;
}

export function pointFigure(candles: readonly Candle[], box = brickSize(candles), reversal = 3): Brick[] {
  const out: Brick[] = [];
  if (!candles.length || !(box > 0)) return out;
  const at = (p: number) => Math.floor(p / box + 1e-9);
  const ref = at(candles[0].c);
  let up = true;
  let lo = 0;
  let hi = 0;
  let pend = 0;
  const shape = (t: number, v: number): Brick => ({ t, o: up ? lo * box : (hi + 1) * box, c: up ? (hi + 1) * box : lo * box, h: (hi + 1) * box, l: lo * box, v, box });
  for (const k of candles) {
    pend += k.v;
    const i = at(k.c);
    const last = out[out.length - 1];
    let fresh = false;
    if (!last) {
      if (i !== ref) {
        up = i > ref;
        lo = Math.min(ref, i);
        hi = Math.max(ref, i);
        fresh = true;
      }
    } else if (up) {
      if (i > hi) {
        hi = i;
        Object.assign(last, shape(last.t, last.v));
      } else if (i <= hi - reversal) {
        up = false;
        hi -= 1;
        lo = i;
        fresh = true;
      }
    } else if (i < lo) {
      lo = i;
      Object.assign(last, shape(last.t, last.v));
    } else if (i >= lo + reversal) {
      up = true;
      lo += 1;
      hi = i;
      fresh = true;
    }
    if (fresh) out.push(shape(k.t, 0));
    if (out.length) {
      out[out.length - 1].v += pend;
      pend = 0;
    }
  }
  return out;
}

export function displayCandles(candles: Candle[], mode: ChartMode, s: TypeSettings = TYPE_DEFAULTS): Candle[] {
  switch (mode) {
    case "heikin": return heikinAshi(candles);
    case "renko": return renko(candles);
    case "range": return rangeBars(candles, s.rangeSize > 0 ? s.rangeSize : undefined);
    case "linebreak": return lineBreak(candles, s.lineBreak);
    case "kagi": return s.kagiAmount > 0 ? kagi(candles, s.kagiAmount, s.kagiPercent) : kagi(candles);
    case "pointfigure": return pointFigure(candles, s.pfBox > 0 ? s.pfBox : undefined, s.pfReversal);
    default: return candles;
  }
}
