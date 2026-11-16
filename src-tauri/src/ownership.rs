use serde::Serialize;
use serde_json::Value;

use crate::analyst::Analysts;

const MODULES: &str = "insiderTransactions,institutionOwnership,fundOwnership,majorHoldersBreakdown";
const CAP: usize = 50;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Insider {
    pub name: String,
    pub relation: Option<String>,
    pub text: String,
    pub shares: Option<f64>,
    pub value: Option<f64>,
    pub date: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Holder {
    pub name: String,
    pub pct_held: Option<f64>,
    pub shares: Option<f64>,
    pub value: Option<f64>,
    pub pct_change: Option<f64>,
    pub reported: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Breakdown {
    pub insiders_pct: Option<f64>,
    pub institutions_pct: Option<f64>,
    pub institutions_float_pct: Option<f64>,
    pub institutions_count: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Ownership {
    pub symbol: String,
    pub insiders: Vec<Insider>,
    pub institutions: Vec<Holder>,
    pub funds: Vec<Holder>,
    pub breakdown: Option<Breakdown>,
}

fn raw(v: &Value) -> Option<f64> {
    v["raw"].as_f64().filter(|x| x.is_finite())
}

fn text(v: &Value) -> Option<String> {
    v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn insiders(v: &Value) -> Vec<Insider> {
    let mut out: Vec<Insider> = v["transactions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|t| {
            Some(Insider {
                name: text(&t["filerName"])?,
                relation: text(&t["filerRelation"]),
                text: text(&t["transactionText"]).unwrap_or_default(),
                shares: raw(&t["shares"]),
                value: raw(&t["value"]),
                date: t["startDate"]["raw"].as_i64(),
            })
        })
        .collect();
    out.sort_by_key(|i| std::cmp::Reverse(i.date));
    out.truncate(CAP);
    out
}

fn holders(v: &Value) -> Vec<Holder> {
    v["ownershipList"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|h| {
            Some(Holder {
                name: text(&h["organization"])?,
                pct_held: raw(&h["pctHeld"]),
                shares: raw(&h["position"]),
                value: raw(&h["value"]),
                pct_change: raw(&h["pctChange"]),
                reported: h["reportDate"]["raw"].as_i64(),
            })
        })
        .take(CAP)
        .collect()
}

pub fn parse(body: &[u8], symbol: &str) -> Result<Option<Ownership>, String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("bad response: {e}"))?;
    let err = &v["quoteSummary"]["error"];
    if err["code"].as_str() == Some("Not Found") {
        return Ok(None);
    }
    if let Some(desc) = err["description"].as_str() {
        return Err(desc.to_string());
    }
    let r = &v["quoteSummary"]["result"][0];
    let b = &r["majorHoldersBreakdown"];
    let breakdown = Breakdown {
        insiders_pct: raw(&b["insidersPercentHeld"]),
        institutions_pct: raw(&b["institutionsPercentHeld"]),
        institutions_float_pct: raw(&b["institutionsFloatPercentHeld"]),
        institutions_count: raw(&b["institutionsCount"]),
    };
    let known = breakdown.insiders_pct.is_some() || breakdown.institutions_pct.is_some() || breakdown.institutions_count.is_some();
    let o = Ownership {
        symbol: symbol.to_string(),
        insiders: insiders(&r["insiderTransactions"]),
        institutions: holders(&r["institutionOwnership"]),
        funds: holders(&r["fundOwnership"]),
        breakdown: known.then_some(breakdown),
    };
    let empty = o.insiders.is_empty() && o.institutions.is_empty() && o.funds.is_empty() && o.breakdown.is_none();
    Ok((!empty).then_some(o))
}

pub async fn fetch(analysts: &Analysts, symbol: &str) -> Result<Option<Ownership>, String> {
    let symbol = symbol.trim().to_uppercase();
    parse(&analysts.summary(&symbol, MODULES).await?, &symbol)
}

#[cfg(test)]
mod tests {
    use super::*;

    const AAPL: &[u8] = include_bytes!("../../fixtures/ownership-aapl.json");
    const NONE: &[u8] = include_bytes!("../../fixtures/analyst-none.json");

    #[test]
    fn parses_insiders_newest_first() {
        let o = parse(AAPL, "AAPL").unwrap().expect("ownership");
        assert_eq!(o.insiders.len(), 2);
        let first = &o.insiders[0];
        assert_eq!(first.name, "COOK TIMOTHY D");
        assert_eq!(first.relation.as_deref(), Some("Chief Executive Officer"));
        assert_eq!(first.text, "Sale at price 230.00 per share.");
        assert_eq!((first.shares, first.value, first.date), (Some(50000.0), Some(11500000.0), Some(1790000000)));
        assert_eq!(o.insiders[1].text, "");
        assert_eq!(o.insiders[1].value, None);
    }

    #[test]
    fn parses_holders_and_breakdown() {
        let o = parse(AAPL, "AAPL").unwrap().expect("ownership");
        assert_eq!(o.institutions.len(), 1);
        let h = &o.institutions[0];
        assert_eq!(h.name, "Vanguard Group Inc");
        assert_eq!((h.pct_held, h.shares, h.pct_change), (Some(0.0944), Some(1400000000.0), Some(0.0125)));
        assert_eq!(h.reported, Some(1788000000));
        assert_eq!(o.funds[0].name, "Vanguard Total Stock Market Index Fund");
        let b = o.breakdown.unwrap();
        assert_eq!((b.insiders_pct, b.institutions_pct, b.institutions_count), (Some(0.0206), Some(0.6511), Some(6500.0)));
    }

    #[test]
    fn no_data_is_none() {
        assert_eq!(parse(NONE, "SPY").unwrap(), None);
        let body = br#"{"quoteSummary":{"result":[{"insiderTransactions":{"transactions":[]},"majorHoldersBreakdown":{"maxAge":1}}],"error":null}}"#;
        assert_eq!(parse(body, "ETF").unwrap(), None);
    }

    #[test]
    fn auth_error_is_an_error() {
        let body = br#"{"quoteSummary":{"result":null,"error":{"code":"Unauthorized","description":"Invalid Crumb"}}}"#;
        assert_eq!(parse(body, "X").unwrap_err(), "Invalid Crumb");
    }
}
