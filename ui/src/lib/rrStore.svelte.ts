import { clampReward } from "./drawing";

const KEY = "tickr.rr";

function load(): number {
  try { return clampReward(Number(localStorage.getItem(KEY) ?? 2)); } catch { return 2; }
}

export const rr = $state({ reward: load() });

export function setReward(v: number) {
  rr.reward = clampReward(v);
  try { localStorage.setItem(KEY, String(rr.reward)); } catch { /* storage unavailable */ }
}

addEventListener("storage", (e) => {
  if (e.key === KEY) rr.reward = load();
});
