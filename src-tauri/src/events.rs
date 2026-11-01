//! Upcoming US economic events for the next week, from Yahoo's calendar.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::analyst::Analysts;
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

/// The last list fetched this session.
static LIST: Mutex<Option<EventsReport>> = Mutex::new(None);

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

#[cfg(test)]
mod tests {
    use super::*;

    const ECON: &[u8] = include_bytes!("../../fixtures/events-econ.json");

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
}
