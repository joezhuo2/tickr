import { describe, expect, it } from "vitest";
import { ParseError, buildCondition, check, ema, evaluate, parse, rsi, sma } from "./strategy";
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
