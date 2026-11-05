use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const DEFAULT_STARTING_CASH: f64 = 100_000.0;
pub const MIN_CASH: f64 = 100.0;
pub const MAX_CASH: f64 = 1_000_000_000.0;
pub const MAX_QTY: i64 = 10_000_000;
pub const MAX_COMMISSION: f64 = 1000.0;
pub const MAX_BPS: f64 = 1000.0;
pub const MAX_ORDERS: usize = 100;
pub const MAX_HISTORY: usize = 2000;
pub const MAX_POSITIONS: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrderKind {
    Market,
    Limit,
    Stop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Long,
    Short,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Costs {
    pub commission: f64,
    pub commission_bps: f64,
    pub slippage_bps: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub symbol: String,
    pub qty: i64,
    pub avg_price: f64,
    #[serde(default)]
    pub entry_costs: f64,
    #[serde(default)]
    pub opened: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Order {
    pub id: u64,
    pub symbol: String,
    pub side: Side,
    pub qty: i64,
    pub kind: OrderKind,
    pub price: Option<f64>,
    #[serde(default)]
    pub created: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Fill {
    pub id: u64,
    #[serde(default)]
    pub order_id: Option<u64>,
    pub symbol: String,
    pub side: Side,
    pub qty: i64,
    pub price: f64,
    #[serde(default)]
    pub commission: f64,
    pub time: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClosedTrade {
    pub id: u64,
    pub symbol: String,
    pub direction: Direction,
    pub qty: i64,
    pub entry_price: f64,
    pub exit_price: f64,
    pub pnl: f64,
    #[serde(default)]
    pub costs: f64,
    pub opened: i64,
    pub closed: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PaperAccount {
    pub starting_cash: f64,
    pub cash: f64,
    pub realized: f64,
    pub positions: Vec<Position>,
    pub orders: Vec<Order>,
    pub fills: Vec<Fill>,
    pub trades: Vec<ClosedTrade>,
    pub costs: Costs,
    pub next_id: u64,
}

impl Default for PaperAccount {
    fn default() -> Self {
        Self::new(DEFAULT_STARTING_CASH, Costs::default())
    }
}

pub fn paper_path(settings_path: &Path) -> PathBuf {
    settings_path.with_file_name("paper.json")
}

fn valid_symbol(symbol: &str) -> bool {
    (1..=32).contains(&symbol.chars().count()) && symbol.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || ".-^=_".contains(c))
}

fn finite(v: f64) -> bool {
    v.is_finite()
}

fn positive(v: f64) -> bool {
    v.is_finite() && v > 0.0
}

fn valid_qty(q: i64) -> bool {
    (1..=MAX_QTY).contains(&q)
}

pub fn validate_cash(cash: f64) -> Result<(), String> {
    if !cash.is_finite() || !(MIN_CASH..=MAX_CASH).contains(&cash) {
        return Err(format!("Starting cash must be from {MIN_CASH} to {MAX_CASH}"));
    }
    Ok(())
}

impl Costs {
    pub fn validate(&self) -> Result<(), String> {
        if !self.commission.is_finite() || !(0.0..=MAX_COMMISSION).contains(&self.commission) {
            return Err(format!("Commission per trade must be from 0 to {MAX_COMMISSION}"));
        }
        if !self.commission_bps.is_finite() || !(0.0..=MAX_BPS).contains(&self.commission_bps) {
            return Err(format!("Commission bps must be from 0 to {MAX_BPS}"));
        }
        if !self.slippage_bps.is_finite() || !(0.0..=MAX_BPS).contains(&self.slippage_bps) {
            return Err(format!("Slippage bps must be from 0 to {MAX_BPS}"));
        }
        Ok(())
    }
}

impl PaperAccount {
    pub fn new(starting_cash: f64, costs: Costs) -> Self {
        Self { starting_cash, cash: starting_cash, realized: 0.0, positions: Vec::new(), orders: Vec::new(), fills: Vec::new(), trades: Vec::new(), costs, next_id: 1 }
    }

    pub fn validate(&self) -> Result<(), String> {
        validate_cash(self.starting_cash)?;
        self.costs.validate()?;
        if !finite(self.cash) || !finite(self.realized) {
            return Err("Cash and realized P&L must be finite".into());
        }
        if self.positions.len() > MAX_POSITIONS {
            return Err(format!("At most {MAX_POSITIONS} positions are allowed"));
        }
        if self.orders.len() > MAX_ORDERS {
            return Err(format!("At most {MAX_ORDERS} open orders are allowed"));
        }
        if self.fills.len() > MAX_HISTORY || self.trades.len() > MAX_HISTORY {
            return Err(format!("At most {MAX_HISTORY} fills and trades are kept"));
        }
        let mut symbols = HashSet::new();
        for p in &self.positions {
            if !valid_symbol(&p.symbol) || !symbols.insert(p.symbol.as_str()) {
                return Err(format!("Invalid or duplicate position symbol {}", p.symbol));
            }
            if p.qty == 0 || !positive(p.avg_price) || !finite(p.entry_costs) || p.entry_costs < 0.0 {
                return Err(format!("Invalid position for {}", p.symbol));
            }
        }
        let mut ids = HashSet::new();
        for o in &self.orders {
            if !ids.insert(o.id) || o.id >= self.next_id {
                return Err("Invalid or duplicate order ID".into());
            }
            if !valid_symbol(&o.symbol) || !valid_qty(o.qty) {
                return Err(format!("Invalid order for {}", o.symbol));
            }
            match (o.kind, o.price) {
                (OrderKind::Market, _) => return Err("Market orders cannot rest on the saved account".into()),
                (_, Some(p)) if positive(p) => {}
                _ => return Err("Limit and stop orders need a positive price".into()),
            }
        }
        for f in &self.fills {
            if f.id >= self.next_id || !valid_symbol(&f.symbol) || !valid_qty(f.qty) || !positive(f.price) || !finite(f.commission) || f.commission < 0.0 {
                return Err("Invalid fill".into());
            }
        }
        for t in &self.trades {
            if t.id >= self.next_id || !valid_symbol(&t.symbol) || !valid_qty(t.qty) || !positive(t.entry_price) || !positive(t.exit_price) || !finite(t.pnl) || !finite(t.costs) || t.costs < 0.0 {
                return Err("Invalid closed trade".into());
            }
        }
        Ok(())
    }

    pub fn load(path: &Path) -> Self {
        let Ok(bytes) = std::fs::read(path) else { return Self::default() };
        match serde_json::from_slice::<Self>(&bytes).map_err(|e| e.to_string()).and_then(|a| a.validate().map(|_| a)) {
            Ok(a) => a,
            Err(e) => {
                log::warn!("paper account {}: {e}", path.display());
                if let Err(e) = std::fs::copy(path, path.with_extension("invalid.json")) {
                    log::warn!("back up paper account: {e}");
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
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(tmp, path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> PaperAccount {
        PaperAccount {
            starting_cash: 10_000.0,
            cash: 9_000.5,
            realized: 12.5,
            positions: vec![
                Position { symbol: "AAPL".into(), qty: 10, avg_price: 100.0, entry_costs: 1.0, opened: 1_700_000_000 },
                Position { symbol: "BRK-B".into(), qty: -3, avg_price: 400.0, entry_costs: 0.0, opened: 1_700_000_100 },
            ],
            orders: vec![Order { id: 5, symbol: "AAPL".into(), side: Side::Sell, qty: 5, kind: OrderKind::Limit, price: Some(120.0), created: 1_700_000_200 }],
            fills: vec![Fill { id: 1, order_id: None, symbol: "AAPL".into(), side: Side::Buy, qty: 10, price: 100.0, commission: 1.0, time: 1_700_000_000 }],
            trades: vec![ClosedTrade { id: 3, symbol: "MSFT".into(), direction: Direction::Short, qty: 2, entry_price: 300.0, exit_price: 293.75, pnl: 12.5, costs: 0.0, opened: 1, closed: 2 }],
            costs: Costs { commission: 1.0, commission_bps: 0.5, slippage_bps: 2.0 },
            next_id: 6,
        }
    }

    #[test]
    fn defaults_for_missing_and_partial_files() {
        let a = PaperAccount::default();
        assert_eq!(a.cash, DEFAULT_STARTING_CASH);
        assert_eq!(a.starting_cash, DEFAULT_STARTING_CASH);
        assert_eq!(a.next_id, 1);
        assert!(a.validate().is_ok());
        let old: PaperAccount = serde_json::from_str(r#"{"starting_cash":5000,"cash":4000}"#).unwrap();
        assert_eq!(old.cash, 4000.0);
        assert_eq!(old.costs, Costs::default());
        assert!(old.positions.is_empty() && old.trades.is_empty());
        let partial: PaperAccount = serde_json::from_str(r#"{"costs":{"slippage_bps":5}}"#).unwrap();
        assert_eq!(partial.costs.slippage_bps, 5.0);
        assert_eq!(partial.costs.commission, 0.0);
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(PaperAccount::load(&dir.path().join("paper.json")), PaperAccount::default());
    }

    #[test]
    fn roundtrips_with_frontend_field_names() {
        let a = sample();
        assert!(a.validate().is_ok());
        let v = serde_json::to_value(&a).unwrap();
        assert_eq!(v["orders"][0]["kind"], "limit");
        assert_eq!(v["orders"][0]["side"], "sell");
        assert_eq!(v["trades"][0]["direction"], "short");
        assert_eq!(v["fills"][0]["order_id"], serde_json::Value::Null);
        let dir = tempfile::tempdir().unwrap();
        let p = paper_path(&dir.path().join("settings.json"));
        assert_eq!(p.file_name().unwrap(), "paper.json");
        a.save(&p).unwrap();
        assert_eq!(PaperAccount::load(&p), a);
    }

    #[test]
    fn rejects_invalid_accounts() {
        let invalid: Vec<fn(&mut PaperAccount)> = vec![
            |a| a.starting_cash = 99.0,
            |a| a.starting_cash = f64::NAN,
            |a| a.cash = f64::INFINITY,
            |a| a.realized = f64::NAN,
            |a| a.costs.commission = -1.0,
            |a| a.costs.commission_bps = 1001.0,
            |a| a.costs.slippage_bps = f64::NAN,
            |a| a.positions[0].qty = 0,
            |a| a.positions[0].avg_price = 0.0,
            |a| a.positions[0].entry_costs = -1.0,
            |a| a.positions[1].symbol = "AAPL".into(),
            |a| a.positions[0].symbol = "a b".into(),
            |a| a.orders[0].kind = OrderKind::Market,
            |a| a.orders[0].price = None,
            |a| a.orders[0].price = Some(-2.0),
            |a| a.orders[0].qty = 0,
            |a| a.orders[0].qty = MAX_QTY + 1,
            |a| a.orders[0].id = 6,
            |a| a.orders.push(a.orders[0].clone()),
            |a| a.orders = vec![a.orders[0].clone(); MAX_ORDERS + 1],
            |a| a.fills[0].price = f64::NAN,
            |a| a.fills = vec![a.fills[0].clone(); MAX_HISTORY + 1],
            |a| a.trades[0].pnl = f64::INFINITY,
            |a| a.trades[0].exit_price = 0.0,
        ];
        for edit in invalid {
            let mut a = sample();
            edit(&mut a);
            assert!(a.validate().is_err(), "{a:?}");
        }
        assert!(serde_json::from_str::<PaperAccount>(r#"{"orders":[{"id":1,"symbol":"A","side":"hold","qty":1,"kind":"limit","price":1}]}"#).is_err());
    }

    #[test]
    fn invalid_file_loads_defaults_and_keeps_a_backup() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("paper.json");
        std::fs::write(&p, r#"{"starting_cash":1}"#).unwrap();
        assert_eq!(PaperAccount::load(&p), PaperAccount::default());
        assert!(dir.path().join("paper.invalid.json").exists());
        std::fs::write(&p, "not json").unwrap();
        assert_eq!(PaperAccount::load(&p), PaperAccount::default());
    }
}
