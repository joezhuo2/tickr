use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::quote::Candle;
use crate::settings::{validate_drawing_list, Drawing};

pub const MAX_RUNS: usize = 200;
pub const MAX_CANDLES: usize = 500;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PracticeTrade {
    pub decision: String,
    pub decided: usize,
    pub exit: Option<usize>,
    pub cancelled: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PracticeRun {
    pub id: u64,
    pub saved: i64,
    pub symbol: String,
    pub name: String,
    #[serde(default)]
    pub exchange: String,
    #[serde(default)]
    pub currency: String,
    #[serde(default)]
    pub timezone: String,
    #[serde(default)]
    pub gmtoffset: i64,
    pub interval: String,
    pub range: String,
    pub start: usize,
    pub volatile: bool,
    pub trade: PracticeTrade,
    pub return_pct: f64,
    pub market_pct: Option<f64>,
    pub candles: Vec<Candle>,
    #[serde(default)]
    pub drawings: Vec<Drawing>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct PracticeRuns {
    pub runs: Vec<PracticeRun>,
}

pub fn practice_path(settings_path: &Path) -> PathBuf {
    settings_path.with_file_name("practice.json")
}

fn short(s: &str, max: usize) -> bool {
    s.chars().count() <= max && !s.chars().any(char::is_control)
}

impl PracticeRun {
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=32).contains(&self.symbol.chars().count()) || !short(&self.symbol, 32) {
            return Err("Invalid practice symbol".into());
        }
        if !short(&self.name, 200) || !short(&self.exchange, 64) || !short(&self.currency, 16) || !short(&self.timezone, 64) {
            return Err("Invalid practice run text".into());
        }
        if !matches!(self.interval.as_str(), "60m" | "1d" | "1wk") || !matches!(self.range.as_str(), "3mo" | "1y" | "2y" | "5y") {
            return Err("Invalid practice interval or range".into());
        }
        let n = self.candles.len();
        if !(2..=MAX_CANDLES).contains(&n) {
            return Err(format!("A practice run needs 2 to {MAX_CANDLES} candles"));
        }
        if self.candles.iter().any(|c| [c.o, c.h, c.l, c.c, c.v].iter().any(|v| !v.is_finite())) || self.candles.windows(2).any(|w| w[0].t > w[1].t) {
            return Err("Invalid practice candles".into());
        }
        let t = &self.trade;
        if !matches!(t.decision.as_str(), "long" | "short" | "skip") || self.start >= n || t.decided >= n || t.exit.is_some_and(|e| e >= n) {
            return Err("Invalid practice trade".into());
        }
        if !self.return_pct.is_finite() || self.market_pct.is_some_and(|v| !v.is_finite()) {
            return Err("Invalid practice result".into());
        }
        validate_drawing_list(&self.drawings)
    }
}

impl PracticeRuns {
    pub fn validate(&self) -> Result<(), String> {
        if self.runs.len() > MAX_RUNS {
            return Err(format!("At most {MAX_RUNS} practice runs can be saved; delete some first"));
        }
        let mut ids = HashSet::new();
        for r in &self.runs {
            if r.id == 0 || !ids.insert(r.id) {
                return Err("Invalid or duplicate practice run ID".into());
            }
            r.validate()?;
        }
        Ok(())
    }

    pub fn upsert(&self, mut run: PracticeRun) -> Result<Self, String> {
        let mut next = self.clone();
        if run.id == 0 {
            run.id = next.runs.iter().map(|r| r.id).max().unwrap_or(0) + 1;
            next.runs.push(run);
        } else if let Some(slot) = next.runs.iter_mut().find(|r| r.id == run.id) {
            *slot = run;
        } else {
            return Err("That practice run was deleted".into());
        }
        next.validate()?;
        Ok(next)
    }

    pub fn load(path: &Path) -> Self {
        let Ok(bytes) = std::fs::read(path) else { return Self::default() };
        match serde_json::from_slice::<Self>(&bytes).map_err(|e| e.to_string()).and_then(|a| a.validate().map(|_| a)) {
            Ok(a) => a,
            Err(e) => {
                log::warn!("practice runs {}: {e}", path.display());
                if let Err(e) = std::fs::copy(path, path.with_extension("invalid.json")) {
                    log::warn!("back up practice runs: {e}");
                }
                Self::default()
            }
        }
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec(self)?)?;
        std::fs::rename(tmp, path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> PracticeRun {
        PracticeRun {
            id: 0,
            saved: 1_700_000_000_000,
            symbol: "BRK-B".into(),
            name: "Berkshire".into(),
            exchange: "NYQ".into(),
            currency: "USD".into(),
            timezone: "America/New_York".into(),
            gmtoffset: -18000,
            interval: "1d".into(),
            range: "1y".into(),
            start: 1,
            volatile: false,
            trade: PracticeTrade { decision: "long".into(), decided: 1, exit: Some(2), cancelled: false },
            return_pct: 1.5,
            market_pct: None,
            candles: (0..3).map(|i| Candle { t: 100 + i, o: 10.0, h: 11.0, l: 9.0, c: 10.5, v: 1000.0 }).collect(),
            drawings: Vec::new(),
        }
    }

    #[test]
    fn saves_updates_and_reloads_runs() {
        let dir = tempfile::tempdir().unwrap();
        let p = practice_path(&dir.path().join("settings.json"));
        assert_eq!(p.file_name().unwrap(), "practice.json");
        assert_eq!(PracticeRuns::load(&p), PracticeRuns::default());
        let runs = PracticeRuns::default().upsert(sample()).unwrap().upsert(sample()).unwrap();
        assert_eq!(runs.runs.iter().map(|r| r.id).collect::<Vec<_>>(), vec![1, 2]);
        let mut edit = runs.runs[0].clone();
        edit.return_pct = -2.0;
        let runs = runs.upsert(edit).unwrap();
        assert_eq!(runs.runs[0].return_pct, -2.0);
        assert!(runs.upsert(PracticeRun { id: 9, ..sample() }).is_err());
        runs.save(&p).unwrap();
        assert_eq!(PracticeRuns::load(&p), runs);
    }

    #[test]
    fn rejects_invalid_runs() {
        let invalid: Vec<fn(&mut PracticeRun)> = vec![
            |r| r.symbol = String::new(),
            |r| r.interval = "5m".into(),
            |r| r.range = "max".into(),
            |r| r.trade.decision = "hold".into(),
            |r| r.trade.decided = 3,
            |r| r.trade.exit = Some(3),
            |r| r.start = 3,
            |r| r.return_pct = f64::NAN,
            |r| r.market_pct = Some(f64::INFINITY),
            |r| r.candles[1].c = f64::NAN,
            |r| r.candles[1].t = 99,
            |r| r.candles.truncate(1),
            |r| r.candles = vec![r.candles[0]; MAX_CANDLES + 1],
        ];
        for edit in invalid {
            let mut r = sample();
            edit(&mut r);
            assert!(PracticeRuns::default().upsert(r).is_err());
        }
        let full = PracticeRuns { runs: (1..=MAX_RUNS as u64).map(|id| PracticeRun { id, ..sample() }).collect() };
        assert!(full.validate().is_ok());
        assert!(full.upsert(sample()).is_err());
    }

    #[test]
    fn invalid_file_loads_empty_and_keeps_a_backup() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("practice.json");
        std::fs::write(&p, r#"{"runs":[{"id":0}]}"#).unwrap();
        assert_eq!(PracticeRuns::load(&p), PracticeRuns::default());
        assert!(dir.path().join("practice.invalid.json").exists());
    }
}
