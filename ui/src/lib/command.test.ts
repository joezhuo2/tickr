import { describe, expect, it } from "vitest";
import { parse, rangeInterval, searchable, type Command, type CommandContext } from "./command";

const ctx: CommandContext = { symbol: "AAPL", groups: ["Tech", "Energy Names"] };
const first = (input: string, c = ctx) => parse(input, c)[0];
const cmd = (input: string, c = ctx): Command | null => first(input, c).command;

describe("symbols and chart", () => {
  it("opens a bare ticker", () => {
    expect(parse("nvda", ctx)).toEqual([{ command: { kind: "open", symbol: "NVDA" }, tag: "Symbol", title: "NVDA", detail: "Opens NVDA" }]);
    expect(cmd("  BRK-B ")).toEqual({ kind: "open", symbol: "BRK-B" });
    expect(cmd("^gspc")).toEqual({ kind: "open", symbol: "^GSPC" });
  });

  it("opens a ticker with an interval and/or range", () => {
    expect(cmd("nvda 5m")).toEqual({ kind: "open", symbol: "NVDA", interval: "5m" });
    expect(cmd("nvda 1y")).toEqual({ kind: "open", symbol: "NVDA", range: "1y" });
    expect(cmd("nvda   1y 1d")).toEqual({ kind: "open", symbol: "NVDA", range: "1y", interval: "1d" });
    expect(cmd("nvda 1d 5y")).toEqual({ kind: "open", symbol: "NVDA", range: "5y", interval: "1d" });
    expect(first("nvda 1y 1d").detail).toBe("Opens NVDA with 1Y range, 1D candles");
  });

  it("changes the current chart with a bare interval or range", () => {
    expect(cmd("5m")).toEqual({ kind: "chart", interval: "5m" });
    expect(cmd("1h")).toEqual({ kind: "chart", interval: "60m" });
    expect(cmd("1y")).toEqual({ kind: "chart", range: "1y" });
    expect(cmd("1d")).toEqual({ kind: "chart", range: "1d" });
    expect(parse("5m", ctx)).toHaveLength(1);
  });

  it("lists both a command and a ticker for an ambiguous word, command first", () => {
    const rows = parse("max", ctx);
    expect(rows.map((r) => r.command?.kind)).toEqual(["chart", "open"]);
    expect(parse("news", ctx).map((r) => r.command?.kind)).toEqual(["panel", "open"]);
    expect(parse("rsi", ctx).map((r) => r.command?.kind)).toEqual(["toggle", "open"]);
  });

  it("rejects text that is neither", () => {
    const rows = parse("what is this", ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0].command).toBeNull();
  });

  it("parses ranges and intervals in either order", () => {
    expect(rangeInterval(["1y", "1wk"])).toEqual({ range: "1y", interval: "1wk" });
    expect(rangeInterval(["1w", "max"])).toEqual({ range: "max", interval: "1wk" });
    expect(rangeInterval(["1mo"])).toEqual({ range: "1mo" });
    expect(rangeInterval(["1m"])).toEqual({ interval: "1m" });
    expect(rangeInterval(["5m", "15m"])).toBeNull();
    expect(rangeInterval(["x"])).toBeNull();
  });
});

describe("alerts", () => {
  it("parses price alerts with operators and words", () => {
    expect(cmd("add alert nvda >= 170")).toEqual({ kind: "alert", symbol: "NVDA", alert: "price", direction: "above", level: 170 });
    expect(cmd("alert nvda < 150")).toEqual({ kind: "alert", symbol: "NVDA", alert: "price", direction: "below", level: 150 });
    expect(cmd("alert nvda>=170.5")).toEqual({ kind: "alert", symbol: "NVDA", alert: "price", direction: "above", level: 170.5 });
    expect(cmd("alert nvda above 170")).toEqual({ kind: "alert", symbol: "NVDA", alert: "price", direction: "above", level: 170 });
    expect(cmd("ALERT NVDA BELOW $150")).toEqual({ kind: "alert", symbol: "NVDA", alert: "price", direction: "below", level: 150 });
    expect(first("alert nvda >= 170").title).toBe("Alert NVDA ≥ 170");
  });

  it("uses the current symbol when none is named", () => {
    expect(cmd("alert >= 170")).toEqual({ kind: "alert", symbol: "AAPL", alert: "price", direction: "above", level: 170 });
    expect(cmd("alert >=170")).toEqual({ kind: "alert", symbol: "AAPL", alert: "price", direction: "above", level: 170 });
    expect(cmd("alert -5%")).toEqual({ kind: "alert", symbol: "AAPL", alert: "day_percent", direction: "below", level: 5 });
    expect(first("alert >= 170", { symbol: "", groups: [] }).command).toBeNull();
  });

  it("parses day-move and trailing alerts", () => {
    expect(cmd("alert nvda +5%")).toEqual({ kind: "alert", symbol: "NVDA", alert: "day_percent", direction: "above", level: 5 });
    expect(cmd("alert nvda -2.5 %")).toEqual({ kind: "alert", symbol: "NVDA", alert: "day_percent", direction: "below", level: 2.5 });
    expect(cmd("alert nvda trail 3%")).toEqual({ kind: "alert", symbol: "NVDA", alert: "trail_percent", direction: "below", level: 3 });
    expect(cmd("alert nvda trail 4")).toEqual({ kind: "alert", symbol: "NVDA", alert: "trail_amount", direction: "below", level: 4 });
  });

  it("explains incomplete alerts", () => {
    const r = first("add alert nvda >=");
    expect(r.command).toBeNull();
    expect(r.detail).toBe("alert nvda >= … needs a price");
    expect(first("alert nvda").detail).toMatch(/Needs a condition/);
    expect(first("alert nvda >= abc").command).toBeNull();
    expect(first("alert nvda trail").detail).toMatch(/needs a percent/);
    expect(first("alert nvda sideways").command).toBeNull();
    expect(first("alert").command).toBeNull();
  });

  it("parses indicator alerts in Strategy syntax", () => {
    expect(cmd("alert nvda crosses_above(rsi(14), 70)")).toEqual({ kind: "chart_alert", symbol: "NVDA", expr: "crosses_above(rsi(14), 70)" });
    expect(cmd("alert crosses_below(close, sma(50))")).toEqual({ kind: "chart_alert", symbol: "AAPL", expr: "crosses_below(close, sma(50))" });
    const r = first("alert nvda crosses_above(rsi(14), ");
    expect(r.command).toBeNull();
    expect(r.detail).toMatch(/Not a valid Strategy condition/);
  });

  it("opens the Alerts overlay", () => {
    expect(cmd("alerts")).toEqual({ kind: "panel", panel: "alerts" });
  });
});

describe("navigation", () => {
  it("opens panels by name", () => {
    for (const [word, panel] of [["news", "news"], ["options", "options"], ["earnings", "earnings"], ["analysts", "analysts"], ["stats", "stats"], ["financials", "stats"], ["market", "market"], ["events", "events"], ["watchlist", "watchlist"], ["technicals", "technicals"], ["paper", "paper"], ["strategy", "backtest"], ["backtest", "backtest"], ["screener", "screener"]] as const)
      expect(cmd(word)).toEqual({ kind: "panel", panel });
  });

  it("opens settings and jumps to a setting", () => {
    expect(cmd("settings")).toEqual({ kind: "settings", entry: null });
    const c = cmd("settings theme");
    expect(c?.kind === "settings" && c.entry?.label).toBe("Theme");
    expect(cmd("settings extended-hours candles")).toMatchObject({ kind: "settings", entry: { label: "Extended-hours candles", tab: "chart" } });
    expect(first("settings zzzz").command).toBeNull();
  });

  it("parses app actions", () => {
    expect(cmd("second chart")).toEqual({ kind: "action", action: "second_chart" });
    expect(cmd("new  window")).toEqual({ kind: "action", action: "new_window" });
    expect(cmd("Refresh")).toEqual({ kind: "action", action: "refresh" });
    expect(cmd("toggle overview")).toEqual({ kind: "action", action: "toggle_overview" });
    expect(cmd("analyze")).toEqual({ kind: "action", action: "analyze" });
    expect(cmd("practice")).toEqual({ kind: "action", action: "practice" });
  });
});

describe("chart settings", () => {
  it("parses chart types", () => {
    expect(cmd("type candles")).toEqual({ kind: "mode", mode: "candles" });
    expect(cmd("type candle")).toEqual({ kind: "mode", mode: "candles" });
    expect(cmd("type heikin ashi")).toEqual({ kind: "mode", mode: "heikin" });
    expect(cmd("type renko")).toEqual({ kind: "mode", mode: "renko" });
    expect(cmd("type line")).toEqual({ kind: "mode", mode: "line" });
    expect(cmd("type line break")).toEqual({ kind: "mode", mode: "linebreak" });
    expect(cmd("type point & figure")).toEqual({ kind: "mode", mode: "pointfigure" });
    expect(cmd("type range bars")).toEqual({ kind: "mode", mode: "range" });
    expect(first("type").command).toBeNull();
    expect(first("type spaghetti").command).toBeNull();
  });

  it("parses scales, go to date and extended hours", () => {
    expect(cmd("scale log")).toEqual({ kind: "scale", scale: "log" });
    expect(cmd("scale linear")).toEqual({ kind: "scale", scale: "linear" });
    expect(cmd("scale percent")).toEqual({ kind: "scale", scale: "percent" });
    expect(first("scale").command).toBeNull();
    expect(cmd("goto 2024-03-15")).toEqual({ kind: "goto", date: "2024-03-15" });
    expect(cmd("go to 2024-03-15")).toEqual({ kind: "goto", date: "2024-03-15" });
    expect(first("goto march").command).toBeNull();
    expect(first("goto").detail).toMatch(/Needs a date/);
    expect(cmd("extended on")).toEqual({ kind: "extended", on: true });
    expect(cmd("extended off")).toEqual({ kind: "extended", on: false });
    expect(first("extended").command).toBeNull();
  });
});

describe("watchlist", () => {
  it("stars and unstars", () => {
    expect(cmd("watch nvda")).toEqual({ kind: "watch", symbol: "NVDA", on: true });
    expect(cmd("star")).toEqual({ kind: "watch", symbol: "AAPL", on: true });
    expect(cmd("unwatch nvda")).toEqual({ kind: "watch", symbol: "NVDA", on: false });
  });

  it("changes group membership with existing groups, case-insensitively", () => {
    expect(cmd("add nvda to tech")).toEqual({ kind: "member", symbol: "NVDA", group: "Tech", on: true });
    expect(cmd("add to TECH")).toEqual({ kind: "member", symbol: "AAPL", group: "Tech", on: true });
    expect(cmd("remove nvda from energy names")).toEqual({ kind: "member", symbol: "NVDA", group: "Energy Names", on: false });
    expect(first("add nvda to Crypto").command).toBeNull();
    expect(first("add nvda to").detail).toMatch(/group name/);
  });

  it("opens a group", () => {
    expect(cmd("group tech")).toEqual({ kind: "group", group: "Tech" });
    expect(first("group nope").command).toBeNull();
  });
});

describe("studies and drawings", () => {
  it("toggles overlays and studies by their names", () => {
    expect(cmd("rsi")).toEqual({ kind: "toggle", toggle: { type: "overlay", key: "rsi" }, label: "RSI pane", on: null });
    expect(cmd("macd")).toMatchObject({ toggle: { type: "overlay", key: "macd" } });
    expect(cmd("vwap on")).toMatchObject({ toggle: { type: "overlay", key: "vwap" }, on: true });
    expect(cmd("bollinger off")).toMatchObject({ toggle: { type: "overlay", key: "bollinger" }, on: false });
    expect(cmd("ichimoku")).toMatchObject({ toggle: { type: "study", id: "ichimoku" } });
    expect(cmd("supertrend")).toMatchObject({ toggle: { type: "study", id: "supertrend" } });
    expect(cmd("volume profile")).toMatchObject({ toggle: { type: "overlay", key: "volume_profile" } });
    expect(cmd("session volume profile")).toMatchObject({ toggle: { type: "study", id: "svp" } });
    expect(cmd("opening range")).toMatchObject({ toggle: { type: "overlay", key: "opening_range" } });
    expect(cmd("key levels")).toMatchObject({ toggle: { type: "overlay", key: "levels" } });
    expect(cmd("williams %r")).toMatchObject({ toggle: { type: "study", id: "willr" } });
  });

  it("picks drawing tools", () => {
    expect(cmd("draw trendline")).toEqual({ kind: "draw", tool: "trend", label: "Trend" });
    expect(cmd("draw level")).toMatchObject({ tool: "hline" });
    expect(cmd("draw fib")).toMatchObject({ tool: "fib" });
    expect(cmd("draw box")).toMatchObject({ tool: "rect" });
    expect(cmd("draw ray")).toMatchObject({ tool: "ray" });
    expect(cmd("draw text")).toMatchObject({ tool: "text" });
    expect(cmd("draw note")).toMatchObject({ tool: "note" });
    expect(cmd("draw pitchfork")).toMatchObject({ tool: "pitchfork" });
    expect(cmd("draw fib extension")).toMatchObject({ tool: "fibext" });
    expect(first("draw").command).toBeNull();
    expect(first("draw unicorn").command).toBeNull();
  });

  it("hides, shows and deletes drawings", () => {
    expect(cmd("hide drawings")).toEqual({ kind: "drawings", op: "hide" });
    expect(cmd("show drawings")).toEqual({ kind: "drawings", op: "show" });
    expect(cmd("delete drawings")).toEqual({ kind: "drawings", op: "delete" });
  });
});

describe("paper trades and modes", () => {
  it("parses market, limit and stop orders on the current symbol", () => {
    expect(cmd("buy 10")).toEqual({ kind: "order", verb: "buy", symbol: "AAPL", qty: 10, order: "market", price: null });
    expect(cmd("buy 10 aapl limit 180")).toEqual({ kind: "order", verb: "buy", symbol: "AAPL", qty: 10, order: "limit", price: 180 });
    expect(cmd("sell 5 stop 150")).toEqual({ kind: "order", verb: "sell", symbol: "AAPL", qty: 5, order: "stop", price: 150 });
    expect(cmd("short 10")).toMatchObject({ verb: "short", qty: 10 });
    expect(cmd("cover 10 aapl")).toMatchObject({ verb: "cover", qty: 10 });
    expect(first("short 10").detail).toBe("Short sells 10 AAPL at market in the paper account");
  });

  it("restricts orders to the current symbol and explains missing parts", () => {
    const other = first("buy 10 nvda");
    expect(other.command).toBeNull();
    expect(other.detail).toMatch(/current symbol \(AAPL\)\. Open NVDA first/);
    expect(cmd("buy 10 nvda", { symbol: "NVDA", groups: [] })).toMatchObject({ symbol: "NVDA" });
    expect(first("buy").detail).toMatch(/needs a quantity/);
    expect(first("buy 10 limit").detail).toBe("buy 10 limit … needs a price");
    expect(first("buy 10 aapl soon").command).toBeNull();
  });

  it("starts replay, practice and backtest", () => {
    expect(cmd("replay")).toEqual({ kind: "replay", date: null });
    expect(cmd("replay 2024-03-15")).toEqual({ kind: "replay", date: "2024-03-15" });
    expect(first("replay yesterday").command).toBeNull();
    expect(cmd("backtest")).toEqual({ kind: "panel", panel: "backtest" });
  });
});

describe("searchable", () => {
  it("searches remotely for single words and unparsed text", () => {
    expect(searchable("nvda", parse("nvda", ctx))).toBe(true);
    expect(searchable("bank of america", parse("bank of america", ctx))).toBe(true);
    expect(searchable("nvda 1y", parse("nvda 1y", ctx))).toBe(false);
    expect(searchable("alert nvda >= 170", parse("alert nvda >= 170", ctx))).toBe(false);
    expect(searchable("  ", [])).toBe(false);
  });
});
