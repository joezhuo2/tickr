import { describe, expect, it } from "vitest";
import {
  AFTER,
  CONTEXT,
  HORIZON,
  KEEP_BEFORE,
  atrPct,
  candidates,
  canClose,
  classify,
  close,
  decide,
  evaluate,
  exerciseBars,
  fetchWindow,
  finish,
  markers,
  marketMove,
  percentReturn,
  pickStart,
  randomInt,
  rangesFor,
  scopeSymbols,
  scopes,
  seeded,
  summarize,
  validSetup,
  type Bar,
} from "./practice";

const DAY = 86_400;

function bars(n: number, close: (i: number) => number = () => 100, range: (i: number) => number = () => 2): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const c = close(i);
    const r = range(i);
    return { t: 1_700_000_000 + i * DAY, o: c, h: c + r / 2, l: c - r / 2, c };
  });
}

function path(points: [number, number, number][]): Bar[] {
  return points.map(([o, c, i]) => ({ t: 1_700_000_000 + i * DAY, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c }));
}

describe("seeded", () => {
  it("is deterministic and stays in [0, 1)", () => {
    const a = seeded(42);
    const b = seeded(42);
    const xs = Array.from({ length: 500 }, () => a());
    expect(Array.from({ length: 500 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(seeded(43)()).not.toBe(seeded(42)());
  });
  it("picks whole indices in range", () => {
    expect(randomInt(() => 0, 5)).toBe(0);
    expect(randomInt(() => 0.9999999, 5)).toBe(4);
    expect(randomInt(() => 1, 5)).toBe(4);
  });
});

describe("atrPct", () => {
  it("averages the true range over the bars up to the index", () => {
    expect(atrPct(bars(30), 20)).toBeCloseTo(2);
    expect(atrPct(bars(30), 13)).toBeNull();
    expect(atrPct(bars(30), 30)).toBeNull();
  });
  it("counts gaps from the previous close", () => {
    const b = bars(20);
    b[15] = { ...b[15], o: 110, h: 111, l: 109, c: 110 };
    expect(atrPct(b, 15)).toBeCloseTo(((13 * 2 + 11) / 14 / 110) * 100);
  });
  it("ignores bars after the index", () => {
    const b = bars(40);
    const before = atrPct(b, 20);
    b[21] = { ...b[21], h: 500, l: 1 };
    expect(atrPct(b, 20)).toBe(before);
  });
});

describe("candidates", () => {
  it("needs context bars before and bars after every start", () => {
    const b = bars(200);
    const c = candidates(b, -Infinity);
    expect(c[0]).toBe(CONTEXT);
    expect(c[c.length - 1]).toBe(b.length - 1 - AFTER);
    expect(c.every((i) => i >= CONTEXT && i + AFTER <= b.length - 1)).toBe(true);
  });
  it("keeps starts inside the chosen date range", () => {
    const b = bars(300);
    const from = b[150].t;
    expect(candidates(b, from)[0]).toBe(150);
  });
  it("is empty when the history is too short", () => {
    expect(candidates(bars(CONTEXT + AFTER), -Infinity)).toEqual([]);
    expect(candidates(bars(CONTEXT + AFTER + 1), -Infinity)).toEqual([CONTEXT]);
  });
});

describe("classify", () => {
  it("flags the most volatile quarter by ATR%", () => {
    const b = bars(400, () => 100, (i) => (i >= 200 ? 10 : 2));
    const list = classify(b, candidates(b, -Infinity));
    const hot = list.filter((c) => c.volatile);
    expect(hot.length).toBe(Math.round(list.length / 4));
    expect(hot.every((c) => c.index >= 200)).toBe(true);
  });
  it("flags nothing when every period is alike", () => {
    const b = bars(300);
    expect(classify(b, candidates(b, -Infinity)).some((c) => c.volatile)).toBe(false);
  });
});

describe("pickStart", () => {
  const b = bars(500, (i) => 100 + Math.sin(i / 7) * 5, (i) => (i % 97 < 20 ? 9 : 2));

  it("never picks a start without enough context or bars after", () => {
    for (let seed = 0; seed < 300; seed++) {
      const p = pickStart(b, b[100].t, seeded(seed))!;
      expect(p.index).toBeGreaterThanOrEqual(Math.max(CONTEXT, 100));
      expect(p.index + AFTER).toBeLessThanOrEqual(b.length - 1);
    }
    expect(pickStart(bars(CONTEXT + AFTER), -Infinity, seeded(1))).toBeNull();
    expect(pickStart(b, b[b.length - AFTER].t, seeded(1))).toBeNull();
  });
  it("is deterministic with a seeded RNG", () => {
    const run = (seed: number) => {
      const rng = seeded(seed);
      return Array.from({ length: 20 }, () => pickStart(b, -Infinity, rng)!.index);
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });
  it("picks volatile periods about one time in three", () => {
    const rng = seeded(123);
    const n = 3000;
    let hot = 0;
    for (let k = 0; k < n; k++) if (pickStart(b, -Infinity, rng)!.volatile) hot++;
    expect(hot / n).toBeGreaterThan(0.29);
    expect(hot / n).toBeLessThan(0.38);
  });
  it("falls back to ordinary periods when none are volatile", () => {
    const flat = bars(300);
    const p = pickStart(flat, -Infinity, () => 0)!;
    expect(p.volatile).toBe(false);
    expect(p.index).toBe(CONTEXT);
  });
});

describe("exerciseBars", () => {
  it("keeps context before the start and a fixed horizon after", () => {
    const b = bars(1000);
    const w = exerciseBars(b, 600);
    expect(w.bars[w.start]).toBe(b[600]);
    expect(w.start).toBe(KEEP_BEFORE);
    expect(w.bars.length).toBe(KEEP_BEFORE + HORIZON + 1);
    const early = exerciseBars(b, 70);
    expect(early.start).toBe(70);
    expect(early.bars[0]).toBe(b[0]);
    const late = exerciseBars(b, 940);
    expect(late.bars[late.bars.length - 1]).toBe(b[999]);
  });
});

describe("setup", () => {
  it("offers only ranges the interval can fill", () => {
    expect(rangesFor("60m")).toEqual(["3mo", "1y"]);
    expect(rangesFor("1d")).toEqual(["3mo", "1y", "2y", "5y"]);
    expect(rangesFor("1wk")).toEqual(["2y", "5y"]);
    expect(validSetup({ scope: "watchlist", interval: "60m", range: "5y" }, [])).toEqual({ scope: "watchlist", interval: "60m", range: "1y" });
    expect(validSetup({ scope: "group:Gone", interval: "1d", range: "2y" }, [])).toEqual({ scope: "watchlist", interval: "1d", range: "2y" });
  });
  it("fetches extra history before the range for context", () => {
    const now = 1_800_000_000;
    const w = fetchWindow({ scope: "watchlist", interval: "1d", range: "1y" }, now);
    expect(w.end).toBe(now);
    expect(w.from).toBe(now - 365 * DAY);
    expect(w.start).toBeLessThan(w.from);
  });
  it("lists starred symbols or a group", () => {
    const groups = [{ name: "Tech", symbols: ["AAPL", "MSFT", "AAPL"] }];
    expect(scopes(groups).map((s) => s.id)).toEqual(["watchlist", "group:Tech"]);
    expect(scopeSymbols("watchlist", ["SPY", "QQQ"], groups)).toEqual(["SPY", "QQQ"]);
    expect(scopeSymbols("group:Tech", ["SPY"], groups)).toEqual(["AAPL", "MSFT"]);
    expect(scopeSymbols("group:None", ["SPY"], groups)).toEqual([]);
  });
});

describe("trades", () => {
  const up = path([
    [100, 100, 0],
    [100, 100, 1],
    [102, 104, 2],
    [104, 108, 3],
    [108, 110, 4],
  ]);

  it("enters at the next candle's open", () => {
    const t = decide("long", 1);
    expect(evaluate(t, up, 1).status).toBe("pending");
    expect(canClose(t, 1)).toBe(false);
    const r = evaluate(t, up, 2);
    expect(r.status).toBe("open");
    expect(r.entry).toBe(2);
    expect(r.entry_price).toBe(102);
    expect(r.exit_price).toBe(104);
    expect(r.bars_held).toBe(1);
  });
  it("closes at a revealed candle's close", () => {
    const t = close(decide("long", 1), 3);
    expect(t.exit).toBe(3);
    const r = evaluate(t, up, 4);
    expect(r.status).toBe("closed");
    expect(r.exit_price).toBe(108);
    expect(r.return_pct).toBeCloseTo((108 / 102 - 1) * 100);
    expect(r.bars_held).toBe(2);
    expect(close(t, 4)).toBe(t);
    expect(close(decide("long", 1), 1).exit).toBeNull();
  });
  it("gives long and short returns the right sign", () => {
    expect(evaluate(close(decide("long", 1), 4), up, 4).return_pct).toBeGreaterThan(0);
    expect(evaluate(close(decide("short", 1), 4), up, 4).return_pct).toBeLessThan(0);
    const down = path([
      [100, 100, 0],
      [100, 100, 1],
      [98, 96, 2],
      [96, 90, 3],
    ]);
    const short = evaluate(close(decide("short", 1), 3), down, 3);
    expect(short.return_pct).toBeCloseTo((1 - 90 / 98) * 100);
    expect(short.return_pct).toBeGreaterThan(0);
    expect(evaluate(close(decide("long", 1), 3), down, 3).return_pct).toBeLessThan(0);
    expect(percentReturn("long", 100, 110)).toBeCloseTo(10);
    expect(percentReturn("short", 100, 110)).toBeCloseTo(-10);
  });
  it("treats skip as neutral", () => {
    const t = decide("skip", 1);
    const r = evaluate(t, up, 4);
    expect(r.status).toBe("skipped");
    expect(r.return_pct).toBe(0);
    expect(r.bars_held).toBe(0);
    expect(canClose(t, 4)).toBe(false);
    expect(finish(t, 4)).toBe(t);
    expect(markers(r, up)).toEqual([]);
    const s = summarize(t, up);
    expect(s.skip_pct).toBe(0);
    expect(s.result.return_pct).toBe(0);
    expect(s.market_pct).toBeCloseTo(10);
  });
  it("cancels a trade ended before its entry candle", () => {
    const t = finish(decide("long", 1), 1);
    expect(t.cancelled).toBe(true);
    const r = evaluate(t, up, 4);
    expect(r.status).toBe("unfilled");
    expect(r.return_pct).toBe(0);
    expect(markers(r, up)).toEqual([]);
  });
  it("closes an open trade at the current close when the exercise ends", () => {
    const t = finish(decide("short", 0), 3);
    expect(t.exit).toBe(3);
    const s = summarize(t, up);
    expect(s.result.status).toBe("closed");
    expect(s.result.entry_price).toBe(100);
    expect(s.result.exit_price).toBe(108);
    expect(s.result.bars_held).toBe(3);
    expect(s.market_pct).toBeCloseTo(10);
  });
  it("marks the entry and exit on the chart", () => {
    const long = evaluate(close(decide("long", 1), 3), up, 4);
    expect(markers(long, up)).toEqual([
      { t: up[2].t, side: "buy", price: 102 },
      { t: up[3].t, side: "sell", price: 108 },
    ]);
    const short = evaluate(decide("short", 1), up, 2);
    expect(markers(short, up)).toEqual([{ t: up[2].t, side: "sell", price: 102 }]);
    expect(markers(evaluate(decide("long", 1), up, 1), up)).toEqual([]);
  });
  it("has no entry past the end of the data", () => {
    expect(evaluate(decide("long", 4), up, 4).status).toBe("pending");
    expect(finish(decide("long", 4), 4).cancelled).toBe(true);
  });
  it("measures the market move over the exercise", () => {
    expect(marketMove(up, 0, 4)).toBeCloseTo(10);
    expect(marketMove(up, 4, 4)).toBeNull();
  });
});
