import { describe, expect, it } from "vitest";
import { exchangesOf, filterHits, hitCurrency, hitLabel, hitTypeLabel, matchesType, rankHits, searchTypeOf, searchView } from "./search";
import type { SearchHit } from "./types";

function hit(symbol: string, over: Partial<SearchHit> = {}): SearchHit {
  return { symbol, name: "", exchange: "", kind: "", quote_type: "", currency: "", ...over };
}

const eq = (symbol: string, exchange: string, over: Partial<SearchHit> = {}) =>
  hit(symbol, { exchange, kind: "Equity", quote_type: "EQUITY", ...over });
const etf = (symbol: string, exchange: string) => hit(symbol, { exchange, kind: "ETF", quote_type: "ETF" });
const symbols = (hits: SearchHit[]) => hits.map((h) => h.symbol);

const shop = [
  eq("SHOP", "NASDAQ"),
  eq("SHOP.TO", "Toronto"),
  etf("SHPU", "NASDAQ"),
  etf("SHPE.TO", "Toronto"),
  eq("FSHOP13.MX", "Mexico"),
  eq("SHP.JO", "Johannesburg Stock Exchange"),
];

const mixed = [
  eq("BRK-B", "NYSE"),
  eq("BRK-A", "NYSE"),
  eq("BRKR", "NASDAQ"),
  eq("BRKB.VI", "Vienna"),
  etf("BRKC", "NYSEArca"),
  hit("BRKB-USD", { exchange: "CCC", kind: "Cryptocurrency", quote_type: "CRYPTOCURRENCY" }),
  hit("EURUSD=X", { exchange: "CCY", kind: "Currency", quote_type: "CURRENCY" }),
  hit("^GSPC", { exchange: "SNP", kind: "Index", quote_type: "INDEX" }),
  hit("VFIAX", { exchange: "NAS", kind: "Mutual Fund", quote_type: "MUTUALFUND" }),
];

describe("rankHits", () => {
  it("puts an exact ticker first, case-insensitively, then prefixes, then the rest in provider order", () => {
    const hits = [eq("XSHOP", "A"), eq("SHOPX", "B"), eq("SHOP", "C"), eq("ZSHOP", "D"), eq("SHOPY", "E")];
    expect(symbols(rankHits(hits, "shop"))).toEqual(["SHOP", "SHOPX", "SHOPY", "XSHOP", "ZSHOP"]);
    expect(symbols(rankHits(hits, "SHOP"))).toEqual(["SHOP", "SHOPX", "SHOPY", "XSHOP", "ZSHOP"]);
  });
  it("moves a late exact match ahead of provider-ranked names", () => {
    const hits = [eq("AMZN.MX", "Mexico"), eq("AMZ.DE", "XETRA"), eq("AMZ", "NYSE")];
    expect(symbols(rankHits(hits, " amz "))).toEqual(["AMZ", "AMZN.MX", "AMZ.DE"]);
  });
  it("ranks the exact listing above other exchanges of the same company", () => {
    expect(symbols(rankHits(shop, "shop.to"))).toEqual(["SHOP.TO", "SHOP", "SHPU", "SHPE.TO", "FSHOP13.MX", "SHP.JO"]);
    expect(symbols(rankHits(shop, "shop"))).toEqual(["SHOP", "SHOP.TO", "SHPU", "SHPE.TO", "FSHOP13.MX", "SHP.JO"]);
  });
  it("keeps provider order among equal ranks and for identical symbols on different exchanges", () => {
    const hits = [eq("ABC", "NYSE"), eq("ABC", "LSE"), eq("ABCD", "NYSE"), eq("ABCE", "LSE")];
    const ranked = rankHits(hits, "abc");
    expect(ranked.map((h) => `${h.symbol}@${h.exchange}`)).toEqual(["ABC@NYSE", "ABC@LSE", "ABCD@NYSE", "ABCE@LSE"]);
  });
  it("treats BRK.B and BRK-B as the same instrument without outranking a true exact match", () => {
    expect(symbols(rankHits(mixed, "brk.b"))[0]).toBe("BRK-B");
    expect(symbols(rankHits(mixed, "brk.b")).slice(0, 3)).toEqual(["BRK-B", "BRKB.VI", "BRKB-USD"]);
    expect(symbols(rankHits(mixed, "brk-b"))[0]).toBe("BRK-B");
    const both = [eq("BRK.B", "X"), eq("BRK-B", "Y")];
    expect(symbols(rankHits(both, "brk-b"))).toEqual(["BRK-B", "BRK.B"]);
    expect(symbols(rankHits(both, "BRK.B"))).toEqual(["BRK.B", "BRK-B"]);
  });
  it("matches index and currency symbols typed without punctuation", () => {
    expect(symbols(rankHits(mixed, "gspc"))[0]).toBe("^GSPC");
    expect(symbols(rankHits(mixed, "eurusd"))[0]).toBe("EURUSD=X");
  });
  it("does not rank on a query made only of separators", () => {
    const hits = [eq("AAA", "A"), eq("^BBB", "B"), eq("CCC", "C")];
    expect(symbols(rankHits(hits, "^"))).toEqual(["^BBB", "AAA", "CCC"]);
    expect(symbols(rankHits(hits, "."))).toEqual(["AAA", "^BBB", "CCC"]);
  });
  it("returns provider order for an empty query and never mutates the input", () => {
    const hits = [eq("B", "X"), eq("A", "X")];
    expect(symbols(rankHits(hits, "  "))).toEqual(["B", "A"]);
    rankHits(hits, "a");
    expect(symbols(hits)).toEqual(["B", "A"]);
  });
  it("survives hits with missing fields", () => {
    const broken = [{ symbol: "AB" }, { symbol: undefined }, hit("A")] as unknown as SearchHit[];
    expect(rankHits(broken, "a")).toHaveLength(3);
    expect(rankHits(broken, "a")[0].symbol).toBe("A");
  });
});

describe("type filter", () => {
  it("maps Yahoo quote types", () => {
    expect(mixed.map(searchTypeOf)).toEqual(["stocks", "stocks", "stocks", "stocks", "etfs", "crypto", "currencies", "indices", "funds"]);
    expect(searchTypeOf(hit("X", { quote_type: "etf" }))).toBe("etfs");
    expect(searchTypeOf(hit("X", { quote_type: " mutualfund " }))).toBe("funds");
  });
  it("leaves unknown and missing types visible only under All", () => {
    const fut = hit("ES=F", { quote_type: "FUTURE", kind: "Futures" });
    const none = hit("ZZZ");
    const toString = hit("TS", { quote_type: "toString" });
    for (const h of [fut, none, toString]) {
      expect(searchTypeOf(h)).toBeNull();
      expect(matchesType(h, "all")).toBe(true);
      expect(matchesType(h, "stocks")).toBe(false);
    }
  });
  it("filters each type", () => {
    expect(symbols(filterHits(mixed, "all", ""))).toHaveLength(mixed.length);
    expect(symbols(filterHits(mixed, "stocks", ""))).toEqual(["BRK-B", "BRK-A", "BRKR", "BRKB.VI"]);
    expect(symbols(filterHits(mixed, "etfs", ""))).toEqual(["BRKC"]);
    expect(symbols(filterHits(mixed, "crypto", ""))).toEqual(["BRKB-USD"]);
    expect(symbols(filterHits(mixed, "currencies", ""))).toEqual(["EURUSD=X"]);
    expect(symbols(filterHits(mixed, "indices", ""))).toEqual(["^GSPC"]);
    expect(symbols(filterHits(mixed, "funds", ""))).toEqual(["VFIAX"]);
  });
});

describe("exchange filter", () => {
  it("lists distinct exchanges sorted, skipping blanks", () => {
    expect(exchangesOf(shop)).toEqual(["Johannesburg Stock Exchange", "Mexico", "NASDAQ", "Toronto"]);
    expect(exchangesOf([hit("A"), hit("B", { exchange: "  " }), eq("C", "NYSE"), eq("D", "NYSE")])).toEqual(["NYSE"]);
    expect(exchangesOf([])).toEqual([]);
  });
  it("filters by exchange and keeps everything when none is chosen", () => {
    expect(symbols(filterHits(shop, "all", "Toronto"))).toEqual(["SHOP.TO", "SHPE.TO"]);
    expect(filterHits(shop, "all", "")).toHaveLength(shop.length);
    expect(filterHits(shop, "all", "Nowhere")).toEqual([]);
  });
  it("hides hits with no exchange once an exchange is chosen", () => {
    expect(symbols(filterHits([hit("A"), eq("B", "NYSE")], "all", "NYSE"))).toEqual(["B"]);
  });
});

describe("searchView", () => {
  it("combines type and exchange filters with ranking", () => {
    expect(symbols(searchView(shop, "shop", "stocks", "Toronto"))).toEqual(["SHOP.TO"]);
    expect(symbols(searchView(shop, "shop", "etfs", "Toronto"))).toEqual(["SHPE.TO"]);
    expect(symbols(searchView(shop, "shop", "etfs", "NASDAQ"))).toEqual(["SHPU"]);
    expect(symbols(searchView(shop, "shop", "stocks", ""))).toEqual(["SHOP", "SHOP.TO", "FSHOP13.MX", "SHP.JO"]);
    expect(symbols(searchView(shop, "shp.jo", "stocks", "Johannesburg Stock Exchange"))).toEqual(["SHP.JO"]);
  });
  it("returns nothing when the combination matches no result", () => {
    expect(searchView(shop, "shop", "crypto", "")).toEqual([]);
    expect(searchView(shop, "shop", "etfs", "Mexico")).toEqual([]);
  });
  it("ranks after filtering so the exact match leads the filtered list", () => {
    const hits = [eq("BRKB.VI", "Vienna"), eq("BRK-B", "NYSE"), etf("BRKC", "NYSEArca")];
    expect(symbols(searchView(hits, "brk-b", "stocks", ""))).toEqual(["BRK-B", "BRKB.VI"]);
    expect(symbols(searchView(hits, "brk-b", "all", "Vienna"))).toEqual(["BRKB.VI"]);
  });
  it("returns an empty list for no hits", () => {
    expect(searchView([], "x", "all", "")).toEqual([]);
  });
});

describe("labels", () => {
  it("shows exchange, currency and type in that order", () => {
    expect(hitLabel(eq("AAPL", "NASDAQ", { currency: "USD" }))).toBe("NASDAQ · USD · Equity");
    expect(hitLabel(eq("SHOP.TO", "Toronto", { currency: "cad" }))).toBe("Toronto · CAD · Equity");
  });
  it("shows nothing for a currency the payload does not carry", () => {
    expect(hitCurrency(eq("AAPL", "NASDAQ"))).toBe("");
    expect(hitCurrency(eq("SHOP.TO", "Toronto"))).toBe("");
    expect(hitCurrency(etf("SHPU", "NASDAQ"))).toBe("");
    expect(hitCurrency(hit("^GSPC", { quote_type: "INDEX" }))).toBe("");
    expect(hitLabel(eq("AAPL", "NASDAQ"))).toBe("NASDAQ · Equity");
  });
  it("reads the quote currency from the symbol of crypto and currency pairs only", () => {
    const crypto = (symbol: string) => hit(symbol, { quote_type: "CRYPTOCURRENCY" });
    const fx = (symbol: string) => hit(symbol, { quote_type: "CURRENCY" });
    expect(hitCurrency(crypto("BTC-USD"))).toBe("USD");
    expect(hitCurrency(crypto("ETH-BTC"))).toBe("BTC");
    expect(hitCurrency(crypto("BTC"))).toBe("");
    expect(hitCurrency(fx("EURGBP=X"))).toBe("GBP");
    expect(hitCurrency(fx("JPY=X"))).toBe("");
    expect(hitCurrency(eq("BTC-USD", "NYSE"))).toBe("");
    expect(hitCurrency({ ...crypto("BTC-USD"), currency: "EUR" })).toBe("EUR");
    expect(hitLabel(hit("BRKB-USD", { exchange: "CCC", kind: "Cryptocurrency", quote_type: "CRYPTOCURRENCY" }))).toBe("CCC · USD · Cryptocurrency");
  });
  it("falls back to the quote type name when the display type is missing", () => {
    expect(hitTypeLabel(hit("X", { quote_type: "ETF" }))).toBe("ETF");
    expect(hitTypeLabel(hit("X", { quote_type: "MUTUALFUND" }))).toBe("Mutual Fund");
    expect(hitTypeLabel(hit("X", { kind: "Futures", quote_type: "FUTURE" }))).toBe("Futures");
    expect(hitTypeLabel(hit("X", { quote_type: "FUTURE" }))).toBe("");
    expect(hitTypeLabel(hit("X"))).toBe("");
  });
  it("omits missing parts without stray separators", () => {
    expect(hitLabel(hit("X"))).toBe("");
    expect(hitLabel(hit("X", { exchange: "NYSE" }))).toBe("NYSE");
    expect(hitLabel(hit("X", { kind: "Equity" }))).toBe("Equity");
    expect(hitLabel({ symbol: "X" } as SearchHit)).toBe("");
  });
});
