export const MULTIPLIER = 100;
export const MAX_SAVED = 3;

export type LegKind = "call" | "put" | "stock";
export type LegSide = "long" | "short";
export type PriceMode = "mid" | "natural";

export interface Leg {
  id: string;
  kind: LegKind;
  side: LegSide;
  strike: number;
  quantity: number;
  price: number;
}

export type LegInput = Omit<Leg, "id">;

export interface ChainQuote {
  strike: number;
  bid: number | null;
  ask: number | null;
  last: number | null;
}

export interface Chain {
  calls: ChainQuote[];
  puts: ChainQuote[];
}

export interface Analysis {
  netCost: number;
  maxProfit: number;
  maxLoss: number;
  breakEvens: number[];
}

export interface SavedStrategy {
  slot: number;
  name: string;
  legs: Leg[];
  visible: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export type PresetId =
  | "long_call"
  | "long_put"
  | "covered_call"
  | "bull_call_spread"
  | "bear_put_spread"
  | "straddle"
  | "strangle"
  | "iron_condor";

const EPS = 1e-9;

let seq = 0;

export function makeLeg(input: LegInput): Leg {
  seq += 1;
  return { ...input, id: `leg-${seq}` };
}

const sign = (leg: Pick<Leg, "side">) => (leg.side === "long" ? 1 : -1);

const snap = (v: number) => (Math.abs(v) < EPS ? 0 : v);

const round = (v: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f + 0;
};

export function legPnl(leg: Leg, underlying: number, multiplier = MULTIPLIER): number {
  const value =
    leg.kind === "call"
      ? Math.max(underlying - leg.strike, 0)
      : leg.kind === "put"
        ? Math.max(leg.strike - underlying, 0)
        : underlying;
  return sign(leg) * leg.quantity * multiplier * (value - leg.price) + 0;
}

export function positionPnl(legs: Leg[], underlying: number, multiplier = MULTIPLIER): number {
  return legs.reduce((sum, leg) => sum + legPnl(leg, underlying, multiplier), 0);
}

export function netCost(legs: Leg[], multiplier = MULTIPLIER): number {
  return legs.reduce((sum, leg) => sum + sign(leg) * leg.quantity * multiplier * leg.price, 0);
}

export function cleanLegs(legs: Leg[]): Leg[] {
  const out: Leg[] = [];
  for (const leg of legs) {
    const quantity = Number.isFinite(leg.quantity) ? Math.floor(leg.quantity) : 0;
    const optionStrike = leg.kind === "stock" || (Number.isFinite(leg.strike) && leg.strike >= 0);
    if (quantity < 1 || !optionStrike) continue;
    out.push({
      ...leg,
      strike: leg.kind === "stock" ? 0 : leg.strike,
      quantity,
      price: Number.isFinite(leg.price) && leg.price >= 0 ? leg.price : 0,
    });
  }
  return out;
}

export function addLeg(legs: Leg[], leg: Leg): Leg[] {
  const i = legs.findIndex((l) => l.kind === leg.kind && l.side === leg.side && l.strike === leg.strike);
  if (i < 0) return [...legs, leg];
  return legs.map((l, j) => (j === i ? { ...l, quantity: l.quantity + leg.quantity } : l));
}

function strikesOf(legs: Leg[]): number[] {
  const strikes = legs.filter((l) => l.kind !== "stock" && l.strike > 0).map((l) => l.strike);
  return [...new Set(strikes)].sort((a, b) => a - b);
}

function shape(legs: Leg[], multiplier: number) {
  const xs = [0, ...strikesOf(legs)];
  const ys = xs.map((x) => snap(positionPnl(legs, x, multiplier)));
  const slope = legs.reduce((sum, l) => (l.kind === "put" ? sum : sum + sign(l) * l.quantity * multiplier), 0);
  return { xs, ys, slope: snap(slope) };
}

export function analyze(legs: Leg[], multiplier = MULTIPLIER): Analysis {
  if (legs.length === 0) return { netCost: 0, maxProfit: 0, maxLoss: 0, breakEvens: [] };
  const { xs, ys, slope } = shape(legs, multiplier);
  const last = xs.length - 1;
  const roots: number[] = [];
  for (let i = 1; i <= last; i++) {
    if (ys[i] === 0) {
      const leftOpen = ys[i - 1] !== 0;
      const rightOpen = i < last ? ys[i + 1] !== 0 : slope !== 0;
      if (leftOpen || rightOpen) roots.push(xs[i]);
    }
  }
  for (let i = 0; i < last; i++) {
    if (ys[i] * ys[i + 1] < 0) {
      roots.push(xs[i] + (-ys[i] * (xs[i + 1] - xs[i])) / (ys[i + 1] - ys[i]));
    }
  }
  if (ys[last] * slope < 0) roots.push(xs[last] - ys[last] / slope);
  const breakEvens = roots.map((r) => round(r, 6)).sort((a, b) => a - b);
  return {
    netCost: round(netCost(legs, multiplier), 6),
    maxProfit: slope > 0 ? Infinity : round(Math.max(...ys), 6),
    maxLoss: slope < 0 ? -Infinity : round(Math.min(...ys), 6),
    breakEvens: breakEvens.filter((r, i) => i === 0 || r - breakEvens[i - 1] > EPS),
  };
}

export function payoffCurve(legs: Leg[], lo: number, hi: number, multiplier = MULTIPLIER): Point[] {
  if (!(hi > lo)) return [{ x: lo, y: positionPnl(legs, lo, multiplier) }];
  const xs = [lo, ...strikesOf(legs).filter((k) => k > lo && k < hi), hi];
  return xs.map((x) => ({ x, y: positionPnl(legs, x, multiplier) }));
}

export function priceRange(sets: Leg[][], spot: number | null): { lo: number; hi: number } | null {
  const anchors: number[] = [];
  if (spot != null && Number.isFinite(spot) && spot > 0) anchors.push(spot);
  for (const legs of sets) {
    anchors.push(...strikesOf(legs));
    anchors.push(...analyze(legs).breakEvens);
  }
  if (anchors.length === 0) return null;
  const lo = Math.min(...anchors);
  const hi = Math.max(...anchors);
  if (!(hi > 0)) return { lo: 0, hi: 1 };
  const span = Math.max(hi - lo, hi * 0.1);
  const pad = Math.max(span * 0.35, hi * 0.05);
  return { lo: Math.max(0, lo - pad), hi: hi + pad };
}

const positive = (v: number | null | undefined) => (v != null && v > 0 ? v : null);

export function entryPrice(quote: Omit<ChainQuote, "strike">, side: LegSide, mode: PriceMode): number | null {
  const { bid, ask, last } = quote;
  const mid = bid != null && ask != null && ask > 0 ? (bid + ask) / 2 : null;
  const natural = side === "long" ? positive(ask) : positive(bid);
  const price = mode === "natural" ? (natural ?? mid ?? positive(last)) : (mid ?? positive(last));
  return price == null ? null : round(price, 4);
}

interface Slot {
  kind: Exclude<LegKind, "stock">;
  side: LegSide;
  offset: number;
}

interface Shape {
  slots: Slot[];
  stock?: boolean;
}

const SHAPES: Record<PresetId, Shape> = {
  long_call: { slots: [{ kind: "call", side: "long", offset: 0 }] },
  long_put: { slots: [{ kind: "put", side: "long", offset: 0 }] },
  covered_call: { slots: [{ kind: "call", side: "short", offset: 1 }], stock: true },
  bull_call_spread: {
    slots: [
      { kind: "call", side: "long", offset: 0 },
      { kind: "call", side: "short", offset: 1 },
    ],
  },
  bear_put_spread: {
    slots: [
      { kind: "put", side: "long", offset: 0 },
      { kind: "put", side: "short", offset: -1 },
    ],
  },
  straddle: {
    slots: [
      { kind: "call", side: "long", offset: 0 },
      { kind: "put", side: "long", offset: 0 },
    ],
  },
  strangle: {
    slots: [
      { kind: "put", side: "long", offset: -1 },
      { kind: "call", side: "long", offset: 1 },
    ],
  },
  iron_condor: {
    slots: [
      { kind: "put", side: "long", offset: -2 },
      { kind: "put", side: "short", offset: -1 },
      { kind: "call", side: "short", offset: 1 },
      { kind: "call", side: "long", offset: 2 },
    ],
  },
};

export const PRESETS: { id: PresetId; label: string }[] = [
  { id: "long_call", label: "Long call" },
  { id: "long_put", label: "Long put" },
  { id: "covered_call", label: "Covered call" },
  { id: "bull_call_spread", label: "Bull call spread" },
  { id: "bear_put_spread", label: "Bear put spread" },
  { id: "straddle", label: "Straddle" },
  { id: "strangle", label: "Strangle" },
  { id: "iron_condor", label: "Iron condor" },
];

function usable(quotes: ChainQuote[], mode: PriceMode): Map<number, ChainQuote> {
  const out = new Map<number, ChainQuote>();
  for (const q of quotes) {
    if (!Number.isFinite(q.strike) || q.strike <= 0) continue;
    if (entryPrice(q, "long", mode) == null || entryPrice(q, "short", mode) == null) continue;
    out.set(q.strike, q);
  }
  return out;
}

export function presetLegs(
  id: PresetId,
  chain: Chain,
  spot: number | null,
  mode: PriceMode = "mid",
): LegInput[] | null {
  const shapeOf = SHAPES[id];
  const calls = usable(chain.calls, mode);
  const puts = usable(chain.puts, mode);
  const needCalls = shapeOf.slots.some((s) => s.kind === "call");
  const needPuts = shapeOf.slots.some((s) => s.kind === "put");
  const strikes = [...(needCalls ? calls : puts).keys()]
    .filter((k) => (!needCalls || calls.has(k)) && (!needPuts || puts.has(k)))
    .sort((a, b) => a - b);
  const down = Math.max(0, ...shapeOf.slots.map((s) => -s.offset));
  const up = Math.max(0, ...shapeOf.slots.map((s) => s.offset));
  const n = strikes.length;
  if (n < down + up + 1) return null;
  if (shapeOf.stock && (spot == null || !(spot > 0))) return null;
  let atm = Math.floor(n / 2);
  if (spot != null && spot > 0) {
    atm = 0;
    for (let i = 1; i < n; i++) {
      if (Math.abs(strikes[i] - spot) < Math.abs(strikes[atm] - spot)) atm = i;
    }
  }
  const center = Math.min(Math.max(atm, down), n - 1 - up);
  const legs: LegInput[] = [];
  if (shapeOf.stock) legs.push({ kind: "stock", side: "long", strike: 0, quantity: 1, price: spot as number });
  for (const slot of shapeOf.slots) {
    const strike = strikes[center + slot.offset];
    const quote = (slot.kind === "call" ? calls : puts).get(strike) as ChainQuote;
    legs.push({
      kind: slot.kind,
      side: slot.side,
      strike,
      quantity: 1,
      price: entryPrice(quote, slot.side, mode) ?? 0,
    });
  }
  return legs;
}

export function saveStrategy(saved: SavedStrategy[], name: string, legs: Leg[]): SavedStrategy[] | null {
  const kept = legs.filter((l) => l.quantity > 0);
  if (kept.length === 0 || saved.length >= MAX_SAVED) return null;
  const slot = Array.from({ length: MAX_SAVED }, (_, i) => i).find((s) => !saved.some((x) => x.slot === s)) ?? 0;
  const base = name.trim() || `Strategy ${slot + 1}`;
  const unique = saved.some((s) => s.name === base) ? `${base} (${slot + 1})` : base;
  return [...saved, { slot, name: unique, legs: kept.map((l) => ({ ...l })), visible: true }];
}
