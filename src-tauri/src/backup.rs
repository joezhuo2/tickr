use serde_json::{json, Value};

use crate::alerts::{self, MAX_ALERTS};
use crate::settings::{validate_drawings, validate_indicators, validate_preset_name, validate_screen_name, validate_screen_rules, validate_text_size, Settings};

const APP: &str = "tickr";

pub fn export(settings: &Settings, version: &str, exported_at: i64) -> Result<String, String> {
    let settings = Settings { geometry: None, ..settings.clone() };
    serde_json::to_string_pretty(&json!({ "app": APP, "version": version, "exported_at": exported_at, "settings": settings }))
        .map_err(|e| format!("Could not export settings: {e}"))
}

pub fn parse(text: &str) -> Result<Settings, String> {
    let bad = |e: &dyn std::fmt::Display| format!("Not a valid tickr backup: {e}");
    let root: Value = serde_json::from_str(text).map_err(|e| bad(&e))?;
    if root.get("app").and_then(Value::as_str) != Some(APP) {
        return Err("Not a tickr backup file.".into());
    }
    let mut s: Settings = serde_json::from_value(root.get("settings").cloned().ok_or_else(|| bad(&"no settings"))?).map_err(|e| bad(&e))?;
    validate(&mut s)?;
    Ok(s)
}

fn validate(s: &mut Settings) -> Result<(), String> {
    validate_text_size(s.text_size)?;
    crate::hotkey::parse(&s.hotkey)?;
    validate_indicators(&s.indicators, &s.indicator_presets)?;
    validate_drawings(&s.drawings)?;
    for preset in &s.indicator_presets {
        validate_preset_name(&preset.name)?;
    }
    for screen in &s.screens {
        validate_screen_name(&screen.name)?;
        validate_screen_rules(&screen.rules)?;
    }
    if s.alerts.len() > MAX_ALERTS {
        return Err(format!("A backup can hold at most {MAX_ALERTS} alerts."));
    }
    for a in &s.alerts {
        alerts::validate(&a.symbol, a.level, a.kind, a.direction)?;
    }
    s.chart_layout = s.chart_layout.clone().cleaned()?;
    s.event_filter = s.event_filter.clone().cleaned()?;
    s.watchlist = crate::commands::clean_symbols(std::mem::take(&mut s.watchlist));
    s.groups = crate::commands::clean_groups(std::mem::take(&mut s.groups), &s.watchlist);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::Group;

    fn sample() -> Settings {
        Settings {
            symbol: "NVDA".into(),
            text_size: 125,
            hotkey: "Ctrl+Alt+K".into(),
            watchlist: vec!["AAPL".into(), "NVDA".into()],
            groups: vec![Group { name: "Tech".into(), symbols: vec!["NVDA".into()] }],
            recent_symbols: vec!["TSLA".into()],
            ..Settings::default()
        }
    }

    #[test]
    fn round_trips() {
        let s = sample();
        let text = export(&s, "1.2.3", 1_700_000_000).unwrap();
        let root: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(root["app"], "tickr");
        assert_eq!(root["version"], "1.2.3");
        assert_eq!(root["exported_at"], 1_700_000_000);
        assert_eq!(parse(&text).unwrap(), s);
    }

    #[test]
    fn export_has_no_geometry() {
        let s = Settings { geometry: Some(crate::settings::Geometry { x: 1, y: 2, w: 3, h: 4 }), ..sample() };
        assert_eq!(parse(&export(&s, "1", 0).unwrap()).unwrap().geometry, None);
    }

    #[test]
    fn rejects_wrong_app_and_garbage() {
        assert!(parse("not json").is_err());
        assert!(parse("[]").is_err());
        assert!(parse(r#"{"app":"other","settings":{}}"#).is_err());
        assert!(parse(r#"{"settings":{}}"#).is_err());
        assert!(parse(r#"{"app":"tickr"}"#).is_err());
        assert!(parse(r#"{"app":"tickr","settings":{"text_size":130}}"#).is_err());
        assert!(parse(r#"{"app":"tickr","settings":{"hotkey":"Nope+"}}"#).is_err());
        assert!(parse(r#"{"app":"tickr","settings":{"symbol":5}}"#).is_err());
    }

    #[test]
    fn older_export_gets_defaults() {
        let s = parse(r#"{"app":"tickr","version":"0.1.0","settings":{"symbol":"MSFT","watchlist":["msft"]}}"#).unwrap();
        assert_eq!(s.symbol, "MSFT");
        assert_eq!(s.watchlist, ["MSFT"]);
        assert_eq!(s.text_size, Settings::default().text_size);
        assert_eq!(s.keybinds, Settings::default().keybinds);
        assert_eq!(s.indicators, Settings::default().indicators);
    }
}
