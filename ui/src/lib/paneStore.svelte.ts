import { cleanPanes, type PaneState } from "./panes";

const KEY = "tickr.panes";

function load(): PaneState {
  try { return cleanPanes(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch { return cleanPanes(null); }
}

export const panes = $state(load());

export function setPanes(next: PaneState) {
  panes.groups = next.groups;
  panes.left = next.left;
  try { localStorage.setItem(KEY, JSON.stringify(panes)); } catch { /* storage unavailable */ }
}
