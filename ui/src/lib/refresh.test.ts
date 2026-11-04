import { describe, expect, it } from "vitest";
import { REFRESH_LABELS, refreshOutcome, type RefreshView } from "./refresh";

describe("refresh outcome", () => {
  it("names the panel on success", () => {
    expect(refreshOutcome("news")).toEqual({ text: "News refreshed", error: false });
    expect(refreshOutcome("technicals", null)).toEqual({ text: "Technicals refreshed", error: false });
  });

  it("names the panel and error on failure", () => {
    expect(refreshOutcome("analysts", "offline")).toEqual({ text: "Could not refresh Analysts: offline", error: true });
  });

  it("labels every view", () => {
    for (const view of Object.keys(REFRESH_LABELS) as RefreshView[]) {
      expect(refreshOutcome(view).text).toBe(`${REFRESH_LABELS[view]} refreshed`);
    }
  });
});
