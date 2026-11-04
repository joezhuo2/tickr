//! Connection health and redacted troubleshooting diagnostics.

use std::sync::Arc;
use std::time::Duration;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use crate::state::{lock, now_secs, Shared};
use crate::{ai, alpaca, provider::Provider, stream::Status};

#[derive(Clone, Debug, Default)]
pub struct Health {
    pub last_ok: i64,
    pub last_error: Option<String>,
    pub last_error_at: i64,
}

impl Health {
    pub fn success(&mut self, at: i64) { self.last_ok = at; }
    pub fn failure(&mut self, error: &str, at: i64) {
        self.last_error = Some(error.to_string());
        self.last_error_at = at;
    }
    pub fn record<T>(&mut self, result: &Result<T, String>, at: i64) {
        match result { Ok(_) => self.success(at), Err(error) => self.failure(error, at) }
    }
    pub fn state(&self, off: bool) -> &'static str {
        if off { "off" }
        else if self.last_ok == 0 && self.last_error_at == 0 { "unknown" }
        else if self.last_error_at > self.last_ok { "error" }
        else { "ok" }
    }
}

#[derive(Clone, Default)]
pub struct Connections {
    pub quote: Health,
    pub news: Health,
    pub ai: Health,
}

#[derive(Serialize)]
pub struct ServiceStatus {
    pub id: &'static str,
    pub label: &'static str,
    pub state: &'static str,
    pub last_ok: i64,
    pub last_error: Option<String>,
    pub last_error_at: i64,
}

#[derive(Serialize)]
pub struct ConnectionsReport {
    pub services: Vec<ServiceStatus>,
    pub app_version: String,
    pub os: String,
    pub provider: &'static str,
    pub stream: String,
    pub log_dir: String,
}

pub fn describe(service: &str, err: &str) -> String {
    let lower = err.to_ascii_lowercase();
    let code = lower.split_once("http ").and_then(|(_, tail)| tail.split_whitespace().next()).and_then(|s| s.parse::<u16>().ok());
    let hint = match code {
        Some(401 | 403) if service == "ai" => "check the API key",
        Some(401 | 403) => "access denied",
        Some(429) => "rate limited, try again later",
        Some(500..=599) => "server error, try again later",
        _ if lower.contains("request failed") && service == "ai" => "check your network or the base URL",
        _ if lower.contains("request failed") => "check your network",
        _ => return err.to_string(),
    };
    format!("{err} \u{2014} {hint}")
}

pub fn redact(text: &str, secrets: &[&str], home: Option<&str>) -> String {
    let mut secrets: Vec<&str> = secrets.iter().map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    secrets.sort_by_key(|s| std::cmp::Reverse(s.len()));
    let mut out = String::new();
    let mut rest = text;
    while !rest.is_empty() {
        if let Some(tail) = rest.strip_prefix("[redacted]") {
            out.push_str("[redacted]");
            rest = tail;
        } else if let Some(secret) = secrets.iter().find(|s| rest.starts_with(**s)) {
            out.push_str("[redacted]");
            rest = &rest[secret.len()..];
        } else if rest.get(..7).is_some_and(|s| s.eq_ignore_ascii_case("bearer ")) {
            out.push_str("Bearer ");
            rest = rest[7..].trim_start();
            if let Some(tail) = rest.strip_prefix("[redacted]") {
                out.push_str("[redacted]");
                rest = tail;
            } else {
                let end = rest.find(|c: char| c.is_whitespace() || matches!(c, '\"' | '\'' | ',' | ';' | ')' | ']')).unwrap_or(rest.len());
                if end > 0 { out.push_str("[redacted]"); }
                rest = &rest[end..];
            }
        } else if let Some(home) = home.filter(|h| !h.is_empty() && rest.starts_with(h)) {
            out.push('~');
            rest = &rest[home.len()..];
        } else {
            let c = rest.chars().next().unwrap();
            out.push(c);
            rest = &rest[c.len_utf8()..];
        }
    }
    out
}

pub fn os_version() -> String {
    static OS: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    OS.get_or_init(read_os_version).clone()
}

fn read_os_version() -> String {
    #[cfg(target_os = "windows")]
    let version = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd").args(["/C", "ver"]).creation_flags(0x08000000).output()
            .ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    };
    #[cfg(target_os = "macos")]
    let version = std::process::Command::new("sw_vers").arg("-productVersion").output()
        .ok().filter(|o| o.status.success()).map(|o| format!("macOS {}", String::from_utf8_lossy(&o.stdout).trim()));
    #[cfg(target_os = "linux")]
    let version = std::fs::read_to_string("/etc/os-release").ok().and_then(|text| {
        text.lines().find_map(|line| line.strip_prefix("PRETTY_NAME=").map(|s| s.trim_matches(['\"', '\'']).to_string()))
    });
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let version: Option<String> = None;
    format!("{} {}", version.filter(|s| !s.is_empty()).unwrap_or_else(|| std::env::consts::OS.into()), std::env::consts::ARCH)
}

fn service(id: &'static str, label: &'static str, health: &Health, off: bool, sanitize: &impl Fn(&str) -> String) -> ServiceStatus {
    ServiceStatus {
        id, label, state: health.state(off), last_ok: health.last_ok, last_error_at: health.last_error_at,
        last_error: health.last_error.as_ref().map(|e| sanitize(&describe(id, e))),
    }
}

fn with_redaction<T>(app: &AppHandle, f: impl FnOnce(&ai::AiConfig, &dyn Fn(&str) -> String) -> T) -> T {
    let path = ai::env_path();
    let cfg = ai::load_config(&path);
    let keys = alpaca::load_keys(&path);
    let home = app.path().home_dir().ok().map(|p| p.to_string_lossy().into_owned());
    let mut secrets = vec![cfg.api_key.as_str(), cfg.base_url.as_str()];
    if let Some(keys) = &keys { secrets.extend([keys.key_id.as_str(), keys.secret.as_str()]); }
    f(&cfg, &|text| redact(text, &secrets, home.as_deref()))
}

fn report(app: &AppHandle, shared: &Shared) -> ConnectionsReport {
    with_redaction(app, |cfg, sanitize| {
        let health = lock(&shared.connections).clone();
        let off = !cfg.configured(ai::Feature::News) && !cfg.configured(ai::Feature::Events);
        let stream = match &*lock(&shared.stream_status) {
            Status::Off => "off".into(), Status::Connecting => "connecting".into(),
            Status::Live => "live".into(), Status::Retrying => "retrying".into(),
            Status::Error(e) => format!("error: {}", describe("quote", e)),
        };
        ConnectionsReport {
            services: vec![service("quote", "Quotes", &health.quote, false, &sanitize), service("news", "News", &health.news, false, &sanitize), service("ai", "AI", &health.ai, off, &sanitize)],
            app_version: app.package_info().version.to_string(), os: os_version(),
            provider: match Provider::current(shared) { Provider::Yahoo => "yahoo", Provider::Alpaca(..) => "alpaca" },
            stream: sanitize(&stream),
            log_dir: sanitize(&app.path().app_log_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "unavailable".into())),
        }
    })
}

pub fn diagnostics_text(report: &ConnectionsReport) -> String {
    let time = |t| if t == 0 { "never".into() } else { alpaca::format_time(t) };
    let mut text = format!("tickr {}\nOS: {}\nProvider: {}\nStream: {}\nLog folder: {}\n", report.app_version, report.os, report.provider, report.stream, report.log_dir);
    for s in &report.services {
        text.push_str(&format!("{}: {}; last success: {}; last error: {}{}\n", s.label, s.state, time(s.last_ok), time(s.last_error_at), s.last_error.as_ref().map(|e| format!(" ({e})")).unwrap_or_default()));
    }
    text
}

#[tauri::command]
pub fn get_connections(app: AppHandle, shared: State<'_, Arc<Shared>>) -> ConnectionsReport { report(&app, &shared) }

#[tauri::command]
pub async fn retry_connection(app: AppHandle, shared: State<'_, Arc<Shared>>, service: String) -> Result<ConnectionsReport, String> {
    match service.as_str() {
        "quote" => {
            let provider = Provider::current(&shared);
            let result = provider.fetch_quote(&shared.http, &shared.symbol(), now_secs()).await;
            lock(&shared.connections).quote.record(&result, now_secs());
            shared.wake.notify_one();
        }
        "news" => {
            let result = crate::news::fetch(&shared.http, &shared.symbol()).await;
            lock(&shared.connections).news.record(&result, now_secs());
        }
        "ai" => {
            let cfg = ai::load_config(&ai::env_path());
            if cfg.configured(ai::Feature::News) || cfg.configured(ai::Feature::Events) {
                if let Some(model) = ai::test_models(&cfg).first() {
                    let result = ai::chat(&shared.http, &cfg, ai::test_body(model), Duration::from_secs(20)).await.and_then(|body| ai::reply_content(&body));
                    lock(&shared.connections).ai.record(&result, now_secs());
                }
            }
        }
        _ => return Err("Unknown connection service".into()),
    }
    Ok(report(&app, &shared))
}

#[tauri::command]
pub fn get_diagnostics(app: AppHandle, shared: State<'_, Arc<Shared>>) -> String {
    let report = report(&app, &shared);
    with_redaction(&app, |_, sanitize| sanitize(&diagnostics_text(&report)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_transitions_preserve_history() {
        let mut h = Health::default();
        assert_eq!(h.state(false), "unknown");
        assert_eq!(h.state(true), "off");
        h.record(&Err::<(), _>("HTTP 401".into()), 10);
        assert_eq!(h.state(false), "error");
        h.record(&Ok::<_, String>(()), 11);
        assert_eq!(h.state(false), "ok");
        assert_eq!(h.last_error.as_deref(), Some("HTTP 401"));
        assert_eq!(h.last_error_at, 10);
        h.failure("HTTP 429", 12);
        assert_eq!(h.state(false), "error");
        h.success(12);
        assert_eq!(h.state(false), "ok");
        assert_eq!(h.state(true), "off");
    }

    #[test]
    fn readable_hints() {
        for service in ["quote", "news", "ai"] {
            for code in [401, 403] {
                let err = format!("HTTP {code} Forbidden");
                assert_eq!(describe(service, &err), format!("{err} \u{2014} {}", if service == "ai" { "check the API key" } else { "access denied" }));
            }
            for (err, hint) in [("HTTP 429", "rate limited, try again later"), ("HTTP 500", "server error, try again later"), ("HTTP 503", "server error, try again later"), ("HTTP 599", "server error, try again later")] {
                assert_eq!(describe(service, err), format!("{err} \u{2014} {hint}"));
            }
            assert_eq!(describe(service, "request failed"), format!("request failed \u{2014} check your network{}", if service == "ai" { " or the base URL" } else { "" }));
            assert_eq!(describe(service, "unusual response"), "unusual response");
            assert_eq!(describe(service, "HTTP 404"), "HTTP 404");
        }
    }

    #[test]
    fn redacts_secrets_bearer_and_home() {
        assert_eq!(redact("unchanged", &["", "  "], Some("")), "unchanged");
        let text = "HTTP 401 secret-long secret Bearer token-123 /home/joe/logs";
        let secrets = [" secret ", "secret-long", "", "  "];
        let safe = redact(text, &secrets, Some("/home/joe"));
        assert_eq!(safe, "HTTP 401 [redacted] [redacted] Bearer [redacted] ~/logs");
        assert_eq!(redact(&safe, &secrets, Some("/home/joe")), safe);
        assert_eq!(redact("\u{e9} bearer abc.def==, Bearer xyz\nend", &[], None), "\u{e9} Bearer [redacted], Bearer [redacted]\nend");
        assert_eq!(redact(r"C:\Users\Joe\logs", &[], Some(r"C:\Users\Joe")), r"~\logs");
        assert_eq!(redact("key secret", &["key", "secret"], None), "[redacted] [redacted]");
    }

    #[test]
    fn diagnostics_include_versions_and_safe_errors() {
        let cfg = ai::AiConfig { api_key: "ai-secret".into(), base_url: "https://private.example/v1".into(), ..Default::default() };
        let keys = alpaca::AlpacaCreds { key_id: "KEYID".into(), secret: "KEYSECRET".into() };
        let secrets = [cfg.api_key.as_str(), keys.key_id.as_str(), keys.secret.as_str(), cfg.base_url.as_str()];
        let sanitize = |s: &str| redact(s, &secrets, Some("/home/joe"));
        let h = Health { last_ok: 1, last_error: Some("HTTP 401 ai-secret KEYID KEYSECRET https://private.example/v1 Bearer token".into()), last_error_at: 2 };
        let report = ConnectionsReport {
            services: vec![service("ai", "AI", &h, false, &sanitize), service("news", "News", &Health::default(), false, &sanitize)],
            app_version: "1.2.3".into(), os: "Windows 11 x86_64".into(), provider: "yahoo", stream: "off".into(), log_dir: sanitize("/home/joe/logs"),
        };
        let json = serde_json::to_string(&report).unwrap();
        let text = sanitize(&diagnostics_text(&report));
        for secret in secrets.into_iter().chain(["token", "/home/joe"]) {
            assert!(!json.contains(secret));
            assert!(!text.contains(secret));
        }
        for expected in ["tickr 1.2.3", "Windows 11 x86_64", "Provider: yahoo", "Stream: off", "Log folder: ~/logs", "AI: error", "1970-01-01T00:00:01Z", "1970-01-01T00:00:02Z", "last success: never", "last error: never", "check the API key"] {
            assert!(text.contains(expected), "{expected}: {text}");
        }
    }
}
