import { describe, expect, it } from "vitest";
import { aroon, cci, cmf, donchian, hma, ichimoku, keltner, linearRegression, mfi, obv, parabolicSar, pivotPeriod, pivots, roc, stochRsi, stochastic, supertrend, vwma, williamsR, wma, zigzag } from "./studies";
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
    expect(i.spanA).toHaveLength(15);
    expect(i.spanA[14]).toBe((i.tenkan[11]! + i.kijun[11]!) / 2);
    expect(i.spanB[14]).toBe((c[11].h + c[8].l) / 2);
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

  it("decouples the Ichimoku displacement from the base period", () => {
    const c = ramp(12);
    const i = ichimoku(c, 2, 3, 4, 1);
    expect(i.spanA).toHaveLength(13);
    expect(i.chikou[0]).toBe(c[1].c);
    expect(i.spanB[4]).toBe((c[3].h + c[0].l) / 2);
  });

  it("derives fibonacci, camarilla and woodie pivots", () => {
    const day = 86400;
    const c = [k(0, 12, 8, 10), k(100, 14, 9, 12), k(day, 20, 15, 16)];
    const at = (t: "fibonacci" | "camarilla" | "woodie") => pivots(c, pivotPeriod("5m", 0), t)[2]!;
    const p = 34 / 3;
    expect(at("fibonacci").r1).toBeCloseTo(p + 0.382 * 6);
    expect(at("fibonacci").s2).toBeCloseTo(p - 0.618 * 6);
    expect(at("camarilla").r2).toBeCloseTo(13.1);
    expect(at("camarilla").s1).toBeCloseTo(11.45);
    expect(at("woodie")).toEqual({ p: 11.5, r1: 15, s1: 9, r2: 17.5, s2: 5.5 });
  });

  it("builds Keltner channels from an EMA and Wilder ATR", () => {
    const c = [k(0, 11, 9, 10), k(1, 12, 10, 11), k(2, 13, 11, 12), k(3, 14, 12, 13)];
    const { upper, mid, lower } = keltner(c, 2, 2, 2);
    expect(mid[0]).toBeNull();
    expect(mid[1]).toBe(10.5);
    expect(mid[2]).toBeCloseTo(11.5);
    expect(upper[1]).toBe(14.5);
    expect(lower[3]).toBeCloseTo(mid[3]! - 4);
  });

  it("tracks the highest high and lowest low for Donchian", () => {
    const d = donchian(ramp(5), 3);
    expect(d.upper[1]).toBeNull();
    expect(d.upper[2]).toBe(13);
    expect(d.lower[4]).toBe(11);
    expect(d.mid[4]).toBe(13);
  });

  it("computes CCI, Williams %R and MFI by hand", () => {
    const c = [k(0, 12, 8, 10), k(1, 13, 9, 11), k(2, 17, 11, 14)];
    const x = cci(c, 3);
    expect(x[1]).toBeNull();
    expect(x[2]).toBeCloseTo(100, 6);
    expect(cci([k(0, 5, 5, 5), k(1, 5, 5, 5)], 2)[1]).toBe(0);
    expect(williamsR(c, 3)[2]).toBeCloseTo(-100 / 3);
    expect(williamsR([k(0, 5, 5, 5)], 1)[0]).toBe(-50);
    const m = [k(0, 10, 10, 10, 5), k(1, 12, 12, 12, 2), k(2, 11, 11, 11, 4), k(3, 11, 11, 11, 9)];
    expect(mfi(m, 2)[1]).toBeNull();
    expect(mfi(m, 2)[2]).toBeCloseTo(100 - 100 / (1 + 24 / 44));
    expect(mfi(m, 2)[3]).toBe(0);
    expect(mfi(ramp(4), 2)[3]).toBe(100);
  });

  it("steps and flips the Parabolic SAR", () => {
    const up = parabolicSar(ramp(5));
    expect(up.value[0]).toBeNull();
    expect(up.value[1]).toBe(9);
    expect(up.value[2]).toBe(9);
    expect(up.value[3]).toBeCloseTo(9.16, 6);
    expect(up.value[4]).toBeCloseTo(9.4504, 6);
    const flip = parabolicSar([k(0, 11, 9, 10), k(1, 12, 10, 11), k(2, 9, 5, 6)]);
    expect(flip.value[2]).toBe(12);
    expect(flip.up[2]).toBe(false);
  });

  it("weights WMA, Hull MA and VWMA", () => {
    expect(wma(ramp(5), 3)[1]).toBeNull();
    expect(wma(ramp(5), 3)[2]).toBeCloseTo(68 / 6);
    const h = hma(ramp(8), 4);
    expect(h[3]).toBeNull();
    expect(h[4]).toBeCloseTo(14);
    expect(h[7]).toBeCloseTo(17);
    expect(vwma([k(0, 10, 10, 10, 1), k(1, 20, 20, 20, 3)], 2)).toEqual([null, 17.5]);
    expect(vwma([k(0, 10, 10, 10, 0)], 1)).toEqual([null]);
  });

  it("marks ZigZag pivots on percent reversals and never moves a confirmed one", () => {
    const c = [100, 110, 104, 103, 112, 100].map((p, i) => k(i, p, p, p));
    const full = zigzag(c, 5);
    expect(full).toEqual([100, 110, null, 103, 112, 100]);
    for (let m = 1; m <= c.length; m++) {
      const part = zigzag(c.slice(0, m), 5);
      const shown = part.flatMap((v, i) => (v == null ? [] : [i]));
      for (const i of shown.slice(0, -1)) expect(part[i]).toBe(full[i]);
    }
    expect(zigzag([], 5)).toEqual([]);
  });

  it("fits a linear regression channel over the last bars", () => {
    const line = linearRegression(ramp(5), 3, 2);
    expect(line.mid[1]).toBeNull();
    expect(line.mid.slice(2)).toEqual([12, 13, 14].map((x) => expect.closeTo(x, 9)));
    expect(line.upper[4]).toBeCloseTo(14);
    const bent = linearRegression([1, 3, 2].map((p, i) => k(i, p, p, p)), 3, 2);
    expect(bent.mid[2]).toBeCloseTo(2.5);
    expect(bent.upper[2]).toBeCloseTo(2.5 + 2 * Math.sqrt(0.5));
    expect(bent.lower[0]).toBeCloseTo(1.5 - 2 * Math.sqrt(0.5));
    expect(linearRegression(ramp(2), 3).mid).toEqual([null, null]);
  });

  it("computes Stoch RSI, Aroon, CMF and ROC by hand", () => {
    const c = [10, 11, 10, 12, 11].map((p, i) => k(i, p, p, p));
    expect(stochRsi(c, 1, 2, 1, 1).k).toEqual([null, null, 0, 100, 0]);
    const smooth = stochRsi(c, 1, 2, 2, 1);
    expect(smooth.k).toEqual([null, null, null, 50, 50]);
    expect(smooth.d[4]).toBe(50);
    const a = aroon(ramp(4), 2);
    expect(a.up[1]).toBeNull();
    expect(a.up[3]).toBe(100);
    expect(a.down[3]).toBe(0);
    expect(cmf([k(0, 12, 8, 11, 10)], 1)).toEqual([0.5]);
    expect(cmf([k(0, 12, 8, 11, 10), k(1, 9, 9, 9, 30)], 2)[1]).toBeCloseTo(0.125);
    expect(roc(ramp(5), 2).slice(0, 3)).toEqual([null, null, 20]);
  });
});
