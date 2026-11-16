import { describe, expect, it } from "vitest";
import { price, span } from "./format";
import { hasVolume, instrumentOf, isDerivativeMarket, priceDigits } from "./instrument";

describe("instrument", () => {
  it("classifies Yahoo futures and forex symbols", () => {
    expect(["ES=F", "cl=f", "GC=F", "ZC=F"].map(instrumentOf)).toEqual(["future", "future", "future", "future"]);
    expect(["EURUSD=X", "USDJPY=X", "JPY=X"].map(instrumentOf)).toEqual(["forex", "forex", "forex"]);
    expect(["AAPL", "BTC-USD", "^GSPC", "", null, "X=Y"].map(instrumentOf)).toEqual(["other", "other", "other", "other", "other", "other"]);
    expect(isDerivativeMarket("ES=F") && isDerivativeMarket("EURUSD=X") && !isDerivativeMarket("AAPL")).toBe(true);
  });
  it("forex has no volume", () => {
    expect(hasVolume("EURUSD=X")).toBe(false);
    expect(hasVolume("ES=F") && hasVolume("AAPL")).toBe(true);
  });
  it("picks forex digits", () => {
    expect(priceDigits("EURUSD=X", 1.08123)).toBe(5);
    expect(priceDigits("USDMXN=X", 17.1234)).toBe(4);
    expect(priceDigits("USDJPY=X", 150.123)).toBe(2);
    expect(priceDigits("JPY=X", 150.123)).toBe(2);
    expect(priceDigits("AUDJPY=X", 98.4)).toBe(3);
    expect(priceDigits("ES=F", 5000)).toBeUndefined();
    expect(priceDigits("AAPL", 1)).toBeUndefined();
  });
  it("formats prices by symbol", () => {
    expect(price(1.08123, "USD", "EURUSD=X")).toBe("1.08123");
    expect(price(150.1234, "JPY", "USDJPY=X")).toBe("150.12");
    expect(price(5012.5, "USD", "ES=F")).toBe("$5,012.50");
    expect(price(1.5, "USD")).toBe("$1.50");
    expect(span(1.0801, 1.0899, "EURUSD=X")).toBe("1.08010 – 1.08990");
  });
});
