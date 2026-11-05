import { describe, expect, it } from "vitest";
import { addedAlert, alertCounts, alertStatus, emptyMessage, filterAlerts, fireTime, levelError, sortAlerts, toggleLabel, triggerInfo, visibleAlerts } from "./alerts";
import type { PriceAlert } from "./types";

function make(over: Partial<PriceAlert> & { id: number }): PriceAlert {
  return {
    symbol: "AAPL",
    direction: "above",
    level: 100,
    enabled: true,
    triggered_at: null,
    triggered_price: null,
    kind: "price",
    reference: null,
    recurring: false,
    cooldown_mins: 15,
    regular_only: false,
    ...over,
  };
}

const armed = make({ id: 1 });
const armedRecurring = make({ id: 2, recurring: true, triggered_at: 500, triggered_price: 101 });
const triggeredOld = make({ id: 3, enabled: false, triggered_at: 1000, triggered_price: 99.5 });
const triggeredNew = make({ id: 4, enabled: false, triggered_at: 2000, triggered_price: 98 });
const paused = make({ id: 5, enabled: false });
const pausedRecurring = make({ id: 6, enabled: false, recurring: true, triggered_at: 700, triggered_price: 102 });
const all = [armed, armedRecurring, triggeredOld, triggeredNew, paused, pausedRecurring];

describe("alertStatus", () => {
  it("separates armed, triggered and paused", () => {
    expect(alertStatus(armed)).toBe("armed");
    expect(alertStatus(armedRecurring)).toBe("armed");
    expect(alertStatus(triggeredOld)).toBe("triggered");
    expect(alertStatus(paused)).toBe("paused");
  });
  it("treats a paused recurring alert that already fired as paused", () => {
    expect(alertStatus(pausedRecurring)).toBe("paused");
  });
});

describe("filterAlerts", () => {
  it("returns everything for all", () => {
    expect(filterAlerts(all, "all")).toEqual(all);
  });
  it("filters by status", () => {
    expect(filterAlerts(all, "armed").map((a) => a.id)).toEqual([1, 2]);
    expect(filterAlerts(all, "triggered").map((a) => a.id)).toEqual([3, 4]);
    expect(filterAlerts(all, "paused").map((a) => a.id)).toEqual([5, 6]);
  });
  it("handles an empty list", () => {
    expect(filterAlerts([], "paused")).toEqual([]);
  });
});

describe("sortAlerts", () => {
  it("lists triggered alerts newest first", () => {
    expect(sortAlerts([triggeredOld, triggeredNew], "triggered").map((a) => a.id)).toEqual([4, 3]);
  });
  it("breaks ties by id", () => {
    const a = make({ id: 9, enabled: false, triggered_at: 5 });
    const b = make({ id: 8, enabled: false, triggered_at: 5 });
    expect(sortAlerts([a, b], "triggered").map((x) => x.id)).toEqual([8, 9]);
  });
  it("keeps saved order for the other filters and does not mutate", () => {
    const input = [triggeredOld, triggeredNew];
    expect(sortAlerts(input, "all").map((a) => a.id)).toEqual([3, 4]);
    expect(sortAlerts(input, "triggered")).not.toBe(input);
    expect(input.map((a) => a.id)).toEqual([3, 4]);
  });
  it("filters then sorts", () => {
    expect(visibleAlerts(all, "triggered").map((a) => a.id)).toEqual([4, 3]);
    expect(visibleAlerts(all, "all").map((a) => a.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("alertCounts", () => {
  it("counts each status", () => {
    expect(alertCounts(all)).toEqual({ all: 6, armed: 2, triggered: 2, paused: 2 });
    expect(alertCounts([])).toEqual({ all: 0, armed: 0, triggered: 0, paused: 0 });
  });
});

describe("emptyMessage", () => {
  it("names the filter", () => {
    expect(emptyMessage("all")).toBe("No price alerts yet.");
    expect(emptyMessage("paused")).toBe("No paused alerts.");
    expect(emptyMessage("triggered")).toBe("No triggered alerts.");
  });
});

describe("fireTime", () => {
  it("formats a unix time in the given zone with a plain space", () => {
    expect(fireTime(1_699_999_980, "en-US", "UTC")).toBe("Nov 14, 2023, 10:13 PM");
    expect(fireTime(1_699_999_980, "en-US", "America/New_York")).toBe("Nov 14, 2023, 5:13 PM");
  });
});

describe("triggerInfo", () => {
  it("is null before an alert fires", () => {
    expect(triggerInfo(armed, "en-US", "UTC")).toBeNull();
    expect(triggerInfo(paused, "en-US", "UTC")).toBeNull();
  });
  it("shows price and time for a triggered alert", () => {
    expect(triggerInfo({ ...triggeredOld, triggered_at: 1_699_999_980, triggered_price: 251.337 }, "en-US", "UTC")).toEqual({
      label: "Triggered",
      price: "251.34",
      time: "Nov 14, 2023, 10:13 PM",
    });
  });
  it("labels recurring alerts as last fired, armed or paused", () => {
    expect(triggerInfo(armedRecurring, "en-US", "UTC")?.label).toBe("Last fired");
    expect(triggerInfo(pausedRecurring, "en-US", "UTC")?.label).toBe("Last fired");
  });
  it("keeps the time when an older alert has no stored price", () => {
    const old = make({ id: 7, enabled: false, triggered_at: 1_699_999_980 });
    expect(triggerInfo(old, "en-US", "UTC")).toEqual({ label: "Triggered", price: null, time: "Nov 14, 2023, 10:13 PM" });
  });
  it("uses more digits for sub-dollar prices and ignores invalid ones", () => {
    expect(triggerInfo(make({ id: 8, enabled: false, triggered_at: 1, triggered_price: 0.12345 }), "en-US", "UTC")?.price).toBe("0.1235");
    expect(triggerInfo(make({ id: 8, enabled: false, triggered_at: 1, triggered_price: Number.NaN }), "en-US", "UTC")?.price).toBeNull();
    expect(triggerInfo(make({ id: 8, enabled: false, triggered_at: 1, triggered_price: 0 }), "en-US", "UTC")?.price).toBeNull();
  });
});

describe("toggleLabel", () => {
  it("offers the next action for each status", () => {
    expect(toggleLabel("armed")).toBe("Pause");
    expect(toggleLabel("paused")).toBe("Resume");
    expect(toggleLabel("triggered")).toBe("Rearm");
  });
});

describe("levelError", () => {
  it("accepts positive finite numbers only", () => {
    expect(levelError(1.5, "Price")).toBeNull();
    for (const bad of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(levelError(bad, "Percent")).toBe("Enter a percent greater than zero.");
    }
  });
});

describe("addedAlert", () => {
  it("finds the alert that was not in the previous list", () => {
    expect(addedAlert([{ id: 1 }, { id: 3 }], [{ id: 1 }, { id: 4 }, { id: 3 }])).toEqual({ id: 4 });
    expect(addedAlert([{ id: 1 }], [{ id: 1 }])).toBeUndefined();
  });
});
