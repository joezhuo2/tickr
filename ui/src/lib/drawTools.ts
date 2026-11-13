import type { Drawing } from "./types";

export type Tool = "cursor" | "ruler" | Drawing["kind"];
export const TOOLS: { tool: Tool; label: string; icon: string }[] = [
  { tool: "cursor", label: "Cursor", icon: "M5 3l14 8-6 2-2 6z" },
  { tool: "hline", label: "Level", icon: "M3 12h18" },
  { tool: "trend", label: "Trend", icon: "M4 19L20 5M4 19h.01M20 5h.01" },
  { tool: "text", label: "Text", icon: "M6 6V4h12v2M12 4v16M9 20h6" },
  { tool: "note", label: "Note", icon: "M5 4h14v12h-7l-4 4v-4H5z" },
  { tool: "ruler", label: "Ruler", icon: "M3.5 15.5l12-12 5 5-12 12zM7 12l2 2M10 9l2 2M13 6l2 2" },
  { tool: "pen", label: "Pen", icon: "M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" },
  { tool: "rect", label: "Box", icon: "M4 6h16v12H4z" },
  { tool: "ray", label: "Ray", icon: "M5 18L20 7M15 6.5l5 .5-1 5M5 18h.01" },
  { tool: "fib", label: "Fib", icon: "M3 4h18M3 9h18M3 15h18M3 20h18" },
  { tool: "position", label: "R:R", icon: "M4 4h16v7H4zM4 11h16v9H4z" },
  { tool: "avwap", label: "AVWAP", icon: "M4 6v14M4 18c5 0 6-8 11-8 2 0 3 1 5 1" },
];
export const MORE_TOOLS: { tool: Drawing["kind"]; label: string }[] = [
  { tool: "channel", label: "Channel" },
  { tool: "vline", label: "Vertical line" },
  { tool: "hray", label: "Horizontal ray" },
  { tool: "arrow", label: "Arrow" },
  { tool: "prange", label: "Price range" },
  { tool: "drange", label: "Date range" },
  { tool: "fibext", label: "Fib extension" },
  { tool: "pitchfork", label: "Pitchfork" },
  { tool: "vprofile", label: "Volume profile (range)" },
  { tool: "arrowup", label: "Arrow up marker" },
  { tool: "arrowdown", label: "Arrow down marker" },
  { tool: "callout", label: "Callout" },
  { tool: "impulse", label: "Elliott impulse (1-5)" },
  { tool: "corrective", label: "Elliott correction (A-B-C)" },
  { tool: "xabcd", label: "XABCD harmonic" },
  { tool: "headshoulders", label: "Head and shoulders" },
];
