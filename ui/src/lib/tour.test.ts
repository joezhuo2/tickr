import { describe, expect, it } from "vitest";
import { TOUR_STEPS, availableSteps, move } from "./tour";

describe("tour", () => {
  it("skips steps whose element is not on screen", () => {
    expect(availableSteps(TOUR_STEPS, () => true)).toHaveLength(TOUR_STEPS.length);
    expect(availableSteps(TOUR_STEPS, (s) => s === "button.gear").map((s) => s.id)).toEqual(["tray", "settings"]);
  });

  it("keeps the step index in range", () => {
    expect(move(0, -1, 4)).toBe(0);
    expect(move(2, 1, 4)).toBe(3);
    expect(move(3, 1, 4)).toBe(3);
  });
});
