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
};
const SHAPES: Record<string, ChartPatternKind> = {
  "0,1": "ascending_triangle",
  "-1,0": "descending_triangle",
  "-1,1": "symmetrical_triangle",
  "1,1": "rising_wedge",
  "-1,-1": "falling_wedge",
};

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
    if (Math.max(up.err, lo.err) > tol / 2 || w0 < 2 * tol || w1 <= 0 || w1 > 0.75 * w0) continue;
    const dir = (slope: number) => (slope * bars > tol ? 1 : slope * bars < -tol ? -1 : 0);
    const kind = SHAPES[`${dir(up.slope)},${dir(lo.slope)}`];
    if (!kind) continue;
    const bias = CHART_PATTERN_INFO[kind].bias;
    const apex = first + (bars * w0) / (w0 - w1);
    const s = settle(
      cs,
      last + 1,
      Math.min(Math.floor(apex), last + bars),
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
      quality: score(1 - (2 * Math.max(up.err, lo.err)) / tol, 1 - w1 / w0),
    });
  }
  return out;
}

const rank = (k: ChartPatternKind) => (k.includes("shoulders") ? 0 : k.startsWith("triple") ? 1 : k.startsWith("double") ? 2 : k.endsWith("flag") ? 4 : 3);

function finish(f: Found, sign: number): ChartPattern {
  const kind = sign < 0 ? (MIRROR[f.kind] ?? f.kind) : f.kind;
  const flip = (p: Point): Point => ({ i: p.i, t: p.t, price: sign * p.price });
  const { name, bias } = CHART_PATTERN_INFO[kind];
  return { ...f, kind, name, bias, points: f.points.map(flip), lines: f.lines.map(([a, b]): [Point, Point] => [flip(a), flip(b)]) };
}

export function detectChartPatterns(candles: readonly Candle[], kinds: readonly ChartPatternKind[] = CHART_PATTERN_KINDS): ChartPattern[] {
  if (candles.length < MIN_BARS) return [];
  const tol = candles.reduce((s, c) => s + c.h - c.l, 0) / candles.length;
  if (!(tol > 0)) return [];
  const flipped = candles.map((c) => ({ ...c, o: -c.o, h: -c.l, l: -c.h, c: -c.c }));
  const tops = (cs: readonly Candle[], ps: Pivot[]) => [...headAndShoulders(cs, ps, tol), ...doubleTops(cs, ps, tol), ...bullFlags(cs, ps, tol)];
  const found = SPANS.flatMap((span) => {
    const up = pivots(candles, span);
    return [...[...tops(candles, up), ...triangles(candles, up, tol)].map((f) => finish(f, 1)), ...tops(flipped, pivots(flipped, span)).map((f) => finish(f, -1))];
  });
  const kept: ChartPattern[] = [];
  const shared = (a: ChartPattern, b: ChartPattern) => a.points.filter((p) => b.points.some((q) => q.i === p.i)).length;
  for (const p of found.filter((p) => kinds.includes(p.kind)).sort((a, b) => rank(a.kind) - rank(b.kind) || b.quality - a.quality || a.start - b.start)) {
    if (kept.every((q) => shared(p, q) < 2)) kept.push(p);
  }
  return kept.sort((a, b) => a.start - b.start || a.end - b.end);
}
