//! Recent headlines for a symbol, from Yahoo's search endpoint.

use serde::Serialize;
use serde_json::Value;

use crate::quote::{get, SEARCH_URL};

/// How many headlines to ask for.
pub const COUNT: &str = "20";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Article {
    pub title: String,
    pub publisher: String,
    pub link: String,
    /// Unix seconds.
    pub published: i64,
}

/// Headlines with a title and an http(s) link, newest first.
pub fn parse(body: &[u8]) -> Result<Vec<Article>, String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("bad response: {e}"))?;
    let mut out: Vec<Article> = v["news"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        .filter_map(|n| {
            let title = n["title"].as_str()?.trim();
            let link = n["link"].as_str()?;
            if title.is_empty() || !is_web_url(link) {
                return None;
            }
            Some(Article {
                title: title.to_string(),
                publisher: n["publisher"].as_str().unwrap_or_default().to_string(),
                link: link.to_string(),
                published: n["providerPublishTime"].as_i64().unwrap_or(0),
            })
        })
        .collect();
    out.sort_by_key(|a| std::cmp::Reverse(a.published));
    Ok(out)
}

/// Only web links are handed to the system opener.
pub fn is_web_url(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://")
}

pub async fn fetch(client: &reqwest::Client, symbol: &str) -> Result<Vec<Article>, String> {
    let symbol = symbol.trim().to_uppercase();
    let body = get(client, SEARCH_URL, &[("q", &symbol), ("quotesCount", "0"), ("newsCount", COUNT)]).await?;
    parse(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    const AAPL: &[u8] = include_bytes!("../../fixtures/news-aapl.json");

    #[test]
    fn parses_newest_first() {
        let got = parse(AAPL).unwrap();
        assert_eq!(got.len(), 20);
        assert!(got.windows(2).all(|w| w[0].published >= w[1].published));
        assert!(got.iter().all(|a| !a.title.is_empty() && is_web_url(&a.link)));
        assert_eq!(got[0].publisher, "MT Newswires");
    }

    #[test]
    fn sorts_and_drops_bad_links() {
        let body = br#"{"news":[
            {"title":"old","publisher":"A","link":"https://a/1","providerPublishTime":10},
            {"title":"bad","publisher":"B","link":"javascript:alert(1)","providerPublishTime":30},
            {"title":"new","publisher":"C","link":"https://c/2","providerPublishTime":20},
            {"publisher":"D","link":"https://d/3","providerPublishTime":40}
        ]}"#;
        let titles: Vec<_> = parse(body).unwrap().into_iter().map(|a| a.title).collect();
        assert_eq!(titles, ["new", "old"]);
    }

    #[test]
    fn no_news_is_empty() {
        assert!(parse(br#"{"quotes":[]}"#).unwrap().is_empty());
    }
}
