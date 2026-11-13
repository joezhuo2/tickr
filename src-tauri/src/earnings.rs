
use serde::Serialize;
use serde_json::Value;

use crate::analyst::Analysts;
use crate::calendar::Cache;
use crate::financials::Period;
use crate::state::now_secs;

const MODULES: &str = "earnings,calendarEvents";
const CAP: usize = 12;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Report {
    pub quarter: String,
    pub reported: i64,
    pub eps_actual: Option<f64>,
    pub eps_estimate: Option<f64>,
    pub surprise_pct: Option<f64>,
    pub revenue: Option<f64>,
    pub period_end: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Older {
    pub date: String,
    pub eps_actual: f64,
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
    pub older: Vec<Older>,
}

impl Earnings {
    pub fn add_older(&mut self, quarterly: &[Period]) {
        let Some(oldest) = self.history.iter().filter_map(|r| r.period_end.clone()).min() else { return };
        let room = CAP.saturating_sub(self.history.len());
        self.older = quarterly
            .iter()
            .rev()
            .filter(|p| p.date < oldest)
            .filter_map(|p| {
                let eps = p.items.get("DilutedEPS").or_else(|| p.items.get("BasicEPS"))?;
                Some(Older { date: p.date.clone(), eps_actual: *eps, revenue: p.revenue })
            })
            .take(room)
            .collect();
    }
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
                period_end: q["periodEndDate"]["fmt"].as_str().map(str::to_string),
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
        older: Vec::new(),
    }))
}

pub async fn fetch(analysts: &Analysts, calendar: &Cache, symbol: &str) -> Result<Option<Earnings>, String> {
    let symbol = symbol.trim().to_uppercase();
    let body = analysts.summary(&symbol, MODULES).await?;
    calendar.seed(&symbol, &body, now_secs());
    parse(&body, &symbol)
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
    fn adds_older_quarters_with_actual_eps_only() {
        let body = br#"{"timeseries":{"result":[
            {"meta":{"type":["quarterlyDilutedEPS"]},"quarterlyDilutedEPS":[
                {"asOfDate":"2025-03-31","reportedValue":{"raw":1.65}},
                {"asOfDate":"2025-06-30","reportedValue":{"raw":1.57}},
                {"asOfDate":"2025-09-30","reportedValue":{"raw":1.85}}
            ]},
            {"meta":{"type":["quarterlyBasicEPS"]},"quarterlyBasicEPS":[
                {"asOfDate":"2024-12-31","reportedValue":{"raw":2.41}}
            ]},
            {"meta":{"type":["quarterlyTotalRevenue"]},"quarterlyTotalRevenue":[
                {"asOfDate":"2025-06-30","reportedValue":{"raw":94036.0}},
                {"asOfDate":"2024-09-30","reportedValue":{"raw":1.0}}
            ]}
        ],"error":null}}"#;
        let f = crate::financials::parse(body, "AAPL").unwrap().expect("financials");
        let mut e = parse(AAPL, "AAPL").unwrap().expect("earnings");
        assert_eq!(e.history[3].period_end.as_deref(), Some("2025-09-30"));
        e.add_older(&f.quarterly);
        let dates: Vec<&str> = e.older.iter().map(|o| o.date.as_str()).collect();
        assert_eq!(dates, ["2025-06-30", "2025-03-31", "2024-12-31"]);
        assert_eq!(e.older[0].eps_actual, 1.57);
        assert_eq!(e.older[0].revenue, Some(94036.0));
        assert_eq!(e.older[2].eps_actual, 2.41);
        assert_eq!(e.history.len(), 4);
    }

    #[test]
    fn older_quarters_fill_up_to_twelve() {
        let mut e = parse(AAPL, "AAPL").unwrap().expect("earnings");
        let points: Vec<String> = (0..20).map(|i| format!(r#"{{"asOfDate":"20{i:02}-03-31","reportedValue":{{"raw":1.0}}}}"#)).collect();
        let body = format!(r#"{{"timeseries":{{"result":[{{"meta":{{"type":["quarterlyDilutedEPS"]}},"quarterlyDilutedEPS":[{}]}}],"error":null}}}}"#, points.join(","));
        let f = crate::financials::parse(body.as_bytes(), "X").unwrap().expect("financials");
        e.add_older(&f.quarterly);
        assert_eq!(e.older.len(), 8);
        assert_eq!(e.older[0].date, "2019-03-31");
        assert_eq!(e.older[7].date, "2012-03-31");
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
