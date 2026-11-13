import { describe, expect, it } from "vitest";
import { ParseError, buildCondition, check, ema, evaluate, parse, rsi, sma, values } from "./strategy";
import { adx, aroon, cci, cmf, donchian, hma, macd, mfi, roc, stochRsi, stochastic, supertrend, vwma, williamsR, wma } from "./studies";
import type { Candle } from "./types";

const bars = (closes: number[]): Candle[] => closes.map((c, i) => ({ t: i * 60, o: c, h: c + 1, l: c - 1, c, v: 1000 + i }));
const run = (src: string, closes: number[]) => evaluate(parse(src), bars(closes));

describe("parse", () => {
  it("respects precedence and parentheses", () => {
    expect(parse("close > 1 + 2 * 3")).toEqual({
      k: "cmp", op: ">", a: { k: "field", name: "close" },
      b: { k: "math", op: "+", a: { k: "num", v: 1 }, b: { k: "math", op: "*", a: { k: "num", v: 2 }, b: { k: "num", v: 3 } } },
    });
    expect(run("(close + 1) * 2 > 10", [3, 4, 5])).toEqual([false, false, true]);
    expect(run("close > 1 or close > 0 and close > 9", [2])).toEqual([true]);
    expect(run("not close > 3 and close > 1", [1, 2, 5])).toEqual([false, true, false]);
    expect(run("-close < -2", [1, 3])).toEqual([false, true]);
  });

  it("is case-insensitive about names", () => {
    expect(run("CLOSE >= SMA(2)", [1, 3])).toEqual([false, true]);
  });

  it("reports errors with a position", () => {
    const cases: [string, RegExp, number][] = [
      ["", /empty/, 0],
      ["close > ", /Unexpected end of expression/, 8],
      ["close > 1 )", /Unexpected "\)"/, 10],
      ["(close > 1", /Expected "\)"/, 10],
      ["close $ 1", /Unexpected character "\$"/, 6],
      ["foo > 1", /Unknown name "foo"/, 0],
      ["sma(0) > 1", /whole-number period/, 4],
      ["sma(2.5) > 1", /whole-number period/, 4],
      ["close + 1", /needs a true\/false condition/, 0],
      ["close and close > 1", /"and" needs a true\/false condition/, 0],
      ["close > 1 > 2", /Chained comparisons/, 10],
      ["(close > 1) + 2 > 1", /"\+" needs a number/, 0],
      ["crosses_above(close, 1", /Expected "\)"/, 22],
    ];
    for (const [src, msg, pos] of cases) {
      let err: unknown;
      try {
        parse(src);
      } catch (e) {
        err = e;
      }
      expect(err, src).toBeInstanceOf(ParseError);
      expect((err as ParseError).message, src).toMatch(msg);
      expect((err as ParseError).pos, src).toBe(pos);
    }
    expect(check("close > sma(20)")).toBeNull();
    expect(check("close >")).toMatch(/position 8/);
  });
});

describe("indicators", () => {
  it("sma and ema wait for a full window, ema seeded with the sma", () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([NaN, 1.5, 2.5, 3.5]);
    const e = ema([1, 2, 3, 4], 3);
    expect(e.slice(0, 2)).toEqual([NaN, NaN]);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(0.5 * 4 + 0.5 * 2);
  });

  it("rsi reads 100 on gains only, 50 when flat, and starts after n changes", () => {
    expect(rsi([1, 2, 3, 4], 2)).toEqual([NaN, NaN, 100, 100]);
    expect(rsi([5, 5, 5], 2)).toEqual([NaN, NaN, 50]);
    expect(rsi([1, 2, 1], 2)[2]).toBe(50);
    expect(rsi([], 14)).toEqual([]);
  });
});

describe("evaluate", () => {
  it("detects crosses on the bar they happen", () => {
    expect(run("crosses_above(close, 5)", [4, 5, 6, 4, 7])).toEqual([false, false, true, false, true]);
    expect(run("crosses_below(close, 5)", [6, 5, 4, 6, 3])).toEqual([false, false, true, false, true]);
  });

  it("treats indicator warm-up as false, not as a signal", () => {
    expect(run("close > sma(3)", [1, 2, 3, 4])).toEqual([false, false, true, true]);
    expect(run("not close < sma(3)", [3, 2, 1])).toEqual([true, true, false]);
    expect(run("crosses_above(sma(2), sma(3))", [3, 2, 1, 5])).toEqual([false, false, false, true]);
  });

  it("reads volume and other fields", () => {
    expect(run("volume > 1000 and high - low == 2", [1, 1])).toEqual([false, true]);
  });

  it("never looks ahead: bar i depends only on bars up to i", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + 10 * Math.sin(i / 3) + (i % 7));
    const src = "crosses_above(ema(5), sma(10)) or rsi(14) < 40 and close > open - 1 or crosses_below(close, ema(8))";
    const expr = parse(src);
    const full = evaluate(expr, bars(closes));
    for (let i = 0; i < closes.length; i++) {
      const prefix = evaluate(expr, bars(closes.slice(0, i + 1)));
      expect(prefix[i], `bar ${i}`).toBe(full[i]);
      const altered = bars([...closes.slice(0, i + 1), ...closes.slice(i + 1).map((c) => c * 3 + 50)]);
      expect(evaluate(expr, altered)[i], `bar ${i}`).toBe(full[i]);
    }
    expect(full.some(Boolean)).toBe(true);
  });
});

describe("buildCondition", () => {
  it("writes expressions the parser accepts", () => {
    const a = buildCondition({ kind: "close", n: 0 }, ">", { kind: "sma", n: 50 });
    const b = buildCondition({ kind: "rsi", n: 14 }, "crosses_below", { kind: "value", n: 30 });
    const c = buildCondition({ kind: "ema", n: 9 }, "crosses_above", { kind: "ema", n: 21 });
    expect([a, b, c]).toEqual(["close > sma(50)", "crosses_below(rsi(14), 30)", "crosses_above(ema(9), ema(21))"]);
    for (const s of [a, b, c]) expect(check(s)).toBeNull();
  });
});

describe("study functions", () => {
  const c = bars([10, 12, 11, 13, 15, 14, 16, 18, 17, 19, 21, 20, 22, 21, 23, 25, 24, 26, 28, 27, 29, 31, 30, 32, 34, 33, 35, 37, 36, 38, 40, 39, 41, 43, 42, 44, 46, 45]);
  const nums = (s: (number | null)[]) => s.map((x) => x ?? NaN);
  const num = (src: string) => values(parse(src, "num"), c);

  it("fills left-out arguments with the study defaults", () => {
    expect(parse("macd()", "num")).toEqual({ k: "fn", fn: "macd", args: [12, 26, 9] });
    expect(parse("macd(8)", "num")).toEqual({ k: "fn", fn: "macd", args: [8, 26, 9] });
    expect(parse("cci", "num")).toEqual({ k: "fn", fn: "cci", args: [20] });
    expect(parse("bb_upper(10, 2.5)", "num")).toEqual({ k: "fn", fn: "bb_upper", args: [10, 2.5] });
    expect(parse("stochrsi", "num")).toEqual({ k: "fn", fn: "stochrsi", args: [14, 14, 3, 3] });
    expect(parse("supertrend(7)", "num")).toEqual({ k: "fn", fn: "supertrend", args: [7, 3] });
  });

  it("rejects bad arguments", () => {
    for (const src of ["macd(1, 2, 3, 4) > 0", "macd(1.5) > 0", "bb_upper(20, 0) > 0", "cci(0) > 0", "roc(9 > 0", "wma(close) > 0"]) expect(check(src)).not.toBeNull();
    expect(check("crosses_above(macd(), macd_signal()) and adx(14) > 25")).toBeNull();
  });

  it("reuses the study computations", () => {
    const pairs: [string, (number | null)[]][] = [
      ["macd(3, 6, 4)", macd(c, 3, 6, 4).line],
      ["macd_signal(3, 6, 4)", macd(c, 3, 6, 4).signal],
      ["macd_hist(3, 6, 4)", macd(c, 3, 6, 4).hist],
      ["stoch_k(5, 2, 2)", stochastic(c, 5, 2, 2).k],
      ["stoch_d(5, 2, 2)", stochastic(c, 5, 2, 2).d],
      ["wma(4)", wma(c, 4)],
      ["hma(4)", hma(c, 4)],
      ["vwma(4)", vwma(c, 4)],
      ["stochrsi(3, 3, 2, 2)", stochRsi(c, 3, 3, 2, 2).k],
      ["aroon_up(5)", aroon(c, 5).up],
      ["aroon_down(5)", aroon(c, 5).down],
      ["cmf(5)", cmf(c, 5)],
      ["roc(3)", roc(c, 3)],
      ["cci(5)", cci(c, 5)],
      ["mfi(5)", mfi(c, 5)],
      ["willr(5)", williamsR(c, 5)],
      ["adx(5)", adx(c, 5)],
      ["supertrend(5, 2)", supertrend(c, 5, 2).value],
      ["donchian_high(5)", donchian(c, 5).upper],
      ["donchian_low(5)", donchian(c, 5).lower],
    ];
    for (const [src, want] of pairs) expect(num(src), src).toEqual(nums(want));
    expect(num("macd_signal()").filter(Number.isFinite).length).toBe(c.length - 33);
  });

  it("computes known values", () => {
    const three = bars([1, 2, 3]);
    expect(values(parse("bb_mid(3, 2)", "num"), three)[2]).toBe(2);
    expect(values(parse("bb_upper(3, 2)", "num"), three)[2]).toBeCloseTo(2 + 2 * Math.sqrt(2 / 3));
    expect(values(parse("bb_lower(3, 1)", "num"), three)[2]).toBeCloseTo(2 - Math.sqrt(2 / 3));
    expect(values(parse("wma(3)", "num"), three)[2]).toBeCloseTo(14 / 6);
    expect(values(parse("roc(1)", "num"), bars([10, 11]))[1]).toBeCloseTo(10);
    expect(values(parse("adx(3)", "num"), bars([1, 2, 3, 4, 5, 6, 7])).slice(4)).toEqual([NaN, 100, 100]);
    expect(values(parse("donchian_high(2)", "num"), three)[2]).toBe(4);
  });

  it("builds conditions with the new functions", () => {
    expect(buildCondition({ kind: "macd", n: 12 }, ">", { kind: "value", n: 0 })).toBe("macd(12) > 0");
    expect(buildCondition({ kind: "close", n: 0 }, "crosses_below", { kind: "bb_lower", n: 20 })).toBe("crosses_below(close, bb_lower(20))");
  });
});
