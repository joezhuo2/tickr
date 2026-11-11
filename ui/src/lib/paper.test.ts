import { describe, expect, it } from "vitest";
import {
  DEFAULT_COSTS,
  DEFAULT_STARTING_CASH,
  LIMITS,
  applyFill,
  bookAccount,
  bookCursor,
  buyingPower,
  cancelOrder,
  cashError,
  commissionFor,
  costsError,
  equity,
  liveBlock,
  marketOrder,
  newAccount,
  openBook,
  placeOrder,
  positionOf,
  processBar,
  processPrice,
  qtyError,
  reset,
  seekBook,
  setCosts,
  shortExposure,
  slipped,
  summary,
  triggerPrice,
  unrealized,
  updateBook,
  type Account,
  type Bar,
  type Costs,
  type Order,
  type Outcome,
} from "./paper";

const T = 1_700_000_000;
const bar = (t: number, o: number, h: number, l: number, c: number): Bar => ({ t, o, h, l, c });
const flat = (t: number, p: number) => bar(t, p, p, p, p);

function ok(r: Outcome): Account {
  if (!r.ok) throw new Error(r.error);
  return r.account;
}

function err(r: Outcome): string {
  if (r.ok) throw new Error("expected a rejection");
  return r.error;
}

function withCosts(costs: Partial<Costs>, cash = 10_000): Account {
  return newAccount(cash, { ...DEFAULT_COSTS, ...costs });
}

function totalUnrealized(a: Account, marks: Record<string, number>): number {
  return a.positions.reduce((s, p) => s + unrealized(p, marks[p.symbol] ?? p.avg_price), 0);
}

describe("account setup", () => {
  it("starts flat with the starting cash", () => {
    const a = newAccount();
    expect(a.cash).toBe(DEFAULT_STARTING_CASH);
    expect(a.starting_cash).toBe(DEFAULT_STARTING_CASH);
    expect(a).toMatchObject({ realized: 0, positions: [], orders: [], fills: [], trades: [], next_id: 1 });
    expect(a.costs).toEqual(DEFAULT_COSTS);
    expect(a.costs).not.toBe(DEFAULT_COSTS);
  });

  it("validates starting cash, costs and quantity", () => {
    expect(cashError(100)).toBeNull();
    expect(cashError(LIMITS.maxCash)).toBeNull();
    for (const v of [99.99, 0, -1, NaN, Infinity, LIMITS.maxCash + 1]) expect(cashError(v)).not.toBeNull();
    expect(costsError({ commission: 1, commission_bps: 5, slippage_bps: 10 })).toBeNull();
    expect(costsError({ commission: -1, commission_bps: 0, slippage_bps: 0 })).toMatch(/Commission per trade/);
    expect(costsError({ commission: 0, commission_bps: 1001, slippage_bps: 0 })).toMatch(/Commission bps/);
    expect(costsError({ commission: 0, commission_bps: 0, slippage_bps: NaN })).toMatch(/Slippage/);
    expect(qtyError(1)).toBeNull();
    expect(qtyError(LIMITS.maxQty)).toBeNull();
    for (const q of [0, -1, 1.5, NaN, Infinity, LIMITS.maxQty + 1]) expect(qtyError(q)).not.toBeNull();
  });

  it("resets positions, orders and history but keeps costs", () => {
    let a = withCosts({ commission: 1 });
    a = ok(marketOrder(a, "AAPL", "buy", 10, 100, T));
    a = ok(placeOrder(a, { symbol: "AAPL", side: "sell", qty: 5, kind: "limit", price: 120 }, T));
    const fresh = ok(reset(a, 50_000));
    expect(fresh).toEqual(newAccount(50_000, a.costs));
    expect(ok(reset(a)).cash).toBe(10_000);
    expect(err(reset(a, 5))).toMatch(/Starting cash/);
  });

  it("updates costs only when valid", () => {
    const a = newAccount();
    expect(ok(setCosts(a, { commission: 2, commission_bps: 1, slippage_bps: 3 })).costs).toEqual({ commission: 2, commission_bps: 1, slippage_bps: 3 });
    expect(err(setCosts(a, { commission: 2000, commission_bps: 0, slippage_bps: 0 }))).toMatch(/Commission/);
  });
});

describe("fill model", () => {
  it("slips buys up and sells down by bps", () => {
    expect(slipped("buy", 100, 10)).toBeCloseTo(100.1, 10);
    expect(slipped("sell", 100, 10)).toBeCloseTo(99.9, 10);
    expect(slipped("buy", 100, 0)).toBe(100);
  });

  it("charges a flat commission plus bps of notional", () => {
    expect(commissionFor({ commission: 1, commission_bps: 10, slippage_bps: 0 }, 10, 100)).toBeCloseTo(2, 10);
    expect(commissionFor(DEFAULT_COSTS, 10, 100)).toBe(0);
  });

  it("fills a market buy at the reference price plus slippage and pays commission", () => {
    const a = ok(marketOrder(withCosts({ commission: 1, commission_bps: 10, slippage_bps: 10 }), "AAPL", "buy", 10, 100, T));
    const fill = a.fills[0];
    expect(fill.price).toBeCloseTo(100.1, 10);
    expect(fill.commission).toBeCloseTo(1 + 1001 * 0.001, 10);
    expect(fill).toMatchObject({ symbol: "AAPL", side: "buy", qty: 10, time: T, order_id: null });
    expect(a.cash).toBeCloseTo(10_000 - 1001 - fill.commission, 8);
    expect(positionOf(a, "AAPL")).toMatchObject({ qty: 10, opened: T });
    expect(positionOf(a, "AAPL")!.avg_price).toBeCloseTo(100.1, 10);
    expect(positionOf(a, "AAPL")!.entry_costs).toBeCloseTo(fill.commission, 10);
  });

  it("fills a market sell at the reference price minus slippage", () => {
    const a = ok(marketOrder(withCosts({ slippage_bps: 50 }), "AAPL", "sell", 1, 200, T));
    expect(a.fills[0].price).toBeCloseTo(199, 10);
    expect(positionOf(a, "AAPL")!.qty).toBe(-1);
  });

  it("rejects invalid reference prices and sizes", () => {
    const a = newAccount();
    for (const p of [0, -5, NaN, Infinity]) expect(err(marketOrder(a, "AAPL", "buy", 1, p, T))).toMatch(/Reference price/);
    for (const q of [0, -3, 2.5, NaN]) expect(err(marketOrder(a, "AAPL", "buy", q, 100, T))).toMatch(/Quantity/);
    expect(err(applyFill(a, "AAPL", "buy", 1, 0, T))).toMatch(/Fill price/);
  });
});

describe("position accounting", () => {
  it("averages the price when adding to a position", () => {
    let a = withCosts({}, 100_000);
    a = ok(marketOrder(a, "MSFT", "buy", 10, 100, T));
    a = ok(marketOrder(a, "MSFT", "buy", 30, 120, T + 1));
    const p = positionOf(a, "MSFT")!;
    expect(p.qty).toBe(40);
    expect(p.avg_price).toBeCloseTo(115, 10);
    expect(p.opened).toBe(T);
    expect(a.cash).toBeCloseTo(100_000 - 1000 - 3600, 8);
  });

  it("realizes P&L net of entry and exit costs when reducing, and logs the closed trade", () => {
    let a = withCosts({ commission: 2 });
    a = ok(marketOrder(a, "AAPL", "buy", 10, 100, T));
    a = ok(marketOrder(a, "AAPL", "sell", 4, 110, T + 60));
    const p = positionOf(a, "AAPL")!;
    expect(p.qty).toBe(6);
    expect(p.avg_price).toBe(100);
    expect(p.entry_costs).toBeCloseTo(1.2, 10);
    expect(a.realized).toBeCloseTo(40 - 0.8 - 2, 10);
    expect(a.trades).toHaveLength(1);
    const t = a.trades[0];
    expect(t).toMatchObject({ symbol: "AAPL", direction: "long", qty: 4, entry_price: 100, exit_price: 110, opened: T, closed: T + 60 });
    expect(t.pnl).toBeCloseTo(37.2, 10);
    expect(t.costs).toBeCloseTo(2.8, 10);
    a = ok(marketOrder(a, "AAPL", "sell", 6, 90, T + 120));
    expect(positionOf(a, "AAPL")).toBeNull();
    expect(a.trades[1].pnl).toBeCloseTo(-60 - 1.2 - 2, 10);
    expect(a.realized).toBeCloseTo(37.2 - 63.2, 10);
    expect(a.cash).toBeCloseTo(10_000 + a.realized, 8);
  });

  it("flips a long into a short, splitting the commission by shares", () => {
    let a = withCosts({ commission: 3 });
    a = ok(marketOrder(a, "TSLA", "buy", 10, 50, T));
    a = ok(marketOrder(a, "TSLA", "sell", 30, 60, T + 1));
    const p = positionOf(a, "TSLA")!;
    expect(p.qty).toBe(-20);
    expect(p.avg_price).toBe(60);
    expect(p.opened).toBe(T + 1);
    expect(p.entry_costs).toBeCloseTo(2, 10);
    expect(a.trades).toHaveLength(1);
    expect(a.trades[0]).toMatchObject({ direction: "long", qty: 10, entry_price: 50, exit_price: 60 });
    expect(a.trades[0].pnl).toBeCloseTo(100 - 3 - 1, 10);
  });

  it("flips a short into a long", () => {
    let a = withCosts({});
    a = ok(marketOrder(a, "TSLA", "sell", 5, 100, T));
    a = ok(marketOrder(a, "TSLA", "buy", 8, 90, T + 1));
    expect(positionOf(a, "TSLA")).toMatchObject({ qty: 3, avg_price: 90 });
    expect(a.trades[0]).toMatchObject({ direction: "short", qty: 5, entry_price: 100, exit_price: 90, pnl: 50 });
  });

  it("realizes profit on a short when covering lower", () => {
    let a = withCosts({});
    a = ok(marketOrder(a, "NFLX", "sell", 10, 100, T));
    expect(a.cash).toBe(11_000);
    a = ok(marketOrder(a, "NFLX", "buy", 10, 80, T + 1));
    expect(a.realized).toBe(200);
    expect(a.cash).toBe(10_200);
    expect(a.positions).toEqual([]);
  });

  it("keeps the position order stable when updating", () => {
    let a = newAccount();
    for (const s of ["A", "B", "C"]) a = ok(marketOrder(a, s, "buy", 1, 10, T));
    a = ok(marketOrder(a, "A", "buy", 1, 10, T));
    expect(a.positions.map((p) => p.symbol)).toEqual(["A", "B", "C"]);
  });

  it("marks unrealized P&L net of entry costs and equity from marks", () => {
    let a = withCosts({ commission: 1 });
    a = ok(marketOrder(a, "AAPL", "buy", 10, 100, T));
    a = ok(marketOrder(a, "MSFT", "sell", 5, 200, T));
    const marks = { AAPL: 105, MSFT: 190 };
    expect(unrealized(positionOf(a, "AAPL")!, 105)).toBeCloseTo(49, 10);
    expect(unrealized(positionOf(a, "MSFT")!, 190)).toBeCloseTo(49, 10);
    expect(equity(a, marks)).toBeCloseTo(a.cash + 10 * 105 - 5 * 190, 8);
    const s = summary(a, marks);
    expect(s.equity).toBeCloseTo(10_000 + 98, 8);
    expect(s.unrealized).toBeCloseTo(98, 8);
    expect(s.unmarked).toEqual([]);
    expect(s.return_pct).toBeCloseTo(((s.equity - 10_000) / 10_000) * 100, 10);
    const partial = summary(a, { AAPL: 105 });
    expect(partial.unmarked).toEqual(["MSFT"]);
    expect(partial.equity).toBeCloseTo(a.cash + 1050 - 1000, 8);
  });

  it("keeps equity equal to starting cash plus realized plus unrealized", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let a = withCosts({ commission: 0.5, commission_bps: 2, slippage_bps: 3 }, 1_000_000);
    const marks: Record<string, number> = { X: 100, Y: 50 };
    for (let i = 0; i < 300; i++) {
      const sym = rand() < 0.5 ? "X" : "Y";
      marks[sym] = Math.max(1, marks[sym] * (1 + (rand() - 0.5) * 0.05));
      const r = marketOrder(a, sym, rand() < 0.5 ? "buy" : "sell", 1 + Math.floor(rand() * 40), marks[sym], T + i);
      if (r.ok) a = r.account;
      expect(equity(a, marks)).toBeCloseTo(a.starting_cash + a.realized + totalUnrealized(a, marks), 6);
    }
    expect(a.fills.length).toBeGreaterThan(100);
    expect(a.trades.reduce((s, t) => s + t.pnl, 0)).toBeCloseTo(a.realized, 6);
  });
});

describe("buying power", () => {
  it("rejects buys beyond cash, including commission", () => {
    const a = withCosts({ commission: 1 }, 1000);
    expect(err(marketOrder(a, "AAPL", "buy", 10, 100, T))).toBe("Insufficient buying power");
    expect(ok(marketOrder(withCosts({}, 1000), "AAPL", "buy", 10, 100, T)).cash).toBe(0);
  });

  it("reserves the short value and does not count short proceeds", () => {
    let a = withCosts({}, 1000);
    a = ok(marketOrder(a, "AAPL", "sell", 5, 100, T));
    expect(a.cash).toBe(1500);
    expect(shortExposure(a)).toBe(500);
    expect(buyingPower(a)).toBe(500);
    expect(err(marketOrder(a, "MSFT", "buy", 6, 100, T))).toBe("Insufficient buying power");
    expect(err(marketOrder(a, "AAPL", "sell", 6, 100, T))).toBe("Insufficient buying power");
    a = ok(marketOrder(a, "AAPL", "sell", 5, 100, T));
    expect(buyingPower(a)).toBe(0);
  });

  it("always allows reducing or closing, even when buying power is negative", () => {
    let a = withCosts({ commission: 5 }, 1000);
    a = ok(marketOrder(a, "AAPL", "sell", 9, 100, T));
    a = ok(marketOrder(a, "AAPL", "buy", 4, 300, T + 1));
    expect(buyingPower(a)).toBeLessThan(0);
    a = ok(marketOrder(a, "AAPL", "buy", 5, 300, T + 2));
    expect(a.positions).toEqual([]);
    expect(a.cash).toBeLessThan(0);
    expect(err(marketOrder(a, "MSFT", "buy", 1, 1, T + 3))).toBe("Insufficient buying power");
  });

  it("checks the opening side of a flip", () => {
    let a = withCosts({}, 1000);
    a = ok(marketOrder(a, "AAPL", "buy", 10, 100, T));
    expect(err(marketOrder(a, "AAPL", "sell", 21, 100, T))).toBe("Insufficient buying power");
    a = ok(marketOrder(a, "AAPL", "sell", 20, 100, T));
    expect(positionOf(a, "AAPL")!.qty).toBe(-10);
    expect(buyingPower(a)).toBe(0);
  });
});

describe("resting orders", () => {
  const order = (a: Account) => a.orders[a.orders.length - 1];

  it("validates order requests", () => {
    const a = newAccount();
    expect(err(placeOrder(a, { symbol: "AAPL", side: "buy", qty: 1, kind: "limit" }, T))).toMatch(/Limit price/);
    expect(err(placeOrder(a, { symbol: "AAPL", side: "buy", qty: 1, kind: "stop", price: -1 }, T))).toMatch(/Stop price/);
    expect(err(placeOrder(a, { symbol: "AAPL", side: "buy", qty: 0, kind: "limit", price: 1 }, T))).toMatch(/Quantity/);
    expect(err(placeOrder(a, { symbol: "", side: "buy", qty: 1, kind: "limit", price: 1 }, T))).toMatch(/symbol/);
    const placed = ok(placeOrder(a, { symbol: "AAPL", side: "buy", qty: 1, kind: "market", price: 99 }, T));
    expect(order(placed)).toMatchObject({ id: 1, kind: "market", price: null, created: T });
    expect(placed.next_id).toBe(2);
  });

  it("caps open orders", () => {
    let a = newAccount();
    for (let i = 0; i < LIMITS.maxOrders; i++) a = ok(placeOrder(a, { symbol: "AAPL", side: "buy", qty: 1, kind: "limit", price: 1 }, T));
    expect(err(placeOrder(a, { symbol: "AAPL", side: "buy", qty: 1, kind: "limit", price: 1 }, T))).toMatch(/open orders/);
  });

  it("pre-checks buying power at the order price and at the market estimate", () => {
    const a = withCosts({}, 1000);
    expect(err(placeOrder(a, { symbol: "AAPL", side: "buy", qty: 11, kind: "limit", price: 100 }, T))).toBe("Insufficient buying power");
    expect(err(placeOrder(a, { symbol: "AAPL", side: "buy", qty: 11, kind: "market" }, T, 100))).toBe("Insufficient buying power");
    expect(ok(placeOrder(a, { symbol: "AAPL", side: "buy", qty: 11, kind: "market" }, T)).orders).toHaveLength(1);
  });

  it("cancels by id", () => {
    let a = ok(placeOrder(newAccount(), { symbol: "AAPL", side: "buy", qty: 1, kind: "limit", price: 90 }, T));
    expect(cancelOrder(a, 999)).toBe(a);
    a = cancelOrder(a, a.orders[0].id);
    expect(a.orders).toEqual([]);
  });

  it("fills a buy limit when the low reaches it, at the limit or a better open, without slippage", () => {
    const costs = { commission: 0, commission_bps: 0, slippage_bps: 100 };
    const o: Order = { id: 1, symbol: "A", side: "buy", qty: 1, kind: "limit", price: 100, created: 0 };
    expect(triggerPrice(o, bar(1, 105, 106, 101, 102), costs)).toBeNull();
    expect(triggerPrice(o, bar(1, 105, 106, 100, 102), costs)).toBe(100);
    expect(triggerPrice(o, bar(1, 95, 99, 94, 97), costs)).toBe(95);
  });

  it("fills a sell limit when the high reaches it, at the limit or a better open", () => {
    const o: Order = { id: 1, symbol: "A", side: "sell", qty: 1, kind: "limit", price: 110, created: 0 };
    expect(triggerPrice(o, bar(1, 100, 109.99, 99, 105), DEFAULT_COSTS)).toBeNull();
    expect(triggerPrice(o, bar(1, 100, 110, 99, 105), DEFAULT_COSTS)).toBe(110);
    expect(triggerPrice(o, bar(1, 115, 120, 112, 118), DEFAULT_COSTS)).toBe(115);
  });

  it("triggers a buy stop when the high reaches it, at the stop or a worse open, plus slippage", () => {
    const costs = { commission: 0, commission_bps: 0, slippage_bps: 10 };
    const o: Order = { id: 1, symbol: "A", side: "buy", qty: 1, kind: "stop", price: 110, created: 0 };
    expect(triggerPrice(o, bar(1, 100, 109, 99, 105), costs)).toBeNull();
    expect(triggerPrice(o, bar(1, 100, 111, 99, 105), costs)).toBeCloseTo(110.11, 10);
    expect(triggerPrice(o, bar(1, 120, 121, 118, 119), costs)).toBeCloseTo(120.12, 10);
  });

  it("triggers a sell stop when the low reaches it, at the stop or a worse open, minus slippage", () => {
    const costs = { commission: 0, commission_bps: 0, slippage_bps: 10 };
    const o: Order = { id: 1, symbol: "A", side: "sell", qty: 1, kind: "stop", price: 90, created: 0 };
    expect(triggerPrice(o, bar(1, 100, 101, 91, 95), costs)).toBeNull();
    expect(triggerPrice(o, bar(1, 100, 101, 89, 95), costs)).toBeCloseTo(89.91, 10);
    expect(triggerPrice(o, bar(1, 80, 85, 79, 82), costs)).toBeCloseTo(79.92, 10);
  });

  it("fills a queued market order at the next bar's open plus slippage", () => {
    const costs = { commission: 0, commission_bps: 0, slippage_bps: 20 };
    const o: Order = { id: 1, symbol: "A", side: "buy", qty: 1, kind: "market", price: null, created: 0 };
    expect(triggerPrice(o, bar(1, 50, 60, 40, 55), costs)).toBeCloseTo(50.1, 10);
  });

  it("only evaluates orders for the bar's symbol on bars after the order was placed", () => {
    let a = newAccount();
    a = ok(placeOrder(a, { symbol: "A", side: "buy", qty: 1, kind: "limit", price: 100 }, T));
    a = ok(placeOrder(a, { symbol: "B", side: "buy", qty: 1, kind: "limit", price: 100 }, T));
    expect(processBar(a, "A", bar(T, 90, 95, 85, 90)).events).toEqual([]);
    expect(processBar(a, "A", bar(T - 60, 90, 95, 85, 90)).account).toBe(a);
    const r = processBar(a, "A", bar(T + 60, 90, 95, 85, 90));
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ kind: "fill", fill: { symbol: "A", price: 90, time: T + 60, order_id: 1 } });
    expect(r.account.orders.map((o) => o.symbol)).toEqual(["B"]);
    expect(positionOf(r.account, "A")!.qty).toBe(1);
  });

  it("fills several orders on one bar in the order they were placed", () => {
    let a = newAccount();
    a = ok(placeOrder(a, { symbol: "A", side: "buy", qty: 2, kind: "market" }, T));
    a = ok(placeOrder(a, { symbol: "A", side: "sell", qty: 1, kind: "limit", price: 105 }, T));
    const r = processBar(a, "A", bar(T + 1, 100, 106, 99, 104));
    expect(r.events.map((e) => e.kind)).toEqual(["fill", "fill"]);
    expect(positionOf(r.account, "A")!.qty).toBe(1);
    expect(r.account.trades[0]).toMatchObject({ entry_price: 100, exit_price: 105, pnl: 5 });
  });

  it("drops an order that can no longer be afforded when it fills", () => {
    let a = withCosts({}, 1000);
    a = ok(placeOrder(a, { symbol: "A", side: "buy", qty: 10, kind: "market" }, T, 90));
    const r = processBar(a, "A", bar(T + 1, 120, 125, 118, 121));
    expect(r.events).toEqual([{ kind: "rejected", order: a.orders[0], error: "Insufficient buying power" }]);
    expect(r.account.orders).toEqual([]);
    expect(r.account.positions).toEqual([]);
    expect(r.account.cash).toBe(1000);
  });

  it("evaluates live prices as single-price bars", () => {
    let a = newAccount();
    a = ok(placeOrder(a, { symbol: "A", side: "sell", qty: 1, kind: "stop", price: 95 }, T));
    expect(processPrice(a, "A", 96, T + 5).events).toEqual([]);
    expect(processPrice(a, "A", NaN, T + 5).account).toBe(a);
    const r = processPrice(a, "A", 94, T + 10);
    expect(r.account.fills[0]).toMatchObject({ price: 94, time: T + 10, side: "sell" });
    expect(positionOf(r.account, "A")!.qty).toBe(-1);
  });

  it("caps the fill and trade history", () => {
    let a = newAccount(LIMITS.maxCash);
    for (let i = 0; i < LIMITS.maxHistory / 2 + 5; i++) {
      a = ok(marketOrder(a, "A", "buy", 1, 10, T + i));
      a = ok(marketOrder(a, "A", "sell", 1, 11, T + i));
    }
    expect(a.fills).toHaveLength(LIMITS.maxHistory);
    expect(a.fills[a.fills.length - 1].time).toBe(T + LIMITS.maxHistory / 2 + 4);
    expect(a.trades.length).toBeLessThanOrEqual(LIMITS.maxHistory);
    expect(a.realized).toBeCloseTo(LIMITS.maxHistory / 2 + 5, 6);
  });
});

describe("live market availability", () => {
  it("explains why live market orders are disabled", () => {
    expect(liveBlock("regular", "fresh", 100)).toBeNull();
    expect(liveBlock("regular", "fresh", null)).toMatch(/No live quote/);
    expect(liveBlock(null, null, 100)).toMatch(/No live quote/);
    expect(liveBlock("closed", "closed", 100)).toBe("Market is closed");
    expect(liveBlock("pre", "fresh", 100)).toMatch(/regular session/);
    expect(liveBlock("post", "stale", 100)).toMatch(/regular session/);
    expect(liveBlock("regular", "stale", 100)).toBe("Quote is stale");
    expect(liveBlock("regular", "unknown", 100)).toMatch(/unknown/);
  });
});

describe("replay book", () => {
  const bars = [flat(T, 100), flat(T + 1, 101), bar(T + 2, 102, 103, 99, 100), bar(T + 3, 98, 99, 80, 85), bar(T + 4, 200, 300, 1, 250)];

  it("fills a market order placed at the cursor at the next revealed bar's open", () => {
    let book = openBook(withCosts({ slippage_bps: 100 }), 1);
    const placed = placeOrder(bookAccount(book), { symbol: "A", side: "buy", qty: 1, kind: "market" }, bars[1].t, bars[1].c);
    book = updateBook(book, ok(placed));
    expect(bookAccount(book).positions).toEqual([]);
    const r = seekBook(book, bars, 2, "A");
    expect(bookCursor(r.book)).toBe(2);
    expect(r.events).toHaveLength(1);
    expect(bookAccount(r.book).fills[0].price).toBeCloseTo(102 * 1.01, 10);
    expect(bookAccount(r.book).fills[0].time).toBe(bars[2].t);
  });

  it("never evaluates bars past the cursor", () => {
    let book = openBook(newAccount(), 1);
    book = updateBook(book, ok(placeOrder(bookAccount(book), { symbol: "A", side: "buy", qty: 1, kind: "limit", price: 2 }, bars[1].t)));
    const r = seekBook(book, bars, 3, "A");
    expect(r.events).toEqual([]);
    expect(bookAccount(r.book).orders).toHaveLength(1);
    expect(bookCursor(r.book)).toBe(3);
    const end = seekBook(r.book, bars, 4, "A");
    expect(end.events).toHaveLength(1);
    expect(bookAccount(end.book).fills[0].price).toBe(2);
  });

  it("evaluates every bar when jumping several bars at once", () => {
    let book = openBook(newAccount(), 0);
    book = updateBook(book, ok(placeOrder(bookAccount(book), { symbol: "A", side: "sell", qty: 1, kind: "stop", price: 90 }, bars[0].t)));
    const r = seekBook(book, bars, 4, "A");
    expect(r.book.states).toHaveLength(5);
    expect(bookAccount(r.book).fills).toHaveLength(1);
    expect(bookAccount(r.book).fills[0]).toMatchObject({ time: bars[3].t, price: 90 });
  });

  it("restores the earlier account when stepping back and clamps the cursor", () => {
    let book = openBook(newAccount(), 1);
    book = updateBook(book, ok(placeOrder(bookAccount(book), { symbol: "A", side: "buy", qty: 1, kind: "market" }, bars[1].t)));
    const before = bookAccount(book);
    const forward = seekBook(book, bars, 3, "A").book;
    expect(bookAccount(forward).positions).toHaveLength(1);
    const back = seekBook(forward, bars, 1, "A");
    expect(back.events).toEqual([]);
    expect(bookAccount(back.book)).toBe(before);
    expect(bookCursor(seekBook(forward, bars, 0, "A").book)).toBe(1);
    expect(bookCursor(seekBook(book, bars, 99, "A").book)).toBe(4);
    expect(seekBook(forward, bars, 3, "A").book).toBe(forward);
  });

  it("keeps the replay account separate from the account it was opened from", () => {
    const live = newAccount();
    let book = openBook(newAccount(live.starting_cash, live.costs), 1);
    book = updateBook(book, ok(placeOrder(bookAccount(book), { symbol: "A", side: "buy", qty: 1, kind: "market" }, bars[1].t)));
    seekBook(book, bars, 2, "A");
    expect(live).toEqual(newAccount());
  });
});

describe("positionSize", () => {
  it("sizes a long and a short from account risk and gives the 2R target", async () => {
    const { positionSize } = await import("./paper");
    expect(positionSize(25_000, 1, 50, 49.5)).toEqual({ side: "buy", shares: 500, per_share: 0.5, risk: 250, cost: 25_000, target: 51 });
    expect(positionSize(10_000, 2, 20, 20.75)).toMatchObject({ side: "sell", shares: 266, target: 18.5 });
    expect(positionSize(10_000, 1, 100, 97, 3)?.target).toBe(109);
    expect(positionSize(100, 1, 500, 400)?.shares).toBe(0);
  });

  it("rejects inputs that cannot be sized", async () => {
    const { positionSize } = await import("./paper");
    for (const args of [[0, 1, 10, 9], [1000, 0, 10, 9], [1000, 101, 10, 9], [1000, 1, 10, 10], [1000, 1, -1, 9], [1000, 1, 10, 0], [1000, 1, NaN, 9]] as const) {
      expect(positionSize(...(args as unknown as [number, number, number, number]))).toBeNull();
    }
  });
});
