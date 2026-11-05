//! Economic events for any week, from Yahoo's calendar, and an AI analysis of
//! one event when the user opens it.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::ai;
use crate::analysis::Confidence;
use crate::analyst::Analysts;
use crate::quote::{get, SEARCH_URL};
use crate::sentiment::Sentiment;
use crate::state::{lock, now_secs};

const CALENDAR_URL: &str = "https://query1.finance.yahoo.com/v1/finance/visualization";
const FIELDS: [&str; 8] = [
    "econ_release",
    "country_code",
    "startdatetime",
    "period",
    "after_release_actual",
    "consensus_estimate",
    "prior_release_actual",
    "originally_reported_actual",
];
const PAGE: u32 = 100;
const MAX_PAGES: u32 = 8;
const WEEK_DAYS: i64 = 7;
const MAX_SHIFT_DAYS: i64 = 366;
const CACHED_WEEKS: usize = 12;
const LIST_TTL: i64 = 15 * 60;
const ANALYSIS_TTL: i64 = 6 * 3600;
const ANALYSIS_CAP: usize = 200;
/// Headlines about the event given to the model as context.
const NEWS_COUNT: &str = "10";
const DAY: i64 = 86400;
/// Yahoo reads calendar dates in US Eastern time; EST is close enough for a day boundary.
const ET_OFFSET: i64 = -5 * 3600;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MarketEvent {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub country: String,
    /// Release time, Unix seconds.
    pub at: i64,
    /// What the figure covers, like "Oct" or "Q3".
    pub period: Option<String>,
    pub actual: Option<String>,
    pub expected: Option<String>,
    pub prior: Option<String>,
    /// The prior figure as first reported, when it was revised since.
    pub revised: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventsReport {
    /// Unix seconds.
    pub fetched: i64,
    pub start: String,
    pub total: usize,
    pub events: Vec<MarketEvent>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Page {
    pub events: Vec<MarketEvent>,
    pub total: usize,
    pub rows: usize,
}

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
pub struct EventAnalysis {
    #[serde(default)]
    pub model: String,
    /// Unix seconds.
    pub generated: i64,
    pub tone: Sentiment,
    pub summary: String,
    pub impacts: Vec<Impact>,
}

static LISTS: Mutex<Vec<EventsReport>> = Mutex::new(Vec::new());
/// Serializes read-modify-write of the analysis cache file.
static CACHE_FILE: Mutex<()> = Mutex::new(());

fn fresh(at: i64, now: i64, ttl: i64) -> bool {
    (0..ttl).contains(&(now - at))
}

/// "YYYY-MM-DD" in UTC.
pub(crate) fn ymd(secs: i64) -> String {
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

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((m + 9) % 12) + 2) / 5 + d - 1;
    era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468
}

/// Unix seconds from "2026-11-02T15:00:00.000Z".
fn parse_utc(s: &str) -> Option<i64> {
    if !s.ends_with('Z') || s.len() < 20 || s.as_bytes()[10] != b'T' {
        return None;
    }
    let n = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, sec) = (n(0..4)?, n(5..7)?, n(8..10)?, n(11..13)?, n(14..16)?, n(17..19)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || sec > 60 {
        return None;
    }
    Some(days_from_civil(y, mo, d) * DAY + h * 3600 + mi * 60 + sec)
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

pub(crate) fn parse_day(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let n = |r: std::ops::Range<usize>| s.get(r).filter(|p| p.bytes().all(|c| c.is_ascii_digit()))?.parse::<i64>().ok();
    let days = days_from_civil(n(0..4)?, n(5..7)?, n(8..10)?);
    (ymd(days * DAY) == s).then_some(days)
}

pub fn week_window(start: Option<&str>, now: i64) -> Result<(String, String), String> {
    let today = (now + ET_OFFSET).div_euclid(DAY);
    let first = match start {
        Some(s) => parse_day(s).ok_or("Invalid start date")?,
        None => today,
    };
    if (first - today).abs() > MAX_SHIFT_DAYS {
        return Err("That week is too far from today".into());
    }
    Ok((ymd(first * DAY), ymd((first + WEEK_DAYS) * DAY)))
}

pub fn calendar_query(start: &str, end: &str, offset: u32) -> Value {
    json!({
        "sortType": "ASC",
        "entityIdType": "economic_event",
        "sortField": "startdatetime",
        "includeFields": FIELDS,
        "size": PAGE,
        "offset": offset,
        "query": {"operator": "and", "operands": [
            {"operator": "gte", "operands": ["startdatetime", start]},
            {"operator": "lte", "operands": ["startdatetime", end]},
        ]},
    })
}

pub fn parse_calendar(body: &[u8]) -> Result<Page, String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("bad response: {e}"))?;
    if let Some(desc) = v["finance"]["error"]["description"].as_str() {
        return Err(desc.to_string());
    }
    let results = v["finance"]["result"].as_array().ok_or("no calendar in response")?;
    let Some(doc) = results.first().and_then(|r| r["documents"].as_array()?.first()) else {
        return Ok(Page { events: Vec::new(), total: 0, rows: 0 });
    };
    let cols: Vec<&str> =
        doc["columns"].as_array().map(|a| a.as_slice()).unwrap_or_default().iter().map(|c| c["id"].as_str().unwrap_or_default()).collect();
    let rows = doc["rows"].as_array().map(|a| a.as_slice()).unwrap_or_default();
    let total = results[0]["total"].as_u64().map_or(0, |t| t as usize).max(rows.len());
    let mut events: Vec<MarketEvent> = rows
        .iter()
        .filter_map(|row| {
            let cell = |id: &str| {
                let i = cols.iter().position(|c| *c == id)?;
                Some(row[i].as_str()?.trim()).filter(|s| !s.is_empty()).map(str::to_string)
            };
            // Yahoo marks some releases with a trailing "*".
            let name = cell("econ_release")?.trim_end_matches('*').trim_end().to_string();
            let at = parse_utc(&cell("startdatetime")?)?;
            if name.is_empty() {
                return None;
            }
            let country = cell("country_code")
                .map(|c| c.to_uppercase())
                .filter(|c| (2..=3).contains(&c.len()) && c.bytes().all(|b| b.is_ascii_alphabetic()))
                .unwrap_or_default();
            let id = [at.to_string(), country.to_lowercase(), slug(&name)].into_iter().filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
            Some(MarketEvent {
                id,
                name,
                country,
                at,
                period: cell("period").filter(|p| !p.eq_ignore_ascii_case("n/a")),
                actual: cell("after_release_actual"),
                expected: cell("consensus_estimate"),
                prior: cell("prior_release_actual"),
                revised: cell("originally_reported_actual"),
            })
        })
        .collect();
    events.sort_by_key(|e| e.at);
    Ok(Page { events, total, rows: rows.len() })
}

pub fn merge_pages(pages: Vec<Page>) -> (Vec<MarketEvent>, usize) {
    let total = pages.last().map_or(0, |p| p.total);
    let mut seen = HashSet::new();
    let mut events: Vec<MarketEvent> = pages
        .into_iter()
        .flat_map(|p| p.events)
        .filter(|e| seen.insert((e.at, e.country.clone(), e.name.clone(), e.period.clone())))
        .collect();
    events.sort_by_key(|e| e.at);
    let mut used = HashSet::new();
    for e in &mut events {
        let base = e.id.clone();
        let mut n = 1;
        while !used.insert(e.id.clone()) {
            n += 1;
            e.id = format!("{base}-{n}");
        }
    }
    (events, total)
}

async fn fetch_list(analysts: &Analysts, start: &str, end: &str, now: i64) -> Result<EventsReport, String> {
    let mut pages = Vec::new();
    let mut offset = 0u32;
    for _ in 0..MAX_PAGES {
        let body = calendar_query(start, end, offset);
        let page = parse_calendar(&analysts.post(CALENDAR_URL, &[("lang", "en-US"), ("region", "US")], &body).await?)?;
        offset += page.rows as u32;
        let done = page.rows == 0 || offset as usize >= page.total;
        pages.push(page);
        if done {
            break;
        }
    }
    let (events, total) = merge_pages(pages);
    Ok(EventsReport { fetched: now, start: start.to_string(), total, events })
}

fn store_list(report: EventsReport) {
    let mut lists = lock(&LISTS);
    lists.retain(|r| r.start != report.start);
    lists.push(report);
    let over = lists.len().saturating_sub(CACHED_WEEKS);
    lists.drain(..over);
}

pub async fn fetch(analysts: &Analysts, start: Option<&str>, force: bool) -> Result<EventsReport, String> {
    let now = now_secs();
    let (start, end) = week_window(start, now)?;
    let cached = lock(&LISTS).iter().find(|r| r.start == start).cloned();
    if let Some(r) = cached.as_ref().filter(|r| !force && fresh(r.fetched, now, LIST_TTL)) {
        return Ok(r.clone());
    }
    match fetch_list(analysts, &start, &end, now).await {
        Ok(r) => {
            store_list(r.clone());
            Ok(r)
        }
        Err(e) => cached.ok_or(e).inspect(|_| log::warn!("events refresh failed, using the last list")),
    }
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

/// The analysis in the model's reply text; tolerates code fences and chatter around the JSON.
pub fn parse_analysis(content: &str, now: i64) -> Result<EventAnalysis, String> {
    let start = content.find('{').ok_or("no JSON in reply")?;
    let end = content.rfind('}').filter(|e| *e > start).ok_or("no JSON in reply")?;
    let v: Value = serde_json::from_str(&content[start..=end]).map_err(|e| format!("bad JSON: {e}"))?;
    let tone = match text(&v, "tone").to_lowercase().as_str() {
        "positive" => Sentiment::Positive,
        "negative" => Sentiment::Negative,
        _ => Sentiment::Neutral,
    };
    let summary = text(&v, "summary");
    let impacts: Vec<Impact> = v["impacts"].as_array().map(|a| a.as_slice()).unwrap_or_default().iter().filter_map(parse_impact).collect();
    if summary.is_empty() && impacts.is_empty() {
        return Err("empty analysis in reply".into());
    }
    Ok(EventAnalysis { model: String::new(), generated: now, tone, summary, impacts })
}

const SYSTEM_PROMPT: &str = "You are a markets analyst. Analyze the given scheduled economic release (its country is given) and its likely effect on markets and US stocks, using its figures, the recent headlines and your own knowledge. If the actual figure is out, judge it against the expectation and the prior; otherwise describe what a beat or a miss would mean. Reply with only a JSON object: {\"tone\":\"positive\"|\"negative\"|\"neutral\" (likely effect on US stocks),\"summary\":string (a few sentences: what the release measures, what to watch and how markets may react),\"impacts\":[{\"name\":ticker or sector name,\"kind\":\"stock\"|\"sector\",\"score\":integer -100..100 (expected price effect, negative is bearish),\"confidence\":integer 0..100,\"confidence_label\":\"low\"|\"medium\"|\"high\",\"reasoning\":string}]}. Pick the most affected stocks and sectors. No prose, no code fences.";

pub fn request_body(model: &str, now: i64, e: &MarketEvent, headlines: &[String]) -> Value {
    let or = |v: &Option<String>, none: &str| v.clone().unwrap_or_else(|| none.to_string());
    let mut user = format!(
        "Today: {}\nEvent: {} ({})\nRelease: {} {:02}:{:02} UTC\nPeriod: {}\nExpected: {}\nPrior: {}\nActual: {}\n",
        ymd(now),
        e.name,
        if e.country.is_empty() { "country unknown" } else { &e.country },
        ymd(e.at),
        e.at.rem_euclid(DAY) / 3600,
        e.at.rem_euclid(3600) / 60,
        or(&e.period, "n/a"),
        or(&e.expected, "n/a"),
        or(&e.prior, "n/a"),
        or(&e.actual, "not released yet"),
    );
    if let Some(r) = &e.revised {
        user.push_str(&format!("Prior as first reported: {r}\n"));
    }
    if !headlines.is_empty() {
        user.push_str("Headlines:\n");
        for t in headlines {
            user.push_str(&format!("- {t}\n"));
        }
    }
    json!({
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user},
        ],
    })
}

/// Recent headlines about the event; none on failure, since they are only context.
async fn headlines(client: &reqwest::Client, name: &str) -> Vec<String> {
    match get(client, SEARCH_URL, &[("q", name), ("quotesCount", "0"), ("newsCount", NEWS_COUNT)]).await.and_then(|b| crate::news::parse(&b)) {
        Ok(list) => list.into_iter().map(|a| a.title).collect(),
        Err(e) => {
            log::warn!("event headlines {name}: {e}");
            Vec::new()
        }
    }
}

type AnalysisCache = Vec<(String, EventAnalysis)>;

pub fn analysis_path() -> PathBuf {
    crate::settings::cache_dir().join("event-analysis.json")
}

/// A new actual figure changes the key, so a release gets a fresh analysis.
fn analysis_key(model: &str, e: &MarketEvent) -> String {
    format!("{model}\n{}\n{}", e.id, e.actual.as_deref().unwrap_or_default())
}

fn load_cache(path: &Path) -> AnalysisCache {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save_cache(path: &Path, cache: &AnalysisCache) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(cache)?)?;
    std::fs::rename(tmp, path)
}

fn lookup(cache: &AnalysisCache, key: &str, now: i64) -> Option<EventAnalysis> {
    cache.iter().find(|(k, a)| k == key && fresh(a.generated, now, ANALYSIS_TTL)).map(|(_, a)| a.clone())
}

/// Adds or replaces an entry, dropping stale ones and the oldest beyond the cap.
fn store(cache: &mut AnalysisCache, key: String, a: EventAnalysis, now: i64) {
    cache.retain(|(k, v)| *k != key && fresh(v.generated, now, ANALYSIS_TTL));
    cache.push((key, a));
    let over = cache.len().saturating_sub(ANALYSIS_CAP);
    cache.drain(..over);
}

/// AI analysis of one event, cached on disk for 6 hours per model and figure.
pub async fn analyze(client: &reqwest::Client, event: &MarketEvent, force: bool) -> Result<EventAnalysis, String> {
    let now = now_secs();
    let cfg = ai::load_config(&ai::env_path());
    if !cfg.configured(ai::Feature::Events) {
        return Err("AI not configured — set it in Settings".into());
    }
    let model = cfg.model_for(ai::Feature::Events);
    let key = analysis_key(model, event);
    let path = analysis_path();
    if !force {
        if let Some(a) = lookup(&load_cache(&path), &key, now) {
            return Ok(a);
        }
    }
    let titles = headlines(client, &event.name).await;
    let reply = ai::chat(client, &cfg, request_body(model, now, event, &titles), Duration::from_secs(60)).await?;
    let mut a = parse_analysis(&ai::reply_content(&reply)?, now)?;
    a.model = model.to_string();
    let _guard = lock(&CACHE_FILE);
    let mut cache = load_cache(&path);
    store(&mut cache, key, a.clone(), now);
    if let Err(e) = save_cache(&path, &cache) {
        log::warn!("save event analysis cache: {e}");
    }
    Ok(a)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ECON: &[u8] = include_bytes!("../../fixtures/events-econ.json");
    const WORLD: &[u8] = include_bytes!("../../fixtures/events-world.json");
    const NOW: i64 = 1_793_577_600; // 2026-11-02 00:00 UTC

    fn event() -> MarketEvent {
        parse_calendar(ECON).unwrap().events.remove(0)
    }

    fn analysis(generated: i64) -> EventAnalysis {
        EventAnalysis { model: "m".into(), generated, tone: Sentiment::Neutral, summary: "s".into(), impacts: Vec::new() }
    }

    #[test]
    fn parses_analysis_reply() {
        let c = r#"Sure:
```json
{"tone":"Negative","summary":"s","impacts":[
  {"name":"NVDA","kind":"stock","score":-40,"confidence":75,"confidence_label":"high","reasoning":"r"},
  {"name":"Banks","kind":"Sector","score":10,"confidence":30,"reasoning":"r2"},
  {"name":"","score":5}]}
```"#;
        let a = parse_analysis(c, NOW).unwrap();
        assert_eq!((a.generated, a.tone, a.summary.as_str()), (NOW, Sentiment::Negative, "s"));
        assert_eq!(a.impacts.len(), 2);
        assert_eq!(a.impacts[0].confidence_label, Confidence::High);
        assert_eq!((a.impacts[1].kind.as_str(), a.impacts[1].confidence_label), ("sector", Confidence::Low));
        let json = serde_json::to_value(&a).unwrap();
        assert_eq!(json["impacts"][0]["confidence_label"], "high");
        assert_eq!(json["tone"], "negative");
    }

    #[test]
    fn clamps_and_derives_label() {
        let c = r#"{"summary":"s","impacts":[
            {"name":"A","score":250,"confidence":180,"confidence_label":"bogus"},
            {"name":"B","score":-250,"confidence":-5},
            {"name":"C","score":"12","confidence":55}]}"#;
        let a = parse_analysis(c, NOW).unwrap();
        let i = &a.impacts;
        assert_eq!(a.tone, Sentiment::Neutral);
        assert_eq!((i[0].score, i[0].confidence, i[0].confidence_label), (100, 100, Confidence::High));
        assert_eq!((i[1].score, i[1].confidence, i[1].confidence_label), (-100, 0, Confidence::Low));
        assert_eq!((i[2].score, i[2].confidence_label), (12, Confidence::Medium));
    }

    #[test]
    fn rejects_empty_or_missing_analysis() {
        assert!(parse_analysis("nothing", NOW).is_err());
        assert!(parse_analysis("{\"tone\":\"positive\"}", NOW).is_err());
        assert!(parse_analysis("[1, 2]", NOW).is_err());
    }

    #[test]
    fn builds_request_with_figures_and_headlines() {
        let mut e = event();
        e.expected = Some("55.0".into());
        let b = request_body("m", NOW, &e, &["A".into(), "B".into()]);
        assert_eq!((b["model"].as_str(), b["temperature"].as_i64()), (Some("m"), Some(0)));
        let user = b["messages"][1]["content"].as_str().unwrap();
        for part in ["Today: 2026-11-02", "Event: ISM Manufacturing PMI (US)", "Release: 2026-11-02 15:00 UTC", "Period: Oct", "Expected: 55.0", "Prior: 54.5", "Actual: not released yet", "- A\n- B\n"] {
            assert!(user.contains(part), "{part:?} in {user}");
        }
        assert!(!user.contains("first reported"));
        let none = request_body("m", NOW, &e, &[]);
        assert!(!none["messages"][1]["content"].as_str().unwrap().contains("Headlines"));
    }

    #[test]
    fn analysis_key_follows_model_and_actual() {
        let mut e = event();
        let before = analysis_key("m", &e);
        assert_ne!(before, analysis_key("other", &e));
        e.actual = Some("53.2".into());
        assert_ne!(before, analysis_key("m", &e));
    }

    #[test]
    fn cache_stores_replaces_expires_and_caps() {
        let mut c = AnalysisCache::new();
        store(&mut c, "a".into(), analysis(NOW), NOW);
        let replacement = EventAnalysis { summary: "fresh".into(), ..analysis(NOW + 1) };
        store(&mut c, "a".into(), replacement.clone(), NOW + 1);
        assert_eq!(c.len(), 1);
        assert_eq!(lookup(&c, "a", NOW + 1).unwrap(), replacement);
        assert!(lookup(&c, "a", NOW + 1 + ANALYSIS_TTL).is_none());
        assert!(lookup(&c, "b", NOW).is_none());
        store(&mut c, "b".into(), analysis(NOW + ANALYSIS_TTL + 2), NOW + ANALYSIS_TTL + 2);
        assert_eq!(c.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(), ["b"]);
        for i in 0..ANALYSIS_CAP + 5 {
            store(&mut c, format!("k{i}"), analysis(NOW), NOW);
        }
        assert_eq!(c.len(), ANALYSIS_CAP);
        assert_eq!(c[0].0, "k5");
    }

    #[test]
    fn cache_file_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("c/event-analysis.json");
        assert!(load_cache(&p).is_empty());
        let c = vec![("k".to_string(), analysis(NOW))];
        save_cache(&p, &c).unwrap();
        assert_eq!(load_cache(&p), c);
        let mut legacy = serde_json::to_value(&c).unwrap();
        legacy[0][1].as_object_mut().unwrap().remove("model");
        std::fs::write(&p, serde_json::to_vec(&legacy).unwrap()).unwrap();
        assert!(load_cache(&p)[0].1.model.is_empty());
    }

    #[test]
    fn formats_and_parses_dates() {
        assert_eq!(ymd(0), "1970-01-01");
        assert_eq!(ymd(1_767_225_600), "2026-01-01");
        assert_eq!(ymd(1_709_164_800), "2024-02-29");
        assert_eq!(parse_utc("2026-01-01T00:00:00.000Z"), Some(1_767_225_600));
        assert_eq!(parse_utc("2024-02-29T00:00:00Z"), Some(1_709_164_800));
        assert_eq!(parse_utc("2026-11-02T15:00:00.000Z"), Some(1_793_631_600));
        assert_eq!(parse_utc("2026-11-02T15:00:00.000-05:00"), None);
        assert_eq!(parse_utc("2026-13-02T15:00:00.000Z"), None);
        assert_eq!(parse_utc("soon"), None);
    }

    #[test]
    fn freshness_window() {
        assert!(fresh(1000, 1000, LIST_TTL));
        assert!(fresh(1000, 1000 + LIST_TTL - 1, LIST_TTL));
        assert!(!fresh(1000, 1000 + LIST_TTL, LIST_TTL));
        assert!(!fresh(1000, 999, LIST_TTL));
    }

    #[test]
    fn parses_calendar_fixture() {
        let got = parse_calendar(ECON).unwrap().events;
        let names: Vec<_> = got.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(
            names,
            ["ISM Manufacturing PMI", "Redbook YY", "ADP National Employment", "Initial Jobless Clm", "Non-Farm Payrolls", "Consumer Credit"]
        );
        let ism = &got[0];
        assert_eq!(ism.id, "1793631600-us-ism-manufacturing-pmi");
        assert_eq!(ism.country, "US");
        assert_eq!(ism.at, 1_793_631_600);
        assert_eq!(ism.period.as_deref(), Some("Oct"));
        assert_eq!(ism.prior.as_deref(), Some("54.5"));
        assert_eq!((ism.actual.as_ref(), ism.expected.as_ref(), ism.revised.as_ref()), (None, None, None));
        assert_eq!(got[1].period, None);
    }

    #[test]
    fn reads_columns_by_id_and_drops_bad_rows() {
        let body = br#"{"finance":{"result":[{"documents":[{"columns":[
            {"id":"startdatetime"},{"id":"econ_release"},{"id":"consensus_estimate"},{"id":"after_release_actual"}],
            "rows":[
                ["2026-11-06T13:30:00.000Z","Non-Farm Payrolls","50"," 61 "],
                ["2026-11-02T15:00:00.000Z","ISM Manufacturing PMI","",null],
                ["later","Bad Time","1","2"],
                ["2026-11-03T15:00:00.000Z","*","1","2"],
                ["2026-11-03T15:00:00.000Z",null,"1","2"]]}]}],"error":null}}"#;
        let got = parse_calendar(body).unwrap().events;
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].name, "ISM Manufacturing PMI");
        assert_eq!((got[0].expected.as_ref(), got[0].actual.as_ref()), (None, None));
        assert_eq!((got[1].expected.as_deref(), got[1].actual.as_deref()), (Some("50"), Some("61")));
    }

    #[test]
    fn empty_and_error_replies() {
        assert!(parse_calendar(br#"{"finance":{"result":[{"documents":[]}],"error":null}}"#).unwrap().events.is_empty());
        assert!(parse_calendar(br#"{"finance":{"result":[],"error":null}}"#).unwrap().events.is_empty());
        let err = br#"{"finance":{"result":null,"error":{"code":"Unauthorized","description":"Invalid Crumb"}}}"#;
        assert_eq!(parse_calendar(err).unwrap_err(), "Invalid Crumb");
        assert!(parse_calendar(b"{}").is_err());
    }

    #[test]
    fn builds_calendar_query_for_all_countries() {
        let q = calendar_query("2026-11-01", "2026-11-08", 200);
        assert_eq!(q["entityIdType"], "economic_event");
        assert_eq!((q["size"].as_u64(), q["offset"].as_u64()), (Some(100), Some(200)));
        assert!(q["includeFields"].as_array().unwrap().contains(&json!("country_code")));
        let ops = q["query"]["operands"].as_array().unwrap();
        assert_eq!(ops.len(), 2);
        assert_eq!(ops[0]["operands"], json!(["startdatetime", "2026-11-01"]));
        assert_eq!(ops[1]["operands"], json!(["startdatetime", "2026-11-08"]));
    }

    #[test]
    fn parses_world_page_with_countries_and_total() {
        let page = parse_calendar(WORLD).unwrap();
        assert_eq!((page.rows, page.events.len(), page.total), (40, 40, 64));
        let countries: HashSet<_> = page.events.iter().map(|e| e.country.as_str()).collect();
        assert_eq!(countries.len(), 12);
        for c in ["US", "SE", "EU", "BR", "CA", "GH"] {
            assert!(countries.contains(c), "{c}");
        }
        assert!(page.events.windows(2).all(|w| w[0].at <= w[1].at));
        let ids: HashSet<_> = page.events.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids.len(), 40);
        let swe = page.events.iter().find(|e| e.country == "SE" && e.name == "PMI Services").unwrap();
        assert_eq!((swe.actual.as_deref(), swe.revised.as_deref()), (Some("55.7"), Some("57.3")));
        let riks = page.events.iter().find(|e| e.name == "Riksbank Rate").unwrap();
        assert_eq!((riks.period.as_deref(), riks.actual.as_deref()), (None, Some("2")));
    }

    #[test]
    fn country_codes_are_validated_and_ids_stay_distinct() {
        let body = br#"{"finance":{"result":[{"total":9,"documents":[{"columns":[
            {"id":"econ_release"},{"id":"country_code"},{"id":"startdatetime"}],
            "rows":[
                ["CPI YY","eu","2026-11-04T10:00:00.000Z"],
                ["CPI YY","IT","2026-11-04T10:00:00.000Z"],
                ["CPI YY","","2026-11-04T10:00:00.000Z"],
                ["CPI YY","not a code","2026-11-04T10:00:00.000Z"],
                ["CPI YY",null,"2026-11-04T10:00:00.000Z"]]}]}],"error":null}}"#;
        let page = parse_calendar(body).unwrap();
        assert_eq!((page.rows, page.total), (5, 9));
        let countries: Vec<_> = page.events.iter().map(|e| e.country.as_str()).collect();
        assert_eq!(countries, ["EU", "IT", "", "", ""]);
        assert_eq!(page.events[0].id, "1793786400-eu-cpi-yy");
        assert_eq!(page.events[2].id, "1793786400-cpi-yy");
    }

    #[test]
    fn total_never_undercounts_rows() {
        let body = br#"{"finance":{"result":[{"total":1,"documents":[{"columns":[{"id":"econ_release"},{"id":"startdatetime"}],
            "rows":[["A","2026-11-04T10:00:00.000Z"],["B","2026-11-04T11:00:00.000Z"]]}]}],"error":null}}"#;
        let page = parse_calendar(body).unwrap();
        assert_eq!((page.rows, page.total), (2, 2));
        assert!(page.events.iter().all(|e| e.country.is_empty()));
    }

    #[test]
    fn merges_pages_without_duplicates_in_time_order() {
        let a = parse_calendar(WORLD).unwrap();
        let mut b = a.clone();
        b.events.reverse();
        b.total = 64;
        let (events, total) = merge_pages(vec![a.clone(), b]);
        assert_eq!((events.len(), total), (40, 64));
        assert!(events.windows(2).all(|w| w[0].at <= w[1].at));
        assert_eq!(merge_pages(Vec::new()), (Vec::new(), 0));
    }

    #[test]
    fn merge_keeps_distinct_rows_with_the_same_slug_and_drops_exact_repeats() {
        let body = br#"{"finance":{"result":[{"total":4,"documents":[{"columns":[
            {"id":"econ_release"},{"id":"country_code"},{"id":"startdatetime"},{"id":"period"}],
            "rows":[
                ["CPI MM, SA","US","2026-11-04T13:30:00.000Z","Oct"],
                ["CPI MM SA","US","2026-11-04T13:30:00.000Z","Oct"],
                ["CPI MM, SA","US","2026-11-04T13:30:00.000Z","Oct"],
                ["CPI MM, SA","US","2026-11-04T13:30:00.000Z","Nov"]]}]}],"error":null}}"#;
        let page = parse_calendar(body).unwrap();
        let (events, total) = merge_pages(vec![page.clone(), page]);
        assert_eq!((events.len(), total), (3, 4));
        let ids: HashSet<_> = events.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids.len(), 3);
        assert!(ids.contains("1793799000-us-cpi-mm-sa"));
        assert!(ids.contains("1793799000-us-cpi-mm-sa-2"));
        assert!(ids.contains("1793799000-us-cpi-mm-sa-3"));
    }

    #[test]
    fn week_window_defaults_to_today_and_validates_dates() {
        assert_eq!(week_window(None, NOW).unwrap(), ("2026-11-01".into(), "2026-11-08".into()));
        assert_eq!(week_window(Some("2026-10-25"), NOW).unwrap(), ("2026-10-25".into(), "2026-11-01".into()));
        assert_eq!(week_window(Some("2026-11-08"), NOW).unwrap(), ("2026-11-08".into(), "2026-11-15".into()));
        assert_eq!(week_window(Some("2026-12-28"), NOW).unwrap().1, "2027-01-04");
        for bad in ["", "soon", "2026-13-01", "2026-02-30", "2026-1-01", "20261101", "2026-11-01T00:00", "2026-11-0x", "-026-11-01", "2026-+1-01"] {
            assert_eq!(week_window(Some(bad), NOW).unwrap_err(), "Invalid start date", "{bad}");
        }
        assert!(week_window(Some("2024-01-01"), NOW).is_err());
        assert!(week_window(Some("2028-01-01"), NOW).is_err());
        assert!(week_window(Some("2027-11-01"), NOW).is_ok());
        assert!(week_window(Some("2025-11-02"), NOW).is_ok());
    }

    #[test]
    fn list_cache_keeps_one_report_per_week_and_caps() {
        let report = |start: &str, fetched| EventsReport { fetched, start: start.into(), total: 0, events: Vec::new() };
        lock(&LISTS).clear();
        store_list(report("2026-11-01", 1));
        store_list(report("2026-11-08", 2));
        store_list(report("2026-11-01", 3));
        {
            let lists = lock(&LISTS);
            assert_eq!(lists.iter().map(|r| (r.start.as_str(), r.fetched)).collect::<Vec<_>>(), [("2026-11-08", 2), ("2026-11-01", 3)]);
        }
        for d in 0..CACHED_WEEKS + 3 {
            store_list(report(&format!("2027-01-{:02}", d + 1), 10));
        }
        let lists = lock(&LISTS);
        assert_eq!(lists.len(), CACHED_WEEKS);
        assert_eq!(lists[0].start, "2027-01-04");
    }

    /// Hits Yahoo. Run with `cargo test -- --ignored live`.
    #[test]
    #[ignore]
    fn live_calendar() {
        let a = Analysts::new();
        let now = now_secs();
        let (start, end) = week_window(None, now).unwrap();
        let r = tauri::async_runtime::block_on(fetch_list(&a, &start, &end, now)).unwrap();
        assert!(!r.events.is_empty(), "{r:?}");
        assert!(r.events.iter().any(|e| e.country != "US"), "{r:?}");
    }

    /// Hits Yahoo and the configured AI endpoint. Run with `cargo test -- --ignored live`.
    #[test]
    #[ignore]
    fn live_analysis() {
        let e = event();
        let a = tauri::async_runtime::block_on(analyze(&crate::quote::client(), &e, false)).unwrap();
        assert!(!a.summary.is_empty(), "{a:?}");
    }
}
