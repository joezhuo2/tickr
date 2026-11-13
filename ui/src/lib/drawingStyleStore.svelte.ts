import { cleanDrawingStyles, type DrawingStyles } from "./drawing";

const KEY = "tickr.drawingStyles";

function load(): DrawingStyles {
  try { return cleanDrawingStyles(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch { return cleanDrawingStyles(null); }
}

export const drawingStyles = $state(load());

export function setDrawingStyles(next: DrawingStyles) {
  Object.assign(drawingStyles, next);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
}

addEventListener("storage", (e) => {
  if (e.key === KEY) Object.assign(drawingStyles, load());
});
