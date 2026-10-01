import { describe, expect, it } from "vitest";
import { axisTime, change, direction, fullTime, niceTicks, price, signed, span, volume } from "./format";
import { accelerator } from "./hotkey";

const key = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("format", () => {
  it("prices", () => {
    expect(price(333.024)).toBe("$333.02");
    expect(price(1234.5)).toBe("$1,234.50");
    expect(price(0.12345)).toBe("$0.1235");
    expect(price(12.5, "CAD")).toBe("12.50 CAD");
    expect(price(null)).toBe("—");
  });

  it("signed and change", () => {
    expect(signed(1.234)).toBe("+1.23");
    expect(signed(-1.5)).toBe("−1.50");
    expect(signed(-0.001)).toBe("+0.00");
    expect(change(3.62, 1.099)).toBe("+3.62 (+1.10%)");
    expect(change(null, 1)).toBe("—");
    expect(direction(-2)).toBe("down");
    expect(direction(0)).toBe("flat");
  });

  it("volume and span", () => {
    expect(volume(49875295)).toBe("49.9M");
    expect(volume(1.2e9)).toBe("1.2B");
    expect(volume(250_000_000)).toBe("250M");
    expect(volume(999)).toBe("999");
    expect(span(1, 2)).toBe("1.00 – 2.00");
  });

  it("times use the exchange offset", () => {
    // 2026-09-30 13:30:00 UTC = 09:30 EDT (-14400).
    const t = Date.UTC(2026, 8, 30, 13, 30) / 1000;
    expect(axisTime(t, -14400, "1d")).toBe("09:30");
    expect(axisTime(t, -14400, "5d")).toBe("Wed 09:30");
    expect(axisTime(t, -14400, "6mo")).toBe("Sep 30");
    expect(axisTime(t, -14400, "5y")).toBe("Sep 2026");
    expect(fullTime(t, -14400, "5m")).toBe("Wed Sep 30, 2026 09:30");
    expect(fullTime(t, -14400, "1d")).toBe("Wed Sep 30, 2026");
    expect(fullTime(t, -14400, "1mo")).toBe("Wed Sep 30, 2026");
  });

  it("nice ticks", () => {
    expect(niceTicks(0, 100)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(329.4, 339.5)).toEqual([330, 335]);
    expect(niceTicks(5, 5)).toEqual([5]);
  });
});

describe("hotkey", () => {
  it("builds accelerators", () => {
    expect(accelerator(key("KeyK", { ctrlKey: true, altKey: true }))).toBe("Ctrl+Alt+K");
    expect(accelerator(key("Digit1", { metaKey: true, shiftKey: true }))).toBe("Shift+Super+1");
    expect(accelerator(key("F9"))).toBe("F9");
    expect(accelerator(key("ArrowUp", { altKey: true }))).toBe("Alt+Up");
  });

  it("rejects weak or modifier-only combos", () => {
    expect(accelerator(key("KeyK"))).toBeNull();
    expect(accelerator(key("KeyK", { shiftKey: true }))).toBeNull();
    expect(accelerator(key("ControlLeft", { ctrlKey: true }))).toBeNull();
  });
});
