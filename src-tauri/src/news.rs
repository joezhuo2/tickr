//! Recent headlines for a symbol, from Yahoo's search endpoint.

use serde::Serialize;
use serde_json::Value;

use crate::quote::{get, SEARCH_URL};
use crate::sentiment::{self, Sentiment};

/// How many headlines to ask for.
pub const COUNT: &str = "20";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Article {
    pub title: String,
    pub publisher: String,
    pub link: String,
    /// Unix seconds.
    pub published: i64,
    /// Tone of the title, from sentiment.rs.
    pub sentiment: Sentiment,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FeedArticle {
    #[serde(flatten)]
    pub article: Article,
    pub symbols: Vec<String>,
}

fn link_key(link: &str) -> String {
    let mut url = match reqwest::Url::parse(link) {
        Ok(url) => url,
        Err(_) => return link.split(['?', '#']).next().unwrap_or_default().trim_end_matches('/').to_string(),
    };
    url.set_query(None);
    url.set_fragment(None);
    url.as_str().trim_end_matches('/').to_string()
}

fn title_key(title: &str) -> String {
    title.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" ")
}

pub fn merge(lists: Vec<(String, Vec<Article>)>) -> Vec<FeedArticle> {
    let mut out: Vec<(FeedArticle, Vec<String>, Vec<String>)> = Vec::new();
    let mut symbols = Vec::new();
    for (symbol, articles) in lists {
        if !symbols.contains(&symbol) {
            symbols.push(symbol.clone());
        }
        for article in articles {
            let link = link_key(&article.link);
            let title = title_key(&article.title);
            let matches: Vec<_> = out.iter().enumerate()
                .filter(|(_, (_, links, titles))| links.contains(&link) || titles.contains(&title))
                .map(|(i, _)| i).collect();
            if let Some(&first) = matches.first() {
                for &i in matches.iter().skip(1).rev() {
                    let (other, links, titles) = out.remove(i);
                    out[first].0.symbols.extend(other.symbols);
                    out[first].1.extend(links);
                    out[first].2.extend(titles);
                }
                out[first].0.symbols.push(symbol.clone());
                out[first].1.push(link);
                out[first].2.push(title);
            } else {
                out.push((FeedArticle { article, symbols: vec![symbol.clone()] }, vec![link], vec![title]));
            }
        }
    }
    let mut out: Vec<_> = out.into_iter().map(|(mut item, _, _)| {
        item.symbols = symbols.iter().filter(|s| item.symbols.contains(s)).cloned().collect();
        item
    }).collect();
    out.sort_by_key(|a| std::cmp::Reverse(a.article.published));
    out
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
                sentiment: sentiment::classify(title),
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
    fn merges_links_titles_and_symbols_preserving_first_copy() {
        let first = parse(br#"{"news":[
            {"title":"Revenue rises!","publisher":"First","link":"https://EXAMPLE.com/Story/?source=a#top","providerPublishTime":10},
            {"title":"Newest story","link":"https://example.com/new","providerPublishTime":30}
        ]}"#).unwrap();
        let second = parse(br#"{"news":[
            {"title":"Different title","link":"https://example.com/Story#other","providerPublishTime":20},
            {"title":"  REVENUE -- rises  ","link":"https://other.com/story","providerPublishTime":40},
            {"title":"Case sensitive path","link":"https://example.com/story","providerPublishTime":5}
        ]}"#).unwrap();
        let got = merge(vec![("AAPL".into(), first), ("MSFT".into(), second.clone()), ("MSFT".into(), second)]);
        assert_eq!(got.len(), 3);
        assert_eq!(got[0].article.title, "Newest story");
        assert_eq!(got[1].article.title, "Revenue rises!");
        assert_eq!(got[1].article.publisher, "First");
        assert_eq!(got[1].article.published, 10);
        assert_eq!(got[1].symbols, ["AAPL", "MSFT"]);
        assert_eq!(got[2].symbols, ["MSFT"]);
        let json = serde_json::to_value(&got[1]).unwrap();
        assert_eq!(json["title"], "Revenue rises!");
        assert_eq!(json["symbols"], serde_json::json!(["AAPL", "MSFT"]));
    }

    #[test]
    fn merges_aliases_and_bridging_stories() {
        let list = parse(br#"{"news":[
            {"title":"First title","link":"https://a/one","providerPublishTime":30},
            {"title":"Second title","link":"https://b/two","providerPublishTime":20},
            {"title":"Second title","link":"https://a/one?tracking=1","providerPublishTime":10},
            {"title":"Third title","link":"https://b/two#top","providerPublishTime":5}
        ]}"#).unwrap();
        let got = merge(vec![("AAPL".into(), list)]);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].article.title, "First title");
        assert_eq!(got[0].symbols, ["AAPL"]);
        assert!(merge(Vec::new()).is_empty());
        assert!(merge(vec![("AAPL".into(), Vec::new())]).is_empty());
    }

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
    fn tags_each_headline() {
        let got = parse(AAPL).unwrap();
        let tone = |title: &str| got.iter().find(|a| a.title.starts_with(title)).unwrap().sentiment;
        assert_eq!(tone("Apple Says Some AT&T"), Sentiment::Negative);
        assert_eq!(tone("Apple (AAPL) Exceeds Market Returns"), Sentiment::Positive);
        assert_eq!(tone("Apple Tightens macOS"), Sentiment::Neutral);
        let json = serde_json::to_value(&got[0]).unwrap();
        assert_eq!(json["sentiment"], "negative");
    }

    #[test]
    fn no_news_is_empty() {
        assert!(parse(br#"{"quotes":[]}"#).unwrap().is_empty());
    }
}
