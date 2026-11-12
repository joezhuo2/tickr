import { describe, expect, it } from "vitest";
import { cssToHex, hexToHsv, hsvToHex, isHex, luminance, mix } from "./color";
import { FONTS, customVars, sanitizeCustom } from "./display";

describe("color math", () => {
  it("validates six-digit hex colors only", () => {
    expect(isHex("#4c8dff")).toBe(true);
    expect(isHex("#4C8DFF")).toBe(true);
    for (const bad of ["4c8dff", "#fff", "#4c8dfg", "red", ""]) expect(isHex(bad)).toBe(false);
  });

  it("round-trips hex through HSV", () => {
    for (const hex of ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#4c8dff", "#7c4dff", "#123456"]) expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv("#808080").s).toBe(0);
  });

  it("measures luminance and mixes colors", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1);
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#102030", "#ffffff", 0)).toBe("#102030");
  });
});

describe("custom theme", () => {
  it("sets nothing for an empty customization", () => {
    expect(customVars({ main: "", sub: "", font: "", mono: "", colors: {} })).toEqual({ vars: {}, scheme: null });
  });

  it("derives a readable palette from the sub color", () => {
    const dark = customVars({ main: "#ff9f0a", sub: "#0b1220", font: "", mono: "", colors: {} });
    expect(dark.scheme).toBe("dark");
    expect(dark.vars["--accent"]).toBe("#ff9f0a");
    expect(dark.vars["--bg"]).toBe("#0b1220");
    expect(luminance(dark.vars["--text"])).toBeGreaterThan(0.8);
    expect(luminance(dark.vars["--surface"])).toBeGreaterThan(luminance("#0b1220"));
    const light = customVars({ main: "", sub: "#f5f1e8", font: "", mono: "", colors: {} });
    expect(light.scheme).toBe("light");
    expect(light.vars["--accent"]).toBeUndefined();
    expect(luminance(light.vars["--text"])).toBeLessThan(0.05);
  });

  it("maps font choices to stacks and drops anything unknown", () => {
    const serif = FONTS.find((f) => f.id === "serif")!;
    expect(customVars({ main: "", sub: "", font: "serif", mono: "", colors: {} }).vars).toEqual({ "--font": serif.stack });
    expect(sanitizeCustom({ main: "red", sub: "#ABCDEF", font: "comic", mono: 4 })).toEqual({ main: "", sub: "#abcdef", font: "", mono: "", colors: {} });
    expect(sanitizeCustom(null)).toEqual({ main: "", sub: "", font: "", mono: "", colors: {} });
  });
});

describe("color overrides", () => {
  it("converts computed CSS colors to hex", () => {
    expect(cssToHex(" #4C8DFF ")).toBe("#4c8dff");
    expect(cssToHex("#fa0")).toBe("#ffaa00");
    expect(cssToHex("rgba(0, 122, 204, 0.8)")).toBe("#007acc");
    expect(cssToHex("rgb(255 0 0)")).toBe("#ff0000");
    expect(cssToHex("var(--x)")).toBe("");
  });

  it("applies token overrides over the derived palette and keeps only known tokens", () => {
    const c = sanitizeCustom({ sub: "#0b1220", colors: { up: "#00FF00", text: "#ffffff", bogus: "#123456", down: "red" } });
    expect(c.colors).toEqual({ up: "#00ff00", text: "#ffffff" });
    const { vars } = customVars(c);
    expect(vars["--up"]).toBe("#00ff00");
    expect(vars["--text"]).toBe("#ffffff");
    expect(vars["--down"]).toBeUndefined();
  });
});
