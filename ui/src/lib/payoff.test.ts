import { describe, expect, it } from "vitest";
import {
  MAX_SAVED,
  MULTIPLIER,
  PRESETS,
  addLeg,
  analyze,
  cleanLegs,
  entryPrice,
  legPnl,
  makeLeg,
  netCost,
  payoffCurve,
  positionPnl,
  presetLegs,
  priceRange,
  saveStrategy,
  type Chain,
  type ChainQuote,
  type Leg,
  type LegKind,
  type LegSide,
  type PresetId,
} from "./payoff";

const leg = (kind: LegKind, side: LegSide, strike: number, price: number, quantity = 1): Leg =>
  makeLeg({ kind, side, strike, quantity, price });

const call = (side: LegSide, strike: number, price: number, quantity = 1) => leg("call", side, strike, price, quantity);
const put = (side: LegSide, strike: number, price: number, quantity = 1) => leg("put", side, strike, price, quantity);
const stock = (side: LegSide, price: number, quantity = 1) => leg("stock", side, 0, price, quantity);

describe("multiplier", () => {
  it("is 100 shares per contract", () => {
    expect(MULTIPLIER).toBe(100);
  });

  it("scales every dollar figure", () => {
    const legs = [call("long", 100, 3)];
    expect(positionPnl(legs, 110)).toBe(700);
    expect(positionPnl(legs, 110, 10)).toBe(70);
    expect(positionPnl(legs, 110, 1)).toBe(7);
    expect(netCost(legs, 10)).toBe(30);
    expect(analyze(legs, 1).maxLoss).toBe(-3);
    expect(analyze(legs, 10).breakEvens).toEqual([103]);
  });
});

describe("single legs", () => {
  it("prices a long call at expiry", () => {
    const l = call("long", 100, 3);
    expect(legPnl(l, 90)).toBe(-300);
    expect(legPnl(l, 100)).toBe(-300);
    expect(legPnl(l, 103)).toBe(0);
    expect(legPnl(l, 110)).toBe(700);
  });

  it("prices a short call as the mirror image", () => {
    const l = call("short", 100, 3);
    expect(legPnl(l, 90)).toBe(300);
    expect(legPnl(l, 103)).toBe(0);
    expect(legPnl(l, 110)).toBe(-700);
  });

  it("prices a long put at expiry", () => {
    const l = put("long", 100, 2.5);
    expect(legPnl(l, 110)).toBe(-250);
    expect(legPnl(l, 97.5)).toBe(0);
    expect(legPnl(l, 90)).toBe(750);
    expect(legPnl(l, 0)).toBe(9750);
  });

  it("prices a short put as the mirror image", () => {
    const l = put("short", 100, 2.5);
    expect(legPnl(l, 110)).toBe(250);
    expect(legPnl(l, 90)).toBe(-750);
  });

  it("prices stock against its entry price", () => {
    expect(legPnl(stock("long", 100), 112)).toBe(1200);
    expect(legPnl(stock("long", 100), 90)).toBe(-1000);
    expect(legPnl(stock("short", 100), 112)).toBe(-1200);
  });

  it("scales by quantity", () => {
    expect(legPnl(call("long", 100, 3, 4), 110)).toBe(2800);
    expect(legPnl(call("short", 100, 3, 2), 90)).toBe(600);
  });

  it("sums legs into a position", () => {
    const legs = [call("long", 100, 5), call("short", 110, 2)];
    expect(positionPnl(legs, 90)).toBe(-300);
    expect(positionPnl(legs, 105)).toBe(200);
    expect(positionPnl(legs, 130)).toBe(700);
    expect(positionPnl([], 100)).toBe(0);
  });
});

describe("net debit and credit", () => {
  it("is positive for a debit and negative for a credit", () => {
    expect(netCost([call("long", 100, 3)])).toBe(300);
    expect(netCost([call("short", 100, 3)])).toBe(-300);
  });

  it("nets legs and quantities", () => {
    expect(netCost([call("long", 100, 5), call("short", 110, 2)])).toBe(300);
    expect(netCost([call("long", 100, 1.5, 3), put("short", 90, 1, 2)])).toBeCloseTo(250, 9);
  });

  it("includes the stock outlay", () => {
    expect(netCost([stock("long", 100), call("short", 105, 2)])).toBe(9800);
  });

  it("is zero without legs", () => {
    expect(netCost([])).toBe(0);
  });
});

describe("long and short calls and puts", () => {
  it("long call: unlimited profit, premium at risk", () => {
    const a = analyze([call("long", 100, 3)]);
    expect(a.maxProfit).toBe(Infinity);
    expect(a.maxLoss).toBe(-300);
    expect(a.breakEvens).toEqual([103]);
    expect(a.netCost).toBe(300);
  });

  it("long put: profit capped at the strike less premium", () => {
    const a = analyze([put("long", 100, 2.5)]);
    expect(a.maxProfit).toBe(9750);
    expect(a.maxLoss).toBe(-250);
    expect(a.breakEvens).toEqual([97.5]);
    expect(a.netCost).toBe(250);
  });

  it("short call: unlimited loss, premium kept", () => {
    const a = analyze([call("short", 100, 3)]);
    expect(a.maxProfit).toBe(300);
    expect(a.maxLoss).toBe(-Infinity);
    expect(a.breakEvens).toEqual([103]);
    expect(a.netCost).toBe(-300);
  });

  it("short put: loss capped at the strike less premium", () => {
    const a = analyze([put("short", 100, 2.5)]);
    expect(a.maxProfit).toBe(250);
    expect(a.maxLoss).toBe(-9750);
    expect(a.breakEvens).toEqual([97.5]);
    expect(a.netCost).toBe(-250);
  });

  it("scales with quantity", () => {
    const a = analyze([call("long", 100, 3, 5)]);
    expect(a.maxLoss).toBe(-1500);
    expect(a.netCost).toBe(1500);
    expect(a.breakEvens).toEqual([103]);
  });

  it("long stock: break-even at entry, unlimited profit", () => {
    const a = analyze([stock("long", 50)]);
    expect(a.breakEvens).toEqual([50]);
    expect(a.maxProfit).toBe(Infinity);
    expect(a.maxLoss).toBe(-5000);
  });

  it("short stock: unlimited loss", () => {
    const a = analyze([stock("short", 50)]);
    expect(a.maxLoss).toBe(-Infinity);
    expect(a.maxProfit).toBe(5000);
    expect(a.breakEvens).toEqual([50]);
  });
});

describe("spreads", () => {
  it("bull call spread", () => {
    const a = analyze([call("long", 100, 5), call("short", 110, 2)]);
    expect(a.netCost).toBe(300);
    expect(a.maxProfit).toBe(700);
    expect(a.maxLoss).toBe(-300);
    expect(a.breakEvens).toEqual([103]);
  });

  it("bear put spread", () => {
    const a = analyze([put("long", 110, 5), put("short", 100, 2)]);
    expect(a.netCost).toBe(300);
    expect(a.maxProfit).toBe(700);
    expect(a.maxLoss).toBe(-300);
    expect(a.breakEvens).toEqual([107]);
  });

  it("bear call spread is a credit with capped risk", () => {
    const a = analyze([call("short", 100, 5), call("long", 110, 2)]);
    expect(a.netCost).toBe(-300);
    expect(a.maxProfit).toBe(300);
    expect(a.maxLoss).toBe(-700);
    expect(a.breakEvens).toEqual([103]);
  });

  it("covered call", () => {
    const a = analyze([stock("long", 100), call("short", 105, 2)]);
    expect(a.netCost).toBe(9800);
    expect(a.maxProfit).toBe(700);
    expect(a.maxLoss).toBe(-9800);
    expect(a.breakEvens).toEqual([98]);
  });

  it("straddle has two break-evens and unlimited upside", () => {
    const a = analyze([call("long", 100, 3), put("long", 100, 2)]);
    expect(a.netCost).toBe(500);
    expect(a.maxLoss).toBe(-500);
    expect(a.maxProfit).toBe(Infinity);
    expect(a.breakEvens).toEqual([95, 105]);
  });

  it("strangle has a flat loss zone between the strikes", () => {
    const legs = [put("long", 95, 1), call("long", 105, 1.5)];
    const a = analyze(legs);
    expect(a.netCost).toBe(250);
    expect(a.maxLoss).toBe(-250);
    expect(a.maxProfit).toBe(Infinity);
    expect(a.breakEvens).toEqual([92.5, 107.5]);
    expect(positionPnl(legs, 100)).toBe(-250);
  });

  it("short straddle has unlimited loss on the upside", () => {
    const a = analyze([call("short", 100, 3), put("short", 100, 2)]);
    expect(a.netCost).toBe(-500);
    expect(a.maxProfit).toBe(500);
    expect(a.maxLoss).toBe(-Infinity);
    expect(a.breakEvens).toEqual([95, 105]);
  });

  it("ratio spread with more shorts than longs has unlimited loss", () => {
    const a = analyze([call("long", 100, 5), call("short", 110, 2, 2)]);
    expect(a.maxLoss).toBe(-Infinity);
    expect(a.maxProfit).toBe(900);
  });

  it("ratio spread with more longs than shorts has unlimited profit", () => {
    const a = analyze([call("long", 100, 5, 2), call("short", 110, 2)]);
    expect(a.maxProfit).toBe(Infinity);
    expect(a.maxLoss).toBe(-800);
  });

  it("combines quantities across spread legs", () => {
    const a = analyze([call("long", 100, 5, 3), call("short", 110, 2, 3)]);
    expect(a.netCost).toBe(900);
    expect(a.maxProfit).toBe(2100);
    expect(a.maxLoss).toBe(-900);
    expect(a.breakEvens).toEqual([103]);
  });
});

describe("iron condor", () => {
  const legs = () => [put("long", 90, 0.5), put("short", 95, 1.5), call("short", 105, 1.5), call("long", 110, 0.5)];

  it("is a credit with capped profit and loss", () => {
    const a = analyze(legs());
    expect(a.netCost).toBeCloseTo(-200, 9);
    expect(a.maxProfit).toBeCloseTo(200, 9);
    expect(a.maxLoss).toBeCloseTo(-300, 9);
  });

  it("has break-evens at the short strikes less and plus the credit", () => {
    const a = analyze(legs());
    expect(a.breakEvens).toHaveLength(2);
    expect(a.breakEvens[0]).toBeCloseTo(93, 6);
    expect(a.breakEvens[1]).toBeCloseTo(107, 6);
  });

  it("pays the maximum between the short strikes and loses it beyond the wings", () => {
    const l = legs();
    expect(positionPnl(l, 100)).toBeCloseTo(200, 9);
    expect(positionPnl(l, 95)).toBeCloseTo(200, 9);
    expect(positionPnl(l, 105)).toBeCloseTo(200, 9);
    expect(positionPnl(l, 90)).toBeCloseTo(-300, 9);
    expect(positionPnl(l, 80)).toBeCloseTo(-300, 9);
    expect(positionPnl(l, 120)).toBeCloseTo(-300, 9);
    expect(positionPnl(l, 0)).toBeCloseTo(-300, 9);
  });
});

describe("break-evens", () => {
  it("is empty without legs", () => {
    expect(analyze([])).toEqual({ netCost: 0, maxProfit: 0, maxLoss: 0, breakEvens: [] });
  });

  it("is empty when the position always loses", () => {
    const a = analyze([call("long", 100, 6), call("short", 100, 5)]);
    expect(a.breakEvens).toEqual([]);
    expect(a.maxLoss).toBe(-100);
    expect(a.maxProfit).toBe(-100);
  });

  it("is empty when the position always profits", () => {
    const a = analyze([call("long", 100, 5), call("short", 100, 6)]);
    expect(a.breakEvens).toEqual([]);
    expect(a.maxLoss).toBe(100);
    expect(a.maxProfit).toBe(100);
  });

  it("is empty for a perfectly hedged flat position", () => {
    const a = analyze([call("long", 100, 5), call("short", 100, 5)]);
    expect(a.breakEvens).toEqual([]);
    expect(a.maxProfit).toBe(0);
    expect(a.maxLoss).toBe(0);
  });

  it("reports a zero-cost bull spread at the lower strike", () => {
    const a = analyze([call("long", 100, 5), call("short", 110, 5)]);
    expect(a.netCost).toBe(0);
    expect(a.breakEvens).toEqual([100]);
    expect(a.maxLoss).toBe(0);
    expect(a.maxProfit).toBe(1000);
  });

  it("reports the edge of a zero P/L region", () => {
    const a = analyze([put("long", 100, 0)]);
    expect(a.breakEvens).toEqual([100]);
    expect(a.maxLoss).toBe(0);
  });

  it("reports an exact break-even that lands on a strike", () => {
    const a = analyze([call("long", 100, 5), call("short", 105, 0)]);
    expect(a.breakEvens).toEqual([105]);
  });

  it("finds a crossing between strikes by interpolation", () => {
    const a = analyze([call("long", 100, 5), call("short", 110, 2)]);
    expect(a.breakEvens[0]).toBeCloseTo(103, 9);
  });

  it("finds a crossing past the last strike", () => {
    const a = analyze([call("short", 100, 3)]);
    expect(a.breakEvens).toEqual([103]);
  });

  it("finds a crossing below the first strike", () => {
    const a = analyze([put("short", 100, 2.5)]);
    expect(a.breakEvens).toEqual([97.5]);
  });

  it("returns break-evens in ascending order", () => {
    const a = analyze([call("long", 100, 3), put("long", 100, 2)]);
    expect([...a.breakEvens].sort((x, y) => x - y)).toEqual(a.breakEvens);
  });

  it("is not thrown off by floating point premiums", () => {
    const a = analyze([call("long", 100, 1.1), call("short", 105, 0.2)]);
    expect(a.breakEvens).toHaveLength(1);
    expect(a.breakEvens[0]).toBeCloseTo(100.9, 6);
    expect(a.netCost).toBeCloseTo(90, 9);
  });

  it("handles legs at the same strike on both sides", () => {
    const a = analyze([call("long", 100, 3), put("long", 100, 2), call("short", 100, 3), put("short", 100, 2)]);
    expect(a.breakEvens).toEqual([]);
    expect(a.maxProfit).toBe(0);
    expect(a.maxLoss).toBe(0);
  });
});

describe("unlimited cases", () => {
  it.each([
    ["long call", [call("long", 100, 1)], true, false],
    ["short call", [call("short", 100, 1)], false, true],
    ["long put", [put("long", 100, 1)], false, false],
    ["short put", [put("short", 100, 1)], false, false],
    ["long stock", [stock("long", 100)], true, false],
    ["short stock", [stock("short", 100)], false, true],
    ["covered call", [stock("long", 100), call("short", 105, 1)], false, false],
    ["protective put", [stock("long", 100), put("long", 95, 1)], true, false],
    ["short call with a long call above", [call("short", 100, 3), call("long", 110, 1)], false, false],
    ["naked short strangle", [put("short", 95, 1), call("short", 105, 1)], false, true],
  ] as const)("%s", (_name, legs, profit, loss) => {
    const a = analyze([...legs]);
    expect(a.maxProfit === Infinity).toBe(profit);
    expect(a.maxLoss === -Infinity).toBe(loss);
  });

  it("only treats the upside as unbounded", () => {
    expect(Number.isFinite(analyze([put("short", 100, 1)]).maxLoss)).toBe(true);
    expect(Number.isFinite(analyze([put("long", 100, 1)]).maxProfit)).toBe(true);
  });
});

describe("payoff curve", () => {
  it("has vertices at the ends and each strike inside", () => {
    const legs = [call("long", 100, 5), call("short", 110, 2)];
    const pts = payoffCurve(legs, 80, 130);
    expect(pts.map((p) => p.x)).toEqual([80, 100, 110, 130]);
    expect(pts.map((p) => p.y)).toEqual([-300, -300, 700, 700]);
  });

  it("omits strikes outside the window", () => {
    const pts = payoffCurve([call("long", 100, 5), call("short", 150, 2)], 90, 120);
    expect(pts.map((p) => p.x)).toEqual([90, 100, 120]);
  });

  it("omits strikes that sit on the window edge", () => {
    const pts = payoffCurve([call("long", 100, 5)], 100, 120);
    expect(pts.map((p) => p.x)).toEqual([100, 120]);
  });

  it("is empty-position flat", () => {
    expect(payoffCurve([], 50, 150).map((p) => p.y)).toEqual([0, 0]);
  });

  it("returns a single point for an empty window", () => {
    expect(payoffCurve([call("long", 100, 5)], 100, 100)).toEqual([{ x: 100, y: -500 }]);
  });

  it("honours the multiplier", () => {
    const pts = payoffCurve([call("long", 100, 5)], 90, 110, 10);
    expect(pts.map((p) => p.y)).toEqual([-50, -50, 50]);
  });

  it("matches positionPnl at every vertex", () => {
    const legs = [put("long", 90, 0.5), put("short", 95, 1.5), call("short", 105, 1.5), call("long", 110, 0.5)];
    for (const p of payoffCurve(legs, 70, 130)) expect(p.y).toBeCloseTo(positionPnl(legs, p.x), 9);
  });
});

describe("price range", () => {
  it("is null with nothing to show", () => {
    expect(priceRange([], null)).toBeNull();
    expect(priceRange([[]], null)).toBeNull();
  });

  it("centres on the spot alone", () => {
    const r = priceRange([], 100);
    expect(r).not.toBeNull();
    expect(r!.lo).toBeLessThan(100);
    expect(r!.hi).toBeGreaterThan(100);
  });

  it("contains the spot, every strike and every break-even", () => {
    const sets = [
      [put("long", 90, 0.5), put("short", 95, 1.5), call("short", 105, 1.5), call("long", 110, 0.5)],
      [call("long", 120, 8)],
    ];
    const r = priceRange(sets, 101)!;
    for (const v of [90, 95, 101, 105, 110, 120, 128, 93, 107]) {
      expect(r.lo).toBeLessThan(v);
      expect(r.hi).toBeGreaterThan(v);
    }
  });

  it("pads a single at-the-money leg", () => {
    const r = priceRange([[call("long", 100, 3)]], 100)!;
    expect(r.hi - r.lo).toBeGreaterThan(10);
  });

  it("never goes below zero", () => {
    const r = priceRange([[put("long", 1, 0.9)]], 1)!;
    expect(r.lo).toBe(0);
  });

  it("ignores a missing spot", () => {
    const r = priceRange([[call("long", 100, 3)]], null)!;
    expect(r.lo).toBeLessThan(100);
    expect(r.hi).toBeGreaterThan(103);
  });
});

describe("entry price", () => {
  it("uses the mid price by default", () => {
    expect(entryPrice({ bid: 1, ask: 1.2, last: 0.9 }, "long", "mid")).toBe(1.1);
    expect(entryPrice({ bid: 1.1, ask: 1.2, last: null }, "short", "mid")).toBe(1.15);
  });

  it("uses the ask to buy and the bid to sell at the natural price", () => {
    const q = { bid: 1, ask: 1.2, last: 0.9 };
    expect(entryPrice(q, "long", "natural")).toBe(1.2);
    expect(entryPrice(q, "short", "natural")).toBe(1);
  });

  it("treats a zero bid with a live ask as a real quote", () => {
    expect(entryPrice({ bid: 0, ask: 0.05, last: null }, "long", "mid")).toBe(0.025);
    expect(entryPrice({ bid: 0, ask: 0.05, last: null }, "short", "natural")).toBe(0.025);
    expect(entryPrice({ bid: 0, ask: 0.05, last: null }, "long", "natural")).toBe(0.05);
  });

  it("falls back to the last price when the market is closed", () => {
    const q = { bid: 0, ask: 0, last: 0.8 };
    expect(entryPrice(q, "long", "mid")).toBe(0.8);
    expect(entryPrice(q, "long", "natural")).toBe(0.8);
    expect(entryPrice(q, "short", "natural")).toBe(0.8);
  });

  it("falls back to the last price when a side is missing", () => {
    expect(entryPrice({ bid: null, ask: null, last: 2 }, "long", "mid")).toBe(2);
    expect(entryPrice({ bid: null, ask: 1.5, last: 2 }, "short", "natural")).toBe(2);
  });

  it("is null without any usable price", () => {
    expect(entryPrice({ bid: null, ask: null, last: null }, "long", "mid")).toBeNull();
    expect(entryPrice({ bid: 0, ask: 0, last: 0 }, "short", "natural")).toBeNull();
  });

  it("rounds away floating point noise", () => {
    expect(entryPrice({ bid: 0.1, ask: 0.2, last: null }, "long", "mid")).toBe(0.15);
  });
});

describe("legs", () => {
  it("gives every leg a distinct id", () => {
    const a = call("long", 100, 1);
    const b = call("long", 100, 1);
    expect(a.id).not.toBe(b.id);
  });

  it("adds a new leg to the end", () => {
    const a = call("long", 100, 1);
    const b = put("long", 100, 1);
    expect(addLeg([a], b).map((l) => l.id)).toEqual([a.id, b.id]);
  });

  it("merges a repeated contract into the quantity", () => {
    const a = call("long", 100, 1.5);
    const again = call("long", 100, 9);
    const out = addLeg([a], again);
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe(2);
    expect(out[0].price).toBe(1.5);
    expect(out[0].id).toBe(a.id);
  });

  it("keeps long and short legs of one contract separate", () => {
    const a = call("long", 100, 1);
    expect(addLeg([a], call("short", 100, 1))).toHaveLength(2);
  });

  it("does not mutate the input", () => {
    const a = call("long", 100, 1);
    const legs = [a];
    addLeg(legs, call("long", 100, 1));
    expect(legs).toHaveLength(1);
    expect(a.quantity).toBe(1);
  });

  it("drops legs with a bad quantity and repairs bad prices", () => {
    const good = call("long", 100, 1, 2.9);
    const zero = call("long", 105, 1, 0);
    const nan = call("long", 110, 1, Number.NaN);
    const neg = call("long", 115, 1, -1);
    const noPrice = call("long", 120, Number.NaN);
    const negPrice = call("long", 125, -3);
    const out = cleanLegs([good, zero, nan, neg, noPrice, negPrice]);
    expect(out.map((l) => l.strike)).toEqual([100, 120, 125]);
    expect(out[0].quantity).toBe(2);
    expect(out[1].price).toBe(0);
    expect(out[2].price).toBe(0);
  });

  it("drops option legs with a bad strike but keeps stock", () => {
    const out = cleanLegs([call("long", Number.NaN, 1), stock("long", 100)]);
    expect(out.map((l) => l.kind)).toEqual(["stock"]);
    expect(out[0].strike).toBe(0);
  });

  it("treats an empty quantity field as zero", () => {
    const l = call("long", 100, 1);
    l.quantity = null as unknown as number;
    expect(cleanLegs([l])).toEqual([]);
  });
});

function quote(strike: number, bid: number | null = 1, ask: number | null = 2, last: number | null = null): ChainQuote {
  return { strike, bid, ask, last };
}

const STRIKES = [90, 95, 100, 105, 110, 115, 120];

function chainOf(strikes = STRIKES, patch: Record<number, Partial<ChainQuote>> = {}): Chain {
  const make = (k: number) => ({ ...quote(k), ...patch[k] });
  return { calls: strikes.map(make), puts: strikes.map(make) };
}

function shape(id: PresetId, chain: Chain, spot: number | null, mode: "mid" | "natural" = "mid") {
  return (presetLegs(id, chain, spot, mode) ?? []).map((l) => `${l.side} ${l.kind} ${l.strike || ""}`.trim());
}

describe("preset strategies", () => {
  const chain = chainOf();

  it("lists the eight presets", () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      "long_call",
      "long_put",
      "covered_call",
      "bull_call_spread",
      "bear_put_spread",
      "straddle",
      "strangle",
      "iron_condor",
    ]);
  });

  it("builds a long call at the money", () => {
    expect(shape("long_call", chain, 101)).toEqual(["long call 100"]);
  });

  it("builds a long put at the money", () => {
    expect(shape("long_put", chain, 101)).toEqual(["long put 100"]);
  });

  it("builds a covered call with shares and a call one strike up", () => {
    expect(shape("covered_call", chain, 101)).toEqual(["long stock", "short call 105"]);
    const legs = presetLegs("covered_call", chain, 101)!;
    expect(legs[0].price).toBe(101);
    expect(legs[0].quantity).toBe(1);
  });

  it("builds a bull call spread", () => {
    expect(shape("bull_call_spread", chain, 101)).toEqual(["long call 100", "short call 105"]);
  });

  it("builds a bear put spread", () => {
    expect(shape("bear_put_spread", chain, 101)).toEqual(["long put 100", "short put 95"]);
  });

  it("builds a straddle", () => {
    expect(shape("straddle", chain, 101)).toEqual(["long call 100", "long put 100"]);
  });

  it("builds a strangle", () => {
    expect(shape("strangle", chain, 101)).toEqual(["long put 95", "long call 105"]);
  });

  it("builds an iron condor", () => {
    expect(shape("iron_condor", chain, 101)).toEqual([
      "long put 90",
      "short put 95",
      "short call 105",
      "long call 110",
    ]);
  });

  it("picks the strike nearest the spot", () => {
    expect(shape("long_call", chain, 107)).toEqual(["long call 105"]);
    expect(shape("long_call", chain, 108)).toEqual(["long call 110"]);
    expect(shape("long_call", chain, 50)).toEqual(["long call 90"]);
    expect(shape("long_call", chain, 500)).toEqual(["long call 120"]);
  });

  it("breaks a tie toward the lower strike", () => {
    expect(shape("long_call", chain, 102.5)).toEqual(["long call 100"]);
  });

  it("shifts the window to stay inside the chain", () => {
    expect(shape("bull_call_spread", chain, 500)).toEqual(["long call 115", "short call 120"]);
    expect(shape("bear_put_spread", chain, 50)).toEqual(["long put 95", "short put 90"]);
    expect(shape("iron_condor", chain, 500)).toEqual([
      "long put 100",
      "short put 105",
      "short call 115",
      "long call 120",
    ]);
    expect(shape("iron_condor", chain, 50)).toEqual([
      "long put 90",
      "short put 95",
      "short call 105",
      "long call 110",
    ]);
  });

  it("starts mid-chain without a spot", () => {
    expect(shape("long_call", chain, null)).toEqual(["long call 105"]);
  });

  it("needs a spot for a covered call", () => {
    expect(presetLegs("covered_call", chain, null)).toBeNull();
    expect(presetLegs("covered_call", chain, 0)).toBeNull();
  });

  it("gives each leg one contract", () => {
    for (const p of PRESETS) {
      for (const l of presetLegs(p.id, chain, 101)!) expect(l.quantity).toBe(1);
    }
  });

  it("prices legs at the mid", () => {
    const priced = chainOf(STRIKES, { 100: { bid: 4.8, ask: 5.2 }, 105: { bid: 2.4, ask: 2.6 } });
    const legs = presetLegs("bull_call_spread", priced, 101, "mid")!;
    expect(legs.map((l) => l.price)).toEqual([5, 2.5]);
  });

  it("prices legs at the ask to buy and the bid to sell", () => {
    const priced = chainOf(STRIKES, { 100: { bid: 4.8, ask: 5.2 }, 105: { bid: 2.4, ask: 2.6 } });
    const legs = presetLegs("bull_call_spread", priced, 101, "natural")!;
    expect(legs.map((l) => l.price)).toEqual([5.2, 2.4]);
  });

  it("produces the expected economics for a bull call spread", () => {
    const priced = chainOf(STRIKES, { 100: { bid: 4.8, ask: 5.2 }, 105: { bid: 2.4, ask: 2.6 } });
    const legs = presetLegs("bull_call_spread", priced, 101, "mid")!.map((l) => makeLeg(l));
    const a = analyze(legs);
    expect(a.netCost).toBeCloseTo(250, 9);
    expect(a.maxLoss).toBeCloseTo(-250, 9);
    expect(a.maxProfit).toBeCloseTo(250, 9);
    expect(a.breakEvens[0]).toBeCloseTo(102.5, 6);
  });

  it("produces a credit for the iron condor with symmetric quotes", () => {
    const legs = presetLegs("iron_condor", chain, 101)!.map((l) => makeLeg(l));
    const a = analyze(legs);
    expect(a.netCost).toBeCloseTo(0, 9);
    expect(Number.isFinite(a.maxProfit)).toBe(true);
    expect(Number.isFinite(a.maxLoss)).toBe(true);
  });

  it("skips strikes without a usable quote", () => {
    const sparse = chainOf(STRIKES, { 100: { bid: null, ask: null, last: null } });
    expect(shape("long_call", sparse, 101)).toEqual(["long call 105"]);
  });

  it("uses the last price for a strike with no bid or ask", () => {
    const closed = chainOf(STRIKES, { 100: { bid: 0, ask: 0, last: 3 } });
    const legs = presetLegs("long_call", closed, 101)!;
    expect(legs[0].strike).toBe(100);
    expect(legs[0].price).toBe(3);
  });

  it("only uses strikes listed on both sides for two-sided strategies", () => {
    const chain2: Chain = {
      calls: [90, 95, 100, 105, 110].map((k) => quote(k)),
      puts: [95, 100, 105].map((k) => quote(k)),
    };
    expect(shape("strangle", chain2, 100)).toEqual(["long put 95", "long call 105"]);
    expect(shape("long_call", chain2, 90)).toEqual(["long call 90"]);
  });

  it("returns null when the chain is too short", () => {
    expect(presetLegs("iron_condor", chainOf([95, 100, 105, 110]), 100)).toBeNull();
    expect(presetLegs("iron_condor", chainOf([95, 100, 105, 110, 115]), 105)).not.toBeNull();
    expect(presetLegs("strangle", chainOf([100, 105]), 100)).toBeNull();
    expect(presetLegs("bull_call_spread", chainOf([100]), 100)).toBeNull();
    expect(presetLegs("long_call", chainOf([100]), 100)).not.toBeNull();
    expect(presetLegs("long_call", chainOf([]), 100)).toBeNull();
  });

  it("returns null when a needed side is missing", () => {
    const callsOnly: Chain = { calls: chainOf().calls, puts: [] };
    expect(presetLegs("straddle", callsOnly, 100)).toBeNull();
    expect(presetLegs("long_put", callsOnly, 100)).toBeNull();
    expect(presetLegs("long_call", callsOnly, 100)).not.toBeNull();
  });

  it("ignores non-positive strikes", () => {
    const odd = chainOf([0, 100]);
    expect(shape("long_call", odd, 100)).toEqual(["long call 100"]);
  });
});

describe("saved strategies", () => {
  const legs = () => [call("long", 100, 3)];

  it("saves with the first free slot", () => {
    const one = saveStrategy([], "A", legs())!;
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ slot: 0, name: "A", visible: true });
  });

  it("allows up to three", () => {
    expect(MAX_SAVED).toBe(3);
    let saved = saveStrategy([], "A", legs())!;
    saved = saveStrategy(saved, "B", legs())!;
    saved = saveStrategy(saved, "C", legs())!;
    expect(saved.map((s) => s.slot)).toEqual([0, 1, 2]);
    expect(saveStrategy(saved, "D", legs())).toBeNull();
  });

  it("reuses the slot of a removed strategy", () => {
    let saved = saveStrategy([], "A", legs())!;
    saved = saveStrategy(saved, "B", legs())!;
    saved = saveStrategy(saved, "C", legs())!;
    saved = saved.filter((s) => s.name !== "B");
    saved = saveStrategy(saved, "D", legs())!;
    expect(saved.find((s) => s.name === "D")!.slot).toBe(1);
  });

  it("names an unnamed strategy after its slot", () => {
    const saved = saveStrategy([], "  ", legs())!;
    expect(saved[0].name).toBe("Strategy 1");
  });

  it("keeps names distinct", () => {
    let saved = saveStrategy([], "Condor", legs())!;
    saved = saveStrategy(saved, "Condor", legs())!;
    expect(saved.map((s) => s.name)).toEqual(["Condor", "Condor (2)"]);
  });

  it("refuses an empty position", () => {
    expect(saveStrategy([], "A", [])).toBeNull();
    expect(saveStrategy([], "A", [call("long", 100, 3, 0)])).toBeNull();
  });

  it("copies the legs so later edits do not leak in", () => {
    const l = legs();
    const saved = saveStrategy([], "A", l)!;
    l[0].quantity = 9;
    expect(saved[0].legs[0].quantity).toBe(1);
  });

  it("does not mutate the existing list", () => {
    const base = saveStrategy([], "A", legs())!;
    saveStrategy(base, "B", legs());
    expect(base).toHaveLength(1);
  });
});
