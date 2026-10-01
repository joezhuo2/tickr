//! Company logos from Parqet's public logo CDN, cached on disk.
//! Misses are cached too (as an empty file) so we do not refetch for a day.

use std::path::PathBuf;
use std::time::{Duration, SystemTime};

const LOGO_URL: &str = "https://assets.parqet.com/logos/symbol";
const MISS_TTL: Duration = Duration::from_secs(24 * 3600);
const HIT_TTL: Duration = Duration::from_secs(30 * 24 * 3600);

fn cache_path(symbol: &str) -> PathBuf {
    let safe: String = symbol
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '.' { c } else { '_' })
        .collect();
    crate::settings::cache_dir().join("logos").join(format!("{safe}.png"))
}

fn fresh(path: &PathBuf, ttl: Duration) -> bool {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .is_some_and(|age| age < ttl)
}

/// PNG bytes for the symbol's logo, or None when there is no logo.
pub async fn get(client: &reqwest::Client, symbol: &str) -> Option<Vec<u8>> {
    let symbol = symbol.trim().to_uppercase();
    let path = cache_path(&symbol);
    if let Ok(bytes) = std::fs::read(&path) {
        let ttl = if bytes.is_empty() { MISS_TTL } else { HIT_TTL };
        if fresh(&path, ttl) {
            return (!bytes.is_empty()).then_some(bytes);
        }
    }
    // Yahoo suffixes (BRK-B, SHOP.TO) are not always known to Parqet; try the base too.
    let base = symbol.split(['.', '-']).next().unwrap_or(&symbol).to_string();
    let mut found = None;
    for s in [symbol.as_str(), base.as_str()] {
        let url = format!("{LOGO_URL}/{s}?format=png&size=64");
        match client.get(&url).send().await {
            Ok(res) if res.status().is_success() => {
                if let Ok(b) = res.bytes().await {
                    if b.starts_with(b"\x89PNG") {
                        found = Some(b.to_vec());
                        break;
                    }
                }
            }
            Ok(_) => {}
            // Network error: do not cache a miss.
            Err(_) => return None,
        }
        if base == symbol {
            break;
        }
    }
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&path, found.as_deref().unwrap_or_default());
    found
}
