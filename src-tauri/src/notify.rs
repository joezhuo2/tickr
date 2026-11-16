use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::quote::{self, Quote};
use crate::state::{lock, now_secs, Shared};

const DAY_MINUTES: u16 = 1440;
const DIGEST_WINDOW: u16 = 180;
const DIGEST_GAP: i64 = 20 * 3600;
const DIGEST_SYMBOLS: usize = 25;
const DIGEST_DAYS: i64 = 5;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Quiet {
    pub dnd: bool,
    pub dnd_start: u16,
    pub dnd_end: u16,
    pub digest: bool,
    pub digest_time: u16,
    pub digest_last: i64,
    pub utc_offset_mins: i32,
}

impl Default for Quiet {
    fn default() -> Self {
        Self { dnd: false, dnd_start: 22 * 60, dnd_end: 7 * 60, digest: false, digest_time: 8 * 60, digest_last: 0, utc_offset_mins: 0 }
    }
}

impl Quiet {
    pub fn check(&self) -> Result<(), String> {
        if self.dnd_start >= DAY_MINUTES || self.dnd_end >= DAY_MINUTES || self.digest_time >= DAY_MINUTES {
            return Err("Times must be within one day.".into());
        }
        if !(-1440..=1440).contains(&self.utc_offset_mins) {
            return Err("Invalid time zone offset.".into());
        }
        Ok(())
    }
}

pub fn local_day(now: i64, offset_mins: i32) -> i64 {
    (now + i64::from(offset_mins) * 60).div_euclid(86_400)
}

fn local_minute(now: i64, offset_mins: i32) -> u16 {
    ((now + i64::from(offset_mins) * 60).rem_euclid(86_400) / 60) as u16
}

fn in_window(start: u16, end: u16, minute: u16) -> bool {
    if start == end {
        false
    } else if start < end {
        (start..end).contains(&minute)
    } else {
        minute >= start || minute < end
    }
}

pub fn suppressed(q: &Quiet, now: i64) -> bool {
    q.dnd && in_window(q.dnd_start, q.dnd_end, local_minute(now, q.utc_offset_mins))
}

fn digest_due(q: &Quiet, now: i64) -> bool {
    let since = (local_minute(now, q.utc_offset_mins) + DAY_MINUTES - q.digest_time) % DAY_MINUTES;
    q.digest && since < DIGEST_WINDOW && now - q.digest_last >= DIGEST_GAP
}

/// A suppressed notification counts as delivered so the alert still records Triggered.
pub fn show(app: &AppHandle, quiet: bool, title: String, body: String) -> bool {
    if quiet {
        return true;
    }
    match app.notification().builder().title(title).body(body).show() {
        Ok(()) => true,
        Err(e) => {
            log::warn!("notification: {e}");
            false
        }
    }
}

pub fn when(days: i64) -> String {
    match days {
        0 => "today".into(),
        1 => "tomorrow".into(),
        n => format!("in {n} days"),
    }
}

fn digest_text(movers: &[(String, f64)], earnings: &[(String, i64)], fired: usize) -> String {
    let mut parts = Vec::new();
    if !movers.is_empty() {
        let list: Vec<_> = movers.iter().map(|(s, p)| format!("{s} {p:+.1}%")).collect();
        parts.push(format!("Movers: {}", list.join(", ")));
    }
    if !earnings.is_empty() {
        let list: Vec<_> = earnings.iter().map(|(s, d)| format!("{s} {}", when(*d))).collect();
        parts.push(format!("Earnings: {}", list.join(", ")));
    }
    if fired > 0 {
        parts.push(format!("Alerts triggered: {fired}"));
    }
    if parts.is_empty() {
        "Nothing notable on your watchlist.".into()
    } else {
        parts.join(". ")
    }
}

fn top_movers(quotes: &[Quote]) -> Vec<(String, f64)> {
    let mut moves: Vec<_> = quotes.iter().filter_map(|q| q.change_pct.filter(|p| p.is_finite()).map(|p| (q.symbol.clone(), p))).collect();
    moves.sort_by(|a, b| b.1.abs().total_cmp(&a.1.abs()));
    moves.truncate(3);
    moves
}

async fn digest(app: &AppHandle, shared: &Shared, now: i64) {
    let (quiet, watchlist, fired) = {
        let s = lock(&shared.settings);
        let day_ago = now - 86_400;
        let fired = s.alerts.iter().filter(|a| a.triggered_at.is_some_and(|t| t >= day_ago)).count();
        (s.quiet.clone(), s.watchlist.iter().take(DIGEST_SYMBOLS).cloned().collect::<Vec<_>>(), fired)
    };
    let mut quotes = Vec::new();
    let mut earnings = Vec::new();
    let today = local_day(now, quiet.utc_offset_mins);
    for batch in watchlist.chunks(4) {
        let tasks: Vec<_> = batch
            .iter()
            .map(|symbol| {
                let symbol = symbol.clone();
                let http = shared.http.clone();
                tauri::async_runtime::spawn(async move { quote::fetch_quote(&http, &symbol, now_secs()).await.ok() })
            })
            .collect();
        for task in tasks {
            if let Ok(Some(q)) = task.await {
                quotes.push(q);
            }
        }
    }
    for symbol in &watchlist {
        let dates = shared.calendar.get(&shared.analysts, symbol, now, false).await;
        let days = dates.earnings.and_then(|e| crate::events::parse_day(&e.date)).map(|d| d - today);
        if let Some(d) = days.filter(|d| (0..=DIGEST_DAYS).contains(d)) {
            earnings.push((symbol.clone(), d));
        }
    }
    let body = digest_text(&top_movers(&quotes), &earnings, fired);
    show(app, suppressed(&quiet, now), "tickr · daily digest".into(), body);
}

pub fn spawn_digest(app: AppHandle, shared: Arc<Shared>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let now = now_secs();
            if !digest_due(&lock(&shared.settings).quiet, now) {
                continue;
            }
            shared.update_settings(|s| s.quiet.digest_last = now);
            digest(&app, &shared, now).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quiet(start: u16, end: u16) -> Quiet {
        Quiet { dnd: true, dnd_start: start, dnd_end: end, ..Quiet::default() }
    }

    #[test]
    fn same_day_and_overnight_windows() {
        assert!(in_window(540, 1020, 540));
        assert!(in_window(540, 1020, 1019));
        assert!(!in_window(540, 1020, 1020));
        assert!(!in_window(540, 1020, 100));
        assert!(in_window(1320, 420, 1380));
        assert!(in_window(1320, 420, 30));
        assert!(in_window(1320, 420, 1320));
        assert!(!in_window(1320, 420, 420));
        assert!(!in_window(1320, 420, 720));
        assert!(!in_window(600, 600, 600));
    }

    #[test]
    fn dnd_uses_the_local_offset_and_is_off_by_default() {
        let now = 1_700_000_000;
        assert!(!suppressed(&Quiet::default(), now));
        let utc_minute = local_minute(now, 0);
        let q = Quiet { utc_offset_mins: -300, ..quiet((utc_minute + 1140) % 1440, (utc_minute + 1141) % 1440) };
        assert_eq!(local_minute(now, -300), (utc_minute + 1140) % 1440);
        assert!(suppressed(&q, now));
        assert!(!suppressed(&Quiet { utc_offset_mins: 0, ..q }, now));
    }

    #[test]
    fn local_day_follows_the_offset() {
        assert_eq!(local_day(86_400 * 10 + 60, -120), 9);
        assert_eq!(local_day(86_400 * 10 - 60, 120), 10);
    }

    #[test]
    fn digest_fires_once_inside_its_window() {
        let q = Quiet { digest: true, digest_time: 480, ..Quiet::default() };
        let day = 86_400 * 20;
        assert!(digest_due(&q, day + 480 * 60));
        assert!(digest_due(&q, day + 600 * 60));
        assert!(!digest_due(&q, day + 479 * 60));
        assert!(!digest_due(&q, day + 700 * 60));
        assert!(!digest_due(&Quiet { digest: false, ..q.clone() }, day + 480 * 60));
        assert!(!digest_due(&Quiet { digest_last: day + 480 * 60, ..q.clone() }, day + 500 * 60));
        assert!(digest_due(&Quiet { digest_last: day - 86_400, ..q }, day + 480 * 60));
    }

    #[test]
    fn digest_text_lists_sections_and_falls_back() {
        let text = digest_text(&[("NVDA".into(), 3.24), ("TSLA".into(), -2.8)], &[("AAPL".into(), 1), ("MSFT".into(), 3)], 2);
        assert_eq!(text, "Movers: NVDA +3.2%, TSLA -2.8%. Earnings: AAPL tomorrow, MSFT in 3 days. Alerts triggered: 2");
        assert_eq!(digest_text(&[], &[], 0), "Nothing notable on your watchlist.");
    }

    #[test]
    fn rejects_times_outside_a_day() {
        assert!(Quiet::default().check().is_ok());
        assert!(Quiet { dnd_end: 1440, ..Quiet::default() }.check().is_err());
        assert!(Quiet { utc_offset_mins: 5000, ..Quiet::default() }.check().is_err());
    }

    #[test]
    fn older_settings_get_safe_defaults() {
        let q: Quiet = serde_json::from_str("{}").unwrap();
        assert!(!q.dnd && !q.digest);
        assert_eq!(q, Quiet::default());
    }
}
