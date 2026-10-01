//! Background quote polling. Runs for the life of the app, window or not.

use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::quote::{self, Session};
use crate::state::{lock, now_secs, QuoteState, Shared};

fn interval(session: Option<Session>) -> Duration {
    Duration::from_secs(match session {
        Some(Session::Regular) => 15,
        Some(Session::Pre | Session::Post) => 60,
        Some(Session::Closed) => 15 * 60,
        None => 60,
    })
}

fn backoff(failures: u32) -> Duration {
    Duration::from_secs((15u64 << failures.min(5)).min(300))
}

/// Sends the current quote state to the window, if it exists.
pub fn emit(app: &AppHandle, shared: &Shared) {
    let q: QuoteState = lock(&shared.quote).clone();
    let _ = app.emit_to(crate::window::LABEL, "quote", q);
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
            let result = quote::fetch_quote(&shared.http, &symbol, now_secs()).await;
            // The symbol may have changed while fetching; drop stale results.
            if shared.symbol() != symbol {
                continue;
            }
            let session = {
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

            let delay = if failures > 0 { backoff(failures) } else { interval(session) };
            tokio::select! {
                _ = tokio::time::sleep(delay) => {}
                _ = shared.wake.notified() => {}
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delays() {
        assert_eq!(interval(Some(Session::Regular)), Duration::from_secs(15));
        assert_eq!(interval(Some(Session::Closed)), Duration::from_secs(900));
        assert_eq!(backoff(1), Duration::from_secs(30));
        assert_eq!(backoff(10), Duration::from_secs(300));
    }
}
