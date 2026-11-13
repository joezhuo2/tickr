import { CHART_MODES } from "./charttypes";
import { MORE_TOOLS, TOOLS, type Tool } from "./drawTools";
import { OVERLAY_TOGGLES } from "./indicators";
import { matchSettings, type SettingEntry } from "./settingsSearch";
import { STUDIES, type StudyId } from "./studies";
import { check } from "./strategy";
import { RANGES, intervalLabel, parseInterval, type AlertKind, type ChartMode, type ChartScale, type Overlays } from "./types";

export type Panel = "news" | "options" | "earnings" | "analysts" | "stats" | "market" | "events" | "watchlist" | "technicals" | "paper" | "backtest" | "screener" | "alerts";
export type AppAction = "second_chart" | "new_window" | "refresh" | "toggle_overview" | "analyze" | "practice";
export type Toggle = { type: "overlay"; key: keyof Overlays } | { type: "study"; id: StudyId };

export type Command =
  | { kind: "open"; symbol: string; range?: string; interval?: string }
  | { kind: "chart"; range?: string; interval?: string }
  | { kind: "alert"; symbol: string; alert: AlertKind; direction: "above" | "below"; level: number }
  | { kind: "chart_alert"; symbol: string; expr: string }
  | { kind: "panel"; panel: Panel }
  | { kind: "settings"; entry: SettingEntry | null }
  | { kind: "action"; action: AppAction }
  | { kind: "replay"; date: string | null }
  | { kind: "mode"; mode: ChartMode }
  | { kind: "scale"; scale: ChartScale }
  | { kind: "goto"; date: string }
  | { kind: "extended"; on: boolean }
  | { kind: "watch"; symbol: string; on: boolean }
  | { kind: "member"; symbol: string; group: string; on: boolean }
  | { kind: "group"; group: string }
  | { kind: "toggle"; toggle: Toggle; label: string; on: boolean | null }
  | { kind: "draw"; tool: Tool; label: string }
  | { kind: "drawings"; op: "hide" | "show" | "delete" }
  | { kind: "order"; verb: "buy" | "sell" | "short" | "cover"; symbol: string; qty: number; order: "market" | "limit" | "stop"; price: number | null };

export interface CommandRow {
  command: Command | null;
  tag: string;
  title: string;
  detail: string;
  fill?: string;
}

export interface CommandContext {
  symbol: string;
  groups: readonly string[];
}

export const EXAMPLES: string[] = ["nvda 1y 1d", "alert nvda >= 170", "buy 10 limit 180", "type candles", "rsi", "settings theme"];

const PANELS: Record<string, { panel: Panel; label: string }> = {
  news: { panel: "news", label: "News" },
  options: { panel: "options", label: "Options" },
  earnings: { panel: "earnings", label: "Earnings" },
  analysts: { panel: "analysts", label: "Analysts" },
  stats: { panel: "stats", label: "Stats" },
  financials: { panel: "stats", label: "Stats and financials" },
  market: { panel: "market", label: "Market" },
  events: { panel: "events", label: "Events" },
  watchlist: { panel: "watchlist", label: "Watchlist" },
  technicals: { panel: "technicals", label: "Technicals" },
  paper: { panel: "paper", label: "Paper trading" },
  strategy: { panel: "backtest", label: "Strategy" },
  backtest: { panel: "backtest", label: "Strategy backtest" },
  screener: { panel: "screener", label: "Screener" },
  alerts: { panel: "alerts", label: "Alerts" },
};

const ACTIONS: Record<string, { action: AppAction; title: string; detail: string }> = {
  "second chart": { action: "second_chart", title: "Second chart", detail: "Shows or hides the second chart" },
  "new window": { action: "new_window", title: "New window", detail: "Opens the current symbol in a new window" },
  refresh: { action: "refresh", title: "Refresh", detail: "Reloads the quote, chart and open panel" },
  "toggle overview": { action: "toggle_overview", title: "Toggle overview", detail: "Shows or hides the stock overview" },
  overview: { action: "toggle_overview", title: "Toggle overview", detail: "Shows or hides the stock overview" },
  analyze: { action: "analyze", title: "Analyze", detail: "Runs technical analysis on the current chart" },
  practice: { action: "practice", title: "Practice", detail: "Opens practice on a random historical setup" },
};

const SCALES: Record<string, ChartScale> = { log: "log", linear: "linear", lin: "linear", percent: "percent", "%": "percent" };
const SCALE_LABELS: Record<ChartScale, string> = { linear: "linear", log: "log", percent: "percent" };
const RANGE_IDS = new Set(RANGES.map((r) => r.id));
const DRAW_ALIASES: Record<string, Tool> = { trendline: "trend", line: "trend", hline: "hline", rr: "position", fibonacci: "fib", freehand: "pen" };
const TICKER = /^\^?[a-z0-9][a-z0-9.\-=^]{0,19}$/;
const NUMBER = /^\$?(\d+(?:\.\d+)?|\.\d+)$/;

const row = (command: Command | null, tag: string, title: string, detail: string): CommandRow => ({ command, tag, title, detail });
const bad = (tag: string, title: string, detail: string) => row(null, tag, title, detail);
const upper = (s: string) => s.toUpperCase();
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const fmt = (n: number) => String(n);

function number(token: string | undefined): number | null {
  const m = token ? NUMBER.exec(token) : null;
  return m ? Number(m[1]) : null;
}

function isTicker(token: string | undefined): token is string {
  return !!token && TICKER.test(token) && !/^[+-]?\d+(\.\d+)?%?$/.test(token);
}

function rangeLabel(id: string): string {
  return RANGES.find((r) => r.id === id)?.label ?? id;
}

function interval(token: string): string | null {
  const r = parseInterval(token);
  return "interval" in r ? r.interval : null;
}

export function rangeInterval(tokens: string[]): { range?: string; interval?: string } | null {
  if (tokens.length === 1) {
    const t = tokens[0];
    if (RANGE_IDS.has(t)) return { range: t };
    const i = interval(t);
    return i ? { interval: i } : null;
  }
  if (tokens.length === 2) {
    const [a, b] = tokens;
    if (RANGE_IDS.has(a) && interval(b)) return { range: a, interval: interval(b)! };
    if (RANGE_IDS.has(b) && interval(a)) return { range: b, interval: interval(a)! };
  }
  return null;
}

function chartWords(r: { range?: string; interval?: string }): string {
  return [r.range && `${rangeLabel(r.range)} range`, r.interval && `${intervalLabel(r.interval)} candles`].filter(Boolean).join(", ");
}

function openRow(symbol: string, r: { range?: string; interval?: string } = {}): CommandRow {
  const extra = chartWords(r);
  const title = [upper(symbol), r.range && rangeLabel(r.range), r.interval && intervalLabel(r.interval)].filter(Boolean).join(" ");
  return row({ kind: "open", symbol: upper(symbol), ...r }, "Symbol", title, extra ? `Opens ${upper(symbol)} with ${extra}` : `Opens ${upper(symbol)}`);
}

function toggles(): { toggle: Toggle; label: string; names: string[] }[] {
  return [
    ...OVERLAY_TOGGLES.map((o) => ({ toggle: { type: "overlay", key: o.key } as Toggle, label: o.label, names: [o.label, o.key.replace(/_/g, " "), o.label.replace(/ pane$/i, "")] })),
    ...STUDIES.map((s) => ({ toggle: { type: "study", id: s.id } as Toggle, label: s.label, names: [s.label, s.id] })),
  ];
}

function findToggle(name: string) {
  const all = toggles();
  const key = compact(name);
  if (!key) return null;
  return all.find((t) => t.names.some((n) => compact(n) === key)) ?? all.find((t) => t.names.some((n) => n.toLowerCase().startsWith(`${name} `))) ?? null;
}

function findMode(name: string): (typeof CHART_MODES)[number] | null {
  const key = compact(name);
  if (!key) return null;
  return CHART_MODES.find((m) => m.id === key || compact(m.label) === key) ?? CHART_MODES.find((m) => compact(m.label).startsWith(key)) ?? null;
}

function findTool(name: string): { tool: Tool; label: string } | null {
  const all = [...TOOLS.filter((t) => t.tool !== "cursor"), ...MORE_TOOLS];
  const alias = DRAW_ALIASES[name];
  const key = compact(name);
  return (
    all.find((t) => t.tool === alias || t.tool === name || compact(t.label) === key) ??
    all.find((t) => t.label.toLowerCase().startsWith(`${name} `) || compact(t.label).startsWith(key)) ??
    null
  );
}

function findGroup(name: string, groups: readonly string[]): string | null {
  const n = name.trim().toLowerCase();
  return groups.find((g) => g.toLowerCase() === n) ?? null;
}

function validDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00Z`));
}

function current(ctx: CommandContext): string | null {
  return ctx.symbol ? upper(ctx.symbol) : null;
}

const OPS: Record<string, { direction: "above" | "below"; sign: string; words: string }> = {
  ">=": { direction: "above", sign: "≥", words: "at or above" },
  ">": { direction: "above", sign: ">", words: "above" },
  above: { direction: "above", sign: "≥", words: "at or above" },
  "<=": { direction: "below", sign: "≤", words: "at or below" },
  "<": { direction: "below", sign: "<", words: "below" },
  below: { direction: "below", sign: "≤", words: "at or below" },
};

const ALERT_HELP = "Try alert nvda >= 170, alert nvda +5%, alert nvda trail 3% or alert nvda crosses_above(rsi(14), 70)";

function parseAlert(input: string, ctx: CommandContext): CommandRow {
  const tag = "Alert";
  const rest = input.includes("(") ? input : input.replace(/(>=|<=|>|<)/g, " $1 ").trim().replace(/\s+/g, " ");
  const first = rest.split(" ")[0];
  const named = isTicker(first) && !(first in OPS) && first !== "trail" && !first.includes("(");
  const symbol = named ? upper(first) : current(ctx);
  const cond = (named ? rest.slice(first.length) : rest).trim();
  if (!symbol) return bad(tag, "Alert", "Open a symbol first or name one, e.g. alert nvda >= 170");
  if (!cond) return bad(tag, `Alert ${symbol} …`, `Needs a condition. ${ALERT_HELP}`);
  if (cond.includes("(")) {
    const error = check(cond);
    if (error) return bad(tag, `Alert ${symbol} ${cond}`, `Not a valid Strategy condition: ${error}`);
    return row({ kind: "chart_alert", symbol, expr: cond }, tag, `Alert ${symbol} ${cond}`, `Adds an indicator alert for ${symbol} on the current candle interval, fires once`);
  }
  const tokens = cond.replace(/(>=|<=|>|<)/g, " $1 ").trim().split(/\s+/);
  const op = OPS[tokens[0]];
  if (op) {
    const level = number(tokens[1]);
    if (tokens.length > 2 || (tokens[1] && level == null)) return bad(tag, `Alert ${symbol} ${cond}`, `Can't read the price. ${ALERT_HELP}`);
    if (level == null || level <= 0) return bad(tag, `Alert ${symbol} ${op.sign} …`, `alert ${symbol.toLowerCase()} ${tokens[0]} … needs a price`);
    return row({ kind: "alert", symbol, alert: "price", direction: op.direction, level }, tag, `Alert ${symbol} ${op.sign} ${fmt(level)}`, `Adds a one-shot price alert when ${symbol} trades ${op.words} ${fmt(level)}`);
  }
  const pct = /^([+-])\s*(\d+(?:\.\d+)?)\s*%$/.exec(cond);
  if (pct) {
    const level = Number(pct[2]);
    const direction = pct[1] === "+" ? "above" : "below";
    if (level <= 0) return bad(tag, `Alert ${symbol} ${cond}`, "The percent must be greater than zero");
    return row({ kind: "alert", symbol, alert: "day_percent", direction, level }, tag, `Alert ${symbol} ${pct[1]}${fmt(level)}%`, `Adds an alert when ${symbol} is ${direction === "above" ? "up" : "down"} ${fmt(level)}% on the day`);
  }
  if (tokens[0] === "trail") {
    const m = /^(\$?\d+(?:\.\d+)?|\.\d+)\s*(%?)$/.exec(tokens.slice(1).join(""));
    const level = m ? number(m[1]) : null;
    if (!tokens[1]) return bad(tag, `Alert ${symbol} trail …`, `alert ${symbol.toLowerCase()} trail … needs a percent, e.g. trail 3%`);
    if (!m || level == null || level <= 0) return bad(tag, `Alert ${symbol} ${cond}`, `Can't read the trail. ${ALERT_HELP}`);
    const percent = m[2] === "%";
    return row(
      { kind: "alert", symbol, alert: percent ? "trail_percent" : "trail_amount", direction: "below", level },
      tag,
      `Alert ${symbol} trail ${percent ? `${fmt(level)}%` : fmt(level)}`,
      `Adds a trailing alert when ${symbol} falls ${percent ? `${fmt(level)}%` : fmt(level)} from its high`,
    );
  }
  return bad(tag, `Alert ${symbol} ${cond}`, `Can't read the condition. ${ALERT_HELP}`);
}

function parseOrder(verb: "buy" | "sell" | "short" | "cover", tokens: string[], ctx: CommandContext): CommandRow {
  const tag = "Paper";
  const side = verb === "buy" || verb === "cover" ? "Buy" : "Sell";
  const qty = number(tokens[0]);
  if (tokens[0] == null || qty == null) return bad(tag, `${side} …`, `${verb} needs a quantity, e.g. ${verb} 10`);
  let rest = tokens.slice(1);
  let symbol = current(ctx);
  if (isTicker(rest[0]) && rest[0] !== "limit" && rest[0] !== "stop") {
    if (symbol && upper(rest[0]) !== symbol) return bad(tag, `${side} ${fmt(qty)} ${upper(rest[0])}`, `Paper orders use the current symbol (${symbol}). Open ${upper(rest[0])} first`);
    symbol = upper(rest[0]);
    rest = rest.slice(1);
  }
  if (!symbol) return bad(tag, `${side} ${fmt(qty)}`, "Open a symbol first");
  let order: "market" | "limit" | "stop" = "market";
  let price: number | null = null;
  if (rest.length) {
    if (rest[0] !== "limit" && rest[0] !== "stop") return bad(tag, `${side} ${fmt(qty)} ${symbol}`, `Can't read "${rest.join(" ")}". Add limit or stop and a price, e.g. ${verb} ${fmt(qty)} limit 180`);
    order = rest[0];
    price = number(rest[1]);
    if (price == null || rest.length > 2) return bad(tag, `${side} ${fmt(qty)} ${symbol} ${order} …`, `${verb} ${fmt(qty)} ${order} … needs a price`);
  }
  const what = verb === "short" ? "Short sells" : verb === "cover" ? "Buys to cover" : verb === "buy" ? "Buys" : "Sells";
  const at = order === "market" ? "at market" : `with a ${order} at ${fmt(price!)}`;
  const title = `${verb[0].toUpperCase()}${verb.slice(1)} ${fmt(qty)} ${symbol}${order === "market" ? "" : ` ${order} ${fmt(price!)}`}`;
  return row({ kind: "order", verb, symbol, qty, order, price }, tag, title, `${what} ${fmt(qty)} ${symbol} ${at} in the paper account`);
}

function parseMember(tokens: string[], on: boolean, ctx: CommandContext): CommandRow | null {
  const word = on ? "to" : "from";
  const at = tokens.indexOf(word);
  if (at < 0 || at > 1) return null;
  const tag = "Watchlist";
  const symbol = at === 1 ? upper(tokens[0]) : current(ctx);
  const name = tokens.slice(at + 1).join(" ");
  if (at === 1 && !isTicker(tokens[0])) return null;
  if (!symbol) return bad(tag, on ? "Add to group" : "Remove from group", "Open a symbol first or name one");
  if (!name) return bad(tag, `${on ? "Add" : "Remove"} ${symbol} ${word} …`, "Needs a group name");
  const group = findGroup(name, ctx.groups);
  if (!group) return bad(tag, `${on ? "Add" : "Remove"} ${symbol} ${word} ${name}`, ctx.groups.length ? `No group named "${name}". Groups: ${ctx.groups.join(", ")}` : "No watchlist groups yet");
  return row({ kind: "member", symbol, group, on }, tag, `${on ? "Add" : "Remove"} ${symbol} ${word} ${group}`, on ? `Adds ${symbol} to the ${group} group (and the watchlist)` : `Removes ${symbol} from the ${group} group`);
}

function parseCommand(text: string, tokens: string[], ctx: CommandContext): CommandRow | null {
  const [w0, w1] = tokens;
  const rest = tokens.slice(1).join(" ");

  if (tokens.length === 1 && PANELS[w0]) return row({ kind: "panel", panel: PANELS[w0].panel }, "Panel", PANELS[w0].label, `Opens ${PANELS[w0].label}`);
  if (ACTIONS[text]) return row({ kind: "action", action: ACTIONS[text].action }, "Action", ACTIONS[text].title, ACTIONS[text].detail);

  if (w0 === "settings") {
    if (!rest) return row({ kind: "settings", entry: null }, "Settings", "Settings", "Opens Settings");
    const entry = matchSettings(rest, undefined, 1)[0];
    if (!entry) return bad("Settings", `Settings · ${rest}`, `No setting matches "${rest}"`);
    return row({ kind: "settings", entry }, "Settings", `Settings · ${entry.label}`, `Opens Settings at ${entry.section}, ${entry.label}`);
  }

  if (w0 === "replay") {
    if (!rest) return row({ kind: "replay", date: null }, "Replay", "Replay", "Starts bar replay on the current chart");
    if (!validDate(rest)) return bad("Replay", `Replay ${rest}`, "Use a date like replay 2024-03-15");
    return row({ kind: "replay", date: rest }, "Replay", `Replay from ${rest}`, `Starts bar replay from ${rest}`);
  }

  if (w0 === "type") {
    if (!rest) return bad("Chart", "Chart type …", `Needs a type: ${CHART_MODES.map((m) => m.label.toLowerCase()).join(", ")}`);
    const m = findMode(rest);
    if (!m) return bad("Chart", `Chart type ${rest}`, `Unknown type. Try ${CHART_MODES.map((x) => x.label.toLowerCase()).join(", ")}`);
    return row({ kind: "mode", mode: m.id }, "Chart", `Chart type ${m.label}`, `Switches the chart to ${m.label}`);
  }

  if (w0 === "scale") {
    const s = SCALES[rest];
    if (!s) return bad("Chart", `Scale ${rest || "…"}`, "Needs log, linear or percent");
    return row({ kind: "scale", scale: s }, "Chart", `Scale ${SCALE_LABELS[s]}`, `Switches to the ${SCALE_LABELS[s]} price scale`);
  }

  if (w0 === "goto" || (w0 === "go" && w1 === "to")) {
    const date = w0 === "goto" ? rest : tokens.slice(2).join(" ");
    if (!date) return bad("Chart", "Go to …", "Needs a date, e.g. goto 2024-03-15");
    if (!validDate(date)) return bad("Chart", `Go to ${date}`, "Use a date like 2024-03-15");
    return row({ kind: "goto", date }, "Chart", `Go to ${date}`, `Centers the chart on ${date}`);
  }

  if (w0 === "extended" || w0 === "ext") {
    if (rest !== "on" && rest !== "off") return bad("Chart", "Extended hours …", "Needs on or off");
    return row({ kind: "extended", on: rest === "on" }, "Chart", `Extended hours ${rest}`, rest === "on" ? "Shows pre-market and after-hours candles" : "Hides pre-market and after-hours candles");
  }

  if (w0 === "watch" || w0 === "star" || w0 === "unwatch" || w0 === "unstar") {
    const on = w0 === "watch" || w0 === "star";
    if (tokens.length > 2 || (w1 && !isTicker(w1))) return bad("Watchlist", text, `Use ${w0} or ${w0} nvda`);
    const symbol = w1 ? upper(w1) : current(ctx);
    if (!symbol) return bad("Watchlist", on ? "Watch" : "Unwatch", "Open a symbol first or name one");
    return row({ kind: "watch", symbol, on }, "Watchlist", `${on ? "Watch" : "Unwatch"} ${symbol}`, on ? `Adds ${symbol} to the watchlist` : `Removes ${symbol} from the watchlist`);
  }

  if (w0 === "group") {
    if (!rest) return bad("Watchlist", "Group …", "Needs a group name");
    const group = findGroup(rest, ctx.groups);
    if (!group) return bad("Watchlist", `Group ${rest}`, ctx.groups.length ? `No group named "${rest}". Groups: ${ctx.groups.join(", ")}` : "No watchlist groups yet");
    return row({ kind: "group", group }, "Watchlist", `Group ${group}`, `Opens the watchlist on ${group}`);
  }

  if (w0 === "add" && w1 !== "alert") {
    const r = parseMember(tokens.slice(1), true, ctx);
    if (r) return r;
  }
  if (w0 === "remove") {
    const r = parseMember(tokens.slice(1), false, ctx);
    if (r) return r;
  }

  if (w0 === "alert" || (w0 === "add" && w1 === "alert")) return parseAlert(tokens.slice(w0 === "add" ? 2 : 1).join(" "), ctx);

  if (w0 === "buy" || w0 === "sell" || w0 === "short" || w0 === "cover") return parseOrder(w0, tokens.slice(1), ctx);

  if (w0 === "draw") {
    if (!rest) return bad("Draw", "Draw …", "Needs a tool, e.g. draw trendline, draw fib or draw box");
    const t = findTool(rest);
    if (!t) return bad("Draw", `Draw ${rest}`, "Unknown drawing tool");
    return row({ kind: "draw", tool: t.tool, label: t.label }, "Draw", `Draw ${t.label}`, `Picks the ${t.label} drawing tool`);
  }

  if (w1 === "drawings" && tokens.length === 2 && (w0 === "hide" || w0 === "show" || w0 === "delete")) {
    const detail = w0 === "delete" ? "Deletes the unlocked drawings on the current chart" : w0 === "hide" ? "Hides all drawings" : "Shows drawings again";
    return row({ kind: "drawings", op: w0 }, "Draw", `${w0[0].toUpperCase()}${w0.slice(1)} drawings`, detail);
  }

  const last = tokens[tokens.length - 1];
  const state = last === "on" ? true : last === "off" ? false : null;
  const name = (state == null ? tokens : tokens.slice(0, -1)).join(" ");
  const t = findToggle(name);
  if (t) {
    const verb = state == null ? "Toggles" : state ? "Shows" : "Hides";
    return row({ kind: "toggle", toggle: t.toggle, label: t.label, on: state }, "Study", `${t.label}${state == null ? "" : state ? " on" : " off"}`, `${verb} ${t.label} on the chart`);
  }

  const r = rangeInterval(tokens);
  if (r) return row({ kind: "chart", ...r }, "Chart", [r.range && rangeLabel(r.range), r.interval && intervalLabel(r.interval)].filter(Boolean).join(" "), `Switches the current chart to ${chartWords(r)}`);

  return null;
}

export function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parse(input: string, ctx: CommandContext): CommandRow[] {
  const text = normalize(input);
  if (!text) return [];
  const tokens = text.split(" ");
  const out: CommandRow[] = [];
  const cmd = parseCommand(text, tokens, ctx);
  if (cmd) out.push(cmd);
  const [w0, ...more] = tokens;
  if (isTicker(w0) && !/^\d/.test(w0)) {
    if (!more.length) out.push(openRow(w0));
    else if (!cmd) {
      const r = rangeInterval(more);
      if (r) out.push(openRow(w0, r));
    }
  }
  if (!out.length) out.push(bad("Search", input.trim(), `No command or symbol matches. Try ${EXAMPLES.slice(0, 3).join(", ")}`));
  return out;
}

export function searchable(input: string, rows: readonly CommandRow[]): boolean {
  const text = normalize(input);
  if (!text) return false;
  return !text.includes(" ") || rows.every((r) => !r.command);
}
