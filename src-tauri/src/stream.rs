use std::sync::Arc;
use std::time::Duration;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::tungstenite::Message;
use crate::alpaca::{self, AlpacaCreds};
use crate::provider::{eligible, Feed, Provider};
use crate::state::{lock, now_secs, Shared};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "lowercase")]
pub enum Status { Off, Connecting, Live, Retrying, Error(String) }

#[derive(Debug, PartialEq)]
pub enum Event { Connected, Authenticated, Trade { symbol: String, price: f64, t: i64 }, Error(u64) }

pub fn parse(text: &str) -> Result<Vec<Event>, String> {
    let value: Value = serde_json::from_str(text).map_err(|_| "Invalid stream JSON")?;
    let values = if let Some(array) = value.as_array() { array.clone() } else { vec![value] };
    let mut events = Vec::new();
    for v in values {
        match v["T"].as_str() {
            Some("success") => match v["msg"].as_str() {
                Some("connected") => events.push(Event::Connected),
                Some("authenticated") => events.push(Event::Authenticated), _ => {},
            },
            Some("error") => events.push(Event::Error(v["code"].as_u64().ok_or("Missing error code")?)),
            Some("t") => {
                let symbol = v["S"].as_str().ok_or("Missing trade symbol")?.to_string();
                let price = v["p"].as_f64().filter(|p| p.is_finite() && *p > 0.0).ok_or("Invalid trade price")?;
                let t = v["t"].as_str().and_then(alpaca::parse_time).ok_or("Invalid trade time")?;
                events.push(Event::Trade { symbol, price, t });
            }
            _ => {},
        }
    }
    Ok(events)
}

pub fn backoff(failures: u32) -> Duration { Duration::from_secs((1u64 << failures.min(6)).min(60)) }
pub fn retry_failures(failures: u32, healthy: Duration) -> u32 { if healthy >= Duration::from_secs(60) { 0 } else { failures } }
pub fn terminal(code: u64) -> bool { matches!(code, 402 | 406 | 409) }
fn error_message(code: u64) -> String {
    match code { 402 => "Authentication failed", 406 => "Connection limit reached", 409 => "Insufficient subscription", _ => "Stream error" }.to_string() + &format!(" ({code})")
}

pub fn set_status(app: &AppHandle, shared: &Shared, status: Status) {
    let mut current = lock(&shared.stream_status);
    if *current != status {
        *current = status.clone();
        let _ = app.emit("stream-status", status);
    }
}

struct Config<'a> { keys: &'a AlpacaCreds, feed: Feed, symbol: &'a str, revision: u64 }

async fn connection(app: &AppHandle, shared: &Shared, config: &Config<'_>, live_since: &mut Option<tokio::time::Instant>) -> Result<(), Option<u64>> {
    let Config { keys, feed, symbol, revision } = *config;
    let (mut socket, _) = tokio::time::timeout(Duration::from_secs(15), tokio_tungstenite::connect_async(feed.stream_url())).await.map_err(|_| None)?.map_err(|_| None)?;
    let mut stage = 0;
    let mut pending = None;
    let mut tick = tokio::time::interval(Duration::from_millis(250));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        tokio::select! {
            _ = tokio::time::sleep_until(deadline), if stage < 2 => return Err(None),
            _ = tick.tick(), if stage == 2 => {
                if let Some((price, t)) = pending.take() {
                    let settings = lock(&shared.settings);
                    if settings.symbol != symbol || shared.revision() != revision { return Ok(()); }
                    let mut state = lock(&shared.quote);
                    if let Some(q) = state.quote.as_mut().filter(|q| q.symbol == symbol) {
                        q.session = crate::quote::session_at(q.periods.as_ref(), now_secs());
                        alpaca::trade(q, price, t, feed);
                        state.error = None;
                        state.updated_at = now_secs();
                    }
                    drop(state);
                    drop(settings);
                    crate::tray::update(app, shared);
                    crate::poller::emit(app, shared);
                    crate::alerts::observe_selected(app, shared, symbol);
                }
            }
            message = socket.next() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        for event in parse(&text).map_err(|_| None)? {
                            match event {
                                Event::Connected if stage == 0 => {
                                    let auth = json!({"action":"auth", "key":keys.key_id, "secret":keys.secret});
                                    socket.send(Message::Text(auth.to_string().into())).await.map_err(|_| None)?;
                                    stage = 1;
                                }
                                Event::Authenticated if stage == 1 => {
                                    socket.send(Message::Text(json!({"action":"subscribe", "trades":[symbol]}).to_string().into())).await.map_err(|_| None)?;
                                    stage = 2;
                                    *live_since = Some(tokio::time::Instant::now());
                                    set_status(app, shared, Status::Live);
                                }
                                Event::Trade { symbol: s, price, t } if stage == 2 && s == symbol => {
                                    if pending.is_none_or(|(_, last)| t >= last) { pending = Some((price, t)); }
                                }
                                Event::Error(code) => return Err(Some(code)),
                                _ => {},
                            }
                        }
                    }
                    Some(Ok(Message::Ping(data))) => socket.send(Message::Pong(data)).await.map_err(|_| None)?,
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return Err(None),
                    _ => {},
                }
            }
        }
    }
}

pub fn spawn(app: AppHandle, shared: Arc<Shared>) {
    tauri::async_runtime::spawn(async move {
        loop {
            let notified = shared.stream_wake.notified();
            let provider = Provider::current(&shared);
            let symbol = shared.symbol();
            let revision = shared.revision();
            let Provider::Alpaca(keys, feed) = provider else {
                set_status(&app, &shared, Status::Off);
                notified.await;
                continue;
            };
            if !eligible(&symbol) {
                set_status(&app, &shared, Status::Off);
                notified.await;
                continue;
            }
            let session = async {
                let mut failures = 0;
                loop {
                    set_status(&app, &shared, Status::Connecting);
                    let mut live_since = None;
                    let config = Config { keys: &keys, feed, symbol: &symbol, revision };
                    let result = connection(&app, &shared, &config, &mut live_since).await;
                    if result.is_ok() { return; }
                    log::warn!("Alpaca stream disconnected");
                    if let Err(Some(code)) = result {
                        if terminal(code) {
                            set_status(&app, &shared, Status::Error(error_message(code)));
                            std::future::pending::<()>().await;
                        }
                    }
                    failures = retry_failures(failures, live_since.map(|t| t.elapsed()).unwrap_or_default());
                    set_status(&app, &shared, Status::Retrying);
                    tokio::time::sleep(backoff(failures)).await;
                    failures = failures.saturating_add(1);
                }
            };
            tokio::select! { _ = notified => {}, _ = session => {} }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn protocol() {
        assert_eq!(parse(r#"[{"T":"success","msg":"connected"},{"T":"success","msg":"authenticated"}]"#).unwrap(), vec![Event::Connected, Event::Authenticated]);
        assert_eq!(parse(r#"[{"T":"t","S":"AAPL","p":123.5,"s":1,"t":"2026-01-02T15:00:00.123Z"}]"#).unwrap(), vec![Event::Trade { symbol: "AAPL".into(), price: 123.5, t: alpaca::parse_time("2026-01-02T15:00:00Z").unwrap() }]);
        assert_eq!(parse(r#"{"T":"error","code":402,"msg":"auth failed"}"#).unwrap(), vec![Event::Error(402)]);
        assert!(parse("garbage").is_err());
        assert!(parse(r#"[{"T":"t","S":"AAPL","p":0,"t":"bad"}]"#).is_err());
    }
    #[test]
    #[ignore = "live network"]
    fn live_stream_rejects_bad_keys() {
        tauri::async_runtime::block_on(async {
            let (mut socket, _) = tokio_tungstenite::connect_async(Feed::Iex.stream_url()).await.unwrap();
            let first = socket.next().await.unwrap().unwrap().into_text().unwrap();
            assert_eq!(parse(&first).unwrap(), vec![Event::Connected]);
            socket.send(Message::Text(json!({"action":"auth", "key":"bad", "secret":"bad"}).to_string().into())).await.unwrap();
            let reply = socket.next().await.unwrap().unwrap().into_text().unwrap();
            assert!(matches!(parse(&reply).unwrap()[0], Event::Error(code) if terminal(code)), "{reply}");
        });
    }

    #[test]
    fn retry_policy() {
        assert_eq!((0..8).map(|n| backoff(n).as_secs()).collect::<Vec<_>>(), [1,2,4,8,16,32,60,60]);
        assert_eq!(retry_failures(6, Duration::from_secs(59)), 6);
        assert_eq!(retry_failures(6, Duration::from_secs(60)), 0);
        for code in [402,406,409] { assert!(terminal(code)); }
        for code in [400,401,403,500] { assert!(!terminal(code)); }
    }
}
