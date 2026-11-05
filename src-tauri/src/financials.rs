use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

use crate::analyst::Analysts;
use crate::state::lock;

const URL: &str = "https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries";
const METRICS: [&str; 5] = ["TotalRevenue", "NetIncome", "GrossProfit", "OperatingIncome", "FreeCashFlow"];
const DAY: i64 = 86400;
const LOOKBACK: i64 = 10 * 365 * DAY;
const TTL: i64 = 12 * 3600;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Period {
    pub date: String,
    pub revenue: Option<f64>,
    pub net_income: Option<f64>,
    pub gross_profit: Option<f64>,
    pub operating_income: Option<f64>,
    pub free_cash_flow: Option<f64>,
}

impl Period {
    fn new(date: &str) -> Self {
        Self {
            date: date.to_string(),
            revenue: None,
            net_income: None,
            gross_profit: None,
            operating_income: None,
            free_cash_flow: None,
        }
    }

    fn slot(&mut self, metric: &str) -> Option<&mut Option<f64>> {
        match metric {
            "TotalRevenue" => Some(&mut self.revenue),
            "NetIncome" => Some(&mut self.net_income),
            "GrossProfit" => Some(&mut self.gross_profit),
            "OperatingIncome" => Some(&mut self.operating_income),
            "FreeCashFlow" => Some(&mut self.free_cash_flow),
            _ => None,
        }
    }

    fn has_data(&self) -> bool {
        [self.revenue, self.net_income, self.gross_profit, self.operating_income, self.free_cash_flow].iter().any(Option::is_some)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Financials {
    pub symbol: String,
    pub currency: Option<String>,
    pub annual: Vec<Period>,
    pub quarterly: Vec<Period>,
}

fn valid_date(d: &str) -> bool {
    d.len() == 10 && d.bytes().enumerate().all(|(i, b)| if i == 4 || i == 7 { b == b'-' } else { b.is_ascii_digit() })
}

fn finish(periods: BTreeMap<String, Period>) -> Vec<Period> {
    periods.into_values().filter(Period::has_data).collect()
}

pub fn parse(body: &[u8], symbol: &str) -> Result<Option<Financials>, String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("bad response: {e}"))?;
    let err = &v["timeseries"]["error"];
    if err["code"].as_str() == Some("Not Found") {
        return Ok(None);
    }
    if let Some(desc) = err["description"].as_str() {
        return Err(desc.to_string());
    }
    let mut currency = None;
    let mut annual: BTreeMap<String, Period> = BTreeMap::new();
    let mut quarterly: BTreeMap<String, Period> = BTreeMap::new();
    for series in v["timeseries"]["result"].as_array().into_iter().flatten() {
        let Some(kind) = series["meta"]["type"][0].as_str() else { continue };
        let (periods, metric) = if let Some(m) = kind.strip_prefix("annual") {
            (&mut annual, m)
        } else if let Some(m) = kind.strip_prefix("quarterly") {
            (&mut quarterly, m)
        } else {
            continue;
        };
        if !METRICS.contains(&metric) {
            continue;
        }
        for point in series[kind].as_array().into_iter().flatten() {
            let Some(date) = point["asOfDate"].as_str().filter(|d| valid_date(d)) else { continue };
            if currency.is_none() {
                currency = point["currencyCode"].as_str().filter(|c| !c.is_empty()).map(str::to_string);
            }
            let value = point["reportedValue"]["raw"].as_f64().filter(|x| x.is_finite());
            if let Some(slot) = periods.entry(date.to_string()).or_insert_with(|| Period::new(date)).slot(metric) {
                *slot = value.or(*slot);
            }
        }
    }
    let (annual, quarterly) = (finish(annual), finish(quarterly));
    if annual.is_empty() && quarterly.is_empty() {
        return Ok(None);
    }
    Ok(Some(Financials { symbol: symbol.to_string(), currency, annual, quarterly }))
}

fn types() -> String {
    ["annual", "quarterly"].iter().flat_map(|p| METRICS.iter().map(move |m| format!("{p}{m}"))).collect::<Vec<_>>().join(",")
}

async fn fetch(analysts: &Analysts, symbol: &str, now: i64) -> Result<Option<Financials>, String> {
    let symbol = symbol.trim().to_uppercase();
    let (from, to) = ((now - LOOKBACK).max(0).to_string(), (now + DAY).to_string());
    let query = [("type", types()), ("merge", "false".into()), ("period1", from), ("period2", to)];
    let query: Vec<(&str, &str)> = query.iter().map(|(k, v)| (*k, v.as_str())).collect();
    parse(&analysts.request(&format!("{URL}/{symbol}"), &query).await?, &symbol)
}

#[derive(Default)]
pub struct Cache {
    entries: Mutex<HashMap<String, (i64, Option<Financials>)>>,
}

impl Cache {
    pub fn cached(&self, symbol: &str, now: i64) -> Option<Option<Financials>> {
        lock(&self.entries)
            .get(&symbol.trim().to_uppercase())
            .filter(|(at, _)| (0..TTL).contains(&(now - at)))
            .map(|(_, f)| f.clone())
    }

    fn store(&self, symbol: &str, now: i64, f: Option<Financials>) {
        lock(&self.entries).insert(symbol.trim().to_uppercase(), (now, f));
    }
}

pub async fn get(analysts: &Analysts, cache: &Cache, symbol: &str, now: i64, force: bool) -> Result<Option<Financials>, String> {
    if !force {
        if let Some(f) = cache.cached(symbol, now) {
            return Ok(f);
        }
    }
    let f = fetch(analysts, symbol, now).await?;
    cache.store(symbol, now, f.clone());
    Ok(f)
}

#[cfg(test)]
mod tests {
    use super::*;

    const AAPL: &[u8] = include_bytes!("../../fixtures/financials-aapl.json");
    const JPM: &[u8] = include_bytes!("../../fixtures/financials-jpm.json");
    const SPY: &[u8] = include_bytes!("../../fixtures/financials-spy.json");

    #[test]
    fn parses_annual_and_quarterly_in_date_order() {
        let f = parse(AAPL, "AAPL").unwrap().expect("financials");
        assert_eq!(f.symbol, "AAPL");
        assert_eq!(f.currency.as_deref(), Some("USD"));
        assert_eq!(f.annual.len(), 4);
        assert_eq!(f.quarterly.len(), 5);
        assert!(f.annual.windows(2).all(|w| w[0].date < w[1].date));
        assert!(f.quarterly.windows(2).all(|w| w[0].date < w[1].date));
        let y = f.annual.last().unwrap();
        assert_eq!(y.date, "2025-09-30");
        assert_eq!(y.revenue, Some(416161000000.0));
        assert_eq!(y.net_income, Some(112010000000.0));
        assert_eq!(y.gross_profit, Some(195201000000.0));
        assert_eq!(y.operating_income, Some(133050000000.0));
        assert_eq!(y.free_cash_flow, Some(98767000000.0));
        let q = &f.quarterly[0];
        assert_eq!(q.date, "2025-06-30");
        assert_eq!(q.revenue, Some(94036000000.0));
        assert_eq!(q.operating_income, Some(28202000000.0));
        assert_eq!(f.quarterly[4].date, "2026-06-30");
    }

    #[test]
    fn missing_series_are_null() {
        let f = parse(JPM, "JPM").unwrap().expect("financials");
        assert_eq!((f.annual.len(), f.quarterly.len()), (4, 5));
        let y = f.annual.last().unwrap();
        assert_eq!(y.revenue, Some(181847000000.0));
        assert_eq!(y.gross_profit, None);
        assert_eq!(y.operating_income, None);
        assert_eq!(y.free_cash_flow, Some(-147782000000.0));
    }

    #[test]
    fn no_data_is_none() {
        assert_eq!(parse(SPY, "SPY").unwrap(), None);
        let body = br#"{"timeseries":{"result":[],"error":null}}"#;
        assert_eq!(parse(body, "X").unwrap(), None);
        let body = br#"{"timeseries":{"result":null,"error":{"code":"Not Found","description":"No data found, symbol may be delisted"}}}"#;
        assert_eq!(parse(body, "X").unwrap(), None);
    }

    #[test]
    fn other_errors_are_errors() {
        let body = br#"{"timeseries":{"result":null,"error":{"code":"Bad Request","description":"Invalid input"}}}"#;
        assert_eq!(parse(body, "X").unwrap_err(), "Invalid input");
        assert!(parse(b"<html>", "X").unwrap_err().starts_with("bad response"));
    }

    #[test]
    fn malformed_points_are_skipped() {
        let body = br#"{"timeseries":{"result":[
            {"meta":{"type":["annualTotalRevenue"]},"annualTotalRevenue":[
                null,
                {"asOfDate":"2024-12-31","currencyCode":"EUR","reportedValue":{"raw":"n/a"}},
                {"asOfDate":"2025-12-31","currencyCode":"EUR","reportedValue":{"raw":500.0}},
                {"asOfDate":"soon","reportedValue":{"raw":9.0}},
                {"reportedValue":{"raw":9.0}},
                {"asOfDate":"2026-12-31"}
            ]},
            {"meta":{"type":["annualNetIncome"]},"annualNetIncome":[{"asOfDate":"2025-12-31","reportedValue":{"raw":50.0}}]},
            {"meta":{"type":["annualEbitda"]},"annualEbitda":[{"asOfDate":"2023-12-31","reportedValue":{"raw":1.0}}]},
            {"meta":{"type":["trailingTotalRevenue"]},"trailingTotalRevenue":[{"asOfDate":"2023-12-31","reportedValue":{"raw":1.0}}]},
            {"meta":{}},
            {"meta":{"type":["quarterlyGrossProfit"]},"quarterlyGrossProfit":"oops"}
        ],"error":null}}"#;
        let f = parse(body, "X").unwrap().expect("financials");
        assert_eq!(f.currency.as_deref(), Some("EUR"));
        assert!(f.quarterly.is_empty());
        assert_eq!(f.annual.len(), 1);
        let y = &f.annual[0];
        assert_eq!(y.date, "2025-12-31");
        assert_eq!((y.revenue, y.net_income, y.gross_profit), (Some(500.0), Some(50.0), None));
    }

    #[test]
    fn requests_all_metrics_for_both_frequencies() {
        let t = types();
        let all: Vec<&str> = t.split(',').collect();
        assert_eq!(all.len(), 10);
        assert!(all.contains(&"annualTotalRevenue") && all.contains(&"quarterlyFreeCashFlow"));
        assert!(all.contains(&"annualGrossProfit") && all.contains(&"quarterlyOperatingIncome"));
        assert!(all.contains(&"annualNetIncome") && all.contains(&"quarterlyNetIncome"));
    }

    #[test]
    fn cache_respects_ttl() {
        let c = Cache::default();
        c.store("AAPL", 1000, None);
        assert_eq!(c.cached("aapl", 1000 + TTL - 1), Some(None));
        assert_eq!(c.cached("AAPL", 1000 + TTL), None);
        assert_eq!(c.cached("AAPL", 999), None);
        assert_eq!(c.cached("MSFT", 1000), None);
    }

    #[test]
    #[ignore]
    fn live_financials() {
        let a = Analysts::new();
        let now = crate::state::now_secs();
        tauri::async_runtime::block_on(async {
            let f = fetch(&a, "AAPL", now).await.unwrap().expect("AAPL has statements");
            assert!(f.annual.last().unwrap().revenue.is_some() && !f.quarterly.is_empty(), "{f:?}");
            assert_eq!(fetch(&a, "BTC-USD", now).await.unwrap(), None);
        });
    }
}
