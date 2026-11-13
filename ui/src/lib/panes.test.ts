import { describe, expect, it } from "vitest";
import { paneLayout } from "./indicators";
import { cleanPanes, defaultPanes, mergeUp, movePane, paneName, paneRects, unmerge, visibleGroups, withPanes, type PaneId } from "./panes";

const all = () => true;
const only = (...ids: PaneId[]) => (id: PaneId) => ids.includes(id);

describe("cleanPanes", () => {
  it("defaults to today's order for missing or broken state", () => {
    expect(cleanPanes(null)).toEqual(defaultPanes());
    expect(cleanPanes({ groups: 5, left: "nope" })).toEqual(defaultPanes());
    expect(cleanPanes({ groups: [["macd", "bogus", 3], [], "x"], left: "percent" })).toEqual({
      groups: [["price"], ["macd"], ["rsi"], ["stoch"], ["obv"], ["cci"], ["willr"], ["mfi"], ["stochrsi"], ["aroon"], ["cmf"], ["roc"], ["rsi_study"], ["macd_study"]],
      left: "percent",
    });
  });

  it("keeps price first, drops duplicates and keeps merged groups", () => {
    expect(cleanPanes({ groups: [["obv"], ["stoch", "price", "obv"], ["rsi", "macd"]], left: "same" })).toEqual({
      groups: [["price", "stoch"], ["obv"], ["rsi", "macd"], ["cci"], ["willr"], ["mfi"], ["stochrsi"], ["aroon"], ["cmf"], ["roc"], ["rsi_study"], ["macd_study"]],
      left: "same",
    });
  });
});

describe("pane operations", () => {
  it("moves a pane past hidden panes and stops at the ends", () => {
    const s = defaultPanes();
    expect(movePane(s, "stoch", -1, only("rsi", "stoch")).groups).toEqual([["price"], ["stoch"], ["macd"], ["rsi"], ["obv"], ["cci"], ["willr"], ["mfi"], ["stochrsi"], ["aroon"], ["cmf"], ["roc"], ["rsi_study"], ["macd_study"]]);
    expect(movePane(s, "rsi", -1, all)).toBe(s);
    expect(movePane(s, "macd_study", 1, all)).toBe(s);
  });

  it("merges into the visible pane above, including the price pane, and unmerges", () => {
    const s = mergeUp(defaultPanes(), "stoch", only("rsi", "stoch"));
    expect(s.groups).toEqual([["price"], ["rsi", "stoch"], ["macd"], ["obv"], ["cci"], ["willr"], ["mfi"], ["stochrsi"], ["aroon"], ["cmf"], ["roc"], ["rsi_study"], ["macd_study"]]);
    expect(unmerge(s, "stoch").groups).toEqual([["price"], ["rsi"], ["stoch"], ["macd"], ["obv"], ["cci"], ["willr"], ["mfi"], ["stochrsi"], ["aroon"], ["cmf"], ["roc"], ["rsi_study"], ["macd_study"]]);
    const p = mergeUp(defaultPanes(), "rsi", all);
    expect(p.groups[0]).toEqual(["price", "rsi"]);
    expect(unmerge(p, "price").groups).toEqual(defaultPanes().groups);
    expect(unmerge(defaultPanes(), "rsi")).toEqual(defaultPanes());
  });

  it("filters hidden members and empty groups", () => {
    expect(visibleGroups([["price", "rsi"], ["macd", "obv"], ["stoch"]], only("obv"))).toEqual([["price"], ["obv"]]);
  });
});

describe("paneRects", () => {
  it("matches the old layout by default", () => {
    const vis = visibleGroups(defaultPanes().groups, only("rsi", "macd", "obv"));
    const r = paneRects(400, vis, null);
    const old = paneLayout(400, true, true, 1);
    expect(r.priceH).toBe(old.priceH);
    expect(r.volTop).toBe(old.volTop);
    expect(r.slots.map((s) => s.top)).toEqual([old.rsiTop, old.macdTop, old.extraTops[0]]);
    expect(r.slots.every((s) => s.h === old.rsiH)).toBe(true);
    expect(r.hidePrice).toBe(false);
  });

  it("maximizes a sub-pane or the price pane", () => {
    const vis = visibleGroups([["price", "obv"], ["rsi", "stoch"], ["macd"]], all);
    expect(paneRects(400, vis, "stoch")).toMatchObject({ hidePrice: true, overlays: ["obv"], slots: [{ ids: ["rsi", "stoch"], top: 0, h: 400 }] });
    const p = paneRects(400, vis, "price");
    expect(p.slots).toEqual([]);
    expect(p.priceH).toBe(paneLayout(400, false, false, 0).priceH);
    expect(paneRects(400, visibleGroups(defaultPanes().groups, only("rsi")), "macd").slots).toHaveLength(1);
  });
});

describe("extra study panes", () => {
  it("keeps instance panes, names them and appends new ones", () => {
    const s = cleanPanes({ groups: [["price"], ["cci-2", "rsi"], ["bogus-2"]], left: "off" });
    expect(s.groups[1]).toEqual(["cci-2", "rsi"]);
    expect(s.groups.flat()).not.toContain("bogus-2");
    expect(paneName("cci-2")).toBe("CCI 2");
    expect(paneName("rsi_study")).toBe("RSI study");
    const more = withPanes(s, ["cci-2", "macd_study-3"]);
    expect(more.groups.at(-1)).toEqual(["macd_study-3"]);
    expect(withPanes(more, ["cci-2"])).toBe(more);
  });
});
