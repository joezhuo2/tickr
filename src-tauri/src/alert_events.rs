use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

use tauri::AppHandle;

use crate::alerts::{self, AlertKind, PriceAlert};
use crate::quote::{self, Session};
use crate::state::{lock, now_secs, Shared};

static LAST: Mutex<BTreeMap<String, i64>> = Mutex::new(BTreeMap::new());

#[derive(Default)]
pub struct Facts {
    pub earnings_days: Option<i64>,
    pub dividend_days: Option<i64>,
    pub session: Option<Session>,
    pub rel_volume: Option<f64>,
    pub news: Option<(i64, String)>,
}

fn flag(on: bool) -> f64 {
    if on { 1.0 } else { 0.0 }
}

pub fn evaluate(
    list: &mut [PriceAlert],
    states: &mut HashMap<u32, f64>,
    symbol: &str,
    facts: &Facts,
    now: i64,
    mut notify: impl FnMut(&PriceAlert, String) -> bool,
) -> bool {
    let mut changed = false;
    for alert in list.iter_mut().filter(|a| a.enabled && a.symbol == symbol && a.kind.is_event()) {
        if alerts::dormant(alert, now) {
            states.remove(&alert.id);
            continue;
        }
        let prev = states.get(&alert.id).copied();
        let (state, hit, text) = match alert.kind {
            AlertKind::News => {
                let Some(since) = alert.reference else {
                    alert.reference = Some(now as f64);
                    changed = true;
                    continue;
                };
                match &facts.news {
                    Some((t, title)) if (*t as f64) > since => (None, true, format!("{symbol}: {title}")),
                    _ => continue,
                }
            }
            AlertKind::MarketOpen | AlertKind::MarketClose => {
                let Some(session) = facts.session else { continue };
                let open = session == Session::Regular;
                let hit = if alert.kind == AlertKind::MarketOpen { open && prev == Some(0.0) } else { !open && prev == Some(1.0) };
                let text = format!("{symbol}: the regular session has {}.", if open { "opened" } else { "closed" });
                (Some(flag(open)), hit, text)
            }
            AlertKind::RelVolume => {
                let Some(rv) = facts.rel_volume else { continue };
                let on = rv >= alert.level;
                (Some(flag(on)), on && prev != Some(1.0), format!("{symbol} relative volume is {rv:.1}x, above {}x.", alert.level))
            }
            kind => {
                let (days, what) = if kind == AlertKind::EarningsDays {
                    (facts.earnings_days, "reports earnings")
                } else {
                    (facts.dividend_days, "goes ex-dividend")
                };
                let Some(d) = days else { continue };
                let on = d >= 0 && (d as f64) <= alert.level;
                (Some(flag(on)), on && prev != Some(1.0), format!("{symbol} {what} {}.", crate::notify::when(d)))
            }
        };
        if let Some(s) = state {
            states.insert(alert.id, s);
        }
        let cooling = alert.recurring && alert.triggered_at.is_some_and(|t| now - t < i64::from(alert.cooldown_mins) * 60);
        if !hit || cooling {
            continue;
        }
        if !notify(alert, text) {
            match prev {
                Some(p) => states.insert(alert.id, p),
                None => states.remove(&alert.id),
            };
            continue;
        }
        alert.triggered_at = Some(now);
        alert.triggered_price = None;
        if alert.kind == AlertKind::News {
            alert.reference = facts.news.as_ref().map(|(t, _)| *t as f64);
        }
        if !alert.recurring {
            alert.enabled = false;
            states.remove(&alert.id);
        }
        changed = true;
    }
    changed
}

fn due(key: String, every: i64, now: i64) -> bool {
    let mut last = lock(&LAST);
    if last.get(&key).is_some_and(|t| now - t < every) {
        return false;
    }
    last.insert(key, now);
    true
}

pub async fn poll(app: &AppHandle, shared: &Shared) {
    let now = now_secs();
    let (wanted, offset) = {
        let s = lock(&shared.settings);
        let mut wanted: BTreeMap<String, Vec<AlertKind>> = BTreeMap::new();
        for a in s.alerts.iter().filter(|a| a.enabled && a.kind.is_event() && !alerts::dormant(a, now)) {
            wanted.entry(a.symbol.clone()).or_default().push(a.kind);
        }
        (wanted, s.quiet.utc_offset_mins)
    };
    let today = crate::notify::local_day(now, offset);
    let mut gathered = Vec::new();
    for (symbol, kinds) in wanted {
        let has = |any: &[AlertKind]| kinds.iter().any(|k| any.contains(k));
        let mut facts = Facts::default();
        if has(&[AlertKind::EarningsDays, AlertKind::DividendDays]) {
            let dates = shared.calendar.get(&shared.analysts, &symbol, now, false).await;
            let days = |d: &str| crate::events::parse_day(d).map(|n| n - today);
            facts.earnings_days = dates.earnings.and_then(|e| days(&e.date));
            facts.dividend_days = dates.ex_dividend.and_then(|d| days(&d));
        }
        if has(&[AlertKind::MarketOpen, AlertKind::MarketClose]) && due(format!("quote:{symbol}"), 60, now) {
            facts.session = quote::fetch_quote(&shared.http, &symbol, now).await.ok().map(|q| q.session);
        }
        if has(&[AlertKind::RelVolume]) && due(format!("rvol:{symbol}"), 300, now) {
            facts.rel_volume = quote::fetch_chart(&shared.http, &symbol, "6mo", "1d", false)
                .await
                .ok()
                .and_then(|c| crate::analysis::indicators::rvol(&c.candles, crate::analysis::RVOL_LEN).last().copied().flatten());
        }
        if has(&[AlertKind::News]) && due(format!("news:{symbol}"), 300, now) {
            facts.news = crate::news::fetch(&shared.http, &symbol)
                .await
                .ok()
                .and_then(|a| a.into_iter().max_by_key(|x| x.published))
                .map(|a| (a.published, a.title));
        }
        gathered.push((symbol, facts));
    }
    let changed = {
        let mut settings = lock(&shared.settings);
        let mut states = lock(&shared.alert_prices);
        let quiet = crate::notify::suppressed(&settings.quiet, now);
        let mut changed = alerts::expire(&mut settings.alerts, now);
        for (symbol, facts) in &gathered {
            changed |= evaluate(&mut settings.alerts, &mut states, symbol, facts, now, |_, text| {
                crate::notify::show(app, quiet, format!("tickr · {symbol} alert"), text)
            });
        }
        if changed {
            if let Err(e) = settings.save(&shared.settings_path) {
                log::warn!("save event alerts: {e}");
            }
        }
        changed
    };
    if changed {
        alerts::emit(app, shared);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::alerts::Direction;

    fn alert(kind: AlertKind, level: f64) -> PriceAlert {
        PriceAlert {
            id: 1,
            symbol: "AAPL".into(),
            direction: Direction::Above,
            level,
            enabled: true,
            triggered_at: None,
            kind,
            reference: None,
            recurring: false,
            cooldown_mins: 0,
            regular_only: false,
            triggered_price: None,
            snooze_until: None,
            expires_at: None,
        }
    }

    fn run(list: &mut [PriceAlert], states: &mut HashMap<u32, f64>, facts: &Facts, now: i64) -> Vec<String> {
        let mut sent = Vec::new();
        evaluate(list, states, "AAPL", facts, now, |_, text| {
            sent.push(text);
            true
        });
        sent
    }

    #[test]
    fn earnings_fire_once_inside_the_window_and_disable() {
        let mut list = vec![alert(AlertKind::EarningsDays, 3.0)];
        let mut states = HashMap::new();
        let far = Facts { earnings_days: Some(5), ..Facts::default() };
        assert!(run(&mut list, &mut states, &far, 1).is_empty());
        let near = Facts { earnings_days: Some(2), ..Facts::default() };
        assert_eq!(run(&mut list, &mut states, &near, 2), ["AAPL reports earnings in 2 days."]);
        assert!(!list[0].enabled);
        assert_eq!(list[0].triggered_at, Some(2));
        assert!(run(&mut list, &mut states, &near, 3).is_empty());
    }

    #[test]
    fn dividend_today_and_past_dates() {
        let mut list = vec![alert(AlertKind::DividendDays, 0.0)];
        let mut states = HashMap::new();
        let past = Facts { dividend_days: Some(-1), ..Facts::default() };
        assert!(run(&mut list, &mut states, &past, 1).is_empty());
        let today = Facts { dividend_days: Some(0), ..Facts::default() };
        assert_eq!(run(&mut list, &mut states, &today, 2), ["AAPL goes ex-dividend today."]);
        assert!(run(&mut list, &mut states, &Facts::default(), 3).is_empty());
    }

    #[test]
    fn market_open_needs_a_closed_to_open_transition() {
        let mut list = vec![alert(AlertKind::MarketOpen, 0.0)];
        let mut states = HashMap::new();
        let at = |s| Facts { session: Some(s), ..Facts::default() };
        assert!(run(&mut list, &mut states, &at(Session::Regular), 1).is_empty());
        assert!(run(&mut list, &mut states, &at(Session::Post), 2).is_empty());
        assert!(run(&mut list, &mut states, &Facts::default(), 3).is_empty());
        assert_eq!(run(&mut list, &mut states, &at(Session::Regular), 4), ["AAPL: the regular session has opened."]);
        assert!(!list[0].enabled);
    }

    #[test]
    fn market_close_recurs_daily() {
        let mut list = vec![PriceAlert { recurring: true, ..alert(AlertKind::MarketClose, 0.0) }];
        let mut states = HashMap::new();
        let at = |s| Facts { session: Some(s), ..Facts::default() };
        assert!(run(&mut list, &mut states, &at(Session::Post), 1).is_empty());
        assert!(run(&mut list, &mut states, &at(Session::Regular), 2).is_empty());
        assert_eq!(run(&mut list, &mut states, &at(Session::Post), 3).len(), 1);
        assert!(list[0].enabled);
        assert!(run(&mut list, &mut states, &at(Session::Closed), 4).is_empty());
        assert!(run(&mut list, &mut states, &at(Session::Regular), 5).is_empty());
        assert_eq!(run(&mut list, &mut states, &at(Session::Closed), 6).len(), 1);
    }

    #[test]
    fn relative_volume_fires_on_the_way_up_and_recurring_needs_a_dip() {
        let mut list = vec![PriceAlert { recurring: true, ..alert(AlertKind::RelVolume, 2.0) }];
        let mut states = HashMap::new();
        let rv = |v| Facts { rel_volume: Some(v), ..Facts::default() };
        assert!(run(&mut list, &mut states, &rv(1.5), 1).is_empty());
        assert_eq!(run(&mut list, &mut states, &rv(2.4), 2), ["AAPL relative volume is 2.4x, above 2x."]);
        assert!(run(&mut list, &mut states, &rv(3.0), 3).is_empty());
        assert!(run(&mut list, &mut states, &rv(1.0), 4).is_empty());
        assert_eq!(run(&mut list, &mut states, &rv(2.0), 5).len(), 1);
    }

    #[test]
    fn news_only_counts_headlines_after_arming() {
        let mut list = vec![alert(AlertKind::News, 0.0)];
        let mut states = HashMap::new();
        let story = |t| Facts { news: Some((t, "Big deal".into())), ..Facts::default() };
        assert!(run(&mut list, &mut states, &story(500), 1000).is_empty());
        assert_eq!(list[0].reference, Some(1000.0));
        assert!(run(&mut list, &mut states, &story(900), 1010).is_empty());
        assert_eq!(run(&mut list, &mut states, &story(1005), 1020), ["AAPL: Big deal"]);
        assert!(!list[0].enabled);
    }

    #[test]
    fn recurring_news_advances_its_baseline() {
        let mut list = vec![PriceAlert { recurring: true, reference: Some(10.0), ..alert(AlertKind::News, 0.0) }];
        let mut states = HashMap::new();
        let story = |t| Facts { news: Some((t, "x".into())), ..Facts::default() };
        assert_eq!(run(&mut list, &mut states, &story(20), 30).len(), 1);
        assert_eq!(list[0].reference, Some(20.0));
        assert!(run(&mut list, &mut states, &story(20), 31).is_empty());
        assert_eq!(run(&mut list, &mut states, &story(25), 32).len(), 1);
    }

    #[test]
    fn failed_dispatch_retries_and_snooze_or_expiry_silence() {
        let near = Facts { earnings_days: Some(1), ..Facts::default() };
        let mut list = vec![alert(AlertKind::EarningsDays, 3.0)];
        let mut states = HashMap::new();
        assert!(!evaluate(&mut list, &mut states, "AAPL", &near, 1, |_, _| false));
        assert!(list[0].enabled && !states.contains_key(&1));
        assert_eq!(run(&mut list, &mut states, &near, 2).len(), 1);

        let mut snoozed = vec![PriceAlert { snooze_until: Some(10), ..alert(AlertKind::EarningsDays, 3.0) }];
        assert!(run(&mut snoozed, &mut states, &near, 5).is_empty());
        assert_eq!(run(&mut snoozed, &mut states, &near, 10).len(), 1);

        let mut expired = vec![PriceAlert { expires_at: Some(5), ..alert(AlertKind::EarningsDays, 3.0) }];
        assert!(run(&mut expired, &mut states, &near, 5).is_empty());
    }

    #[test]
    fn ignores_price_alerts_and_other_symbols() {
        let near = Facts { earnings_days: Some(1), ..Facts::default() };
        let mut list = vec![alert(AlertKind::Price, 100.0), PriceAlert { symbol: "MSFT".into(), ..alert(AlertKind::EarningsDays, 3.0) }];
        let mut states = HashMap::new();
        assert!(run(&mut list, &mut states, &near, 1).is_empty());
    }
}
