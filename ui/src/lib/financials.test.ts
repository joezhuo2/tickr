import { describe, expect, it } from "vitest";
import { barLayout, eps, statementRows, STATEMENTS, hasData, lineLayout, margin, marginSeries, money, percent, periodLabel, tableRows, volumeSeries } from "./financials";
import type { FinancialPeriod } from "./types";

const period = (date: string, p: Partial<FinancialPeriod> = {}): FinancialPeriod => ({
  date,
  revenue: null,
  net_income: null,
  gross_profit: null,
  operating_income: null,
  free_cash_flow: null,
  items: {},
  ...p,
});

describe("margin", () => {
  it("is the share of revenue in percent", () => {
    expect(margin(25, 100)).toBe(25);
    expect(margin(-5, 200)).toBe(-2.5);
    expect(margin(0, 100)).toBe(0);
  });

  it("is null without both figures or with no positive revenue", () => {
    expect(margin(null, 100)).toBeNull();
    expect(margin(10, null)).toBeNull();
    expect(margin(undefined, undefined)).toBeNull();
    expect(margin(10, 0)).toBeNull();
    expect(margin(10, -50)).toBeNull();
    expect(margin(Number.NaN, 100)).toBeNull();
    expect(margin(Infinity, 100)).toBeNull();
  });
});

describe("formatting", () => {
  it("abbreviates money with a true minus sign", () => {
    expect(money(416161000000)).toBe("416B");
    expect(money(94036000000)).toBe("94.0B");
    expect(money(-147782000000)).toBe("−148B");
    expect(money(2500000)).toBe("2.5M");
    expect(money(0)).toBe("0");
    expect(money(null)).toBe("—");
    expect(money(undefined)).toBe("—");
  });

  it("formats percents to one decimal", () => {
    expect(percent(46.9)).toBe("46.9%");
    expect(percent(-2.54)).toBe("−2.5%");
    expect(percent(0)).toBe("0.0%");
    expect(percent(-0.04)).toBe("0.0%");
    expect(percent(null)).toBe("—");
  });

  it("labels periods", () => {
    expect(periodLabel("2025-09-30", "annual")).toBe("FY2025");
    expect(periodLabel("2026-06-30", "quarterly")).toBe("Jun '26");
    expect(periodLabel("2025-12-31", "quarterly")).toBe("Dec '25");
    expect(periodLabel("2025-13-01", "quarterly")).toBe("2025-13-01");
    expect(periodLabel("soon", "annual")).toBe("soon");
  });
});

describe("series and rows", () => {
  const periods = [
    period("2024-09-30", { revenue: 400, net_income: 100, gross_profit: 180, operating_income: 120, free_cash_flow: 90 }),
    period("2025-09-30", { revenue: 500, net_income: -50, gross_profit: 250, operating_income: null, free_cash_flow: null }),
  ];

  it("lists revenue, net income and free cash flow per period", () => {
    const s = volumeSeries(periods);
    expect(s.map((x) => x.key)).toEqual(["revenue", "net_income", "free_cash_flow"]);
    expect(s[0].values).toEqual([400, 500]);
    expect(s[2].values).toEqual([90, null]);
  });

  it("derives margins from revenue and skips series with no data", () => {
    const s = marginSeries(periods);
    expect(s.map((x) => x.key)).toEqual(["gross_margin", "operating_margin", "net_margin"]);
    expect(s[0].values).toEqual([45, 50]);
    expect(s[1].values).toEqual([30, null]);
    expect(s[2].values).toEqual([25, -10]);
    const bare = [period("2025-09-30", { revenue: 500, net_income: 50 })];
    expect(marginSeries(bare).map((x) => x.key)).toEqual(["net_margin"]);
  });

  it("builds table rows with formatted cells", () => {
    const rows = tableRows(periods);
    expect(rows.map((r) => r.label)).toEqual(["Revenue", "Net income", "Free cash flow", "Gross margin", "Operating margin", "Net margin"]);
    expect(rows[1].cells).toEqual(["100", "−50"]);
    expect(rows[2].cells).toEqual(["90", "—"]);
    expect(rows[3].cells).toEqual(["45.0%", "50.0%"]);
    expect(rows[4].cells).toEqual(["30.0%", "—"]);
  });

  it("drops rows without any value and reports empty data", () => {
    const sparse = [period("2025-09-30", { revenue: 500 })];
    expect(tableRows(sparse).map((r) => r.key)).toEqual(["revenue"]);
    expect(hasData(sparse)).toBe(true);
    expect(hasData([period("2025-09-30")])).toBe(false);
    expect(hasData([])).toBe(false);
    expect(tableRows([])).toEqual([]);
  });
});

describe("barLayout", () => {
  it("draws positive bars up from a zero baseline and negative bars down", () => {
    const { bars, baseline } = barLayout([[100, -50]], 200, 106, 0, 3);
    expect(baseline).toBeCloseTo(3 + (100 / 150) * 100, 6);
    const [up, down] = bars;
    expect(up.x).toBe(0);
    expect(up.width).toBe(100);
    expect(up.y).toBeCloseTo(3, 6);
    expect(up.y + up.height).toBeCloseTo(baseline, 6);
    expect(down.x).toBe(100);
    expect(down.y).toBeCloseTo(baseline, 6);
    expect(down.height).toBeCloseTo((50 / 150) * 100, 6);
  });

  it("groups series side by side inside each period slot", () => {
    const { bars } = barLayout([[10, 20], [5, 10]], 100, 50, 0.2, 0);
    expect(bars).toHaveLength(4);
    const first = bars.filter((b) => b.index === 0);
    expect(first.map((b) => b.series)).toEqual([0, 1]);
    expect(first[0].x).toBeCloseTo(5, 6);
    expect(first[1].x).toBeCloseTo(first[0].x + first[0].width, 6);
    expect(bars.every((b) => b.x >= 0 && b.x + b.width <= 100)).toBe(true);
  });

  it("skips missing values and handles empty or all-zero input", () => {
    expect(barLayout([[null, 5]], 100, 50).bars.map((b) => b.index)).toEqual([1]);
    expect(barLayout([], 100, 50).bars).toEqual([]);
    expect(barLayout([[0, 0]], 100, 50).bars.every((b) => b.height === 0)).toBe(true);
    expect(barLayout([[1e-9, 1000]], 100, 50).bars[0].height).toBeGreaterThanOrEqual(1);
  });
});

describe("lineLayout", () => {
  it("places points at the center of each period slot", () => {
    const { paths, baseline } = lineLayout([[0, 10]], 100, 40, 0);
    expect(paths[0]).toBe("M25.0 40.0 L75.0 0.0");
    expect(baseline).toBe(40);
  });

  it("breaks the line at missing values and dots isolated points", () => {
    const { paths } = lineLayout([[10, null, 10, 10, null, 10]], 60, 20, 0);
    expect(paths[0]).toBe("M5.0 0.0 h0 M25.0 0.0 L35.0 0.0 M55.0 0.0 h0");
  });

  it("returns an empty path for a series with no values", () => {
    expect(lineLayout([[null, null]], 100, 40).paths).toEqual([""]);
    expect(lineLayout([], 100, 40).paths).toEqual([]);
  });

  it("keeps negative margins below the zero baseline", () => {
    const { paths, baseline } = lineLayout([[20, -10]], 100, 60, 0);
    expect(baseline).toBeCloseTo(40, 6);
    expect(paths[0]).toBe("M25.0 0.0 L75.0 60.0");
  });
});

describe("eps", () => {
  it("shows two decimals with a true minus and a dash for missing", () => {
    expect(eps(1.5)).toBe("1.50");
    expect(eps(-0.256)).toBe("−0.26");
    expect(eps(null)).toBe("—");
  });
});

describe("statementRows", () => {
  const periods = [
    period("2024-12-31", { items: { TotalRevenue: 100e9, DilutedEPS: 1.5, TotalAssets: 5e11 } }),
    period("2025-12-31", { items: { TotalRevenue: 120e9, DilutedEPS: -0.25, NetIncome: -2e9 } }),
  ];

  it("lists income lines in order, hides rows without data and formats per kind", () => {
    const rows = statementRows(periods, "income");
    expect(rows.map((r) => r.key)).toEqual(["TotalRevenue", "NetIncome", "DilutedEPS"]);
    expect(rows[0].cells).toEqual(["100B", "120B"]);
    expect(rows[1].cells).toEqual(["—", "−2.0B"]);
    expect(rows[2].cells).toEqual(["1.50", "−0.25"]);
  });

  it("keeps statements apart", () => {
    expect(statementRows(periods, "balance").map((r) => r.label)).toEqual(["Total assets"]);
    expect(statementRows(periods, "cashflow")).toEqual([]);
  });

  it("falls back to the overview table and tolerates periods without items", () => {
    expect(statementRows(periods, "overview")).toEqual(tableRows(periods));
    const old = [{ ...period("2025-12-31"), items: undefined }] as unknown as FinancialPeriod[];
    expect(statementRows(old, "income")).toEqual([]);
  });

  it("offers the four views", () => {
    expect(STATEMENTS.map((s) => s.label)).toEqual(["Overview", "Income", "Balance sheet", "Cash flow"]);
  });
});
