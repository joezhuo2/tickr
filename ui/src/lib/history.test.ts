import { describe, expect, it } from "vitest";
import { MAX_BACK, MAX_RECENT, emptyHistory, goBack, goForward, previous, pushRecent, visit } from "./history";

describe("visit", () => {
  it("pushes the current symbol and clears forward", () => {
    const h = visit({ back: ["A"], forward: ["Z"] }, "B", "C");
    expect(h).toEqual({ back: ["A", "B"], forward: [] });
  });
  it("ignores a same-symbol visit", () => {
    const h = { back: ["A"], forward: ["Z"] };
    expect(visit(h, "B", "B")).toBe(h);
  });
  it("caps back at 50, dropping the oldest", () => {
    let h = emptyHistory();
    for (let i = 0; i < 60; i++) h = visit(h, `S${i}`, `S${i + 1}`);
    expect(h.back).toHaveLength(MAX_BACK);
    expect(h.back[0]).toBe("S10");
    expect(h.back.at(-1)).toBe("S59");
  });
});

describe("goBack and goForward", () => {
  it("move between stacks", () => {
    const back = goBack({ back: ["A", "B"], forward: [] }, "C")!;
    expect(back).toEqual({ to: "B", history: { back: ["A"], forward: ["C"] } });
    const fwd = goForward(back.history, "B")!;
    expect(fwd).toEqual({ to: "C", history: { back: ["A", "B"], forward: [] } });
  });
  it("return null when there is nowhere to go", () => {
    expect(goBack(emptyHistory(), "A")).toBeNull();
    expect(goForward(emptyHistory(), "A")).toBeNull();
  });
  it("cap back when going forward", () => {
    const back = Array.from({ length: MAX_BACK }, (_, i) => `S${i}`);
    expect(goForward({ back, forward: ["N"] }, "C")!.history.back).toHaveLength(MAX_BACK);
  });
});

describe("previous", () => {
  it("toggles between two symbols", () => {
    let h = { back: ["A"], forward: [] as string[] };
    let cur = "B";
    for (const want of ["A", "B", "A"]) {
      const m = previous(h, cur)!;
      expect(m.to).toBe(want);
      h = m.history;
      cur = m.to;
    }
  });
  it("keeps forward and returns null with no history", () => {
    expect(previous({ back: ["A"], forward: ["Z"] }, "B")!.history.forward).toEqual(["Z"]);
    expect(previous(emptyHistory(), "A")).toBeNull();
  });
});

describe("pushRecent", () => {
  it("moves to front, dedupes and caps", () => {
    expect(pushRecent(["A", "B", "C"], "B")).toEqual(["B", "A", "C"]);
    let r: string[] = [];
    for (let i = 0; i < 20; i++) r = pushRecent(r, `S${i}`);
    expect(r).toHaveLength(MAX_RECENT);
    expect(r[0]).toBe("S19");
  });
});
