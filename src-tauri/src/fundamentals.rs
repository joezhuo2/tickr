use serde::Serialize;
use serde_json::Value;

use crate::analyst::Analysts;

const MODULES: &str = "summaryDetail,defaultKeyStatistics,financialData,assetProfile";

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Fundamentals {
    pub symbol: String,
    pub market_cap: Option<f64>,
    pub pe: Option<f64>,
    pub eps: Option<f64>,
    pub dividend_yield: Option<f64>,
    pub revenue_growth: Option<f64>,
    pub profit_margin: Option<f64>,
    pub beta: Option<f64>,
    pub sector: Option<String>,
    pub error: Option<String>,
}

fn raw(v: &Value) -> Option<f64> {
    v["raw"].as_f64().filter(|x| x.is_finite())
}

pub fn parse(body: &[u8], symbol: &str) -> Result<Fundamentals, String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("bad response: {e}"))?;
    let err = &v["quoteSummary"]["error"];
    if err["code"].as_str() == Some("Not Found") {
        return Ok(Fundamentals { symbol: symbol.to_string(), ..Fundamentals::default() });
    }
    if let Some(desc) = err["description"].as_str() {
        return Err(desc.to_string());
    }
    let r = &v["quoteSummary"]["result"][0];
    let (sd, ks, fd) = (&r["summaryDetail"], &r["defaultKeyStatistics"], &r["financialData"]);
    Ok(Fundamentals {
        symbol: symbol.to_string(),
        market_cap: raw(&sd["marketCap"]).filter(|c| *c > 0.0),
        pe: raw(&sd["trailingPE"]),
        eps: raw(&ks["trailingEps"]),
        dividend_yield: raw(&sd["dividendYield"]).map(|y| y * 100.0),
        revenue_growth: raw(&fd["revenueGrowth"]).map(|g| g * 100.0),
        profit_margin: raw(&fd["profitMargins"]).map(|m| m * 100.0),
        beta: raw(&sd["beta"]),
        sector: r["assetProfile"]["sector"].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string),
        error: None,
    })
}

pub async fn fetch(analysts: &Analysts, symbol: &str) -> Result<Fundamentals, String> {
    let symbol = symbol.trim().to_uppercase();
    parse(&analysts.summary(&symbol, MODULES).await?, &symbol)
}

#[cfg(test)]
mod tests {
    use super::*;

    const AAPL: &[u8] = include_bytes!("../../fixtures/stats-aapl.json");

    #[test]
    fn reads_raw_numbers_and_converts_ratios_to_percent() {
        let f = parse(AAPL, "AAPL").unwrap();
        assert_eq!(f.symbol, "AAPL");
        assert_eq!(f.market_cap, Some(5081985449984.0));
        assert_eq!(f.eps, Some(8.72));
        assert_eq!(f.beta, Some(1.069));
        assert!((f.pe.unwrap() - 39.933487).abs() < 1e-9);
        assert!((f.dividend_yield.unwrap() - 0.31).abs() < 1e-9);
        assert!((f.revenue_growth.unwrap() - 16.4).abs() < 1e-9);
        assert!((f.profit_margin.unwrap() - 27.618998).abs() < 1e-9);
        assert_eq!(f.sector, None);
        assert_eq!(f.error, None);
    }

    #[test]
    fn sector_comes_from_the_asset_profile() {
        let body = br#"{"quoteSummary":{"result":[{"assetProfile":{"sector":" Technology "},"summaryDetail":{"marketCap":{"raw":0}}}],"error":null}}"#;
        let f = parse(body, "X").unwrap();
        assert_eq!(f.sector.as_deref(), Some("Technology"));
        assert_eq!((f.market_cap, f.pe, f.eps, f.dividend_yield), (None, None, None, None));
    }

    #[test]
    fn missing_and_errors() {
        let body = br#"{"quoteSummary":{"result":null,"error":{"code":"Not Found","description":"x"}}}"#;
        assert_eq!(parse(body, "ZZZ").unwrap(), Fundamentals { symbol: "ZZZ".into(), ..Fundamentals::default() });
        let body = br#"{"quoteSummary":{"result":null,"error":{"code":"Unauthorized","description":"Invalid Crumb"}}}"#;
        assert_eq!(parse(body, "ZZZ").unwrap_err(), "Invalid Crumb");
    }
}
