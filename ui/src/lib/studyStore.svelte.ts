import { STUDIES, type StudyId } from "./studies";

const KEY = "tickr.studies";

function load(): Record<StudyId, boolean> {
  let saved: Record<string, unknown> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { /* storage unavailable */ }
  return Object.fromEntries(STUDIES.map((s) => [s.id, saved[s.id] === true])) as Record<StudyId, boolean>;
}

export const studies = $state(load());

export function toggleStudy(id: StudyId, on: boolean) {
  studies[id] = on;
  try { localStorage.setItem(KEY, JSON.stringify(studies)); } catch { /* storage unavailable */ }
}
