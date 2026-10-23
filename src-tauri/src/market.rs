use serde::Serialize;
use serde_json::Value;

use crate::analyst::Analysts;

const QUOTE_URL: &str = "https://query1.finance.yahoo.com/v7/finance/quote";
const SCREENER_URL: &str = "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved";
const MOVERS: &str = "5";

const INDICES: &[(&str, &str)] =
    &[("^GSPC", "S&P 500"), ("^IXIC", "Nasdaq"), ("^DJI", "Dow"), ("^RUT", "Russell 2000"), ("^VIX", "VIX")];
const MACRO: &[(&str, &str)] = &[
    ("^TNX", "10y Treasury yield"),
    ("CL=F", "Crude oil"),
    ("GC=F", "Gold"),
    ("DX-Y.NYB", "US dollar index"),
    ("BTC-USD", "Bitcoin"),
];
const SECTORS: &[(&str, &str)] = &[
    ("XLK", "Technology"),
    ("XLF", "Financials"),
    ("XLV", "Health care"),
    ("XLY", "Consumer discretionary"),
    ("XLC", "Communication"),
    ("XLI", "Industrials"),
    ("XLP", "Consumer staples"),
    ("XLE", "Energy"),
    ("XLU", "Utilities"),
    ("XLRE", "Real estate"),
    ("XLB", "Materials"),
];

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Mover {
    pub symbol: String,
    pub name: String,
    pub price: Option<f64>,
    pub change_pct: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Market {
    pub indices: Vec<Mover>,
    pub macros: Vec<Mover>,
    pub sectors: Vec<Mover>,
    pub gainers: Vec<Mover>,
    pub losers: Vec<Mover>,
}

fn num(v: &Value) -> Option<f64> {
    v.as_f64().filter(|x| x.is_finite())
}

fn mover(q: &Value, name: Option<&str>) -> Option<Mover> {
    let symbol = q["symbol"].as_str()?;
    let name = name.or(q["shortName"].as_str()).or(q["longName"].as_str()).unwrap_or(symbol);
    Some(Mover {
        symbol: symbol.to_string(),
        name: name.to_string(),
        price: num(&q["regularMarketPrice"]),
        change_pct: num(&q["regularMarketChangePercent"]),
    })
}

fn json(body: &[u8]) -> Result<Value, String> {
    serde_json::from_slice(body).map_err(|e| format!("bad response: {e}"))
}

pub fn parse_quotes(body: &[u8], names: &[(&str, &str)]) -> Result<Vec<Mover>, String> {
    let v = json(body)?;
    let quotes = v["quoteResponse"]["result"].as_array().ok_or("no quotes")?;
    Ok(names
        .iter()
        .filter_map(|(sym, name)| mover(quotes.iter().find(|q| q["symbol"] == *sym)?, Some(name)))
        .collect())
}

pub fn parse_screener(body: &[u8]) -> Result<Vec<Mover>, String> {
    let v = json(body)?;
    let quotes = v["finance"]["result"][0]["quotes"].as_array().ok_or("no movers")?;
    Ok(quotes.iter().filter_map(|q| mover(q, None)).collect())
}

pub async fn fetch(analysts: &Analysts) -> Result<Market, String> {
    let symbols = [INDICES, MACRO, SECTORS].concat().iter().map(|(s, _)| *s).collect::<Vec<_>>().join(",");
    let q = [("symbols", symbols.as_str())];
    let up = [("scrIds", "day_gainers"), ("count", MOVERS)];
    let down = [("scrIds", "day_losers"), ("count", MOVERS)];
    let (quotes, gainers, losers) = tokio::try_join!(
        analysts.request(QUOTE_URL, &q),
        analysts.request(SCREENER_URL, &up),
        analysts.request(SCREENER_URL, &down),
    )?;
    let mut sectors = parse_quotes(&quotes, SECTORS)?;
    sectors.sort_by(|a, b| b.change_pct.unwrap_or(f64::MIN).total_cmp(&a.change_pct.unwrap_or(f64::MIN)));
    Ok(Market {
        indices: parse_quotes(&quotes, INDICES)?,
        macros: parse_quotes(&quotes, MACRO)?,
        sectors,
        gainers: parse_screener(&gainers)?,
        losers: parse_screener(&losers)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const QUOTES: &[u8] = include_bytes!("../../fixtures/market-quotes.json");
    const GAINERS: &[u8] = include_bytes!("../../fixtures/market-gainers.json");

    #[test]
    fn quotes_follow_the_list_and_skip_missing() {
        let got = parse_quotes(QUOTES, &[("^VIX", "VIX"), ("NOPE", "x"), ("^GSPC", "S&P 500")]).unwrap();
        let syms: Vec<_> = got.iter().map(|m| m.symbol.as_str()).collect();
        assert_eq!(syms, ["^VIX", "^GSPC"]);
        assert_eq!(got[1].name, "S&P 500");
        assert_eq!(got[1].price, Some(7663.43));
        assert!((got[1].change_pct.unwrap() + 1.2084272).abs() < 1e-9);
    }

    #[test]
    fn screener_movers() {
        let got = parse_screener(GAINERS).unwrap();
        assert_eq!(got.len(), 5);
        assert!(got.iter().all(|m| m.change_pct.unwrap() > 0.0 && !m.name.is_empty()));
    }

    #[test]
    #[ignore]
    fn live_market() {
        let m = tauri::async_runtime::block_on(fetch(&Analysts::new())).unwrap();
        assert_eq!(m.indices.len(), INDICES.len(), "{m:?}");
        assert_eq!(m.sectors.len(), SECTORS.len());
        assert!(m.sectors.windows(2).all(|w| w[0].change_pct >= w[1].change_pct));
        assert_eq!((m.gainers.len(), m.losers.len()), (5, 5));
    }

    #[test]
    fn bad_bodies_are_errors() {
        assert!(parse_quotes(b"{}", INDICES).is_err());
        assert!(parse_screener(br#"{"finance":{"result":null}}"#).is_err());
    }
}
