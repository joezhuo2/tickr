//! Upcoming US economic events for the next week, from Yahoo's calendar, and
//! an AI analysis of one event when the user opens it.

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
const FIELDS: [&str; 7] = [
    "econ_release",
    "startdatetime",
    "period",
    "after_release_actual",
    "consensus_estimate",
    "prior_release_actual",
    "originally_reported_actual",
];
/// Yahoo caps a page at 100; a US week has about 55.
const PAGE: u32 = 100;
const DAYS_AHEAD: i64 = 7;
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
    pub events: Vec<MarketEvent>,
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
    /// Unix seconds.
    pub generated: i64,
    pub tone: Sentiment,
    pub summary: String,
    pub impacts: Vec<Impact>,
}

/// The last list fetched this session.
static LIST: Mutex<Option<EventsReport>> = Mutex::new(None);
/// Serializes read-modify-write of the analysis cache file.
static CACHE_FILE: Mutex<()> = Mutex::new(());

fn fresh(at: i64, now: i64, ttl: i64) -> bool {
    (0..ttl).contains(&(now - at))
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

/// Calendar request for US economic events from `start` through `end` (YYYY-MM-DD).
pub fn calendar_query(start: &str, end: &str) -> Value {
    json!({
        "sortType": "ASC",
        "entityIdType": "economic_event",
        "sortField": "startdatetime",
        "includeFields": FIELDS,
        "size": PAGE,
        "offset": 0,
        "query": {"operator": "and", "operands": [
            {"operator": "gte", "operands": ["startdatetime", start]},
            {"operator": "lte", "operands": ["startdatetime", end]},
            {"operator": "eq", "operands": ["country_code", "US"]},
        ]},
    })
}

/// Events from a calendar response, by release time.
pub fn parse_calendar(body: &[u8]) -> Result<Vec<MarketEvent>, String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("bad response: {e}"))?;
    if let Some(desc) = v["finance"]["error"]["description"].as_str() {
        return Err(desc.to_string());
    }
    let results = v["finance"]["result"].as_array().ok_or("no calendar in response")?;
    let Some(doc) = results.first().and_then(|r| r["documents"].as_array()?.first()) else {
        return Ok(Vec::new());
    };
    let cols: Vec<&str> =
        doc["columns"].as_array().map(|a| a.as_slice()).unwrap_or_default().iter().map(|c| c["id"].as_str().unwrap_or_default()).collect();
    let rows = doc["rows"].as_array().map(|a| a.as_slice()).unwrap_or_default();
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
            Some(MarketEvent {
                id: format!("{at}-{}", slug(&name)),
                name,
                at,
                period: cell("period"),
                actual: cell("after_release_actual"),
                expected: cell("consensus_estimate"),
                prior: cell("prior_release_actual"),
                revised: cell("originally_reported_actual"),
            })
        })
        .collect();
    events.sort_by_key(|e| e.at);
    Ok(events)
}

async fn fetch_list(analysts: &Analysts, now: i64) -> Result<EventsReport, String> {
    let today = now + ET_OFFSET;
    let body = calendar_query(&ymd(today), &ymd(today + DAYS_AHEAD * DAY));
    let reply = analysts.post(CALENDAR_URL, &[("lang", "en-US"), ("region", "US")], &body).await?;
    Ok(EventsReport { fetched: now, events: parse_calendar(&reply)? })
}

/// This week's events, cached for 15 minutes unless `force`; a failed refresh falls back to the last list.
pub async fn fetch(analysts: &Analysts, force: bool) -> Result<EventsReport, String> {
    let now = now_secs();
    let cached = lock(&LIST).clone();
    if let Some(r) = cached.as_ref().filter(|r| !force && fresh(r.fetched, now, LIST_TTL)) {
        return Ok(r.clone());
    }
    match fetch_list(analysts, now).await {
        Ok(r) => {
            *lock(&LIST) = Some(r.clone());
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
    Ok(EventAnalysis { generated: now, tone, summary, impacts })
}

const SYSTEM_PROMPT: &str = "You are a markets analyst. Analyze the given scheduled US economic release and its likely effect on US stocks, using its figures, the recent headlines and your own knowledge. If the actual figure is out, judge it against the expectation and the prior; otherwise describe what a beat or a miss would mean. Reply with only a JSON object: {\"tone\":\"positive\"|\"negative\"|\"neutral\" (likely effect on US stocks),\"summary\":string (a few sentences: what the release measures, what to watch and how markets may react),\"impacts\":[{\"name\":ticker or sector name,\"kind\":\"stock\"|\"sector\",\"score\":integer -100..100 (expected price effect, negative is bearish),\"confidence\":integer 0..100,\"confidence_label\":\"low\"|\"medium\"|\"high\",\"reasoning\":string}]}. Pick the most affected stocks and sectors. No prose, no code fences.";

pub fn request_body(model: &str, now: i64, e: &MarketEvent, headlines: &[String]) -> Value {
    let or = |v: &Option<String>, none: &str| v.clone().unwrap_or_else(|| none.to_string());
    let mut user = format!(
        "Today: {}\nEvent: {} (US)\nRelease: {} {:02}:{:02} UTC\nPeriod: {}\nExpected: {}\nPrior: {}\nActual: {}\n",
        ymd(now),
        e.name,
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
pub async fn analyze(client: &reqwest::Client, event: &MarketEvent) -> Result<EventAnalysis, String> {
    let now = now_secs();
    let cfg = ai::load_config(&ai::env_path());
    if !cfg.configured() {
        return Err("AI not configured — set it in Settings".into());
    }
    let model = cfg.model.trim();
    let key = analysis_key(model, event);
    let path = analysis_path();
    if let Some(a) = lookup(&load_cache(&path), &key, now) {
        return Ok(a);
    }
    let titles = headlines(client, &event.name).await;
    let reply = ai::chat(client, &cfg, request_body(model, now, event, &titles), Duration::from_secs(60)).await?;
    let a = parse_analysis(&ai::reply_content(&reply)?, now)?;
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
    const NOW: i64 = 1_793_577_600; // 2026-11-02 00:00 UTC

    fn event() -> MarketEvent {
        parse_calendar(ECON).unwrap().remove(0)
    }

    fn analysis(generated: i64) -> EventAnalysis {
        EventAnalysis { generated, tone: Sentiment::Neutral, summary: "s".into(), impacts: Vec::new() }
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
        for part in ["Today: 2026-11-02", "Event: ISM Manufacturing PMI", "Release: 2026-11-02 15:00 UTC", "Period: Oct", "Expected: 55.0", "Prior: 54.5", "Actual: not released yet", "- A\n- B\n"] {
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
        store(&mut c, "a".into(), analysis(NOW + 1), NOW + 1);
        assert_eq!(c.len(), 1);
        assert_eq!(lookup(&c, "a", NOW + 1).unwrap().generated, NOW + 1);
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
        let got = parse_calendar(ECON).unwrap();
        let names: Vec<_> = got.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(
            names,
            ["ISM Manufacturing PMI", "Redbook YY", "ADP National Employment", "Initial Jobless Clm", "Non-Farm Payrolls", "Consumer Credit"]
        );
        let ism = &got[0];
        assert_eq!(ism.id, "1793631600-ism-manufacturing-pmi");
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
        let got = parse_calendar(body).unwrap();
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].name, "ISM Manufacturing PMI");
        assert_eq!((got[0].expected.as_ref(), got[0].actual.as_ref()), (None, None));
        assert_eq!((got[1].expected.as_deref(), got[1].actual.as_deref()), (Some("50"), Some("61")));
    }

    #[test]
    fn empty_and_error_replies() {
        assert!(parse_calendar(br#"{"finance":{"result":[{"documents":[]}],"error":null}}"#).unwrap().is_empty());
        assert!(parse_calendar(br#"{"finance":{"result":[],"error":null}}"#).unwrap().is_empty());
        let err = br#"{"finance":{"result":null,"error":{"code":"Unauthorized","description":"Invalid Crumb"}}}"#;
        assert_eq!(parse_calendar(err).unwrap_err(), "Invalid Crumb");
        assert!(parse_calendar(b"{}").is_err());
    }

    #[test]
    fn builds_us_calendar_query() {
        let q = calendar_query("2026-11-01", "2026-11-08");
        assert_eq!(q["entityIdType"], "economic_event");
        assert_eq!(q["size"], 100);
        let ops = q["query"]["operands"].as_array().unwrap();
        assert_eq!(ops[0]["operands"], json!(["startdatetime", "2026-11-01"]));
        assert_eq!(ops[1]["operands"], json!(["startdatetime", "2026-11-08"]));
        assert_eq!(ops[2]["operands"], json!(["country_code", "US"]));
    }

    /// Hits Yahoo. Run with `cargo test -- --ignored live`.
    #[test]
    #[ignore]
    fn live_calendar() {
        let a = Analysts::new();
        let r = tauri::async_runtime::block_on(fetch_list(&a, now_secs())).unwrap();
        assert!(!r.events.is_empty(), "{r:?}");
    }

    /// Hits Yahoo and the configured AI endpoint. Run with `cargo test -- --ignored live`.
    #[test]
    #[ignore]
    fn live_analysis() {
        let e = event();
        let a = tauri::async_runtime::block_on(analyze(&crate::quote::client(), &e)).unwrap();
        assert!(!a.summary.is_empty(), "{a:?}");
    }
}
