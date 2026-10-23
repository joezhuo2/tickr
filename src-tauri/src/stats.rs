use serde::Serialize;
use serde_json::Value;

use crate::analyst::Analysts;

const MODULES: &str = "summaryDetail,defaultKeyStatistics,financialData";

const SD: &str = "summaryDetail";
const KS: &str = "defaultKeyStatistics";
const FD: &str = "financialData";

type Field = (&'static str, &'static str, &'static str);

const SECTIONS: &[(&str, &[Field])] = &[
    (
        "Valuation",
        &[
            (SD, "marketCap", "Market cap"),
            (KS, "enterpriseValue", "Enterprise value"),
            (SD, "trailingPE", "P/E (trailing)"),
            (SD, "forwardPE", "P/E (forward)"),
            (KS, "pegRatio", "PEG ratio"),
            (SD, "priceToSalesTrailing12Months", "Price/sales"),
            (KS, "priceToBook", "Price/book"),
            (KS, "enterpriseToRevenue", "EV/revenue"),
            (KS, "enterpriseToEbitda", "EV/EBITDA"),
        ],
    ),
    (
        "Trading",
        &[
            (SD, "beta", "Beta"),
            (KS, "52WeekChange", "52w change"),
            (KS, "SandP52WeekChange", "S&P 500 52w change"),
            (SD, "fiftyDayAverage", "50-day average"),
            (SD, "twoHundredDayAverage", "200-day average"),
            (SD, "averageVolume", "Avg volume (3m)"),
            (SD, "averageVolume10days", "Avg volume (10d)"),
            (SD, "allTimeHigh", "All-time high"),
            (SD, "allTimeLow", "All-time low"),
        ],
    ),
    (
        "Dividends & splits",
        &[
            (SD, "dividendRate", "Dividend (annual)"),
            (SD, "dividendYield", "Dividend yield"),
            (SD, "trailingAnnualDividendYield", "Trailing yield"),
            (SD, "fiveYearAvgDividendYield", "5y avg yield (%)"),
            (SD, "payoutRatio", "Payout ratio"),
            (SD, "exDividendDate", "Ex-dividend date"),
            (KS, "lastSplitFactor", "Last split"),
            (KS, "lastSplitDate", "Last split date"),
        ],
    ),
    (
        "Shares & short interest",
        &[
            (KS, "sharesOutstanding", "Shares outstanding"),
            (KS, "floatShares", "Float"),
            (KS, "heldPercentInsiders", "Held by insiders"),
            (KS, "heldPercentInstitutions", "Held by institutions"),
            (KS, "sharesShort", "Shares short"),
            (KS, "shortPercentOfFloat", "Short % of float"),
            (KS, "shortRatio", "Short ratio (days)"),
            (KS, "dateShortInterest", "Short interest as of"),
        ],
    ),
    (
        "Profitability",
        &[
            (FD, "grossMargins", "Gross margin"),
            (FD, "operatingMargins", "Operating margin"),
            (FD, "ebitdaMargins", "EBITDA margin"),
            (FD, "profitMargins", "Profit margin"),
            (FD, "returnOnAssets", "Return on assets"),
            (FD, "returnOnEquity", "Return on equity"),
        ],
    ),
    (
        "Financials",
        &[
            (FD, "totalRevenue", "Revenue (ttm)"),
            (FD, "revenueGrowth", "Revenue growth (yoy)"),
            (FD, "earningsGrowth", "Earnings growth (yoy)"),
            (FD, "ebitda", "EBITDA"),
            (KS, "netIncomeToCommon", "Net income"),
            (KS, "trailingEps", "EPS (trailing)"),
            (KS, "forwardEps", "EPS (forward)"),
            (FD, "freeCashflow", "Free cash flow"),
            (FD, "operatingCashflow", "Operating cash flow"),
            (FD, "totalCash", "Total cash"),
            (FD, "totalDebt", "Total debt"),
            (FD, "debtToEquity", "Debt/equity (%)"),
            (FD, "currentRatio", "Current ratio"),
            (FD, "quickRatio", "Quick ratio"),
            (KS, "bookValue", "Book value/share"),
            (KS, "mostRecentQuarter", "Most recent quarter"),
        ],
    ),
    (
        "Fund",
        &[
            (SD, "totalAssets", "Total assets"),
            (SD, "navPrice", "NAV"),
            (SD, "yield", "Yield"),
            (KS, "annualReportExpenseRatio", "Expense ratio"),
            (KS, "ytdReturn", "YTD return"),
            (KS, "threeYearAverageReturn", "3y avg return"),
            (KS, "fiveYearAverageReturn", "5y avg return"),
            (KS, "fundFamily", "Fund family"),
            (KS, "category", "Category"),
            (KS, "fundInceptionDate", "Inception"),
        ],
    ),
    (
        "Crypto",
        &[
            (SD, "circulatingSupply", "Circulating supply"),
            (SD, "totalSupply", "Total supply"),
            (SD, "maxSupply", "Max supply"),
            (SD, "volume24Hr", "Volume (24h)"),
            (SD, "startDate", "Start date"),
        ],
    ),
];

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Section {
    pub title: String,
    pub rows: Vec<(String, String)>,
}

fn text(v: &Value) -> Option<String> {
    v.as_str().or(v["fmt"].as_str()).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

pub fn parse(body: &[u8]) -> Result<Vec<Section>, String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("bad response: {e}"))?;
    let err = &v["quoteSummary"]["error"];
    if err["code"].as_str() == Some("Not Found") {
        return Ok(Vec::new());
    }
    if let Some(desc) = err["description"].as_str() {
        return Err(desc.to_string());
    }
    let r = &v["quoteSummary"]["result"][0];
    Ok(SECTIONS
        .iter()
        .map(|(title, fields)| Section {
            title: title.to_string(),
            rows: fields
                .iter()
                .filter_map(|(module, key, label)| Some((label.to_string(), text(&r[*module][*key])?)))
                .collect(),
        })
        .filter(|s| !s.rows.is_empty())
        .collect())
}

pub async fn fetch(analysts: &Analysts, symbol: &str) -> Result<Vec<Section>, String> {
    let symbol = symbol.trim().to_uppercase();
    parse(&analysts.summary(&symbol, MODULES).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    const AAPL: &[u8] = include_bytes!("../../fixtures/stats-aapl.json");
    const SPY: &[u8] = include_bytes!("../../fixtures/stats-spy.json");

    fn get<'a>(s: &'a [Section], title: &str, label: &str) -> Option<&'a str> {
        s.iter().find(|x| x.title == title)?.rows.iter().find(|(l, _)| l == label).map(|(_, v)| v.as_str())
    }

    #[test]
    fn stock_has_company_sections() {
        let s = parse(AAPL).unwrap();
        let titles: Vec<_> = s.iter().map(|x| x.title.as_str()).collect();
        assert_eq!(titles, ["Valuation", "Trading", "Dividends & splits", "Shares & short interest", "Profitability", "Financials"]);
        assert_eq!(get(&s, "Valuation", "Market cap"), Some("5.08T"));
        assert_eq!(get(&s, "Dividends & splits", "Dividend yield"), Some("0.31%"));
        assert_eq!(get(&s, "Dividends & splits", "Last split"), Some("4:1"));
        assert_eq!(get(&s, "Shares & short interest", "Short % of float"), Some("0.83%"));
        assert_eq!(get(&s, "Trading", "Beta"), Some("1.07"));
    }

    #[test]
    fn fund_has_fund_section() {
        let s = parse(SPY).unwrap();
        assert!(s.iter().all(|x| x.title != "Profitability" && x.title != "Crypto"));
        assert_eq!(get(&s, "Fund", "Total assets"), Some("809.22B"));
        assert_eq!(get(&s, "Fund", "Yield"), Some("0.99%"));
    }

    #[test]
    fn missing_and_errors() {
        let body = br#"{"quoteSummary":{"result":null,"error":{"code":"Not Found","description":"x"}}}"#;
        assert!(parse(body).unwrap().is_empty());
        let body = br#"{"quoteSummary":{"result":null,"error":{"code":"Unauthorized","description":"Invalid Crumb"}}}"#;
        assert_eq!(parse(body).unwrap_err(), "Invalid Crumb");
    }
}
