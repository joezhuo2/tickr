use serde::Serialize;
use serde_json::Value;

use crate::analyst::Analysts;

const URL: &str = "https://query1.finance.yahoo.com/v7/finance/options";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Contract {
    pub symbol: String,
    pub strike: f64,
    pub last: Option<f64>,
    pub bid: Option<f64>,
    pub ask: Option<f64>,
    pub change: Option<f64>,
    pub change_pct: Option<f64>,
    pub volume: Option<f64>,
    pub open_interest: Option<f64>,
    pub iv: Option<f64>,
    pub last_trade: Option<i64>,
    pub itm: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Options {
    pub price: Option<f64>,
    pub expirations: Vec<i64>,
    pub expiry: Option<i64>,
    pub calls: Vec<Contract>,
    pub puts: Vec<Contract>,
}

fn num(v: &Value) -> Option<f64> {
    v.as_f64().filter(|x| x.is_finite())
}

fn contracts(list: &Value, itm: impl Fn(f64) -> bool) -> Vec<Contract> {
    let mut out: Vec<Contract> = list
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| {
            let strike = num(&c["strike"])?;
            Some(Contract {
                symbol: c["contractSymbol"].as_str().unwrap_or_default().to_string(),
                strike,
                last: num(&c["lastPrice"]),
                bid: num(&c["bid"]),
                ask: num(&c["ask"]),
                change: num(&c["change"]),
                change_pct: num(&c["percentChange"]),
                volume: num(&c["volume"]),
                open_interest: num(&c["openInterest"]),
                iv: num(&c["impliedVolatility"]),
                last_trade: c["lastTradeDate"].as_i64(),
                itm: c["inTheMoney"].as_bool().unwrap_or_else(|| itm(strike)),
            })
        })
        .collect();
    out.sort_by(|a, b| a.strike.total_cmp(&b.strike));
    out
}

pub fn parse(body: &[u8]) -> Result<Options, String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("bad response: {e}"))?;
    let r = &v["optionChain"]["result"][0];
    if r.is_null() {
        return Err("no options".into());
    }
    let price = num(&r["quote"]["regularMarketPrice"]);
    let p = price.unwrap_or(f64::NAN);
    let chain = &r["options"][0];
    Ok(Options {
        price,
        expirations: r["expirationDates"].as_array().into_iter().flatten().filter_map(Value::as_i64).collect(),
        expiry: chain["expirationDate"].as_i64(),
        calls: contracts(&chain["calls"], |k| k < p),
        puts: contracts(&chain["puts"], |k| k > p),
    })
}

pub async fn fetch(analysts: &Analysts, symbol: &str, date: Option<i64>) -> Result<Options, String> {
    let symbol = symbol.trim().to_uppercase();
    let date = date.map(|d| d.to_string());
    let mut q = Vec::new();
    if let Some(d) = &date {
        q.push(("date", d.as_str()));
    }
    parse(&analysts.request(&format!("{URL}/{symbol}"), &q).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    const AAPL: &[u8] = include_bytes!("../../fixtures/options-aapl.json");

    #[test]
    fn parses_chain() {
        let o = parse(AAPL).unwrap();
        assert_eq!(o.price, Some(205.5));
        assert_eq!(o.expirations, [1792540800, 1793145600]);
        assert_eq!(o.expiry, Some(1792540800));
        assert_eq!((o.calls.len(), o.puts.len()), (2, 1));
        let c = &o.calls[0];
        assert_eq!((c.strike, c.last, c.volume, c.open_interest), (200.0, Some(8.1), Some(120.0), Some(3400.0)));
        assert_eq!(c.last_trade, Some(1792500000));
        assert!(c.itm && !o.calls[1].itm);
        assert_eq!(o.calls[1].volume, None);
    }

    #[test]
    fn itm_falls_back_to_strike() {
        let o = parse(AAPL).unwrap();
        assert!(!o.puts[0].itm);
        let b = br#"{"optionChain":{"result":[{"quote":{"regularMarketPrice":10},"options":[{"puts":[{"strike":12}]}]}]}}"#;
        assert!(parse(b).unwrap().puts[0].itm);
    }

    #[test]
    fn bad_bodies_are_errors() {
        assert!(parse(b"{}").is_err());
        assert!(parse(br#"{"optionChain":{"result":[]}}"#).is_err());
    }

    #[test]
    #[ignore]
    fn live_options() {
        let o = tauri::async_runtime::block_on(fetch(&Analysts::new(), "AAPL", None)).unwrap();
        assert!(!o.expirations.is_empty() && !o.calls.is_empty(), "{o:?}");
    }
}
