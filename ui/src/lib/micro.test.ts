import { describe, expect, it } from "vitest";
import { place } from "./micro";

const anchor = { left: 100, top: 100, width: 40, height: 20 };

describe("place", () => {
  it("centres a tooltip above its anchor", () => {
    expect(place(anchor, 60, 20, 800, 600, "above", "center")).toEqual({ left: 90, top: 74, above: true });
  });
  it("drops a tooltip below when there is no room above", () => {
    expect(place({ ...anchor, top: 10 }, 60, 20, 800, 600, "above", "center")).toMatchObject({ top: 36, above: false });
  });
  it("opens a menu below, aligned to the anchor's left edge", () => {
    expect(place(anchor, 120, 200, 800, 600, "below", "start", 4)).toEqual({ left: 100, top: 124, above: false });
  });
  it("flips a menu above when only that side fits", () => {
    expect(place({ ...anchor, top: 500 }, 120, 200, 800, 600, "below", "start", 4)).toMatchObject({ top: 296, above: true });
  });
  it("keeps a popup inside the window", () => {
    expect(place({ ...anchor, left: 790 }, 120, 20, 800, 600, "above", "center").left).toBe(676);
    expect(place({ ...anchor, left: 0 }, 120, 20, 800, 600, "above", "center").left).toBe(4);
    expect(place(anchor, 120, 590, 800, 600, "below", "start").top).toBe(6);
  });
});
