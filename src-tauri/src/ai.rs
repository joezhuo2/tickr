//! Optional AI headline tone through an OpenAI-compatible chat endpoint.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::news::Article;
use crate::sentiment::Sentiment;
use crate::state::{lock, Shared};

const KEY_BASE_URL: &str = "TICKR_AI_BASE_URL";
const KEY_MODEL: &str = "TICKR_AI_MODEL";
const KEY_API_KEY: &str = "TICKR_AI_API_KEY";

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AiConfig {
    pub base_url: String,
    pub model: String,
    pub api_key: String,
}

impl AiConfig {
    /// The API key may stay empty for local endpoints.
    pub fn configured(&self) -> bool {
        !self.base_url.trim().is_empty() && !self.model.trim().is_empty()
    }
}

pub fn env_path() -> PathBuf {
    crate::settings::config_dir().join(".env.local")
}

fn parse_line(line: &str) -> Option<(&str, String)> {
    let line = line.trim();
    if line.starts_with('#') {
        return None;
    }
    let line = line.strip_prefix("export ").unwrap_or(line);
    let (key, value) = line.split_once('=')?;
    let value = value.trim();
    let parsed = match value.chars().next() {
        Some(q @ ('"' | '\'')) => {
            let inner = &value[1..];
            let mut out = String::new();
            let mut chars = inner.chars();
            while let Some(c) = chars.next() {
                if c == q {
                    break;
                }
                if c == '\u{5c}' && q == '"' {
                    match chars.next() {
                        Some(n @ ('"' | '\u{5c}')) => out.push(n),
                        Some(n) => {
                            out.push('\u{5c}');
                            out.push(n);
                        }
                        None => out.push('\u{5c}'),
                    }
                } else {
                    out.push(c);
                }
            }
            out
        }
        _ => value.split(" #").next().unwrap_or_default().trim_end().to_string(),
    };
    Some((key.trim(), parsed))
}

pub fn env_get(text: &str, key: &str) -> Option<String> {
    text.lines().filter_map(parse_line).find(|(k, _)| *k == key).map(|(_, v)| v)
}

fn format_value(value: &str) -> String {
    let plain = value.chars().all(|c| !c.is_whitespace() && !matches!(c, '"' | '\'' | '#' | '\u{5c}'));
    if plain {
        value.to_string()
    } else {
        format!("\"{}\"", value.replace('\u{5c}', "\\\\").replace('"', "\\\""))
    }
}

/// Replaces the first line for `key` in place, or appends one; other lines are kept.
pub fn env_set(text: &str, key: &str, value: &str) -> String {
    let nl = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let new_line = format!("{key}={}", format_value(value));
    let mut out = String::with_capacity(text.len() + new_line.len() + 2);
    let mut found = false;
    for raw in text.split_inclusive('\n') {
        let body = raw.trim_end_matches(['\r', '\n']);
        if !found && parse_line(body).is_some_and(|(k, _)| k == key) {
            found = true;
            out.push_str(&new_line);
            out.push_str(&raw[body.len()..]);
        } else {
            out.push_str(raw);
        }
    }
    if !found {
        if !out.is_empty() && !out.ends_with('\n') {
            out.push_str(nl);
        }
        out.push_str(&new_line);
        out.push_str(nl);
    }
    out
}

pub fn load_config(path: &Path) -> AiConfig {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let get = |k| env_get(&text, k).unwrap_or_default();
    AiConfig { base_url: get(KEY_BASE_URL), model: get(KEY_MODEL), api_key: get(KEY_API_KEY) }
}

pub fn save_config(path: &Path, cfg: &AiConfig) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut text = std::fs::read_to_string(path).unwrap_or_default();
    for (k, v) in [(KEY_BASE_URL, &cfg.base_url), (KEY_MODEL, &cfg.model), (KEY_API_KEY, &cfg.api_key)] {
        text = env_set(&text, k, v.trim());
    }
    let tmp = path.with_extension("local.tmp");
    std::fs::write(&tmp, text)?;
    std::fs::rename(tmp, path)
}

const SYSTEM_PROMPT: &str = "You classify stock news headlines. For each numbered headline, judge its likely effect on the named stock's price or tone: \"positive\", \"neutral\" or \"negative\". Reply with only a JSON array of those strings, one per headline, in order. No prose, no code fences.";

pub fn request_body(model: &str, symbol: &str, titles: &[&str]) -> Value {
    let list: String = titles.iter().enumerate().map(|(i, t)| format!("{}. {t}
", i + 1)).collect();
    json!({
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": format!("Stock: {symbol}
Headlines:
{list}")},
        ],
    })
}

pub fn chat_url(base_url: &str) -> String {
    format!("{}/chat/completions", base_url.trim().trim_end_matches('/'))
}

pub fn parse_reply(body: &[u8], expected: usize) -> Result<Vec<Sentiment>, String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("bad response: {e}"))?;
    let content = v["choices"][0]["message"]["content"].as_str().ok_or("no message in response")?;
    let (start, end) = content.find('[').zip(content.rfind(']')).filter(|(s, e)| s < e).ok_or("no JSON array in reply")?;
    let labels: Vec<String> = serde_json::from_str(&content[start..=end]).map_err(|e| format!("bad array: {e}"))?;
    if labels.len() != expected {
        return Err(format!("expected {expected} labels, got {}", labels.len()));
    }
    labels
        .iter()
        .map(|l| match l.trim().to_lowercase().as_str() {
            "positive" => Ok(Sentiment::Positive),
            "negative" => Ok(Sentiment::Negative),
            "neutral" => Ok(Sentiment::Neutral),
            other => Err(format!("unknown label {other:?}")),
        })
        .collect()
}

pub async fn classify(client: &reqwest::Client, cfg: &AiConfig, symbol: &str, titles: &[&str]) -> Result<Vec<Sentiment>, String> {
    let mut req = client
        .post(chat_url(&cfg.base_url))
        .timeout(Duration::from_secs(20))
        .header("content-type", "application/json")
        .body(request_body(cfg.model.trim(), symbol, titles).to_string());
    if !cfg.api_key.trim().is_empty() {
        req = req.bearer_auth(cfg.api_key.trim());
    }
    let resp = req.send().await.map_err(|e| format!("request failed: {}", e.without_url()))?;
    let status = resp.status();
    let body = resp.bytes().await.map_err(|e| format!("read failed: {}", e.without_url()))?;
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    parse_reply(&body, titles.len())
}

const CACHE_CAP: usize = 2000;

pub fn cache_key(model: &str, link: &str) -> String {
    format!("{model}
{link}")
}

pub fn cache_path() -> PathBuf {
    crate::settings::cache_dir().join("ai-sentiment.json")
}

#[derive(Debug, Default)]
pub struct SentimentCache {
    map: HashMap<String, Sentiment>,
    order: VecDeque<String>,
}

impl SentimentCache {
    pub fn load(path: &Path) -> Self {
        let entries: Vec<(String, Sentiment)> =
            std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        let mut c = Self::default();
        c.insert_all(entries);
        c
    }

    pub fn get(&self, key: &str) -> Option<Sentiment> {
        self.map.get(key).copied()
    }

    pub fn insert_all(&mut self, items: impl IntoIterator<Item = (String, Sentiment)>) {
        for (k, v) in items {
            if self.map.insert(k.clone(), v).is_some() {
                self.order.retain(|o| *o != k);
            }
            self.order.push_back(k);
        }
        while self.order.len() > CACHE_CAP {
            if let Some(old) = self.order.pop_front() {
                self.map.remove(&old);
            }
        }
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let entries: Vec<(&String, Sentiment)> = self.order.iter().map(|k| (k, self.map[k])).collect();
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec(&entries)?)?;
        std::fs::rename(tmp, path)
    }
}

/// Replaces keyword tones with AI tones for `articles`; any failure leaves them as they are.
pub async fn apply(shared: &Shared, symbol: &str, articles: &mut [Article]) {
    if !lock(&shared.settings).ai_news {
        return;
    }
    let cfg = load_config(&env_path());
    if !cfg.configured() {
        return;
    }
    let model = cfg.model.trim().to_string();
    let mut missing = Vec::new();
    {
        let mut guard = lock(&shared.ai_cache);
        let cache = guard.get_or_insert_with(|| SentimentCache::load(&cache_path()));
        for (i, a) in articles.iter_mut().enumerate() {
            match cache.get(&cache_key(&model, &a.link)) {
                Some(s) => a.sentiment = s,
                None => missing.push(i),
            }
        }
    }
    if missing.is_empty() {
        return;
    }
    let titles: Vec<&str> = missing.iter().map(|&i| articles[i].title.as_str()).collect();
    let tones = match classify(&shared.http, &cfg, symbol, &titles).await {
        Ok(t) => t,
        Err(e) => {
            log::warn!("ai news {symbol}: {e}");
            return;
        }
    };
    let mut entries = Vec::with_capacity(missing.len());
    for (&i, tone) in missing.iter().zip(tones) {
        articles[i].sentiment = tone;
        entries.push((cache_key(&model, &articles[i].link), tone));
    }
    let mut guard = lock(&shared.ai_cache);
    if let Some(cache) = guard.as_mut() {
        cache.insert_all(entries);
        if let Err(e) = cache.save(&cache_path()) {
            log::warn!("save ai cache: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_plain_quoted_and_crlf_values() {
        let text = "# c\r\nA=1\r\nexport B = \"x y # z\" \r\nC='q\"r'\r\nD=v # note\r\nE=\"a\\\"b\"\r\n";
        assert_eq!(env_get(text, "A").as_deref(), Some("1"));
        assert_eq!(env_get(text, "B").as_deref(), Some("x y # z"));
        assert_eq!(env_get(text, "C").as_deref(), Some("q\"r"));
        assert_eq!(env_get(text, "D").as_deref(), Some("v"));
        assert_eq!(env_get(text, "E").as_deref(), Some("a\"b"));
        assert_eq!(env_get(text, "#"), None);
        assert_eq!(env_get(text, "Z"), None);
    }

    #[test]
    fn set_updates_in_place_and_keeps_other_lines() {
        let text = "# keep\nA=1\nB=2\n";
        assert_eq!(env_set(text, "A", "9"), "# keep\nA=9\nB=2\n");
        assert_eq!(env_set(text, "C", "3"), "# keep\nA=1\nB=2\nC=3\n");
        assert_eq!(env_set("A=1", "B", "2"), "A=1\nB=2\n");
        assert_eq!(env_set("A=1\r\nB=2\r\n", "A", "x"), "A=x\r\nB=2\r\n");
        assert_eq!(env_set("A=1\r\n", "B", "2"), "A=1\r\nB=2\r\n");
        assert_eq!(env_set("", "A", "1"), "A=1\n");
    }

    #[test]
    fn set_quotes_awkward_values_and_roundtrips() {
        for v in ["", "a b", "p#q", "say \"hi\"", "back\\slash", "it's"] {
            let text = env_set("X=1\n", "K", v);
            assert_eq!(env_get(&text, "K").as_deref(), Some(v), "{v:?}");
        }
    }

    #[test]
    fn config_roundtrip_preserves_foreign_lines() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("sub/.env.local");
        let cfg = AiConfig { base_url: "http://localhost:11434/v1".into(), model: "llama3".into(), api_key: String::new() };
        assert!(!load_config(&p).configured());
        save_config(&p, &cfg).unwrap();
        assert_eq!(load_config(&p), cfg);
        std::fs::write(&p, format!("# mine\nOTHER=1\n{}", std::fs::read_to_string(&p).unwrap())).unwrap();
        let next = AiConfig { model: "gpt".into(), api_key: "sk-1".into(), ..cfg };
        save_config(&p, &next).unwrap();
        let text = std::fs::read_to_string(&p).unwrap();
        assert!(text.starts_with("# mine\nOTHER=1\n"));
        assert_eq!(load_config(&p), next);
        assert!(next.configured());
    }

    fn reply(content: &str) -> Vec<u8> {
        json!({"choices": [{"message": {"content": content}}]}).to_string().into_bytes()
    }

    #[test]
    fn builds_request() {
        let b = request_body("m", "AAPL", &["Up", "Down"]);
        assert_eq!(b["model"], "m");
        assert_eq!(b["temperature"], 0);
        let user = b["messages"][1]["content"].as_str().unwrap();
        assert!(user.contains("AAPL") && user.contains("1. Up
2. Down
"));
        assert_eq!(chat_url(" http://h/v1// "), "http://h/v1/chat/completions");
    }

    #[test]
    fn parses_fenced_and_chatty_replies() {
        use Sentiment::*;
        assert_eq!(parse_reply(&reply("[\"positive\",\"Neutral\"]"), 2).unwrap(), [Positive, Neutral]);
        assert_eq!(parse_reply(&reply("```json
[\"negative\"]
```"), 1).unwrap(), [Negative]);
        assert_eq!(parse_reply(&reply("Sure: [\"neutral\"] done"), 1).unwrap(), [Neutral]);
    }

    #[test]
    fn rejects_bad_replies() {
        assert!(parse_reply(&reply("[\"positive\"]"), 2).is_err());
        assert!(parse_reply(&reply("[\"great\"]"), 1).is_err());
        assert!(parse_reply(&reply("no array"), 1).is_err());
        assert!(parse_reply(b"{}", 1).is_err());
        assert!(parse_reply(b"nope", 1).is_err());
    }

    #[test]
    fn cache_roundtrips_and_caps_oldest() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("c/ai.json");
        let mut c = SentimentCache::load(&p);
        c.insert_all((0..CACHE_CAP + 5).map(|i| (format!("k{i}"), Sentiment::Positive)));
        c.insert_all([("k10".to_string(), Sentiment::Negative)]);
        assert_eq!(c.get("k0"), None);
        assert_eq!(c.get("k10"), Some(Sentiment::Negative));
        c.save(&p).unwrap();
        let back = SentimentCache::load(&p);
        assert_eq!(back.get("k10"), Some(Sentiment::Negative));
        assert_eq!(back.get(&format!("k{}", CACHE_CAP + 4)), Some(Sentiment::Positive));
        assert_eq!(back.map.len(), CACHE_CAP);
        assert_ne!(cache_key("a", "l"), cache_key("b", "l"));
    }
}
