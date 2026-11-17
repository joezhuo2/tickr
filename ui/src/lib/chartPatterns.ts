import { CHART_PATTERN_INFO, CHART_PATTERN_KINDS, type Bias, type ChartPatternKind } from "./patternInfo";
import type { Candle } from "./types";

export interface Point {
  i: number;
  t: number;
  price: number;
}

export interface Pivot extends Point {
  high: boolean;
}

export interface ChartPattern {
  kind: ChartPatternKind;
  name: string;
  bias: Bias;
  start: number;
  end: number;
  points: Point[];
  lines: [Point, Point][];
  confirmed: boolean;
  quality: number;
}

type Found = Pick<ChartPattern, "kind" | "start" | "end" | "points" | "lines" | "confirmed" | "quality">;

export const MIN_BARS = 20;
const SPANS = [3, 6];
const MIRROR: Partial<Record<ChartPatternKind, ChartPatternKind>> = {
  head_and_shoulders: "inverse_head_and_shoulders",
  triple_top: "triple_bottom",
  double_top: "double_bottom",
  bull_flag: "bear_flag",
  bull_pennant: "bear_pennant",
  bullish_fvg: "bearish_fvg",
  bearish_sweep: "bullish_sweep",
};
const SHAPES: Record<string, ChartPatternKind> = {
  "0,1": "ascending_triangle",
  "-1,0": "descending_triangle",
  "-1,1": "symmetrical_triangle",
  "1,1": "rising_wedge",
  "-1,-1": "falling_wedge",
};
const CHANNELS: Record<string, ChartPatternKind> = { "0,0": "rectangle", "1,1": "rising_channel", "-1,-1": "falling_channel" };
const RANK: ChartPatternKind[][] = [
  ["head_and_shoulders", "inverse_head_and_shoulders"],
  ["triple_top", "triple_bottom"],
  ["double_top", "double_bottom"],
  ["cup_and_handle"],
  ["bull_pennant", "bear_pennant"],
  Object.values(SHAPES),
  Object.values(CHANNELS),
  ["bull_flag", "bear_flag"],
  ["bullish_sweep", "bearish_sweep"],
  ["bullish_fvg", "bearish_fvg"],
];

export function pivots(candles: readonly Candle[], span: number): Pivot[] {
  const out: Pivot[] = [];
  for (let i = span; i + span < candles.length; i++) {
    let high = true;
    let low = true;
    for (let j = i - span; j <= i + span; j++) {
      if (j === i) continue;
      if (j > i ? candles[j].h >= candles[i].h : candles[j].h > candles[i].h) high = false;
      if (j > i ? candles[j].l <= candles[i].l : candles[j].l < candles[i].l) low = false;
    }
    if (high === low) continue;
    const p: Pivot = { i, t: candles[i].t, price: high ? candles[i].h : candles[i].l, high };
    const last = out[out.length - 1];
    if (last?.high !== p.high) out.push(p);
    else if (high ? p.price > last.price : p.price < last.price) out[out.length - 1] = p;
  }
  return out;
}

const at = (cs: readonly Candle[], i: number, price: number): Point => ({ i, t: cs[i].t, price });
const through = (a: Point, b: Point) => (i: number) => a.price + ((b.price - a.price) * (i - a.i)) / (b.i - a.i);
const score = (...parts: number[]) => Math.round((parts.reduce((s, x) => s + Math.min(1, Math.max(0, x)), 0) / parts.length) * 100) / 100;

function settle(cs: readonly Candle[], from: number, limit: number, confirm: (c: Candle, i: number) => boolean, fail: (c: Candle, i: number) => boolean) {
  const last = Math.min(limit, cs.length - 1);
  for (let i = from; i <= last; i++) {
    if (fail(cs[i], i)) return null;
    if (confirm(cs[i], i)) return { end: i, to: i, confirmed: true };
  }
  return limit >= cs.length - 1 ? { end: from - 1, to: cs.length - 1, confirmed: false } : null;
}

function fit(ps: readonly Point[]) {
  const mi = ps.reduce((s, p) => s + p.i, 0) / ps.length;
  const mp = ps.reduce((s, p) => s + p.price, 0) / ps.length;
  const den = ps.reduce((s, p) => s + (p.i - mi) ** 2, 0);
  const slope = den ? ps.reduce((s, p) => s + (p.i - mi) * (p.price - mp), 0) / den : 0;
  const value = (i: number) => mp + slope * (i - mi);
  return { slope, value, err: Math.max(...ps.map((p) => Math.abs(p.price - value(p.i)))) };
}

function doubleTops(cs: readonly Candle[], ps: readonly Pivot[], tol: number): Found[] {
  const out: Found[] = [];
  for (let k = 0; k + 2 < ps.length; k++) {
    const [a, m, b] = [ps[k], ps[k + 1], ps[k + 2]];
    const prior = ps[k - 1];
    const top = Math.max(a.price, b.price);
    const diff = Math.abs(a.price - b.price);
    const depth = Math.min(a.price, b.price) - m.price;
    if (!a.high || diff > tol || depth < 3 * tol || (prior && prior.price > m.price)) continue;
    const s = settle(cs, b.i + 1, 2 * b.i - a.i, (c) => c.c < m.price, (c) => c.c > top + tol);
    if (!s) continue;
    out.push({ kind: "double_top", start: a.i, end: s.end, points: [a, m, b], lines: [[at(cs, a.i, m.price), at(cs, s.to, m.price)]], confirmed: s.confirmed, quality: score(1 - diff / tol / 2, depth / (6 * tol)) });
  }
  return out;
}

function headAndShoulders(cs: readonly Candle[], ps: readonly Pivot[], tol: number): Found[] {
  const out: Found[] = [];
  for (let k = 0; k + 4 < ps.length; k++) {
    const [ls, l1, hd, l2, rs] = ps.slice(k, k + 5);
    const prior = ps[k - 1];
    const neck = through(l1, l2);
    const top = Math.max(ls.price, hd.price, rs.price);
    const height = top - Math.max(l1.price, l2.price);
    const sides = (rs.i - hd.i) / (hd.i - ls.i);
    const lift = hd.price - Math.max(ls.price, rs.price);
    const spread = top - Math.min(ls.price, hd.price, rs.price);
    if (!ls.high || (prior && prior.price > Math.min(l1.price, l2.price))) continue;
    if (Math.abs(l1.price - l2.price) > height / 2 || sides < 0.4 || sides > 2.5) continue;
    const head = lift >= tol && Math.abs(ls.price - rs.price) <= height / 2 && Math.min(ls.price - l1.price, rs.price - l2.price) >= tol;
    const triple = !head && spread <= tol && height >= 3 * tol;
    if (!head && !triple) continue;
    const s = settle(cs, rs.i + 1, 2 * rs.i - ls.i, (c, i) => c.c < neck(i), (c) => c.c > top + (triple ? tol : 0));
    if (!s) continue;
    const symmetry = Math.min(sides, 1 / sides);
    const quality = head ? score(1 - Math.abs(ls.price - rs.price) / height, symmetry, 1 - Math.abs(l1.price - l2.price) / height) : score(1 - spread / tol / 2, height / (6 * tol), symmetry);
    out.push({ kind: head ? "head_and_shoulders" : "triple_top", start: ls.i, end: s.end, points: [ls, l1, hd, l2, rs], lines: [[at(cs, ls.i, neck(ls.i)), at(cs, s.to, neck(s.to))]], confirmed: s.confirmed, quality });
  }
  return out;
}

function bullFlags(cs: readonly Candle[], ps: readonly Pivot[], tol: number): Found[] {
  const out: Found[] = [];
  for (let k = 0; k + 3 < ps.length; k++) {
    const [p0, p1, l1, p2] = ps.slice(k, k + 4);
    const pole = p1.price - p0.price;
    const poleBars = p1.i - p0.i;
    const flagBars = p2.i - p1.i;
    const pullback = (p1.price - l1.price) / pole;
    if (p0.high || pole < 4 * tol || !(pullback > 0) || pullback > 0.5 || p2.price > p1.price + tol / 2 || flagBars > 3 * poleBars) continue;
    const slope = (p2.price - p1.price) / flagBars;
    const upper = (i: number) => p1.price + slope * (i - p1.i);
    const lower = (i: number) => l1.price + slope * (i - l1.i);
    const s = settle(cs, p2.i + 1, p2.i + flagBars, (c, i) => c.c > upper(i), (c) => c.c < p1.price - pole * 0.6);
    if (!s) continue;
    out.push({
      kind: "bull_flag",
      start: p0.i,
      end: s.end,
      points: [p0, p1, l1, p2],
      lines: [[at(cs, p1.i, p1.price), at(cs, s.to, upper(s.to))], [at(cs, p1.i, lower(p1.i)), at(cs, s.to, lower(s.to))]],
      confirmed: s.confirmed,
      quality: score(1 - pullback * 1.5, pole / (8 * tol)),
    });
  }
  return out;
}

function pennants(cs: readonly Candle[], ps: readonly Pivot[], tol: number): Found[] {
  const out: Found[] = [];
  for (let k = 0; k + 4 < ps.length; k++) {
    const [p0, p1, l1, p2, l2] = ps.slice(k, k + 5);
    const pole = p1.price - p0.price;
    const bars = l2.i - p1.i;
    const pullback = (p1.price - Math.min(l1.price, l2.price)) / pole;
    if (p0.high || pole < 4 * tol || !(pullback > 0) || pullback > 0.5 || bars > 3 * (p1.i - p0.i) || p2.price >= p1.price || l2.price <= l1.price) continue;
    const upper = through(p1, p2);
    const lower = through(l1, l2);
    const w0 = upper(p1.i) - lower(p1.i);
    const w1 = upper(l2.i) - lower(l2.i);
    if (w1 <= 0 || w1 > 0.75 * w0) continue;
    const s = settle(cs, l2.i + 1, Math.min(Math.floor(p1.i + (bars * w0) / (w0 - w1)), l2.i + bars), (c, i) => c.c > upper(i), (c, i) => c.c < lower(i));
    if (!s) continue;
    out.push({
      kind: "bull_pennant",
      start: p0.i,
      end: s.end,
      points: [p0, p1, l1, p2, l2],
      lines: [[at(cs, p1.i, p1.price), at(cs, s.to, upper(s.to))], [at(cs, p1.i, lower(p1.i)), at(cs, s.to, lower(s.to))]],
      confirmed: s.confirmed,
      quality: score(1 - pullback * 1.5, pole / (8 * tol), 1 - w1 / w0),
    });
  }
  return out;
}

function cups(cs: readonly Candle[], ps: readonly Pivot[], tol: number): Found[] {
  const out: Found[] = [];
  for (let k = 0; k + 3 < ps.length; k++) {
    const [a, m, b, h] = ps.slice(k, k + 4);
    const top = Math.max(a.price, b.price);
    const depth = Math.min(a.price, b.price) - m.price;
    const diff = Math.abs(a.price - b.price);
    const sides = (b.i - m.i) / (m.i - a.i);
    const handle = (b.price - h.price) / depth;
    if (!a.high || depth < 3 * tol || diff > Math.max(tol, depth / 10) || sides < 0.5 || sides > 2 || !(handle > 0) || handle > 0.5 || h.i - b.i > (b.i - a.i) / 2) continue;
    const round = cs.slice(a.i, b.i + 1).filter((c) => c.l <= m.price + depth / 3).length / (b.i - a.i + 1);
    if (round < 0.45) continue;
    const s = settle(cs, h.i + 1, h.i + Math.floor((b.i - a.i) / 2), (c) => c.c > top, (c) => c.c < m.price + depth / 2);
    if (!s) continue;
    out.push({ kind: "cup_and_handle", start: a.i, end: s.end, points: [a, m, b, h], lines: [[at(cs, a.i, top), at(cs, s.to, top)]], confirmed: s.confirmed, quality: score(1 - diff / depth, round, 1 - handle) });
  }
  return out;
}

function gaps(cs: readonly Candle[], tol: number): Found[] {
  const out: Found[] = [];
  for (let i = 2; i < cs.length; i++) {
    const lo = cs[i - 2].h;
    const hi = cs[i].l;
    if (hi - lo < tol / 2) continue;
    if (cs.some((c, j) => j > i && c.l <= lo)) continue;
    const entry = cs.findIndex((c, j) => j > i && c.l < hi);
    const back = entry < 0 ? -1 : cs.findIndex((c, j) => j >= entry && c.c > hi);
    const to = cs.length - 1;
    out.push({ kind: "bullish_fvg", start: i - 2, end: back < 0 ? i : back, points: [at(cs, i - 2, lo), at(cs, i, hi)], lines: [[at(cs, i - 2, hi), at(cs, to, hi)], [at(cs, i - 2, lo), at(cs, to, lo)]], confirmed: back >= 0, quality: score((hi - lo) / tol) });
  }
  return out.slice(-3);
}

function sweeps(cs: readonly Candle[], ps: readonly Pivot[], look: number, tol: number): Found[] {
  const out: Found[] = [];
  for (const p of ps.filter((p) => p.high)) {
    for (let j = p.i + 1; j < Math.min(cs.length, p.i + look); j++) {
      if (cs[j].c > p.price) break;
      if (cs[j].h <= p.price + tol / 10) continue;
      const confirmed = j + 1 < cs.length && cs[j + 1].c < cs[j].c;
      out.push({ kind: "bearish_sweep", start: p.i, end: confirmed ? j + 1 : j, points: [p, at(cs, j, cs[j].h)], lines: [[at(cs, p.i, p.price), at(cs, j, p.price)]], confirmed, quality: score(1 - (j - p.i) / look) });
      break;
    }
  }
  return out;
}

function triangles(cs: readonly Candle[], ps: readonly Pivot[], tol: number): Found[] {
  const out: Found[] = [];
  for (let k = 0; k + 4 < ps.length; k++) {
    const w = ps.slice(k, k + 5);
    const up = fit(w.filter((p) => p.high));
    const lo = fit(w.filter((p) => !p.high));
    const first = w[0].i;
    const last = w[4].i;
    const bars = last - first;
    const w0 = up.value(first) - lo.value(first);
    const w1 = up.value(last) - lo.value(last);
    const conv = w1 <= 0.75 * w0;
    if (Math.max(up.err, lo.err) > tol / 2 || w0 < (conv ? 2 : 3) * tol || w1 <= 0 || (!conv && Math.abs(w1 - w0) > 0.25 * w0)) continue;
    const dir = (slope: number) => (slope * bars > tol ? 1 : slope * bars < -tol ? -1 : 0);
    const kind = (conv ? SHAPES : CHANNELS)[`${dir(up.slope)},${dir(lo.slope)}`];
    if (!kind) continue;
    const bias = CHART_PATTERN_INFO[kind].bias;
    const s = settle(
      cs,
      last + 1,
      conv ? Math.min(Math.floor(first + (bars * w0) / (w0 - w1)), last + bars) : last + bars,
      (c, i) => (bias !== "bearish" && c.c > up.value(i)) || (bias !== "bullish" && c.c < lo.value(i)),
      (c, i) => (bias === "bullish" && c.c < lo.value(i)) || (bias === "bearish" && c.c > up.value(i)),
    );
    if (!s) continue;
    out.push({
      kind,
      start: first,
      end: s.end,
      points: w,
      lines: [[at(cs, first, up.value(first)), at(cs, s.to, up.value(s.to))], [at(cs, first, lo.value(first)), at(cs, s.to, lo.value(s.to))]],
      confirmed: s.confirmed,
      quality: score(1 - (2 * Math.max(up.err, lo.err)) / tol, conv ? 1 - w1 / w0 : 1 - (4 * Math.abs(w1 - w0)) / w0),
    });
  }
  return out;
}

const rank = (k: ChartPatternKind) => RANK.findIndex((r) => r.includes(k));

function finish(f: Found, sign: number): ChartPattern {
  const kind = sign < 0 ? (MIRROR[f.kind] ?? f.kind) : f.kind;
  const flip = (p: Point): Point => ({ i: p.i, t: p.t, price: sign * p.price });
  const { name, bias } = CHART_PATTERN_INFO[kind];
  return { ...f, kind, name, bias, points: f.points.map(flip), lines: f.lines.map(([a, b]): [Point, Point] => [flip(a), flip(b)]) };
}

export function detectChartPatterns(candles: readonly Candle[], kinds: readonly ChartPatternKind[] = CHART_PATTERN_KINDS, minBars = MIN_BARS): ChartPattern[] {
  if (candles.length < minBars) return [];
  const tol = candles.reduce((s, c) => s + c.h - c.l, 0) / candles.length;
  if (!(tol > 0)) return [];
  const flipped = candles.map((c) => ({ ...c, o: -c.o, h: -c.l, l: -c.h, c: -c.c }));
  const tops = (cs: readonly Candle[], ps: Pivot[], span: number) => [...headAndShoulders(cs, ps, tol), ...doubleTops(cs, ps, tol), ...bullFlags(cs, ps, tol), ...pennants(cs, ps, tol), ...sweeps(cs, ps, 10 * span, tol)];
  const found = SPANS.flatMap((span) => {
    const up = pivots(candles, span);
    return [...[...tops(candles, up, span), ...triangles(candles, up, tol), ...cups(candles, up, tol)].map((f) => finish(f, 1)), ...tops(flipped, pivots(flipped, span), span).map((f) => finish(f, -1))];
  });
  found.push(...gaps(candles, tol).map((f) => finish(f, 1)), ...gaps(flipped, tol).map((f) => finish(f, -1)));
  const kept: ChartPattern[] = [];
  const shared = (a: ChartPattern, b: ChartPattern) => a.points.filter((p) => b.points.some((q) => q.i === p.i)).length;
  for (const p of found.filter((p) => kinds.includes(p.kind)).sort((a, b) => rank(a.kind) - rank(b.kind) || b.quality - a.quality || a.start - b.start)) {
    if (kept.every((q) => shared(p, q) < 2)) kept.push(p);
  }
  return kept.sort((a, b) => a.start - b.start || a.end - b.end);
}
