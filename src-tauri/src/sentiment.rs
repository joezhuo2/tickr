//! Headline tone: a small keyword lexicon for financial news.
//!
//! Yahoo's news feed carries no sentiment, so this guesses it from the title
//! alone. It runs locally and gives the same answer for the same headline.
//! Rules, in order:
//! - Each lexicon word adds its weight (+ positive, − negative). A hyphenated
//!   word not in the lexicon is looked up part by part ("service-loss").
//! - A negator ("not", "don't", ...) flips the next three words.
//! - "although", "though" and "despite" open a concession: the words after
//!   count half, up to the end of the clause. "but" and "however" make the
//!   words before count half.
//! - A comma, semicolon, colon, dash or sentence end closes the clause, which
//!   ends any negation or concession.
//! - A total of at least +0.5 is positive, at most −0.5 negative, otherwise
//!   neutral.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Sentiment {
    Positive,
    Negative,
    Neutral,
}

/// How many words after a negator it flips.
const NEGATION_WINDOW: usize = 3;
/// Totals this far from zero are not neutral.
const THRESHOLD: f32 = 0.5;

pub fn classify(title: &str) -> Sentiment {
    let s = score(title);
    if s >= THRESHOLD {
        Sentiment::Positive
    } else if s <= -THRESHOLD {
        Sentiment::Negative
    } else {
        Sentiment::Neutral
    }
}

/// The signed total behind `classify`.
pub fn score(title: &str) -> f32 {
    let tokens = tokenize(title);
    let mut before = 0.0; // clauses already closed
    let mut current = 0.0; // the clause being read
    let mut scale = 1.0;
    let mut negate_until: Option<usize> = None;

    for (i, t) in tokens.iter().enumerate() {
        let Tok::Word(t) = t else {
            before += current;
            current = 0.0;
            scale = 1.0;
            negate_until = None;
            continue;
        };
        let t = t.as_str();
        match t {
            "but" | "however" => {
                before = (before + current) * 0.5;
                current = 0.0;
                scale = 1.0;
                negate_until = None;
                continue;
            }
            "although" | "though" | "despite" => {
                before += current;
                current = 0.0;
                scale = 0.5;
                negate_until = None;
                continue;
            }
            _ => {}
        }
        if is_negator(t) {
            negate_until = Some(i + NEGATION_WINDOW);
            continue;
        }
        let Some(w) = weight(t) else { continue };
        let flip = negate_until.is_some_and(|end| i <= end);
        current += (if flip { -w } else { w }) * scale;
    }
    before + current
}

#[derive(Debug, PartialEq)]
enum Tok {
    Word(String),
    /// End of a clause.
    Break,
}

/// Lowercase words and clause breaks. Curly apostrophes become straight,
/// possessive "'s" is dropped, and inner hyphens are kept. Punctuation only
/// breaks a clause when followed by a space or the end, so "$5.7" does not.
fn tokenize(title: &str) -> Vec<Tok> {
    let text = title.to_lowercase().replace(['\u{2019}', '\u{2018}'], "'");
    let mut out = Vec::new();
    let mut word = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c.is_alphanumeric() || c == '\'' || c == '-' {
            word.push(c);
            continue;
        }
        flush(&mut word, &mut out);
        let at_gap = chars.peek().is_none_or(|n| n.is_whitespace());
        let breaks = match c {
            '\u{2013}' | '\u{2014}' => true,
            ',' | ';' | ':' | '.' | '!' | '?' => at_gap,
            _ => false,
        };
        if breaks && out.last().is_some_and(|t| *t != Tok::Break) {
            out.push(Tok::Break);
        }
    }
    flush(&mut word, &mut out);
    out
}

fn flush(word: &mut String, out: &mut Vec<Tok>) {
    let w = word.trim_matches(|c| c == '\'' || c == '-');
    let w = w.strip_suffix("'s").unwrap_or(w);
    if w.is_empty() {
        // A spaced hyphen is a dash.
        if word.contains('-') && out.last().is_some_and(|t| *t != Tok::Break) {
            out.push(Tok::Break);
        }
    } else {
        out.push(Tok::Word(w.to_string()));
    }
    word.clear();
}

fn is_negator(t: &str) -> bool {
    matches!(
        t,
        "not"
            | "no"
            | "never"
            | "without"
            | "don't"
            | "doesn't"
            | "didn't"
            | "won't"
            | "isn't"
            | "aren't"
            | "wasn't"
            | "weren't"
            | "can't"
            | "cannot"
            | "shouldn't"
            | "wouldn't"
    )
}

/// The word's weight, or for a hyphenated word not in the lexicon, the sum of
/// its parts' weights.
fn weight(t: &str) -> Option<f32> {
    if let Some(w) = lexicon(t) {
        return Some(w);
    }
    if !t.contains('-') {
        return None;
    }
    let sum: f32 = t.split('-').filter_map(lexicon).sum();
    (sum != 0.0).then_some(sum)
}

fn lexicon(t: &str) -> Option<f32> {
    let w = match t {
        // Strong positive.
        "soar" | "soars" | "soared" | "soaring" | "surge" | "surges" | "surged" | "surging" | "skyrocket"
        | "skyrockets" | "skyrocketed" | "breakthrough" | "blowout" => 2.0,
        // Positive.
        "beat" | "beats" | "tops" | "topped" | "exceed" | "exceeds" | "exceeded" | "outperform" | "outperforms"
        | "outperformed" | "jump" | "jumps" | "jumped" | "rally" | "rallies" | "rallied" | "gain" | "gains"
        | "gained" | "rise" | "rises" | "rose" | "rising" | "climb" | "climbs" | "climbed" | "rebound"
        | "rebounds" | "rebounded" | "record" | "upgrade" | "upgrades" | "upgraded" | "raise" | "raises"
        | "raised" | "boost" | "boosts" | "boosted" | "strong" | "stronger" | "strongest" | "strength"
        | "growth" | "grow" | "grows" | "grew" | "profit" | "profits" | "profitable" | "bullish" | "upside"
        | "optimistic" | "optimism" | "upbeat" | "win" | "wins" | "won" | "approval" | "approve" | "approves"
        | "approved" | "expand" | "expands" | "expanded" | "best" | "better" | "favorite" | "buy" | "buys"
        | "positive" | "success" | "successful" | "recover" | "recovers" | "recovered" | "recovery" | "dividend" | "milestone" | "momentum" | "boom" | "booming" => 1.0,
        // Strong negative.
        "plunge" | "plunges" | "plunged" | "plunging" | "crash" | "crashes" | "crashed" | "collapse"
        | "collapses" | "collapsed" | "tank" | "tanks" | "tanked" | "fraud" | "bankrupt" | "bankruptcy"
        | "scandal" => -2.0,
        // Negative.
        "miss" | "misses" | "missed" | "fall" | "falls" | "fell" | "falling" | "drop" | "drops" | "dropped"
        | "slump" | "slumps" | "slumped" | "tumble" | "tumbles" | "tumbled" | "sink" | "sinks" | "sank"
        | "slide" | "slides" | "slid" | "decline" | "declines" | "declined" | "downgrade" | "downgrades"
        | "downgraded" | "cut" | "cuts" | "slash" | "slashes" | "slashed" | "lower" | "lowers" | "lowered"
        | "weak" | "weaker" | "weakness" | "soft" | "softer" | "loss" | "losses" | "lose" | "loses" | "lost"
        | "lawsuit" | "sue" | "sues" | "sued" | "probe" | "investigation" | "recall" | "recalls"
        | "recalled" | "bug" | "outage" | "threat" | "threaten" | "threatens" | "threatened" | "warn"
        | "warns" | "warned" | "warning" | "layoff" | "layoffs" | "fear" | "fears" | "risk" | "risks"
        | "risky" | "bearish" | "drawdown" | "selloff" | "sell-off" | "slowdown" | "slow" | "slows"
        | "slowing" | "delay" | "delays" | "delayed" | "ban" | "bans" | "banned" | "halt" | "halts"
        | "halted" | "concern" | "concerns" | "worry" | "worries" | "worst" | "worse" | "underperform"
        | "underperforms" | "underperformed" | "disappoint" | "disappoints" | "disappointing"
        | "disappointed" | "negative" | "struggle" | "struggles" | "struggling" | "fade"
        | "pessimistic" | "plummet" | "plummets" | "plummeted" | "crisis" | "penalty" | "antitrust" => -1.0,
        _ => return None,
    };
    Some(w)
}

#[cfg(test)]
mod tests {
    use super::*;
    use Sentiment::*;

    #[test]
    fn plain_tone() {
        assert_eq!(classify("Apple beats estimates as iPhone sales surge"), Positive);
        assert_eq!(classify("Tesla shares plunge after delivery miss"), Negative);
        assert_eq!(classify("Apple Tightens macOS Full Disk Access"), Neutral);
        assert_eq!(classify(""), Neutral);
    }

    #[test]
    fn mixed_words_cancel() {
        assert_eq!(classify("Shares rise then fall"), Neutral);
    }

    #[test]
    fn negation_flips_the_next_words() {
        assert_eq!(classify("Analysts don't expect a slowdown"), Positive);
        assert_eq!(classify("Quarter was not strong"), Negative);
        // Outside the window, the word keeps its sign.
        assert_eq!(classify("Not much has changed at the company, profits"), Positive);
    }

    #[test]
    fn concessions_weigh_less() {
        assert_eq!(classify("Apple Stocks Rises Although AI Agents Threaten App-Store Gatekeeping"), Positive);
        assert_eq!(classify("Despite record sales, guidance disappoints and shares drop"), Negative);
        assert_eq!(classify("Despite weak sales, shares jump"), Positive);
        assert_eq!(classify("Sales beat estimates but guidance disappoints"), Negative);
    }

    #[test]
    fn punctuation_closes_the_clause() {
        // The negation stops at the sentence end.
        assert_eq!(classify("Don't panic. Shares gain"), Positive);
        assert_eq!(classify("No guidance - shares fall"), Negative);
        assert_eq!(classify("No guidance \u{2014} shares fall"), Negative);
        // A decimal point is not a sentence end.
        assert_eq!(tokenize("$5.7 trillion").len(), 3);
        assert_eq!(tokenize("Up. Down.").iter().filter(|t| **t == Tok::Break).count(), 2);
    }

    #[test]
    fn curly_apostrophes_and_possessives() {
        assert_eq!(classify("Apple\u{2019}s profit soars"), Positive);
        assert_eq!(classify("Musk\u{2019}s Remarks Don\u{2019}t Mean SpaceX Cut Its Guidance"), Positive);
    }

    #[test]
    fn hyphenated_words_use_their_parts() {
        assert_eq!(classify("Users must replace phones after service-loss bug"), Negative);
        assert_eq!(classify("Stocks rally as sell-off ends"), Neutral);
    }

    #[test]
    fn case_does_not_matter() {
        assert_eq!(classify("NVIDIA HITS RECORD HIGH"), Positive);
    }

    #[test]
    fn serializes_lowercase() {
        assert_eq!(serde_json::to_string(&Positive).unwrap(), "\"positive\"");
        assert_eq!(serde_json::to_string(&Neutral).unwrap(), "\"neutral\"");
    }
}
