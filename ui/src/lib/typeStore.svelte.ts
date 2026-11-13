import { cleanTypeSettings, type TypeSettings } from "./charttypes";

const KEY = "tickr.chartTypeSettings";

function load(): TypeSettings {
  try { return cleanTypeSettings(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch { return cleanTypeSettings(null); }
}

export const typeSettings = $state(load());

export function changeTypeSettings(edit: (s: TypeSettings) => void) {
  const next = cleanTypeSettings($state.snapshot(typeSettings));
  edit(next);
  Object.assign(typeSettings, cleanTypeSettings(next));
  try { localStorage.setItem(KEY, JSON.stringify(typeSettings)); } catch { /* storage unavailable */ }
}
