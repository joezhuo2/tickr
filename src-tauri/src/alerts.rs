//! Per-symbol price alerts, one-shot or recurring. The poller runs even without a window.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

use crate::quote::{self, Quote, Session};
use crate::state::{lock, now_secs, Shared};

pub const MAX_ALERTS: usize = 50;
pub const MAX_COOLDOWN_MINS: u32 = 10080;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Above,
    Below,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlertKind {
    #[default]
    Price,
    DayPercent,
    ArmedPercent,
    TrailPercent,
    TrailAmount,
}

impl AlertKind {
    fn tracks_reference(self) -> bool {
        matches!(self, Self::ArmedPercent | Self::TrailPercent | Self::TrailAmount)
    }

    fn trails(self) -> bool {
        matches!(self, Self::TrailPercent | Self::TrailAmount)
    }

    fn is_percent(self) -> bool {
        matches!(self, Self::DayPercent | Self::ArmedPercent | Self::TrailPercent)
    }
}

fn default_cooldown() -> u32 {
    15
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PriceAlert {
    pub id: u32,
    pub symbol: String,
    pub direction: Direction,
    pub level: f64,
    pub enabled: bool,
    pub triggered_at: Option<i64>,
    #[serde(default)]
    pub kind: AlertKind,
    #[serde(default)]
    pub reference: Option<f64>,
    #[serde(default)]
    pub recurring: bool,
    #[serde(default = "default_cooldown")]
    pub cooldown_mins: u32,
    #[serde(default)]
    pub regular_only: bool,
    #[serde(default)]
    pub triggered_price: Option<f64>,
}

fn has_twin(alerts: &[PriceAlert], symbol: &str, kind: AlertKind, direction: Direction, level: f64, ignoring: Option<u32>) -> bool {
    alerts.iter().any(|a| {
        Some(a.id) != ignoring && a.symbol == symbol && a.kind == kind && a.direction == direction && a.level == level
    })
}

pub fn ensure_room(alerts: &[PriceAlert]) -> Result<(), String> {
    if alerts.len() >= MAX_ALERTS {
        return Err(format!("You can save up to {MAX_ALERTS} alerts. Delete one first."));
    }
    Ok(())
}

fn next_id(alerts: &[PriceAlert]) -> Result<u32, String> {
    alerts.iter().map(|a| a.id).max().unwrap_or(0).checked_add(1).ok_or_else(|| "Alert IDs exhausted.".to_string())
}

fn position(alerts: &[PriceAlert], id: u32) -> Result<usize, String> {
    alerts.iter().position(|a| a.id == id).ok_or_else(|| "Alert no longer exists.".to_string())
}

#[allow(clippy::too_many_arguments)]
pub fn add(
    alerts: &mut Vec<PriceAlert>,
    symbol: String,
    kind: AlertKind,
    direction: Direction,
    level: f64,
    recurring: bool,
    cooldown_mins: u32,
    regular_only: bool,
) -> Result<(), String> {
    ensure_room(alerts)?;
    if has_twin(alerts, &symbol, kind, direction, level, None) {
        return Err("An alert for this symbol, kind, direction and level already exists.".into());
    }
    let id = next_id(alerts)?;
    alerts.push(PriceAlert {
        id,
        symbol,
        direction,
        level,
        enabled: true,
        triggered_at: None,
        kind,
        reference: None,
        recurring,
        cooldown_mins,
        regular_only,
        triggered_price: None,
    });
    Ok(())
}

pub fn set_enabled(alerts: &mut [PriceAlert], id: u32, enabled: bool) -> Result<(), String> {
    let index = position(alerts, id)?;
    let alert = &mut alerts[index];
    alert.enabled = enabled;
    if enabled {
        alert.triggered_at = None;
        alert.triggered_price = None;
        alert.reference = None;
    }
    Ok(())
}

pub fn update(alerts: &mut [PriceAlert], id: u32, level: f64, direction: Direction) -> Result<(), String> {
    let index = position(alerts, id)?;
    let current = &alerts[index];
    validate(&current.symbol, level, current.kind, direction)?;
    let moved = current.level != level || current.direction != direction;
    if moved && has_twin(alerts, &current.symbol, current.kind, direction, level, Some(id)) {
        return Err("An alert for this symbol, kind, direction and level already exists.".into());
    }
    let alert = &mut alerts[index];
    if alert.direction != direction && alert.kind.tracks_reference() {
        alert.reference = None;
    }
    alert.level = level;
    alert.direction = direction;
    Ok(())
}

pub fn duplicate(alerts: &mut Vec<PriceAlert>, id: u32) -> Result<(), String> {
    let index = position(alerts, id)?;
    ensure_room(alerts)?;
    let copy = PriceAlert {
        id: next_id(alerts)?,
        enabled: false,
        triggered_at: None,
        triggered_price: None,
        reference: None,
        ..alerts[index].clone()
    };
    alerts.insert(index + 1, copy);
    Ok(())
}

pub fn validate(symbol: &str, level: f64, kind: AlertKind, direction: Direction) -> Result<String, String> {
    let symbol = symbol.trim().to_uppercase();
    if symbol.is_empty()
        || symbol.len() > 32
        || !symbol
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-^=&_".contains(&b))
    {
        return Err("Enter a valid symbol.".into());
    }
    let noun = match kind {
        AlertKind::Price => "Price",
        AlertKind::TrailAmount => "Amount",
        _ => "Percent",
    };
    if !level.is_finite() || level <= 0.0 {
        return Err(format!("{noun} must be a finite number greater than zero."));
    }
    if kind.is_percent() && direction == Direction::Below && level >= 100.0 {
        return Err("Percent must be less than 100 for a drop.".into());
    }
    Ok(symbol)
}

/// The first successful observation establishes a baseline, never an alert.
fn crossed(direction: Direction, level: f64, previous: Option<f64>, current: f64) -> bool {
    if !level.is_finite() || level <= 0.0 || !current.is_finite() || current <= 0.0 {
        return false;
    }
    previous
        .filter(|p| p.is_finite() && *p > 0.0)
        .is_some_and(|p| match direction {
            Direction::Above => p < level && current >= level,
            Direction::Below => p > level && current <= level,
        })
}

fn price(q: &Quote) -> f64 {
    q.extended.as_ref().map_or(q.price, |e| e.price)
}

struct Observed {
    price: f64,
    regular: f64,
    prev_close: Option<f64>,
    session: Session,
}

impl Observed {
    fn new(q: &Quote) -> Self {
        Self { price: price(q), regular: q.price, prev_close: q.prev_close, session: q.session }
    }
}

fn valid(p: f64) -> bool {
    p.is_finite() && p > 0.0
}

fn trigger(alert: &PriceAlert, reference: f64, prev_close: Option<f64>) -> Option<f64> {
    let up = alert.direction == Direction::Above;
    let pct = |base: f64| base * if up { 1.0 + alert.level / 100.0 } else { 1.0 - alert.level / 100.0 };
    Some(match alert.kind {
        AlertKind::Price => alert.level,
        AlertKind::DayPercent => pct(prev_close.filter(|p| valid(*p))?),
        AlertKind::ArmedPercent | AlertKind::TrailPercent => pct(reference),
        AlertKind::TrailAmount if up => reference + alert.level,
        AlertKind::TrailAmount => reference - alert.level,
    })
}

/// Keep state transitions independent of the OS so one-shot and retry behavior
/// can be tested without sending real desktop notifications.
fn evaluate(
    alerts: &mut [PriceAlert],
    prices: &mut HashMap<u32, f64>,
    symbol: &str,
    obs: &Observed,
    now: i64,
    mut notify: impl FnMut(&PriceAlert, f64) -> bool,
) -> bool {
    if !valid(obs.price) {
        return false;
    }
    let mut changed = false;
    for alert in alerts
        .iter_mut()
        .filter(|a| a.enabled && a.symbol == symbol)
    {
        let current = if alert.regular_only {
            if obs.session != Session::Regular || !valid(obs.regular) {
                continue;
            }
            obs.regular
        } else {
            obs.price
        };
        let tracks = alert.kind.tracks_reference();
        if tracks && alert.reference.is_none() {
            alert.reference = Some(current);
            prices.insert(alert.id, current);
            changed = true;
            continue;
        }
        let reference = alert.reference.unwrap_or(current);
        let Some(trigger) = trigger(alert, reference, obs.prev_close) else {
            continue;
        };
        // A stop breached while the app was closed fires on the first observation after restart.
        let previous = prices
            .get(&alert.id)
            .copied()
            .or(alert.reference.filter(|_| tracks));
        let cooling = alert.recurring
            && alert
                .triggered_at
                .is_some_and(|t| now - t < i64::from(alert.cooldown_mins) * 60);
        if !cooling && crossed(alert.direction, trigger, previous, current) {
            // Retain the old baseline when dispatch fails so a later poll can retry.
            if !notify(alert, current) {
                continue;
            }
            alert.triggered_at = Some(now);
            alert.triggered_price = Some(current);
            if alert.recurring {
                prices.insert(alert.id, current);
                if tracks {
                    alert.reference = Some(current);
                }
            } else {
                alert.enabled = false;
                prices.remove(&alert.id);
            }
            changed = true;
        } else {
            prices.insert(alert.id, current);
            let extreme = match alert.direction {
                Direction::Below => current > reference,
                Direction::Above => current < reference,
            };
            if alert.kind.trails() && extreme {
                alert.reference = Some(current);
                changed = true;
            }
        }
    }
    changed
}

fn describe(alert: &PriceAlert, symbol: &str, current: f64, currency: &str) -> String {
    let up = alert.direction == Direction::Above;
    let level = alert.level;
    let reference = alert.reference.unwrap_or(current);
    let (side, extreme) = if up { ("above", "low") } else { ("below", "high") };
    let moved = if up { "up" } else { "down" };
    let what = match alert.kind {
        AlertKind::Price => format!("{} your {level:.4} alert", if up { "at or above" } else { "at or below" }),
        AlertKind::DayPercent => format!("{moved} {level}% from yesterday's close"),
        AlertKind::ArmedPercent => format!("{moved} {level}% since armed at {reference:.4}"),
        AlertKind::TrailPercent => format!("{level}% {side} its {reference:.4} {extreme}"),
        AlertKind::TrailAmount => format!("{level} {currency} {side} its {reference:.4} {extreme}"),
    };
    format!("{symbol} is {current:.4} {currency}, {what}.")
}

pub fn emit(app: &AppHandle, shared: &Shared) {
    let alerts = lock(&shared.settings).alerts.clone();
    let _ = app.emit_to(crate::window::LABEL, "alerts", alerts);
}

/// Re-check the live configuration after network requests: deleted or paused
/// alerts must not fire from an in-flight quote.
fn observe(app: &AppHandle, shared: &Shared, symbol: &str, q: &Quote) {
    let changed;
    {
        let mut settings = lock(&shared.settings);
        let mut prices = lock(&shared.alert_prices);
        changed = evaluate(
            &mut settings.alerts,
            &mut prices,
            symbol,
            &Observed::new(q),
            now_secs(),
            |alert, current| {
                let body = describe(alert, symbol, current, &q.currency);
                if let Err(e) = app
                    .notification()
                    .builder()
                    .title(format!("tickr · {symbol} price alert"))
                    .body(body)
                    .show()
                {
                    log::warn!("price alert {symbol}: {e}");
                    return false;
                }
                true
            },
        );
        if changed {
            if let Err(e) = settings.save(&shared.settings_path) {
                log::warn!("save triggered alerts: {e}");
            }
        }
    }
    if changed {
        emit(app, shared);
    }
}

/// Checks the selected symbol's alerts against its streamed quote, so a
/// crossing is caught between polls.
pub fn observe_selected(app: &AppHandle, shared: &Shared, symbol: &str) {
    let quote = lock(&shared.quote).quote.clone().filter(|q| q.symbol == symbol);
    if let Some(q) = quote {
        observe(app, shared, symbol, &q);
    }
}

/// Reuse the selected symbol's fresh quote; fetch other alert symbols once each,
/// at most four at a time. Failed requests leave crossing baselines untouched.
pub async fn poll(app: &AppHandle, shared: &Shared, selected: &str, fresh: Option<&Quote>) {
    let symbols: HashSet<_> = lock(&shared.settings)
        .alerts
        .iter()
        .filter(|a| a.enabled)
        .map(|a| a.symbol.clone())
        .collect();
    if symbols.contains(selected) {
        if let Some(q) = fresh {
            observe(app, shared, selected, q);
        }
    }
    let others: Vec<_> = symbols.into_iter().filter(|s| s != selected).collect();
    for batch in others.chunks(4) {
        let tasks: Vec<_> = batch
            .iter()
            .map(|symbol| {
                let symbol = symbol.clone();
                let http = shared.http.clone();
                tauri::async_runtime::spawn(async move {
                    let result = quote::fetch_quote(&http, &symbol, now_secs()).await;
                    (symbol, result)
                })
            })
            .collect();
        for task in tasks {
            match task.await {
                Ok((symbol, Ok(q))) => observe(app, shared, &symbol, &q),
                Ok((symbol, Err(e))) => log::warn!("alert quote {symbol}: {e}"),
                Err(e) => log::warn!("alert quote task: {e}"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crosses_both_directions_including_exact_level() {
        assert!(crossed(Direction::Above, 100.0, Some(99.0), 100.0));
        assert!(crossed(Direction::Above, 100.0, Some(99.0), 105.0));
        assert!(crossed(Direction::Below, 100.0, Some(101.0), 100.0));
        assert!(crossed(Direction::Below, 100.0, Some(101.0), 95.0));
        assert!(!crossed(Direction::Above, 100.0, Some(101.0), 102.0));
        assert!(!crossed(Direction::Below, 100.0, Some(99.0), 98.0));
        assert!(!crossed(Direction::Above, 100.0, Some(105.0), 99.0));
        assert!(!crossed(Direction::Below, 100.0, Some(95.0), 101.0));
        assert!(!crossed(Direction::Above, 100.0, Some(100.0), 100.0));
    }

    #[test]
    fn first_observation_and_invalid_prices_do_not_trigger() {
        assert!(!crossed(Direction::Above, 100.0, None, 110.0));
        assert!(!crossed(Direction::Below, 100.0, None, 90.0));
        for bad in [f64::NAN, f64::INFINITY, 0.0, -1.0] {
            assert!(!crossed(Direction::Above, 100.0, Some(99.0), bad));
            assert!(!crossed(Direction::Above, 100.0, Some(bad), 110.0));
            assert!(!crossed(Direction::Above, bad, Some(99.0), 110.0));
        }
    }

    #[test]
    fn validates_and_normalizes_levels_and_symbols() {
        let (p, a) = (AlertKind::Price, Direction::Above);
        assert_eq!(validate(" btc-usd ", 0.001, p, a).unwrap(), "BTC-USD");
        assert_eq!(validate("^gspc", 5000.0, p, a).unwrap(), "^GSPC");
        assert!(validate("", 10.0, p, a).is_err());
        assert!(validate("AAPL/../", 10.0, p, a).is_err());
        for bad in [f64::NAN, f64::INFINITY, 0.0, -1.0] {
            assert!(validate("AAPL", bad, p, a).is_err());
        }
    }

    #[test]
    fn percent_drops_must_be_under_100_and_messages_name_the_unit() {
        for kind in [AlertKind::DayPercent, AlertKind::ArmedPercent, AlertKind::TrailPercent] {
            assert!(validate("AAPL", 99.0, kind, Direction::Below).is_ok());
            assert!(validate("AAPL", 100.0, kind, Direction::Below).is_err());
            assert!(validate("AAPL", 250.0, kind, Direction::Above).is_ok());
            assert!(validate("AAPL", 0.0, kind, Direction::Above).unwrap_err().starts_with("Percent"));
        }
        assert!(validate("AAPL", 500.0, AlertKind::TrailAmount, Direction::Below).is_ok());
        assert!(validate("AAPL", 0.0, AlertKind::TrailAmount, Direction::Below).unwrap_err().starts_with("Amount"));
    }

    #[test]
    fn old_json_alert_loads_as_one_shot_price_alert() {
        let a: PriceAlert = serde_json::from_str(
            r#"{"id":1,"symbol":"AAPL","direction":"above","level":250.0,"enabled":true,"triggered_at":null}"#,
        )
        .unwrap();
        assert_eq!(a.kind, AlertKind::Price);
        assert_eq!(a.reference, None);
        assert!(!a.recurring);
        assert_eq!(a.cooldown_mins, 15);
        assert!(!a.regular_only);
        assert_eq!(a.triggered_price, None);
    }

    #[test]
    fn old_json_triggered_alert_keeps_time_and_has_no_price() {
        let a: PriceAlert = serde_json::from_str(
            r#"{"id":4,"symbol":"AAPL","direction":"below","level":150.0,"enabled":false,"triggered_at":1700000000,"kind":"price","recurring":false}"#,
        )
        .unwrap();
        assert_eq!(a.triggered_at, Some(1_700_000_000));
        assert_eq!(a.triggered_price, None);
        assert!(!a.enabled);
        let saved = serde_json::to_string(&PriceAlert { triggered_price: Some(149.5), ..a }).unwrap();
        let back: PriceAlert = serde_json::from_str(&saved).unwrap();
        assert_eq!(back.triggered_price, Some(149.5));
    }

    fn alert(id: u32, symbol: &str, enabled: bool) -> PriceAlert {
        PriceAlert {
            id,
            symbol: symbol.into(),
            direction: Direction::Above,
            level: 100.0,
            enabled,
            triggered_at: None,
            kind: AlertKind::Price,
            reference: None,
            recurring: false,
            cooldown_mins: 15,
            regular_only: false,
            triggered_price: None,
        }
    }

    fn kind_alert(kind: AlertKind, direction: Direction, level: f64) -> PriceAlert {
        PriceAlert { kind, direction, level, ..alert(1, "AAPL", true) }
    }

    fn obs(p: f64) -> Observed {
        Observed { price: p, regular: p, prev_close: None, session: Session::Regular }
    }

    fn run(alerts: &mut [PriceAlert], prices: &mut HashMap<u32, f64>, o: Observed, now: i64) -> (bool, usize) {
        let mut sent = 0;
        let changed = evaluate(alerts, prices, "AAPL", &o, now, |_, _| {
            sent += 1;
            true
        });
        (changed, sent)
    }

    #[test]
    fn fires_once_and_ignores_other_symbols_and_paused_alerts() {
        let mut alerts = vec![
            alert(1, "AAPL", true),
            alert(2, "MSFT", true),
            alert(3, "AAPL", false),
        ];
        let mut prices = HashMap::new();
        assert!(!evaluate(
            &mut alerts,
            &mut prices,
            "AAPL",
            &obs(99.0),
            1,
            |_, _| panic!("baseline")
        ));
        let mut sent = Vec::new();
        assert!(evaluate(&mut alerts, &mut prices, "AAPL", &obs(101.0), 2, |a, _| {
            sent.push(a.id);
            true
        }));
        assert_eq!(sent, [1]);
        assert_eq!(alerts[0].triggered_at, Some(2));
        assert!(!alerts[0].enabled);
        assert!(alerts[1].enabled);
        assert_eq!(alerts[2].triggered_at, None);
        assert!(!evaluate(
            &mut alerts,
            &mut prices,
            "AAPL",
            &obs(102.0),
            3,
            |_, _| panic!("already triggered")
        ));
        // Rearming gets a new baseline, even if the price is already beyond the level.
        alerts[0].enabled = true;
        alerts[0].triggered_at = None;
        assert!(!evaluate(
            &mut alerts,
            &mut prices,
            "AAPL",
            &obs(102.0),
            4,
            |_, _| panic!("rearm baseline")
        ));
        assert!(!evaluate(&mut alerts, &mut prices, "AAPL", &obs(99.0), 5, |_, _| {
            true
        }));
        assert!(evaluate(&mut alerts, &mut prices, "AAPL", &obs(100.0), 6, |_, _| {
            true
        }));
    }

    #[test]
    fn failed_dispatch_and_invalid_quotes_preserve_baseline_for_retry() {
        let mut alerts = vec![alert(1, "AAPL", true)];
        let mut prices = HashMap::from([(1, 99.0)]);
        assert!(!evaluate(
            &mut alerts,
            &mut prices,
            "AAPL",
            &obs(f64::NAN),
            1,
            |_, _| panic!("invalid")
        ));
        assert!(!evaluate(
            &mut alerts,
            &mut prices,
            "AAPL",
            &obs(101.0),
            2,
            |_, _| false
        ));
        assert!(alerts[0].enabled);
        assert_eq!(alerts[0].triggered_at, None);
        assert_eq!(prices[&1], 99.0);
        assert!(evaluate(&mut alerts, &mut prices, "AAPL", &obs(102.0), 3, |_, _| {
            true
        }));
        assert!(!prices.contains_key(&1));
    }

    #[test]
    fn day_percent_uses_prev_close_in_both_directions() {
        let with_close = |p: f64| Observed { prev_close: Some(200.0), ..obs(p) };
        let mut down = vec![kind_alert(AlertKind::DayPercent, Direction::Below, 5.0)];
        let mut prices = HashMap::new();
        assert_eq!(run(&mut down, &mut prices, with_close(195.0), 1), (false, 0));
        assert_eq!(run(&mut down, &mut prices, with_close(190.5), 2), (false, 0));
        assert_eq!(run(&mut down, &mut prices, with_close(189.0), 3), (true, 1));
        assert!(!down[0].enabled);

        let mut up = vec![kind_alert(AlertKind::DayPercent, Direction::Above, 5.0)];
        let mut prices = HashMap::new();
        assert_eq!(run(&mut up, &mut prices, with_close(205.0), 1), (false, 0));
        assert_eq!(run(&mut up, &mut prices, with_close(211.0), 2), (true, 1));
    }

    #[test]
    fn day_percent_without_prev_close_is_skipped_and_leaves_baseline() {
        let mut alerts = vec![kind_alert(AlertKind::DayPercent, Direction::Below, 5.0)];
        let mut prices = HashMap::new();
        assert_eq!(run(&mut alerts, &mut prices, obs(150.0), 1), (false, 0));
        assert!(prices.is_empty());
        prices.insert(1, 195.0);
        assert_eq!(run(&mut alerts, &mut prices, obs(150.0), 2), (false, 0));
        assert_eq!(prices[&1], 195.0);
        assert!(alerts[0].enabled);
    }

    #[test]
    fn armed_percent_sets_reference_then_fires() {
        let mut alerts = vec![kind_alert(AlertKind::ArmedPercent, Direction::Above, 5.0)];
        let mut prices = HashMap::new();
        assert_eq!(run(&mut alerts, &mut prices, obs(100.0), 1), (true, 0));
        assert_eq!(alerts[0].reference, Some(100.0));
        assert_eq!(run(&mut alerts, &mut prices, obs(104.0), 2), (false, 0));
        assert_eq!(run(&mut alerts, &mut prices, obs(106.0), 3), (true, 1));
        assert!(!alerts[0].enabled);
    }

    #[test]
    fn trailing_follows_new_high_then_fires_on_the_fall() {
        for (kind, level, drop_ok, drop_fire) in [
            (AlertKind::TrailPercent, 10.0, 109.0, 107.0),
            (AlertKind::TrailAmount, 12.0, 109.0, 107.0),
        ] {
            let mut alerts = vec![kind_alert(kind, Direction::Below, level)];
            let mut prices = HashMap::new();
            assert_eq!(run(&mut alerts, &mut prices, obs(100.0), 1), (true, 0));
            assert_eq!(run(&mut alerts, &mut prices, obs(120.0), 2), (true, 0));
            assert_eq!(alerts[0].reference, Some(120.0));
            assert_eq!(run(&mut alerts, &mut prices, obs(drop_ok), 3), (false, 0));
            assert_eq!(alerts[0].reference, Some(120.0));
            assert_eq!(run(&mut alerts, &mut prices, obs(drop_fire), 4), (true, 1));
            assert!(!alerts[0].enabled);
        }
    }

    #[test]
    fn trailing_above_follows_new_low() {
        let mut alerts = vec![kind_alert(AlertKind::TrailAmount, Direction::Above, 8.0)];
        let mut prices = HashMap::new();
        assert_eq!(run(&mut alerts, &mut prices, obs(100.0), 1), (true, 0));
        assert_eq!(run(&mut alerts, &mut prices, obs(80.0), 2), (true, 0));
        assert_eq!(alerts[0].reference, Some(80.0));
        assert_eq!(run(&mut alerts, &mut prices, obs(87.0), 3), (false, 0));
        assert_eq!(run(&mut alerts, &mut prices, obs(88.5), 4), (true, 1));
    }

    #[test]
    fn stop_breached_across_restart_fires_on_first_observation() {
        let mut alerts = vec![PriceAlert {
            reference: Some(120.0),
            ..kind_alert(AlertKind::TrailAmount, Direction::Below, 5.0)
        }];
        let mut prices = HashMap::new();
        assert_eq!(run(&mut alerts, &mut prices, obs(100.0), 1), (true, 1));
    }

    #[test]
    fn recurring_stays_enabled_and_needs_a_recross() {
        let mut alerts = vec![PriceAlert { recurring: true, cooldown_mins: 0, ..alert(1, "AAPL", true) }];
        let mut prices = HashMap::new();
        assert_eq!(run(&mut alerts, &mut prices, obs(99.0), 1), (false, 0));
        assert_eq!(run(&mut alerts, &mut prices, obs(101.0), 2), (true, 1));
        assert!(alerts[0].enabled);
        assert_eq!(alerts[0].triggered_at, Some(2));
        assert_eq!(run(&mut alerts, &mut prices, obs(102.0), 3), (false, 0));
        assert_eq!(run(&mut alerts, &mut prices, obs(99.0), 4), (false, 0));
        assert_eq!(run(&mut alerts, &mut prices, obs(101.0), 5), (true, 1));
        assert_eq!(alerts[0].triggered_at, Some(5));
    }

    #[test]
    fn recurring_trailing_resets_reference_after_firing() {
        let mut alerts = vec![PriceAlert {
            recurring: true,
            cooldown_mins: 0,
            reference: Some(120.0),
            ..kind_alert(AlertKind::TrailAmount, Direction::Below, 5.0)
        }];
        let mut prices = HashMap::from([(1, 118.0)]);
        assert_eq!(run(&mut alerts, &mut prices, obs(114.0), 1), (true, 1));
        assert_eq!(alerts[0].reference, Some(114.0));
        assert_eq!(run(&mut alerts, &mut prices, obs(110.0), 2), (false, 0));
        assert_eq!(run(&mut alerts, &mut prices, obs(108.0), 3), (true, 1));
    }

    #[test]
    fn cooldown_suppresses_within_window_and_allows_after() {
        let mut alerts = vec![PriceAlert { recurring: true, cooldown_mins: 1, ..alert(1, "AAPL", true) }];
        let mut prices = HashMap::new();
        run(&mut alerts, &mut prices, obs(99.0), 1000);
        assert_eq!(run(&mut alerts, &mut prices, obs(101.0), 1010), (true, 1));
        assert_eq!(run(&mut alerts, &mut prices, obs(99.0), 1020), (false, 0));
        assert_eq!(run(&mut alerts, &mut prices, obs(101.0), 1030), (false, 0));
        assert_eq!(prices[&1], 101.0);
        assert_eq!(alerts[0].triggered_at, Some(1010));
        assert_eq!(run(&mut alerts, &mut prices, obs(99.0), 1040), (false, 0));
        assert_eq!(run(&mut alerts, &mut prices, obs(101.0), 1070), (true, 1));
    }

    #[test]
    fn regular_only_skips_outside_regular_and_uses_regular_price() {
        let mut alerts = vec![PriceAlert { regular_only: true, ..alert(1, "AAPL", true) }];
        let mut prices = HashMap::new();
        let pre = Observed { price: 105.0, regular: 99.0, prev_close: None, session: Session::Pre };
        assert_eq!(run(&mut alerts, &mut prices, pre, 1), (false, 0));
        assert!(prices.is_empty());
        let open = |regular: f64| Observed { price: 90.0, regular, prev_close: None, session: Session::Regular };
        assert_eq!(run(&mut alerts, &mut prices, open(99.0), 2), (false, 0));
        assert_eq!(prices[&1], 99.0);
        assert_eq!(run(&mut alerts, &mut prices, open(101.0), 3), (true, 1));
    }

    #[test]
    fn failed_notify_keeps_baseline_and_reference() {
        let mut alerts = vec![PriceAlert {
            reference: Some(120.0),
            ..kind_alert(AlertKind::TrailAmount, Direction::Below, 5.0)
        }];
        let mut prices = HashMap::from([(1, 116.0)]);
        assert!(!evaluate(&mut alerts, &mut prices, "AAPL", &obs(114.0), 1, |_, _| false));
        assert_eq!(alerts[0].reference, Some(120.0));
        assert_eq!(prices[&1], 116.0);
        assert!(alerts[0].enabled);
        assert_eq!(run(&mut alerts, &mut prices, obs(113.0), 2), (true, 1));
    }

    #[test]
    fn notification_text_describes_the_kind() {
        let day = kind_alert(AlertKind::DayPercent, Direction::Below, 5.0);
        assert_eq!(describe(&day, "AAPL", 188.2, "USD"), "AAPL is 188.2000 USD, down 5% from yesterday's close.");
        let trail = PriceAlert { reference: Some(198.1), ..kind_alert(AlertKind::TrailPercent, Direction::Below, 5.0) };
        assert_eq!(describe(&trail, "AAPL", 188.2, "USD"), "AAPL is 188.2000 USD, 5% below its 198.1000 high.");
    }

    #[test]
    fn firing_records_trigger_price_and_time() {
        let mut alerts = vec![alert(1, "AAPL", true)];
        let mut prices = HashMap::new();
        run(&mut alerts, &mut prices, obs(99.0), 1);
        assert_eq!(run(&mut alerts, &mut prices, obs(101.5), 50), (true, 1));
        assert_eq!(alerts[0].triggered_at, Some(50));
        assert_eq!(alerts[0].triggered_price, Some(101.5));
    }

    #[test]
    fn failed_dispatch_records_no_trigger() {
        let mut alerts = vec![alert(1, "AAPL", true)];
        let mut prices = HashMap::from([(1, 99.0)]);
        assert!(!evaluate(&mut alerts, &mut prices, "AAPL", &obs(101.0), 2, |_, _| false));
        assert_eq!(alerts[0].triggered_at, None);
        assert_eq!(alerts[0].triggered_price, None);
    }

    #[test]
    fn recurring_refire_replaces_trigger_price() {
        let mut alerts = vec![PriceAlert { recurring: true, cooldown_mins: 0, ..alert(1, "AAPL", true) }];
        let mut prices = HashMap::new();
        run(&mut alerts, &mut prices, obs(99.0), 1);
        run(&mut alerts, &mut prices, obs(101.0), 2);
        assert_eq!(alerts[0].triggered_price, Some(101.0));
        run(&mut alerts, &mut prices, obs(99.0), 3);
        run(&mut alerts, &mut prices, obs(104.0), 4);
        assert_eq!((alerts[0].triggered_at, alerts[0].triggered_price), (Some(4), Some(104.0)));
    }

    #[test]
    fn rearming_clears_trigger_details_but_pausing_keeps_them() {
        let mut alerts = vec![PriceAlert { recurring: true, triggered_at: Some(5), triggered_price: Some(101.0), ..alert(1, "AAPL", true) }];
        set_enabled(&mut alerts, 1, false).unwrap();
        assert!(!alerts[0].enabled);
        assert_eq!((alerts[0].triggered_at, alerts[0].triggered_price), (Some(5), Some(101.0)));
        set_enabled(&mut alerts, 1, true).unwrap();
        assert!(alerts[0].enabled);
        assert_eq!((alerts[0].triggered_at, alerts[0].triggered_price), (None, None));
        assert!(set_enabled(&mut alerts, 9, true).is_err());
    }

    #[test]
    fn paused_alert_never_fires_even_when_price_crosses() {
        let mut alerts = vec![alert(1, "AAPL", true)];
        let mut prices = HashMap::new();
        run(&mut alerts, &mut prices, obs(99.0), 1);
        set_enabled(&mut alerts, 1, false).unwrap();
        for (now, p) in [(2, 101.0), (3, 90.0), (4, 150.0)] {
            assert!(!evaluate(&mut alerts, &mut prices, "AAPL", &obs(p), now, |_, _| panic!("paused alert fired")));
        }
        assert_eq!((alerts[0].triggered_at, alerts[0].triggered_price), (None, None));
        assert!(!alerts[0].enabled);
    }

    #[test]
    fn paused_recurring_and_trailing_alerts_never_fire() {
        let mut alerts = vec![
            PriceAlert { recurring: true, cooldown_mins: 0, ..alert(1, "AAPL", true) },
            PriceAlert { reference: Some(120.0), id: 2, ..kind_alert(AlertKind::TrailAmount, Direction::Below, 5.0) },
        ];
        let mut prices = HashMap::from([(1, 99.0), (2, 118.0)]);
        set_enabled(&mut alerts, 1, false).unwrap();
        set_enabled(&mut alerts, 2, false).unwrap();
        assert!(!evaluate(&mut alerts, &mut prices, "AAPL", &obs(101.0), 1, |_, _| panic!("paused fired")));
        assert!(!evaluate(&mut alerts, &mut prices, "AAPL", &obs(100.0), 2, |_, _| panic!("paused fired")));
        assert_eq!(alerts[1].reference, Some(120.0));
    }

    #[test]
    fn resumed_alert_needs_a_fresh_baseline_before_firing() {
        let mut alerts = vec![alert(1, "AAPL", true)];
        let mut prices = HashMap::new();
        run(&mut alerts, &mut prices, obs(99.0), 1);
        set_enabled(&mut alerts, 1, false).unwrap();
        prices.remove(&1);
        set_enabled(&mut alerts, 1, true).unwrap();
        assert_eq!(run(&mut alerts, &mut prices, obs(120.0), 2), (false, 0));
        assert_eq!(run(&mut alerts, &mut prices, obs(99.0), 3), (false, 0));
        assert_eq!(run(&mut alerts, &mut prices, obs(101.0), 4), (true, 1));
    }

    #[test]
    fn update_changes_level_and_direction_and_keeps_state() {
        let mut alerts = vec![PriceAlert { enabled: false, triggered_at: Some(7), triggered_price: Some(101.0), ..alert(1, "AAPL", true) }];
        update(&mut alerts, 1, 120.5, Direction::Below).unwrap();
        assert_eq!((alerts[0].level, alerts[0].direction), (120.5, Direction::Below));
        assert!(!alerts[0].enabled);
        assert_eq!((alerts[0].triggered_at, alerts[0].triggered_price), (Some(7), Some(101.0)));
        assert_eq!(alerts[0].symbol, "AAPL");
    }

    #[test]
    fn update_validates_like_add_and_reports_missing_alerts() {
        let mut alerts = vec![alert(1, "AAPL", true), kind_alert(AlertKind::DayPercent, Direction::Above, 5.0)];
        alerts[1].id = 2;
        for bad in [f64::NAN, f64::INFINITY, 0.0, -3.0] {
            assert!(update(&mut alerts, 1, bad, Direction::Above).is_err());
        }
        assert!(update(&mut alerts, 2, 100.0, Direction::Below).is_err());
        assert!(update(&mut alerts, 2, 99.0, Direction::Below).is_ok());
        assert_eq!(update(&mut alerts, 9, 10.0, Direction::Above).unwrap_err(), "Alert no longer exists.");
        assert_eq!(alerts[0].level, 100.0);
    }

    #[test]
    fn update_rejects_a_twin_but_allows_saving_unchanged_values() {
        let mut alerts = vec![alert(1, "AAPL", true), PriceAlert { level: 110.0, ..alert(2, "AAPL", true) }, alert(3, "AAPL", false)];
        assert!(update(&mut alerts, 2, 100.0, Direction::Above).is_err());
        assert_eq!(alerts[1].level, 110.0);
        assert!(update(&mut alerts, 1, 100.0, Direction::Above).is_ok());
        assert!(update(&mut alerts, 1, 100.0, Direction::Below).is_ok());
        alerts.push(alert(4, "MSFT", true));
        assert!(update(&mut alerts, 4, 110.0, Direction::Above).is_ok());
    }

    #[test]
    fn update_resets_trailing_reference_only_when_direction_changes() {
        let mut alerts = vec![PriceAlert { reference: Some(120.0), ..kind_alert(AlertKind::TrailAmount, Direction::Below, 5.0) }];
        update(&mut alerts, 1, 8.0, Direction::Below).unwrap();
        assert_eq!(alerts[0].reference, Some(120.0));
        update(&mut alerts, 1, 8.0, Direction::Above).unwrap();
        assert_eq!(alerts[0].reference, None);
        let mut plain = vec![PriceAlert { reference: Some(1.0), ..alert(1, "AAPL", true) }];
        update(&mut plain, 1, 100.0, Direction::Below).unwrap();
        assert_eq!(plain[0].reference, Some(1.0));
    }

    #[test]
    fn edited_level_applies_to_the_next_crossing() {
        let mut alerts = vec![alert(1, "AAPL", true)];
        let mut prices = HashMap::new();
        run(&mut alerts, &mut prices, obs(99.0), 1);
        update(&mut alerts, 1, 105.0, Direction::Above).unwrap();
        prices.remove(&1);
        assert_eq!(run(&mut alerts, &mut prices, obs(101.0), 2), (false, 0));
        assert_eq!(run(&mut alerts, &mut prices, obs(105.0), 3), (true, 1));
    }

    #[test]
    fn duplicate_creates_a_paused_copy_right_after_the_original() {
        let mut alerts = vec![
            PriceAlert {
                recurring: true,
                cooldown_mins: 30,
                regular_only: true,
                triggered_at: Some(9),
                triggered_price: Some(101.0),
                reference: Some(98.0),
                ..alert(1, "AAPL", true)
            },
            alert(5, "MSFT", true),
        ];
        duplicate(&mut alerts, 1).unwrap();
        assert_eq!(alerts.iter().map(|a| a.id).collect::<Vec<_>>(), [1, 6, 5]);
        let copy = &alerts[1];
        assert_eq!((copy.symbol.as_str(), copy.level, copy.direction, copy.kind), ("AAPL", 100.0, Direction::Above, AlertKind::Price));
        assert!(copy.recurring && copy.regular_only);
        assert_eq!(copy.cooldown_mins, 30);
        assert!(!copy.enabled);
        assert_eq!((copy.triggered_at, copy.triggered_price, copy.reference), (None, None, None));
        assert!(alerts[0].enabled);
        assert_eq!(alerts[0].triggered_at, Some(9));
    }

    #[test]
    fn duplicate_never_fires_and_respects_limits() {
        let mut alerts = vec![alert(1, "AAPL", true)];
        duplicate(&mut alerts, 1).unwrap();
        let mut prices = HashMap::new();
        let mut sent = Vec::new();
        for (now, p) in [(1, 99.0), (2, 101.0)] {
            evaluate(&mut alerts, &mut prices, "AAPL", &obs(p), now, |a, _| {
                sent.push(a.id);
                true
            });
        }
        assert_eq!(sent, [1]);
        assert_eq!(alerts[1].triggered_at, None);
        assert_eq!(duplicate(&mut alerts, 9).unwrap_err(), "Alert no longer exists.");
        let mut full: Vec<_> = (1..=MAX_ALERTS as u32).map(|i| alert(i, "AAPL", true)).collect();
        assert!(duplicate(&mut full, 1).is_err());
        assert_eq!(full.len(), MAX_ALERTS);
    }

    #[test]
    fn add_rejects_twins_and_full_lists() {
        let mut alerts = Vec::new();
        let add_one = |alerts: &mut Vec<PriceAlert>, level| add(alerts, "AAPL".into(), AlertKind::Price, Direction::Above, level, false, 15, false);
        add_one(&mut alerts, 100.0).unwrap();
        assert!(add_one(&mut alerts, 100.0).is_err());
        add_one(&mut alerts, 101.0).unwrap();
        assert_eq!(alerts.iter().map(|a| a.id).collect::<Vec<_>>(), [1, 2]);
        assert!(alerts.iter().all(|a| a.enabled && a.triggered_price.is_none()));
        let mut full: Vec<_> = (1..=MAX_ALERTS as u32).map(|i| alert(i, "AAPL", true)).collect();
        assert!(add_one(&mut full, 7.0).is_err());
    }
}
