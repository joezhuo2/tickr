
use futures_util::future::try_join_all;
use serde::Serialize;
use serde_json::Value;

use crate::analyst::Analysts;
use crate::market::QUOTE_URL;

// shortcut: static constituent list, refresh when the index changes
const LIST: &str = include_str!("sp500.txt");
const CHUNK: usize = 100;

type Row = (&'static str, &'static str, &'static str);

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HeatQuote {
    pub symbol: String,
    pub name: String,
    pub sector: String,
    pub price: f64,
    pub change_pct: f64,
    pub market_cap: f64,
}

fn constituents() -> Vec<Row> {
    let mut sector = "";
    LIST.lines()
        .filter_map(|l| {
            let l = l.trim();
            if let Some(s) = l.strip_prefix('#') {
                sector = s;
                return None;
            }
            let (symbol, name) = l.split_once('|')?;
            Some((symbol, name, sector))
        })
        .collect()
}

fn parse(body: &[u8], rows: &[Row]) -> Result<Vec<HeatQuote>, String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("bad response: {e}"))?;
    let quotes = v["quoteResponse"]["result"].as_array().ok_or("no quotes")?;
    let finite = |v: &Value| v.as_f64().filter(|x| x.is_finite());
    Ok(rows
        .iter()
        .filter_map(|(symbol, name, sector)| {
            let q = quotes.iter().find(|q| q["symbol"] == *symbol)?;
            Some(HeatQuote {
                symbol: symbol.to_string(),
                name: name.to_string(),
                sector: sector.to_string(),
                price: finite(&q["regularMarketPrice"])?,
                change_pct: finite(&q["regularMarketChangePercent"])?,
                market_cap: finite(&q["marketCap"]).filter(|c| *c > 0.0)?,
            })
        })
        .collect())
}

pub async fn fetch(analysts: &Analysts) -> Result<Vec<HeatQuote>, String> {
    let rows = constituents();
    let bodies = try_join_all(rows.chunks(CHUNK).map(|chunk| {
        let symbols = chunk.iter().map(|(s, _, _)| *s).collect::<Vec<_>>().join(",");
        async move { analysts.request(QUOTE_URL, &[("symbols", symbols.as_str())]).await }
    }))
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for (chunk, body) in rows.chunks(CHUNK).zip(bodies) {
        out.extend(parse(&body, chunk)?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_is_unique_and_sectored() {
        let rows = constituents();
        assert!(rows.len() > 480);
        assert!(rows.iter().all(|(s, n, g)| !s.is_empty() && !n.is_empty() && !g.is_empty()));
        assert_eq!(rows.iter().map(|r| r.0).collect::<std::collections::HashSet<_>>().len(), rows.len());
    }

    #[test]
    fn parse_skips_missing_quotes() {
        let rows: Vec<Row> = vec![("AAA", "Alpha", "Tech"), ("BBB", "Beta", "Tech"), ("CCC", "Gamma", "Tech")];
        let body = br#"{"quoteResponse":{"result":[
            {"symbol":"AAA","regularMarketPrice":10.5,"regularMarketChangePercent":-1.5,"marketCap":2e9},
            {"symbol":"BBB","regularMarketPrice":3.0,"regularMarketChangePercent":0.5}]}}"#;
        let got = parse(body, &rows).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].symbol, "AAA");
        assert_eq!(got[0].market_cap, 2e9);
        assert!(parse(b"{}", &rows).is_err());
    }
}
