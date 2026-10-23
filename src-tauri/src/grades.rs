use serde::Serialize;
use serde_json::Value;

use crate::analyst::Analysts;

const MODULES: &str = "upgradeDowngradeHistory";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RatingChange {
    pub date: i64,
    pub firm: String,
    pub action: String,
    pub from: Option<String>,
    pub to: String,
    pub target: Option<f64>,
}

fn grade(v: &Value) -> Option<String> {
    v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

pub fn parse(body: &[u8]) -> Result<Vec<RatingChange>, String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("bad response: {e}"))?;
    let err = &v["quoteSummary"]["error"];
    if err["code"].as_str() == Some("Not Found") {
        return Ok(Vec::new());
    }
    if let Some(desc) = err["description"].as_str() {
        return Err(desc.to_string());
    }
    let mut out: Vec<RatingChange> = v["quoteSummary"]["result"][0]["upgradeDowngradeHistory"]["history"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        .filter_map(|h| {
            let action = h["action"].as_str().filter(|a| matches!(*a, "init" | "up" | "down"))?;
            Some(RatingChange {
                date: h["epochGradeDate"].as_i64()?,
                firm: grade(&h["firm"])?,
                action: action.to_string(),
                from: grade(&h["fromGrade"]),
                to: grade(&h["toGrade"])?,
                target: h["currentPriceTarget"].as_f64().filter(|t| *t > 0.0),
            })
        })
        .collect();
    out.sort_by_key(|c| std::cmp::Reverse(c.date));
    Ok(out)
}

pub async fn fetch(analysts: &Analysts, symbol: &str) -> Result<Vec<RatingChange>, String> {
    let symbol = symbol.trim().to_uppercase();
    parse(&analysts.summary(&symbol, MODULES).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    const AAPL: &[u8] = include_bytes!("../../fixtures/ratings-aapl.json");

    #[test]
    fn keeps_new_and_changed_ratings() {
        let got = parse(AAPL).unwrap();
        assert_eq!(got.len(), 7);
        assert!(got.iter().all(|c| c.action == "up" || c.action == "down"));
        assert!(got.windows(2).all(|w| w[0].date >= w[1].date));
        let c = &got[0];
        assert_eq!(c.firm, "Loop Capital");
        assert_eq!(c.action, "down");
        assert_eq!((c.from.as_deref(), c.to.as_str()), (Some("Buy"), "Hold"));
        assert_eq!(c.target, Some(330.0));
    }

    #[test]
    fn initiations_have_no_prior_grade() {
        let body = br#"{"quoteSummary":{"result":[{"upgradeDowngradeHistory":{"history":[
            {"epochGradeDate":20,"firm":"A","toGrade":"Buy","fromGrade":"","action":"init","currentPriceTarget":0.0},
            {"epochGradeDate":30,"firm":"B","toGrade":"Buy","fromGrade":"Buy","action":"reit"}
        ]}}],"error":null}}"#;
        let got = parse(body).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!((got[0].from.as_deref(), got[0].target), (None, None));
    }

    #[test]
    fn no_coverage_is_empty() {
        let body = br#"{"quoteSummary":{"result":null,"error":{"code":"Not Found","description":"No fundamentals data found"}}}"#;
        assert!(parse(body).unwrap().is_empty());
        let body = br#"{"quoteSummary":{"result":null,"error":{"code":"Unauthorized","description":"Invalid Crumb"}}}"#;
        assert_eq!(parse(body).unwrap_err(), "Invalid Crumb");
    }
}
