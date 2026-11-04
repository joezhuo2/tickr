import type { Palette, Theme } from "./types";

export function applyDisplay(root: { dataset: { theme?: string; palette?: string } }, theme: Theme, palette: Palette) {
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  if (palette === "standard") delete root.dataset.palette;
  else root.dataset.palette = palette;
}
