// Converts a keydown into a global-shortcut accelerator such as "Ctrl+Alt+K".

export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const NAMED: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Minus: "Minus",
  Equal: "Equal",
  BracketLeft: "BracketLeft",
  BracketRight: "BracketRight",
  Semicolon: "Semicolon",
  Comma: "Comma",
  Period: "Period",
  Slash: "Slash",
  Backslash: "Backslash",
  Backquote: "Backquote",
};

function keyName(code: string): string | null {
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^(F\d{1,2})$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `Numpad${m[1]}`;
  return NAMED[code] ?? null;
}

/**
 * The accelerator for a keydown, or null while only modifiers are held or
 * the combination is too weak to register globally (needs Ctrl, Alt or
 * Super, except for function keys).
 */
export function accelerator(e: KeyLike): string | null {
  const key = keyName(e.code);
  if (!key) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  const strong = e.ctrlKey || e.altKey || e.metaKey;
  if (!strong && !/^F\d/.test(key)) return null;
  return [...mods, key].join("+");
}

const MAC_MODS: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Super: "⌘" };

/** How to show an accelerator: Mac symbols ("⌘⇧K") on macOS, as stored elsewhere. */
export function display(accel: string, mac = /Mac/.test(navigator.platform || navigator.userAgent)): string {
  if (!mac) return accel;
  return accel
    .split("+")
    .map((p) => MAC_MODS[p] ?? p)
    .join("");
}
