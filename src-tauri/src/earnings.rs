
use serde::Serialize;
use serde_json::Value;

use crate::analyst::Analysts;

const MODULES: &str = "earnings,calendarEvents";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Report {
    pub quarter: String,
    pub reported: i64,
    pub eps_actual: Option<f64>,
    pub eps_estimate: Option<f64>,
    pub surprise_pct: Option<f64>,
    pub revenue: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Upcoming {
    pub date: i64,
    pub estimated: bool,
    pub eps_estimate: Option<f64>,
    pub eps_low: Option<f64>,
    pub eps_high: Option<f64>,
    pub revenue_estimate: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Earnings {
    pub symbol: String,
    pub currency: Option<String>,
    pub upcoming: Option<Upcoming>,
    pub history: Vec<Report>,
}

fn raw(v: &Value) -> Option<f64> {
    v["raw"].as_f64().filter(|x| x.is_finite())
}

pub fn parse(body: &[u8], symbol: &str) -> Result<Option<Earnings>, String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("bad response: {e}"))?;
    let err = &v["quoteSummary"]["error"];
    if err["code"].as_str() == Some("Not Found") {
        return Ok(None);
    }
    if let Some(desc) = err["description"].as_str() {
        return Err(desc.to_string());
    }
    let r = &v["quoteSummary"]["result"][0];
    let revenues = r["earnings"]["financialsChart"]["quarterly"].as_array().map(|a| a.as_slice()).unwrap_or_default();
    let mut history: Vec<Report> = r["earnings"]["earningsChart"]["quarterly"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        .filter_map(|q| {
            let revenue = revenues.iter().find(|f| f["date"] == q["date"]).and_then(|f| raw(&f["revenue"]));
            Some(Report {
                quarter: q["fiscalQuarter"].as_str().or(q["date"].as_str())?.to_string(),
                reported: q["reportedDate"]["raw"].as_i64()?,
                eps_actual: raw(&q["actual"]),
                eps_estimate: raw(&q["estimate"]),
                surprise_pct: q["surprisePct"].as_str().and_then(|s| s.parse().ok()),
                revenue,
            })
        })
        .collect();
    history.sort_by_key(|q| std::cmp::Reverse(q.reported));
    let cal = &r["calendarEvents"]["earnings"];
    let upcoming = cal["earningsDate"][0]["raw"].as_i64().map(|date| Upcoming {
        date,
        estimated: cal["isEarningsDateEstimate"].as_bool().unwrap_or(false),
        eps_estimate: raw(&cal["earningsAverage"]),
        eps_low: raw(&cal["earningsLow"]),
        eps_high: raw(&cal["earningsHigh"]),
        revenue_estimate: raw(&cal["revenueAverage"]),
    });
    if history.is_empty() && upcoming.is_none() {
        return Ok(None);
    }
    Ok(Some(Earnings {
        symbol: symbol.to_string(),
        currency: r["earnings"]["financialCurrency"].as_str().map(str::to_string),
        upcoming,
        history,
    }))
}

pub async fn fetch(analysts: &Analysts, symbol: &str) -> Result<Option<Earnings>, String> {
    let symbol = symbol.trim().to_uppercase();
    parse(&analysts.summary(&symbol, MODULES).await?, &symbol)
}

#[cfg(test)]
mod tests {
    use super::*;

    const AAPL: &[u8] = include_bytes!("../../fixtures/earnings-aapl.json");

    #[test]
    fn parses_history_and_upcoming() {
        let e = parse(AAPL, "AAPL").unwrap().expect("earnings");
        assert_eq!(e.currency.as_deref(), Some("USD"));
        assert_eq!(e.history.len(), 4);
        assert!(e.history.windows(2).all(|w| w[0].reported > w[1].reported));
        let last = &e.history[0];
        assert_eq!(last.quarter, "3Q2026");
        assert_eq!(last.reported, 1785443428);
        assert_eq!(last.eps_actual, Some(2.02));
        assert_eq!(last.eps_estimate, Some(1.89243));
        assert_eq!(last.surprise_pct, Some(6.74));
        assert_eq!(last.revenue, Some(109417000000.0));
        let u = e.upcoming.unwrap();
        assert_eq!(u.date, 1793649600);
        assert!(!u.estimated);
        assert_eq!((u.eps_low, u.eps_high), (Some(1.93), Some(2.06)));
        assert_eq!(u.revenue_estimate, Some(113357085200.0));
    }

    #[test]
    fn no_earnings_is_none() {
        let body = br#"{"quoteSummary":{"result":[{"calendarEvents":{"earnings":{"earningsDate":[]}}}],"error":null}}"#;
        assert_eq!(parse(body, "SPY").unwrap(), None);
        let body = br#"{"quoteSummary":{"result":null,"error":{"code":"Not Found","description":"No fundamentals data found"}}}"#;
        assert_eq!(parse(body, "X").unwrap(), None);
    }

    #[test]
    fn auth_error_is_an_error() {
        let body = br#"{"quoteSummary":{"result":null,"error":{"code":"Unauthorized","description":"Invalid Crumb"}}}"#;
        assert_eq!(parse(body, "X").unwrap_err(), "Invalid Crumb");
    }
}
