//! Background quote polling. Runs for the life of the app, window or not.

use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::quote::{self, Session};
use crate::settings::RefreshMode;
use crate::state::{lock, now_secs, QuoteState, Shared};

fn next_delay(mode: RefreshMode, session: Option<Session>, visible: bool, alerts_armed: bool, failures: u32) -> Duration {
    let low_power = mode == RefreshMode::LowPower && !visible;
    let seconds = if failures > 0 {
        (15u64 << failures.min(5)).min(300)
    } else {
        match (session, low_power) {
            (Some(Session::Regular), false) => 15,
            (Some(Session::Regular), true) => 60,
            (Some(Session::Pre | Session::Post), false) => 60,
            (Some(Session::Pre | Session::Post), true) => 300,
            (Some(Session::Closed), false) => 900,
            (Some(Session::Closed), true) => 1800,
            (None, _) => 60,
        }
    };
    Duration::from_secs(if alerts_armed { seconds.min(15) } else { seconds })
}

fn woke_from_sleep(now: i64, expected: i64) -> bool {
    now.saturating_sub(expected) > 30
}

async fn wait(shared: &Shared, delay: Duration, failures: u32) {
    let deadline = tokio::time::Instant::now() + delay;
    let mut probe_at = tokio::time::Instant::now() + Duration::from_secs(15);
    // A reachable host answering with errors is not a recovery, so keep the backoff.
    let mut unreachable = false;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() { return; }
        let slice = remaining.min(Duration::from_secs(5));
        let expected = now_secs() + slice.as_secs() as i64;
        tokio::select! {
            _ = shared.wake.notified() => return,
            _ = tokio::time::sleep(slice) => {}
        }
        if woke_from_sleep(now_secs(), expected) { return; }
        let now = tokio::time::Instant::now();
        if now >= deadline { return; }
        if failures > 0 && now >= probe_at {
            probe_at = now + Duration::from_secs(15);
            let expected = now_secs() + 3;
            tokio::select! {
                _ = shared.wake.notified() => return,
                _ = tokio::time::sleep_until(deadline) => return,
                response = shared.http.head("https://query1.finance.yahoo.com")
                    .timeout(Duration::from_secs(3)).send() => {
                    if (response.is_ok() && unreachable) || woke_from_sleep(now_secs(), expected) { return; }
                    unreachable = response.is_err();
                }
            }
        }
    }
}

/// Sends the current quote state to every open window.
pub fn emit(app: &AppHandle, shared: &Shared) {
    let q: QuoteState = lock(&shared.quote).clone();
    let _ = app.emit("quote", q);
}

async fn refresh_logo(shared: &Shared, symbol: &str) {
    let have = lock(&shared.logo).as_ref().is_some_and(|(s, _)| s == symbol);
    if have {
        return;
    }
    let bytes = crate::logo::get(&shared.http, symbol).await;
    *lock(&shared.logo) = Some((symbol.to_string(), bytes));
}

pub fn spawn(app: AppHandle, shared: Arc<Shared>) {
    tauri::async_runtime::spawn(async move {
        let mut failures = 0u32;
        loop {
            let symbol = shared.symbol();
            let revision = shared.revision();
            let provider = crate::provider::Provider::current(&shared);
            let result = provider.fetch_quote(&shared.http, &symbol, now_secs()).await;
            lock(&shared.connections).quote.record(&result, now_secs());
            let mut fresh = result.as_ref().ok().cloned();
            if fresh.as_ref().is_some_and(|q| q.source != "yahoo") && lock(&shared.settings).alerts.iter().any(|a| a.enabled && a.symbol == symbol) {
                fresh = quote::fetch_quote(&shared.http, &symbol, now_secs()).await.ok();
            }
            // The symbol may have changed while fetching; drop stale results.
            if shared.symbol() != symbol || shared.revision() != revision {
                continue;
            }
            let session = {
                let settings = lock(&shared.settings);
                if settings.symbol != symbol || shared.revision() != revision { continue; }
                let mut q = lock(&shared.quote);
                match result {
                    Ok(quote) => {
                        failures = 0;
                        let session = quote.session;
                        *q = QuoteState { quote: Some(quote), error: None, updated_at: now_secs() };
                        Some(session)
                    }
                    Err(e) => {
                        failures += 1;
                        log::warn!("quote {symbol}: {e}");
                        q.error = Some(e);
                        None
                    }
                }
            };
            refresh_logo(&shared, &symbol).await;
            crate::tray::update(&app, &shared);
            emit(&app, &shared);
            crate::alerts::poll(&app, &shared, &symbol, fresh.as_ref()).await;

            let visible = crate::window::get(&app).is_some_and(|w| crate::window::shown(&w));
            let delay = {
                let settings = lock(&shared.settings);
                next_delay(settings.refresh_mode, session, visible, settings.alerts.iter().any(|a| a.enabled), failures)
            };
            wait(&shared, delay, failures).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delays() {
        for mode in [RefreshMode::Balanced, RefreshMode::LowPower] {
            for visible in [false, true] {
                for (session, balanced, low) in [
                    (Some(Session::Regular), 15, 60),
                    (Some(Session::Pre), 60, 300),
                    (Some(Session::Post), 60, 300),
                    (Some(Session::Closed), 900, 1800),
                    (None, 60, 60),
                ] {
                    for (failures, backoff) in [(0, 0), (1, 30), (2, 60), (3, 120), (4, 240), (5, 300), (10, 300), (u32::MAX, 300)] {
                        let expected = if failures > 0 { backoff }
                            else if mode == RefreshMode::LowPower && !visible { low } else { balanced };
                        assert_eq!(next_delay(mode, session, visible, false, failures), Duration::from_secs(expected));
                        assert_eq!(next_delay(mode, session, visible, true, failures), Duration::from_secs(15));
                    }
                }
            }
        }
    }

    #[test]
    fn detects_wall_clock_jump() {
        assert!(!woke_from_sleep(105, 105));
        assert!(!woke_from_sleep(135, 105));
        assert!(woke_from_sleep(136, 105));
        assert!(woke_from_sleep(3705, 105));
        assert!(!woke_from_sleep(90, 105));
    }
}
