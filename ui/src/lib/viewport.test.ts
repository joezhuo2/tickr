import { describe, expect, it } from "vitest";
import { clamp, follow, full, isFull, MIN_BARS, pan, reveal, visible, zoom } from "./viewport";

describe("clamp", () => {
  it("keeps the view inside the data", () => {
    expect(clamp({ start: -5, count: 20 }, 100)).toEqual({ start: 0, count: 20 });
    expect(clamp({ start: 95, count: 20 }, 100)).toEqual({ start: 80, count: 20 });
  });

  it("limits the bar count to MIN_BARS and n", () => {
    expect(clamp({ start: 0, count: 2 }, 100).count).toBe(MIN_BARS);
    expect(clamp({ start: 0, count: 500 }, 100)).toEqual({ start: 0, count: 100 });
  });

  it("shows everything when there are fewer bars than MIN_BARS", () => {
    expect(clamp({ start: 3, count: 1 }, 4)).toEqual({ start: 0, count: 4 });
    expect(clamp({ start: 0, count: 0 }, 0)).toEqual({ start: 0, count: 0 });
  });
});

describe("zoom", () => {
  it("keeps the bar under the anchor in place", () => {
    const v = zoom({ start: 0, count: 100 }, 100, 0.5, 0.25);
    expect(v).toEqual({ start: 12.5, count: 50 });
    expect(v.start + 0.25 * v.count).toBe(25);
  });

  it("zooms toward the right edge", () => {
    expect(zoom({ start: 0, count: 100 }, 100, 0.2, 1)).toEqual({ start: 80, count: 20 });
  });

  it("stops at MIN_BARS and the full view", () => {
    expect(zoom({ start: 40, count: 20 }, 100, 0.01, 0.5)).toEqual({ start: 45, count: MIN_BARS });
    expect(zoom({ start: 40, count: 20 }, 100, 100, 0.5)).toEqual({ start: 0, count: 100 });
  });

  it("clamps when zooming out near an edge", () => {
    expect(zoom({ start: 90, count: 10 }, 100, 2, 0)).toEqual({ start: 80, count: 20 });
  });

  it("clamps the anchor", () => {
    expect(zoom({ start: 0, count: 100 }, 100, 0.5, 3)).toEqual(zoom({ start: 0, count: 100 }, 100, 0.5, 1));
  });
});

describe("pan", () => {
  it("moves by fractional bars", () => {
    expect(pan({ start: 10, count: 20 }, 100, 2.5)).toEqual({ start: 12.5, count: 20 });
  });

  it("stops at both ends", () => {
    expect(pan({ start: 10, count: 20 }, 100, -50)).toEqual({ start: 0, count: 20 });
    expect(pan({ start: 10, count: 20 }, 100, 500)).toEqual({ start: 80, count: 20 });
  });

  it("does nothing on a full view", () => {
    expect(pan(full(50), 50, 10)).toEqual(full(50));
  });
});

describe("reveal", () => {
  const v = { start: 20, count: 10 };

  it("leaves a visible bar alone", () => {
    expect(reveal(v, 100, 25)).toBe(v);
  });

  it("pans just enough to show the bar", () => {
    expect(reveal(v, 100, 15)).toEqual({ start: 15, count: 10 });
    expect(reveal(v, 100, 34)).toEqual({ start: 25, count: 10 });
  });
});

describe("follow", () => {
  it("keeps a full view full", () => {
    expect(follow(full(100), 100, 101)).toEqual(full(101));
  });

  it("follows new bars at the right edge", () => {
    expect(follow({ start: 80, count: 20 }, 100, 102)).toEqual({ start: 82, count: 20 });
  });

  it("stays put when scrolled back", () => {
    expect(follow({ start: 30, count: 20 }, 100, 102)).toEqual({ start: 30, count: 20 });
  });

  it("clamps when the data shrinks", () => {
    expect(follow({ start: 30, count: 20 }, 100, 40)).toEqual({ start: 20, count: 20 });
  });
});

describe("visible", () => {
  it("includes partly shown bars", () => {
    expect(visible({ start: 12.5, count: 20 }, 100)).toEqual([12, 32]);
    expect(visible({ start: 12, count: 20 }, 100)).toEqual([12, 31]);
  });

  it("stays within the data", () => {
    expect(visible(full(5), 5)).toEqual([0, 4]);
  });
});

describe("isFull", () => {
  it("detects the full view", () => {
    expect(isFull(full(30), 30)).toBe(true);
    expect(isFull({ start: 0, count: 29 }, 30)).toBe(false);
  });
});
