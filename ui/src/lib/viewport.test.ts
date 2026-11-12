import { describe, expect, it } from "vitest";
import { center, firstAtOrAfter, clamp, follow, full, isFull, MAX_FUTURE, MIN_BARS, MIN_SHOWN, pan, reveal, RIGHT_MARGIN, visible, zoom } from "./viewport";

describe("clamp", () => {
  it("stops at the first bar", () => {
    expect(clamp({ start: -5, count: 20 }, 100)).toEqual({ start: 0, count: 20 });
  });

  it("scrolls into the future until only MIN_SHOWN bars remain", () => {
    expect(clamp({ start: 95, count: 20 }, 100)).toEqual({ start: 95, count: 20 });
    expect(clamp({ start: 150, count: 20 }, 100)).toEqual({ start: 100 - MIN_SHOWN, count: 20 });
    expect(clamp({ start: 150, count: MIN_BARS }, 100)).toEqual({ start: 100 - MIN_SHOWN, count: MIN_BARS });
  });

  it("caps the future space at MAX_FUTURE bars", () => {
    expect(clamp({ start: 5000, count: 1000 }, 2000)).toEqual({ start: 1000 + MAX_FUTURE, count: 1000 });
    expect(clamp({ start: 5000, count: 300 }, 2000)).toEqual({ start: 1900, count: 300 });
  });

  it("limits the bar count to MIN_BARS and n plus the right margin", () => {
    expect(clamp({ start: 0, count: 2 }, 100).count).toBe(MIN_BARS);
    expect(clamp({ start: 0, count: 500 }, 100)).toEqual({ start: 0, count: 100 + RIGHT_MARGIN });
  });

  it("shows everything when there are fewer bars than MIN_BARS", () => {
    expect(clamp({ start: 3, count: 1 }, 4)).toEqual({ start: 4 - MIN_SHOWN, count: 4 });
    expect(clamp({ start: 3, count: 1 }, 2)).toEqual({ start: 0, count: 2 });
    expect(clamp({ start: 0, count: 0 }, 0)).toEqual({ start: 0, count: 0 });
    expect(full(0)).toEqual({ start: 0, count: 0 });
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
    expect(zoom({ start: 40, count: 20 }, 100, 100, 0.5)).toEqual(full(100));
  });

  it("keeps the anchor in place over the future space", () => {
    expect(zoom({ start: 95, count: 10 }, 100, 2, 0)).toEqual({ start: 95, count: 20 });
    const v = zoom({ start: 80, count: 40 }, 100, 0.5, 0.75);
    expect(v).toEqual({ start: 95, count: 20 });
    expect(v.start + 0.75 * v.count).toBe(110);
  });

  it("clamps when zooming in would leave fewer than MIN_SHOWN bars", () => {
    expect(zoom({ start: 90, count: 40 }, 100, 0.25, 1)).toEqual({ start: 100 - MIN_SHOWN, count: MIN_BARS });
  });

  it("keeps the right margin when zooming in at the right edge of the full view", () => {
    const v = zoom(full(100), 100, 0.5, 1);
    expect(v.start + v.count).toBe(100 + RIGHT_MARGIN);
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
    expect(pan({ start: 10, count: 20 }, 100, 500)).toEqual({ start: 100 - MIN_SHOWN, count: 20 });
  });

  it("pans into the future and back", () => {
    const out = pan({ start: 80, count: 20 }, 100, 15);
    expect(out).toEqual({ start: 95, count: 20 });
    expect(visible(out, 100)).toEqual([95, 99]);
    expect(pan(out, 100, -15)).toEqual({ start: 80, count: 20 });
  });

  it("pans a full view only into the future", () => {
    expect(pan(full(50), 50, -10)).toEqual(full(50));
    expect(pan(full(50), 50, 10)).toEqual({ start: 10, count: 50 + RIGHT_MARGIN });
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

  it("follows new bars while scrolled into the future", () => {
    expect(follow({ start: 95, count: 20 }, 100, 101)).toEqual({ start: 96, count: 20 });
  });

  it("stays put when scrolled back", () => {
    expect(follow({ start: 30, count: 20 }, 100, 102)).toEqual({ start: 30, count: 20 });
  });

  it("clamps when the data shrinks", () => {
    expect(follow({ start: 30, count: 20 }, 100, 30)).toEqual({ start: 30 - MIN_SHOWN, count: 20 });
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

describe("go to date", () => {
  it("centers a bar, zooming in first when the whole range is shown", () => {
    expect(center(full(500), 500, 250)).toEqual({ start: 210.5, count: 80 });
    expect(center({ start: 0, count: 20 }, 500, 499)).toEqual({ start: 489.5, count: 20 });
    expect(center(full(30), 30, 3)).toEqual({ start: 0, count: 30 });  });

  it("finds the first bar at or after a time, or the last bar", () => {
    expect(firstAtOrAfter([10, 20, 30], 15)).toBe(1);
    expect(firstAtOrAfter([10, 20, 30], 20)).toBe(1);
    expect(firstAtOrAfter([10, 20, 30], 99)).toBe(2);
    expect(firstAtOrAfter([10, 20, 30], 1)).toBe(0);
  });
});
