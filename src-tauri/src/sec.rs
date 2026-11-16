use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tokio::time::Instant;

use crate::state::lock;

const TICKERS_URL: &str = "https://www.sec.gov/files/company_tickers.json";
const SUBMISSIONS_URL: &str = "https://data.sec.gov/submissions/CIK";
const ARCHIVES_URL: &str = "https://www.sec.gov/Archives/edgar/data";
const TICKERS_TTL: i64 = 24 * 3600;
const FILINGS_TTL: i64 = 6 * 3600;
const GAP: Duration = Duration::from_millis(120);
const CAP: usize = 40;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Filing {
    pub form: String,
    pub date: String,
    pub description: Option<String>,
    pub url: String,
}

pub fn valid_email(s: &str) -> bool {
    let Some((user, domain)) = s.split_once('@') else { return false };
    s.len() <= 120
        && !user.is_empty()
        && !s.chars().any(|c| c.is_whitespace() || c.is_control())
        && !domain.contains('@')
        && domain.split('.').count() >= 2
        && domain.split('.').all(|p| !p.is_empty())
}

pub fn parse_tickers(body: &[u8]) -> Result<HashMap<String, u64>, String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("bad response: {e}"))?;
    let list = v.as_object().ok_or("bad response: not a ticker list")?;
    let mut out = HashMap::new();
    for e in list.values() {
        if let (Some(t), Some(cik)) = (e["ticker"].as_str(), e["cik_str"].as_u64()) {
            out.entry(t.to_uppercase()).or_insert(cik);
        }
    }
    Ok(out)
}

fn col<'a>(recent: &'a Value, name: &str, i: usize) -> Option<&'a str> {
    recent[name][i].as_str().filter(|s| !s.is_empty())
}

pub fn parse_filings(body: &[u8], cik: u64) -> Result<Vec<Filing>, String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("bad response: {e}"))?;
    let recent = &v["filings"]["recent"];
    let forms = recent["form"].as_array().ok_or("bad response: no filings")?;
    Ok(forms
        .iter()
        .enumerate()
        .filter_map(|(i, form)| {
            let acc = col(recent, "accessionNumber", i)?;
            let flat = acc.replace('-', "");
            let url = match col(recent, "primaryDocument", i) {
                Some(doc) => format!("{ARCHIVES_URL}/{cik}/{flat}/{doc}"),
                None => format!("{ARCHIVES_URL}/{cik}/{flat}/{acc}-index.htm"),
            };
            Some(Filing {
                form: form.as_str()?.to_string(),
                date: col(recent, "filingDate", i)?.to_string(),
                description: col(recent, "primaryDocDescription", i).map(str::to_string),
                url,
            })
        })
        .take(CAP)
        .collect())
}

#[derive(Default)]
pub struct Sec {
    gate: tokio::sync::Mutex<Option<Instant>>,
    tickers: Mutex<Option<(i64, HashMap<String, u64>)>>,
    filings: Mutex<HashMap<u64, (i64, Vec<Filing>)>>,
}

impl Sec {
    async fn request(&self, client: &reqwest::Client, email: &str, url: &str) -> Result<Vec<u8>, String> {
        let mut last = self.gate.lock().await;
        if let Some(t) = *last {
            tokio::time::sleep_until(t + GAP).await;
        }
        let res = client.get(url).header(reqwest::header::USER_AGENT, format!("tickr {email}")).send().await;
        *last = Some(Instant::now());
        let res = res.map_err(|e| format!("network: {e}"))?;
        let status = res.status();
        let body = res.bytes().await.map_err(|e| format!("network: {e}"))?;
        if status.is_success() {
            Ok(body.to_vec())
        } else if matches!(status.as_u16(), 403 | 429) {
            Err(format!("SEC refused the request (HTTP {status}); check the contact email or try again later"))
        } else {
            Err(format!("HTTP {status}"))
        }
    }

    async fn cik(&self, client: &reqwest::Client, email: &str, symbol: &str, now: i64) -> Result<Option<u64>, String> {
        let cached = lock(&self.tickers).as_ref().filter(|(at, _)| (0..TICKERS_TTL).contains(&(now - at))).map(|(_, m)| m.get(symbol).copied());
        if let Some(cik) = cached {
            return Ok(cik);
        }
        let map = parse_tickers(&self.request(client, email, TICKERS_URL).await?)?;
        let cik = map.get(symbol).copied();
        *lock(&self.tickers) = Some((now, map));
        Ok(cik)
    }

    pub async fn get(&self, client: &reqwest::Client, email: &str, symbol: &str, now: i64, force: bool) -> Result<Option<Vec<Filing>>, String> {
        if !valid_email(email) {
            return Err("SEC contact email is not set".into());
        }
        let Some(cik) = self.cik(client, email, &symbol.trim().to_uppercase(), now).await? else { return Ok(None) };
        if !force {
            if let Some((_, list)) = lock(&self.filings).get(&cik).filter(|(at, _)| (0..FILINGS_TTL).contains(&(now - at))) {
                return Ok(Some(list.clone()));
            }
        }
        let url = format!("{SUBMISSIONS_URL}{cik:010}.json");
        let list = parse_filings(&self.request(client, email, &url).await?, cik)?;
        lock(&self.filings).insert(cik, (now, list.clone()));
        Ok(Some(list))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TICKERS: &[u8] = include_bytes!("../../fixtures/sec-tickers.json");
    const SUBMISSIONS: &[u8] = include_bytes!("../../fixtures/sec-submissions.json");

    #[test]
    fn maps_tickers_to_ciks() {
        let m = parse_tickers(TICKERS).unwrap();
        assert_eq!(m.get("AAPL"), Some(&320193));
        assert_eq!(m.get("MSFT"), Some(&789019));
        assert_eq!(m.get("SPY"), None);
        assert!(parse_tickers(b"[]").is_err());
    }

    #[test]
    fn lists_recent_filings_with_document_links() {
        let f = parse_filings(SUBMISSIONS, 320193).unwrap();
        assert_eq!(f.len(), 2);
        assert_eq!((f[0].form.as_str(), f[0].date.as_str()), ("10-Q", "2026-07-31"));
        assert_eq!(f[0].description.as_deref(), Some("10-Q"));
        assert_eq!(f[0].url, "https://www.sec.gov/Archives/edgar/data/320193/000032019326000090/aapl-20260627.htm");
        assert_eq!(f[1].description, None);
        assert_eq!(f[1].url, "https://www.sec.gov/Archives/edgar/data/320193/000032019326000080/0000320193-26-000080-index.htm");
        assert!(parse_filings(b"{}", 1).is_err());
    }

    #[test]
    fn email_must_look_like_an_address() {
        assert!(valid_email("me@example.com"));
        assert!(!valid_email(""));
        assert!(!valid_email("me@example"));
        assert!(!valid_email("me example@x.com"));
        assert!(!valid_email("@example.com"));
        assert!(!valid_email("a@b@c.com"));
        assert!(!valid_email("me@.com"));
    }

    #[test]
    fn needs_an_email_before_any_request() {
        let sec = Sec::default();
        let client = reqwest::Client::new();
        let r = tauri::async_runtime::block_on(sec.get(&client, "", "AAPL", 0, false));
        assert_eq!(r.unwrap_err(), "SEC contact email is not set");
    }

    #[test]
    fn serves_fresh_cache_without_network() {
        let sec = Sec::default();
        *lock(&sec.tickers) = Some((1000, HashMap::from([("AAPL".to_string(), 1)])));
        lock(&sec.filings).insert(1, (1000, Vec::new()));
        let client = reqwest::Client::new();
        let hit = tauri::async_runtime::block_on(sec.get(&client, "me@example.com", "aapl", 1000 + FILINGS_TTL - 1, false));
        assert_eq!(hit.unwrap(), Some(Vec::new()));
    }
}
