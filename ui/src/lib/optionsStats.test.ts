import { describe, expect, it } from "vitest";
import { atmIv, averageAbs, expiryAfter, maxPain, oiByStrike, pastMoves, smile, straddle, unusualActivity } from "./optionsStats";
import type { OptionContract, Options } from "./types";

const contract = (strike: number, p: Partial<OptionContract> = {}): OptionContract => ({
  symbol: `X${strike}`, strike, last: null, bid: null, ask: null, change: null, change_pct: null, volume: null, open_interest: null, iv: null, last_trade: null, itm: false, ...p,
});
const chain = (calls: OptionContract[], puts: OptionContract[], p: Partial<Options> = {}): Options => ({ price: 100, expirations: [], expiry: 1000, calls, puts, ...p });

describe("max pain", () => {
  it("picks the strike with the least total payout", () => {
    const o = chain(
      [contract(90, { open_interest: 100 }), contract(100, { open_interest: 300 }), contract(110, { open_interest: 100 })],
      [contract(90, { open_interest: 100 }), contract(100, { open_interest: 300 }), contract(110, { open_interest: 100 })],
    );
    expect(maxPain(o)).toBe(100);
  });

  it("follows skewed open interest", () => {
    const o = chain([contract(110, { open_interest: 500 })], [contract(90, { open_interest: 10 })]);
    expect(maxPain(o)).toBe(90);
  });

  it("is null without open interest", () => {
    expect(maxPain(chain([contract(100)], [contract(100)]))).toBeNull();
    expect(maxPain(chain([], []))).toBeNull();
  });
});

describe("unusual activity", () => {
  it("needs volume above open interest and a minimum volume", () => {
    const o = chain(
      [contract(100, { volume: 500, open_interest: 200 }), contract(105, { volume: 50, open_interest: 10 }), contract(110, { volume: 300, open_interest: 300 })],
      [contract(95, { volume: 900, open_interest: 0 }), contract(90, { volume: 400, open_interest: null })],
    );
    const list = unusualActivity(o);
    expect(list.map((u) => [u.kind, u.contract.strike, u.ratio])).toEqual([["put", 95, null], ["call", 100, 2.5]]);
  });
});

describe("chain shapes", () => {
  it("merges open interest by strike around the price", () => {
    const o = chain([contract(100, { open_interest: 5 }), contract(120, { open_interest: 7 })], [contract(100, { open_interest: 3 }), contract(80, { open_interest: 0 })]);
    expect(oiByStrike(o)).toEqual([{ strike: 100, calls: 5, puts: 3 }, { strike: 120, calls: 7, puts: 0 }]);
    expect(oiByStrike(o, 1)).toEqual([{ strike: 100, calls: 5, puts: 3 }]);
  });

  it("builds the smile from out-of-the-money contracts and skips empty IV", () => {
    const o = chain(
      [contract(90, { iv: 0.5 }), contract(100, { iv: 0.3 }), contract(110, { iv: 0.35 })],
      [contract(90, { iv: 0.4 }), contract(100, { iv: 0.31 }), contract(95, { iv: 0 })],
    );
    expect(smile(o)).toEqual([{ strike: 90, iv: 0.4 }, { strike: 100, iv: 0.3 }, { strike: 110, iv: 0.35 }]);
  });

  it("averages the ATM call and put IV", () => {
    const o = chain([contract(100, { iv: 0.3 }), contract(120, { iv: 0.9 })], [contract(101, { iv: 0.32 })]);
    expect(atmIv(o)).toBeCloseTo(0.31);
    expect(atmIv(chain([], []))).toBeNull();
    expect(atmIv(chain([contract(100, { iv: 0.3 })], [], { price: null }))).toBeNull();
  });
});

describe("implied move", () => {
  const DAY = 86400;

  it("picks the first expiry on a later day than the report", () => {
    const report = 10 * DAY + 3600;
    expect(expiryAfter([12 * DAY, 10 * DAY, 11 * DAY], report)).toBe(11 * DAY);
    expect(expiryAfter([10 * DAY], report)).toBeNull();
  });

  it("prices the ATM straddle from mids", () => {
    const o = chain([contract(100, { bid: 4, ask: 4.2 }), contract(105, { bid: 1, ask: 1.2 })], [contract(100, { bid: 3.8, ask: 4 }), contract(105, { bid: 6, ask: 6.2 })]);
    const s = straddle(o)!;
    expect(s.strike).toBe(100);
    expect(s.cost).toBeCloseTo(8);
    expect(s.pct).toBeCloseTo(8);
  });

  it("falls back to the last price and gives up without one", () => {
    expect(straddle(chain([contract(100, { last: 3 })], [contract(100, { last: 2 })]))!.cost).toBe(5);
    expect(straddle(chain([contract(100, { last: 3 })], [contract(100)]))).toBeNull();
    expect(straddle(chain([], []))).toBeNull();
  });

  it("measures the close before to the close after each report", () => {
    const open = 13.5 * 3600;
    const bars = [100, 110, 99, 99, 108.9].map((c, i) => ({ t: i * DAY + open, o: c, h: c, l: c, c, v: 1 }));
    const afterClose = 1 * DAY + 20 * 3600;
    const beforeOpen = 4 * DAY + 12 * 3600;
    const moves = pastMoves(bars, [afterClose, beforeOpen, 10 * DAY]);
    expect(moves.map((m) => m.reported)).toEqual([afterClose, beforeOpen]);
    expect(moves[0].pct).toBeCloseTo(-10);
    expect(moves[1].pct).toBeCloseTo(10);
    expect(averageAbs(moves)).toBeCloseTo(10);
    expect(averageAbs([])).toBeNull();
  });
});
