import { describe, expect, it } from "vitest";
import { lightFuse, pauseFuse, remaining, resumeFuse } from "./fuse";

describe("fuse", () => {
  it("burns down from the start time", () => {
    const f = lightFuse(4000, 1000);
    expect(remaining(f, 1000)).toBe(4000);
    expect(remaining(f, 2500)).toBe(2500);
    expect(remaining(f, 9000)).toBe(0);
  });

  it("holds while paused and resumes from where it stopped", () => {
    const paused = pauseFuse(lightFuse(4000, 0), 1000);
    expect(paused.since).toBeNull();
    expect(remaining(paused, 50_000)).toBe(3000);
    const resumed = resumeFuse(paused, 60_000);
    expect(remaining(resumed, 61_000)).toBe(2000);
  });

  it("ignores repeated pauses and resumes", () => {
    const f = lightFuse(4000, 0);
    expect(resumeFuse(f, 500)).toBe(f);
    const p = pauseFuse(f, 1000);
    expect(pauseFuse(p, 3000)).toBe(p);
  });

  it("never goes negative or backwards in time", () => {
    expect(lightFuse(-5, 0).left).toBe(0);
    expect(remaining(lightFuse(4000, 1000), 500)).toBe(4000);
  });
});
