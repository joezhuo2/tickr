import { describe, expect, it } from "vitest";
import { ichimoku, obv, pivotPeriod, pivots, stochastic, supertrend } from "./studies";
import type { Candle } from "./types";

const k = (t: number, h: number, l: number, c: number, v = 10): Candle => ({ t, o: c, h, l, c, v });
const ramp = (n: number, step = 1) => Array.from({ length: n }, (_, i) => k(i, 10 + i * step + 1, 10 + i * step - 1, 10 + i * step));

describe("studies", () => {
  it("computes stochastic %K and %D with warm-up nulls", () => {
    const { k: fast, d } = stochastic(ramp(10), 3, 1, 2);
    expect(fast.slice(0, 3)).toEqual([null, null, 75]);
    expect(d[2]).toBeNull();
    expect(d[3]).toBe(75);
    expect(stochastic([k(0, 5, 5, 5), k(1, 5, 5, 5)], 2, 1, 1).k[1]).toBe(50);
  });

  it("shifts the Ichimoku spans forward and the lagging line back", () => {
    const c = ramp(12);
    const i = ichimoku(c, 2, 3, 4);
    expect(i.tenkan[1]).toBe((c[1].h + c[0].l) / 2);
    expect(i.kijun[1]).toBeNull();
    expect(i.spanA[4]).toBeNull();
    expect(i.spanA[5]).toBe((i.tenkan[2]! + i.kijun[2]!) / 2);
    expect(i.spanB[6]).toBe((c[3].h + c[0].l) / 2);
    expect(i.chikou[0]).toBe(c[3].c);
    expect(i.chikou[11]).toBeNull();
  });

  it("keeps Supertrend below a rising market and flips above a falling one", () => {
    const up = supertrend(ramp(30), 5, 2);
    expect(up.value[3]).toBeNull();
    expect(up.up[29]).toBe(true);
    expect(up.value[29]!).toBeLessThan(39);
    const c = [...ramp(20), ...Array.from({ length: 20 }, (_, i) => k(20 + i, 30 - i * 3 + 1, 30 - i * 3 - 1, 30 - i * 3))];
    const turn = supertrend(c, 5, 2);
    expect(turn.up[39]).toBe(false);
    expect(turn.value[39]!).toBeGreaterThan(c[39].c);
  });

  it("accumulates on-balance volume by close direction", () => {
    expect(obv([k(0, 1, 1, 10, 5), k(1, 1, 1, 11, 7), k(2, 1, 1, 11, 9), k(3, 1, 1, 9, 4)])).toEqual([0, 7, 7, 3]);
  });

  it("derives pivots from the previous period only", () => {
    const day = 86400;
    const c = [k(0, 12, 8, 10), k(100, 14, 9, 11), k(day, 20, 15, 16), k(2 * day, 1, 1, 1)];
    const p = pivots(c, pivotPeriod("5m", 0));
    expect(p[0]).toBeNull();
    expect(p[1]).toBeNull();
    expect(p[2]).toEqual({ p: 11, r1: 14, s1: 8, r2: 17, s2: 5 });
    expect(p[3]!.p).toBeCloseTo((20 + 15 + 16) / 3);
    expect(pivotPeriod("1d", 0)(0)).toBe(1970 * 12);
    expect(pivotPeriod("1wk", 0)(0)).toBe(1970);
  });
});
