//! Upcoming market events for the next week: Yahoo headlines in, AI-picked events out.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::ai::{self, AiConfig};
use crate::analysis::Confidence;
use crate::quote::{get, SEARCH_URL};
use crate::sentiment::Sentiment;
use crate::state::now_secs;

const TTL_SECS: i64 = 6 * 3600;
const QUERIES: [&str; 4] = ["stock market", "Federal Reserve", "economy", "earnings week"];
const NEWS_COUNT: &str = "15";
const MAX_HEADLINES: usize = 50;
const DAY: i64 = 86400;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Impact {
    pub name: String,
    pub kind: String,
    pub score: i32,
    pub confidence: i32,
    pub confidence_label: Confidence,
    pub reasoning: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MarketEvent {
    pub id: String,
    pub name: String,
    pub date: String,
    pub time: Option<String>,
    pub tone: Sentiment,
    pub summary: String,
    pub impacts: Vec<Impact>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventsReport {
    /// Unix seconds.
    pub generated: i64,
    pub events: Vec<MarketEvent>,
}

pub fn cache_path() -> PathBuf {
    crate::settings::cache_dir().join("market-events.json")
}

pub fn fresh(generated: i64, now: i64) -> bool {
    (0..TTL_SECS).contains(&(now - generated))
}

/// "YYYY-MM-DD" in UTC.
fn ymd(secs: i64) -> String {
    let z = secs.div_euclid(DAY) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    format!("{:04}-{m:02}-{d:02}", yoe + era * 400 + i64::from(m <= 2))
}

/// Events dated before this are past; one day of slack covers time zones.
fn cutoff(now: i64) -> String {
    ymd(now - DAY)
}

fn valid_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}

fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars().flat_map(char::to_lowercase) {
        if c.is_alphanumeric() {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_string()
}

fn label(confidence: i32) -> Confidence {
    match confidence {
        ..=39 => Confidence::Low,
        40..=69 => Confidence::Medium,
        _ => Confidence::High,
    }
}

fn text(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or_default().trim().to_string()
}

fn int(v: &Value, key: &str, lo: i32, hi: i32) -> i32 {
    let n = v[key].as_f64().or_else(|| v[key].as_str().and_then(|s| s.trim().parse().ok())).unwrap_or(0.0);
    (n.round() as i64).clamp(lo.into(), hi.into()) as i32
}

fn parse_impact(v: &Value) -> Option<Impact> {
    let name = text(v, "name");
    if name.is_empty() {
        return None;
    }
    let confidence = int(v, "confidence", 0, 100);
    let confidence_label = match text(v, "confidence_label").to_lowercase().as_str() {
        "low" => Confidence::Low,
        "medium" => Confidence::Medium,
        "high" => Confidence::High,
        _ => label(confidence),
    };
    let kind = if text(v, "kind").eq_ignore_ascii_case("sector") { "sector" } else { "stock" };
    Some(Impact {
        name,
        kind: kind.into(),
        score: int(v, "score", -100, 100),
        confidence,
        confidence_label,
        reasoning: text(v, "reasoning"),
    })
}

fn parse_event(v: &Value, floor: &str) -> Option<MarketEvent> {
    let name = text(v, "name");
    let date = text(v, "date");
    if name.is_empty() || !valid_date(&date) || date.as_str() < floor {
        return None;
    }
    let time = Some(text(v, "time")).filter(|t| !t.is_empty());
    let tone = match text(v, "tone").to_lowercase().as_str() {
        "positive" => Sentiment::Positive,
        "negative" => Sentiment::Negative,
        _ => Sentiment::Neutral,
    };
    let impacts = v["impacts"].as_array().map(|a| a.as_slice()).unwrap_or_default().iter().filter_map(parse_impact).collect();
    Some(MarketEvent { id: format!("{date}-{}", slug(&name)), name, date, time, tone, summary: text(v, "summary"), impacts })
}

/// Events from the model's reply text; tolerates code fences and chatter around the JSON.
pub fn parse_events(content: &str, now: i64) -> Result<Vec<MarketEvent>, String> {
    let start = content.find(['{', '[']).ok_or("no JSON in reply")?;
    let end = content.rfind(['}', ']']).filter(|e| *e > start).ok_or("no JSON in reply")?;
    let v: Value = serde_json::from_str(&content[start..=end]).map_err(|e| format!("bad JSON: {e}"))?;
    let list = if v.is_array() { &v } else { &v["events"] };
    let floor = cutoff(now);
    let mut events: Vec<MarketEvent> =
        list.as_array().ok_or("no events array in reply")?.iter().filter_map(|e| parse_event(e, &floor)).collect();
    events.sort_by(|a, b| (&a.date, a.time.is_none(), &a.time).cmp(&(&b.date, b.time.is_none(), &b.time)));
    Ok(events)
}

const SYSTEM_PROMPT: &str = "You are a markets analyst. From the given news headlines and your own knowledge of the scheduled economic and corporate calendar, list the significant market-moving events happening in the next 7 days (central bank meetings, economic data releases, major earnings, policy deadlines, and similar). Reply with only a JSON object: {\"events\":[{\"name\":string,\"date\":\"YYYY-MM-DD\",\"time\":string or null (like \"08:30 ET\"),\"tone\":\"positive\"|\"negative\"|\"neutral\",\"summary\":string (a few sentences),\"impacts\":[{\"name\":ticker or sector name,\"kind\":\"stock\"|\"sector\",\"score\":integer -100..100 (expected price effect, negative is bearish),\"confidence\":integer 0..100,\"confidence_label\":\"low\"|\"medium\"|\"high\",\"reasoning\":string}]}]}. Pick the affected stocks and sectors freely. Only include events dated from today through the next 7 days. No prose, no code fences.";

pub fn request_body(model: &str, today: &str, headlines: &[&str]) -> Value {
    let list: String = headlines.iter().map(|t| format!("- {t}\n")).collect();
    json!({
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": format!("Today: {today}\nHeadlines:\n{list}")},
        ],
    })
}

async fn headlines(client: &reqwest::Client) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut all = Vec::new();
    let mut last_err = None;
    for q in QUERIES {
        match get(client, SEARCH_URL, &[("q", q), ("quotesCount", "0"), ("newsCount", NEWS_COUNT)]).await.and_then(|b| crate::news::parse(&b)) {
            Ok(list) => all.extend(list.into_iter().filter(|a| seen.insert(a.link.clone()))),
            Err(e) => last_err = Some(e),
        }
    }
    if all.is_empty() {
        return Err(last_err.unwrap_or_else(|| "no headlines".into()));
    }
    all.sort_by_key(|a| std::cmp::Reverse(a.published));
    Ok(all.into_iter().take(MAX_HEADLINES).map(|a| a.title).collect())
}

async fn generate(client: &reqwest::Client, cfg: &AiConfig, now: i64) -> Result<EventsReport, String> {
    let titles = headlines(client).await?;
    let refs: Vec<&str> = titles.iter().map(String::as_str).collect();
    let body = request_body(cfg.model.trim(), &ymd(now), &refs);
    let reply = ai::chat(client, cfg, body, Duration::from_secs(60)).await?;
    let events = parse_events(&ai::reply_content(&reply)?, now)?;
    Ok(EventsReport { generated: now, events })
}

pub fn load(path: &Path) -> Option<EventsReport> {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

pub fn save(path: &Path, report: &EventsReport) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(report)?)?;
    std::fs::rename(tmp, path)
}

/// Cached events while fresh (unless `force`), else regenerated; a failed refresh falls back to the stale cache.
pub async fn get_report(client: &reqwest::Client, force: bool, now: i64) -> Result<EventsReport, String> {
    let path = cache_path();
    let cached = load(&path).map(|mut r| {
        let floor = cutoff(now);
        r.events.retain(|e| e.date >= floor);
        r
    });
    if let Some(r) = cached.as_ref().filter(|r| !force && fresh(r.generated, now)) {
        return Ok(r.clone());
    }
    let cfg = ai::load_config(&ai::env_path());
    let fresh_report = if cfg.configured() {
        generate(client, &cfg, now).await
    } else {
        Err("AI not configured — set it in Settings".into())
    };
    match fresh_report {
        Ok(r) => {
            if let Err(e) = save(&path, &r) {
                log::warn!("save events cache: {e}");
            }
            Ok(r)
        }
        Err(e) => cached.ok_or(e).inspect(|_| log::warn!("events refresh failed, using cache")),
    }
}

pub async fn fetch(client: &reqwest::Client, force: bool) -> Result<EventsReport, String> {
    get_report(client, force, now_secs()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_767_225_600 + 3600; // 2026-01-01 01:00 UTC

    #[test]
    fn formats_dates() {
        assert_eq!(ymd(0), "1970-01-01");
        assert_eq!(ymd(1_767_225_600), "2026-01-01");
        assert_eq!(ymd(1_709_164_800), "2024-02-29");
        assert_eq!(cutoff(NOW), "2025-12-31");
    }

    #[test]
    fn freshness_window() {
        assert!(fresh(1000, 1000));
        assert!(fresh(1000, 1000 + TTL_SECS - 1));
        assert!(!fresh(1000, 1000 + TTL_SECS));
        assert!(!fresh(1000, 999));
    }

    #[test]
    fn parses_valid_reply() {
        let c = r#"{"events":[{"name":"FOMC Rate Decision","date":"2026-01-03","time":"14:00 ET","tone":"Negative","summary":"s","impacts":[
            {"name":"NVDA","kind":"stock","score":-40,"confidence":75,"confidence_label":"high","reasoning":"r"},
            {"name":"Banks","kind":"sector","score":10,"confidence":30,"reasoning":"r2"}]}]}"#;
        let got = parse_events(c, NOW).unwrap();
        assert_eq!(got.len(), 1);
        let e = &got[0];
        assert_eq!(e.id, "2026-01-03-fomc-rate-decision");
        assert_eq!(e.time.as_deref(), Some("14:00 ET"));
        assert_eq!(e.tone, Sentiment::Negative);
        assert_eq!(e.impacts[0].confidence_label, Confidence::High);
        assert_eq!(e.impacts[1].kind, "sector");
        assert_eq!(e.impacts[1].confidence_label, Confidence::Low);
        let json = serde_json::to_value(e).unwrap();
        assert_eq!(json["impacts"][0]["confidence_label"], "high");
    }

    #[test]
    fn parses_fenced_and_bare_array() {
        let c = "Here:\n```json\n[{\"name\":\"CPI\",\"date\":\"2026-01-02\",\"time\":null,\"tone\":\"neutral\",\"summary\":\"\",\"impacts\":[]}]\n```";
        let got = parse_events(c, NOW).unwrap();
        assert_eq!(got[0].name, "CPI");
        assert_eq!(got[0].time, None);
        assert!(parse_events("nothing", NOW).is_err());
        assert!(parse_events("{\"x\":1}", NOW).is_err());
    }

    #[test]
    fn clamps_and_derives_label() {
        let c = r#"{"events":[{"name":"E","date":"2026-01-02","impacts":[
            {"name":"A","score":250,"confidence":180,"confidence_label":"bogus"},
            {"name":"B","score":-250,"confidence":-5},
            {"name":"C","score":"12","confidence":55}]}]}"#;
        let i = &parse_events(c, NOW).unwrap()[0].impacts;
        assert_eq!((i[0].score, i[0].confidence, i[0].confidence_label), (100, 100, Confidence::High));
        assert_eq!((i[1].score, i[1].confidence, i[1].confidence_label), (-100, 0, Confidence::Low));
        assert_eq!((i[2].score, i[2].confidence_label), (12, Confidence::Medium));
    }

    #[test]
    fn drops_past_and_incomplete_and_sorts() {
        let c = r#"[
            {"name":"Late","date":"2026-01-05","time":"09:00 ET"},
            {"name":"Old","date":"2025-12-20"},
            {"name":"","date":"2026-01-02"},
            {"name":"NoDate"},
            {"name":"BadDate","date":"soon"},
            {"name":"AllDay","date":"2026-01-02"},
            {"name":"Early","date":"2026-01-02","time":"08:30 ET"},
            {"name":"Today","date":"2026-01-01","time":"10:00 ET"},
            {"name":"Edge","date":"2025-12-31","time":"10:00 ET"}]"#;
        let names: Vec<_> = parse_events(c, NOW).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["Edge", "Today", "Early", "AllDay", "Late"]);
    }

    #[test]
    fn builds_request() {
        let b = request_body("m", "2026-01-01", &["A", "B"]);
        assert_eq!(b["model"], "m");
        assert_eq!(b["temperature"], 0);
        let user = b["messages"][1]["content"].as_str().unwrap();
        assert!(user.contains("2026-01-01") && user.contains("- A\n- B\n"));
    }

    #[test]
    fn cache_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("c/events.json");
        assert!(load(&p).is_none());
        let r = EventsReport { generated: 5, events: parse_events(r#"[{"name":"X","date":"2026-01-02","impacts":[{"name":"A"}]}]"#, NOW).unwrap() };
        save(&p, &r).unwrap();
        assert_eq!(load(&p), Some(r));
    }
}
