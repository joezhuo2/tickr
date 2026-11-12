use std::path::{Path, PathBuf};
use std::time::SystemTime;
use crate::quote::Candle;

pub const MAX_BARS: usize = 20_000;
pub const MAX_SERIES: usize = 40;
const SPLIT_TOLERANCE: f64 = 0.005;

type Row = (i64, f64, f64, f64, f64, f64);

pub fn cacheable(interval: &str) -> bool {
    matches!(interval, "1m" | "5m" | "15m" | "30m" | "60m")
}

pub fn dir(settings_path: &Path) -> PathBuf {
    settings_path.with_file_name("bars")
}

pub fn key(source: &str, symbol: &str, interval: &str, extended: bool) -> String {
    format!("{source}_{}_{interval}{}", symbol.trim().to_uppercase(), if extended { "_ext" } else { "" })
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_') { c } else { '_' })
        .collect()
}

pub fn split_changed(cached: &[Candle], fresh: &[Candle]) -> bool {
    let settled = &cached[..cached.len().saturating_sub(1)];
    let (mut overlap, mut off) = (0, 0);
    for f in fresh {
        if let Ok(i) = settled.binary_search_by_key(&f.t, |c| c.t) {
            overlap += 1;
            if (f.c - settled[i].c).abs() > SPLIT_TOLERANCE * settled[i].c.abs() { off += 1; }
        }
    }
    off * 2 > overlap
}

pub fn merge(cached: &[Candle], fresh: &[Candle]) -> Vec<Candle> {
    let mut out = if split_changed(cached, fresh) { Vec::new() } else { cached.to_vec() };
    out.extend_from_slice(fresh);
    out.sort_by_key(|c| c.t);
    out.reverse();
    out.dedup_by_key(|c| c.t);
    out.reverse();
    if out.len() > MAX_BARS { out.drain(..out.len() - MAX_BARS); }
    out
}

pub fn older_slice(bars: &[Candle], start: i64, end: i64) -> Vec<Candle> {
    let before = bars.partition_point(|c| c.t < end);
    let Some(last) = before.checked_sub(1).map(|i| bars[i].t) else { return Vec::new() };
    let from = last - (end - start);
    bars[bars.partition_point(|c| c.t < from)..before].to_vec()
}

pub fn evict(mut files: Vec<(SystemTime, PathBuf)>, keep: usize) -> Vec<PathBuf> {
    files.sort_by_key(|f| std::cmp::Reverse(f.0));
    files.into_iter().skip(keep).map(|(_, p)| p).collect()
}

fn path(dir: &Path, key: &str) -> PathBuf {
    dir.join(format!("{key}.json"))
}

pub fn load(dir: &Path, key: &str) -> Vec<Candle> {
    std::fs::read(path(dir, key))
        .ok()
        .and_then(|b| serde_json::from_slice::<Vec<Row>>(&b).ok())
        .map(|rows| rows.into_iter().map(|(t, o, h, l, c, v)| Candle { t, o, h, l, c, v }).collect::<Vec<_>>())
        .filter(|bars| bars.windows(2).all(|w| w[0].t < w[1].t))
        .unwrap_or_default()
}

fn save(dir: &Path, key: &str, bars: &[Candle]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let path = path(dir, key);
    let tmp = path.with_extension("json.tmp");
    let rows: Vec<Row> = bars.iter().map(|c| (c.t, c.o, c.h, c.l, c.c, c.v)).collect();
    std::fs::write(&tmp, serde_json::to_vec(&rows)?)?;
    std::fs::rename(tmp, &path)?;
    let files = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .filter_map(|p| Some((std::fs::metadata(&p).and_then(|m| m.modified()).ok()?, p)))
        .collect();
    // shortcut: recency is the file's write time, so serving older bars from the cache does not refresh it; track reads if active series get evicted.
    for old in evict(files, MAX_SERIES) {
        let _ = std::fs::remove_file(old);
    }
    Ok(())
}

pub fn record(dir: &Path, key: &str, fresh: &[Candle]) {
    if fresh.is_empty() { return; }
    let cached = load(dir, key);
    let merged = merge(&cached, fresh);
    if merged.len() == cached.len() && merged.first() == cached.first() { return; }
    if let Err(e) = save(dir, key, &merged) { log::warn!("bar cache {key}: {e}"); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn k(t: i64, c: f64) -> Candle { Candle { t, o: c, h: c, l: c, c, v: 1.0 } }

    #[test]
    fn merge_dedupes_newest_wins_and_sorts() {
        let merged = merge(&[k(10, 1.0), k(20, 2.0), k(30, 3.0)], &[k(40, 4.0), k(30, 3.01), k(5, 0.5)]);
        assert_eq!(merged.iter().map(|c| c.t).collect::<Vec<_>>(), [5, 10, 20, 30, 40]);
        assert_eq!(merged[3].c, 3.01);
        assert_eq!(merge(&[], &[k(2, 1.0), k(1, 1.0)]).iter().map(|c| c.t).collect::<Vec<_>>(), [1, 2]);
    }

    #[test]
    fn merge_keeps_newest_bars_under_the_cap() {
        let cached: Vec<_> = (0..MAX_BARS as i64).map(|t| k(t, 1.0)).collect();
        let merged = merge(&cached, &[k(MAX_BARS as i64, 1.0), k(MAX_BARS as i64 + 1, 1.0)]);
        assert_eq!(merged.len(), MAX_BARS);
        assert_eq!(merged[0].t, 2);
        assert_eq!(merged.last().unwrap().t, MAX_BARS as i64 + 1);
    }

    #[test]
    fn split_restarts_the_series() {
        let cached = [k(10, 100.0), k(20, 102.0), k(30, 104.0), k(40, 104.0)];
        let fresh = [k(20, 51.0), k(30, 52.0), k(40, 52.0), k(50, 53.0)];
        assert!(split_changed(&cached, &fresh));
        assert_eq!(merge(&cached, &fresh).iter().map(|c| c.t).collect::<Vec<_>>(), [20, 30, 40, 50]);
        assert!(!split_changed(&cached, &[k(30, 104.2), k(40, 90.0), k(50, 1.0)]));
        assert!(!split_changed(&cached, &[k(40, 50.0)]));
        assert!(!split_changed(&[], &fresh));
        assert!(!split_changed(&cached, &[k(60, 1.0)]));
    }

    #[test]
    fn older_slice_serves_the_window_or_the_newest_cached_span_before_it() {
        let bars: Vec<_> = [10, 20, 30, 100, 110].iter().map(|&t| k(t, 1.0)).collect();
        let times = |v: Vec<Candle>| v.iter().map(|c| c.t).collect::<Vec<_>>();
        assert_eq!(times(older_slice(&bars, 95, 110)), [100]);
        assert_eq!(times(older_slice(&bars, 60, 90)), [10, 20, 30]);
        assert_eq!(times(older_slice(&bars, 25, 35)), [20, 30]);
        assert!(older_slice(&bars, 1, 10).is_empty());
        assert!(older_slice(&[], 1, 10).is_empty());
    }

    #[test]
    fn evicts_least_recently_written() {
        let at = |s: u64| SystemTime::UNIX_EPOCH + Duration::from_secs(s);
        let files = vec![(at(3), PathBuf::from("c")), (at(1), PathBuf::from("a")), (at(2), PathBuf::from("b"))];
        assert_eq!(evict(files.clone(), 2), [PathBuf::from("a")]);
        assert!(evict(files, 3).is_empty());
    }

    #[test]
    fn keys_are_safe_file_names() {
        assert_eq!(key("yahoo", "^gspc", "5m", false), "yahoo__GSPC_5m");
        assert_eq!(key("alpaca-iex", "AAPL", "1m", true), "alpaca-iex_AAPL_1m_ext");
        assert_eq!(key("yahoo", "../x", "1m", false), "yahoo_.._X_1m");
        assert!(cacheable("60m") && !cacheable("1mo") && !cacheable("1d"));
    }

    #[test]
    fn corrupt_files_are_ignored_and_overwritten() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("bars");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("yahoo_AAPL_5m.json"), b"{not json").unwrap();
        assert!(load(&dir, "yahoo_AAPL_5m").is_empty());
        record(&dir, "yahoo_AAPL_5m", &[k(1, 1.0), k(2, 2.0)]);
        record(&dir, "yahoo_AAPL_5m", &[k(3, 3.0)]);
        assert_eq!(load(&dir, "yahoo_AAPL_5m"), [k(1, 1.0), k(2, 2.0), k(3, 3.0)]);
        std::fs::write(dir.join("yahoo_AAPL_5m.json"), b"[[2,1,1,1,1,1],[1,1,1,1,1,1]]").unwrap();
        assert!(load(&dir, "yahoo_AAPL_5m").is_empty());
    }
}
