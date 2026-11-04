import { describe, expect, it } from "vitest";
import { applyDisplay } from "./display";
import type { Palette, Theme } from "./types";

describe("display attributes", () => {
  it("applies every theme and palette combination and clears overrides", () => {
    const root = { dataset: { theme: "dark", palette: "accessible", other: "kept" } as Record<string, string> };
    for (const theme of ["system", "light", "dark", "system"] as Theme[]) {
      for (const palette of ["standard", "accessible", "standard"] as Palette[]) {
        applyDisplay(root, theme, palette);
        expect(root.dataset).toEqual({
          other: "kept",
          ...(theme === "system" ? {} : { theme }),
          ...(palette === "standard" ? {} : { palette }),
        });
      }
    }
  });
});
