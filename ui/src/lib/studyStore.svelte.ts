import { STUDIES, type StudyId } from "./studies";
import { cleanSettings, nextKey, type SettingGroup, type StudySettings } from "./studySettings";

const KEY = "tickr.studies";
const SETTINGS_KEY = "tickr.studySettings";

function load(): Record<StudyId, boolean> {
  let saved: Record<string, unknown> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { /* storage unavailable */ }
  return Object.fromEntries(STUDIES.map((s) => [s.id, saved[s.id] === true])) as Record<StudyId, boolean>;
}

function loadSettings(): StudySettings {
  try { return cleanSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null")); } catch { return cleanSettings(null); }
}

export const studies = $state(load());
export const studySettings = $state(loadSettings());

export function toggleStudy(id: StudyId, on: boolean) {
  studies[id] = on;
  try { localStorage.setItem(KEY, JSON.stringify(studies)); } catch { /* storage unavailable */ }
}

export function changeSettings(edit: (s: StudySettings) => void) {
  const next = cleanSettings($state.snapshot(studySettings));
  edit(next);
  Object.assign(studySettings, cleanSettings(next));
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(studySettings)); } catch { /* storage unavailable */ }
}

export function addInstance(study: SettingGroup) {
  if (!studies[study]) toggleStudy(study, true);
  else changeSettings((s) => s.extras.push({ key: nextKey(study, s), study, params: {}, tf: "chart" }));
}

export function removeInstance(key: string) {
  if (key in studies) toggleStudy(key as StudyId, false);
  else changeSettings((s) => (s.extras = s.extras.filter((x) => x.key !== key)));
}
