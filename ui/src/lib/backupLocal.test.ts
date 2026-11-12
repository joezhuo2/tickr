import { describe, expect, it } from "vitest";
import { applyLocal, parseLocal, withLocal } from "./backupLocal";

function fake(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

const alert = { id: 1, symbol: "AAPL", interval: "1d", label: "x", expr: "rsi(14) > 70", line: null, enabled: true, fired_at: null };

describe("backup local state", () => {
  it("round-trips theme colors, studies, indicator alerts and magnet", () => {
    const src = fake({
      "tickr.custom": JSON.stringify({ main: "#ff0000", sub: "", font: "serif", mono: "", colors: {} }),
      "tickr.studies": JSON.stringify({ ichimoku: true }),
      "tickr.chartAlerts": JSON.stringify([alert]),
      "tickr.magnet": "1",
      "tickr.hideDrawings": "1",
      "tickr.technicalsSettingsOpen": "1",
      "tickr.panes": JSON.stringify({ groups: [["price"], ["macd", "rsi"]], left: "percent" }),
      "tickr.rr": "3.5",
    });
    const text = withLocal('{"app":"tickr","settings":{}}', src);
    const dst = fake();
    applyLocal(dst, parseLocal(text));
    expect(JSON.parse(dst.getItem("tickr.custom")!).main).toBe("#ff0000");
    expect(JSON.parse(dst.getItem("tickr.studies")!).ichimoku).toBe(true);
    expect(JSON.parse(dst.getItem("tickr.chartAlerts")!)).toEqual([alert]);
    expect(dst.getItem("tickr.magnet")).toBe("1");
    expect(dst.getItem("tickr.hideDrawings")).toBe("1");
    expect(dst.getItem("tickr.rr")).toBe("3.5");
    expect(dst.getItem("tickr.technicalsSettingsOpen")).toBe("1");
    expect(JSON.parse(dst.getItem("tickr.panes")!)).toEqual({ groups: [["price"], ["macd", "rsi"], ["stoch"], ["obv"]], left: "percent" });
  });

  it("an old backup leaves existing local state alone", () => {
    const dst = fake({ "tickr.studies": '{"ichimoku":true}', "tickr.magnet": "1" });
    applyLocal(dst, parseLocal('{"app":"tickr","settings":{}}'));
    expect(dst.getItem("tickr.studies")).toBe('{"ichimoku":true}');
    expect(dst.getItem("tickr.magnet")).toBe("1");
    expect(dst.getItem("tickr.hideDrawings")).toBeNull();
  });

  it("drops malformed entries", () => {
    const l = parseLocal(JSON.stringify({ local: { chart_alerts: [alert, { id: "x" }, null], studies: 5, custom: { main: "nope" }, panes: { left: "log" } } }));
    expect(l.chart_alerts).toEqual([alert]);
    expect(Object.values(l.studies!).every((v) => v === false)).toBe(true);
    expect(l.custom!.main).toBe("");
    expect(l.panes!.left).toBe("off");
  });
});
