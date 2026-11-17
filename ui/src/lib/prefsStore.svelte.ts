import { cleanPrefs, type Prefs } from "./prefs";

const KEY = "tickr.prefs";

function load(): Prefs {
  try { return cleanPrefs(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch { return cleanPrefs(null); }
}

export const prefs = $state(load());
export const stream = $state({ ms: 250 });

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  Object.assign(prefs, cleanPrefs({ ...prefs, [key]: value }));
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
}

addEventListener("storage", (e) => {
  if (e.key === KEY) Object.assign(prefs, load());
});
