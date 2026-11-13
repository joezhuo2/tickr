import { describe, expect, it } from "vitest";
import { cleanSettings, defaultSettings, nextKey, studyInstances } from "./studySettings";

describe("study settings", () => {
  it("defaults to the previously fixed values", () => {
    const d = defaultSettings();
    expect(d.stoch).toEqual({ k: 14, smooth: 3, d: 3 });
    expect(d.ichimoku).toEqual({ conversion: 9, base: 26, spanB: 52, displacement: 26 });
    expect(d.supertrend).toEqual({ length: 10, multiplier: 3 });
    expect(d.pivotType).toBe("classic");
    expect(d.zigzag).toEqual({ percent: 5 });
    expect(d.linreg).toEqual({ length: 100, deviations: 2 });
    expect(d.stochrsi).toEqual({ rsi: 14, stoch: 14, k: 3, d: 3 });
    expect([d.aroon.length, d.cmf.length, d.roc.length]).toEqual([25, 20, 9]);
    expect(d.vpArea).toBe(70);
    expect(d.showPoc).toBe(true);
    expect(cleanSettings({ vpArea: 99, showPoc: false })).toMatchObject({ vpArea: 95, showPoc: false });
  });

  it("clamps, rounds and rejects bad values", () => {
    const s = cleanSettings({ stoch: { k: 0, smooth: 7.6, d: "x" }, psar: { step: 0.5, max: 0.1 }, supertrend: { multiplier: 99 }, pivotType: "nope" });
    expect(s.stoch).toEqual({ k: 1, smooth: 8, d: 3 });
    expect(s.psar).toEqual({ step: 0.5, max: 0.5 });
    expect(s.supertrend.multiplier).toBe(10);
    expect(s.pivotType).toBe("classic");
    expect(cleanSettings({ pivotType: "woodie" }).pivotType).toBe("woodie");
  });

  it("turns old single-study settings into instance one", () => {
    const old = cleanSettings({ cci: { length: 30 }, stoch: { k: 9 } });
    expect(old.extras).toEqual([]);
    expect(old.timeframes).toEqual({});
    expect(studyInstances({ cci: true, obv: true }, old)).toEqual([{ key: "cci", study: "cci", params: { length: 30 }, tf: "chart" }]);
  });

  it("cleans extra instances and timeframes", () => {
    const s = cleanSettings({
      timeframes: { cci: "1d", zigzag: "1d", stoch: "7m", bogus: "1d" },
      extras: [
        { key: "rsi_study-2", study: "rsi_study", params: { length: 0 }, tf: "60m" },
        { key: "rsi_study-2", study: "rsi_study", params: {}, tf: "chart" },
        { key: "cci-1", study: "cci", params: {} },
        { key: "nope-2", study: "nope" },
        { key: "linreg-3", study: "linreg", params: { length: 50 }, tf: "1d" },
        null,
      ],
    });
    expect(s.timeframes).toEqual({ cci: "1d" });
    expect(s.extras).toEqual([
      { key: "rsi_study-2", study: "rsi_study", params: { length: 1 }, tf: "60m" },
      { key: "linreg-3", study: "linreg", params: { length: 50, deviations: 2 }, tf: "chart" },
    ]);
    expect(studyInstances({ cci: true }, s).map((x) => [x.key, x.tf])).toEqual([["cci", "1d"], ["rsi_study-2", "60m"], ["linreg-3", "chart"]]);
    expect(nextKey("rsi_study", s)).toBe("rsi_study-3");
    expect(nextKey("linreg", s)).toBe("linreg-2");
  });
});
