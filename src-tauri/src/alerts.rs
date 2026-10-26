//! Per-symbol, one-shot price alerts. The poller runs even without a window.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

use crate::quote::{self, Quote};
use crate::state::{lock, now_secs, Shared};

pub const MAX_ALERTS: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Above,
    Below,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PriceAlert {
    pub id: u32,
    pub symbol: String,
    pub direction: Direction,
    pub level: f64,
    pub enabled: bool,
    pub triggered_at: Option<i64>,
}

pub fn validate(symbol: &str, level: f64) -> Result<String, String> {
    let symbol = symbol.trim().to_uppercase();
    if symbol.is_empty()
        || symbol.len() > 32
        || !symbol
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-^=&_".contains(&b))
    {
        return Err("Enter a valid symbol.".into());
    }
    if !level.is_finite() || level <= 0.0 {
        return Err("Price must be a finite number greater than zero.".into());
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

/// Keep state transitions independent of the OS so one-shot and retry behavior
/// can be tested without sending real desktop notifications.
fn evaluate(
    alerts: &mut [PriceAlert],
    prices: &mut HashMap<u32, f64>,
    symbol: &str,
    current: f64,
    now: i64,
    mut notify: impl FnMut(&PriceAlert) -> bool,
) -> bool {
    if !current.is_finite() || current <= 0.0 {
        return false;
    }
    let mut changed = false;
    for alert in alerts
        .iter_mut()
        .filter(|a| a.enabled && a.symbol == symbol)
    {
        let previous = prices.get(&alert.id).copied();
        if crossed(alert.direction, alert.level, previous, current) {
            // Retain the old baseline when dispatch fails so a later poll can retry.
            if !notify(alert) {
                continue;
            }
            alert.enabled = false;
            alert.triggered_at = Some(now);
            prices.remove(&alert.id);
            changed = true;
        } else {
            prices.insert(alert.id, current);
        }
    }
    changed
}

pub fn emit(app: &AppHandle, shared: &Shared) {
    let alerts = lock(&shared.settings).alerts.clone();
    let _ = app.emit_to(crate::window::LABEL, "alerts", alerts);
}

/// Re-check the live configuration after network requests: deleted or paused
/// alerts must not fire from an in-flight quote.
fn observe(app: &AppHandle, shared: &Shared, symbol: &str, current: f64, currency: &str) {
    let changed;
    {
        let mut settings = lock(&shared.settings);
        let mut prices = lock(&shared.alert_prices);
        changed = evaluate(
            &mut settings.alerts,
            &mut prices,
            symbol,
            current,
            now_secs(),
            |alert| {
                let direction = match alert.direction {
                    Direction::Above => "at or above",
                    Direction::Below => "at or below",
                };
                let body = format!(
                    "{symbol} is {current:.4} {currency}, {direction} your {:.4} alert.",
                    alert.level
                );
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
            observe(app, shared, selected, price(q), &q.currency);
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
                Ok((symbol, Ok(q))) => observe(app, shared, &symbol, price(&q), &q.currency),
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
        assert_eq!(validate(" btc-usd ", 0.001).unwrap(), "BTC-USD");
        assert_eq!(validate("^gspc", 5000.0).unwrap(), "^GSPC");
        assert!(validate("", 10.0).is_err());
        assert!(validate("AAPL/../", 10.0).is_err());
        for bad in [f64::NAN, f64::INFINITY, 0.0, -1.0] {
            assert!(validate("AAPL", bad).is_err());
        }
    }

    fn alert(id: u32, symbol: &str, enabled: bool) -> PriceAlert {
        PriceAlert {
            id,
            symbol: symbol.into(),
            direction: Direction::Above,
            level: 100.0,
            enabled,
            triggered_at: None,
        }
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
            99.0,
            1,
            |_| panic!("baseline")
        ));
        let mut sent = Vec::new();
        assert!(evaluate(&mut alerts, &mut prices, "AAPL", 101.0, 2, |a| {
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
            102.0,
            3,
            |_| panic!("already triggered")
        ));
        // Rearming gets a new baseline, even if the price is already beyond the level.
        alerts[0].enabled = true;
        alerts[0].triggered_at = None;
        assert!(!evaluate(
            &mut alerts,
            &mut prices,
            "AAPL",
            102.0,
            4,
            |_| panic!("rearm baseline")
        ));
        assert!(!evaluate(&mut alerts, &mut prices, "AAPL", 99.0, 5, |_| {
            true
        }));
        assert!(evaluate(&mut alerts, &mut prices, "AAPL", 100.0, 6, |_| {
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
            f64::NAN,
            1,
            |_| panic!("invalid")
        ));
        assert!(!evaluate(
            &mut alerts,
            &mut prices,
            "AAPL",
            101.0,
            2,
            |_| false
        ));
        assert!(alerts[0].enabled);
        assert_eq!(alerts[0].triggered_at, None);
        assert_eq!(prices[&1], 99.0);
        assert!(evaluate(&mut alerts, &mut prices, "AAPL", 102.0, 3, |_| {
            true
        }));
        assert!(!prices.contains_key(&1));
    }
}
