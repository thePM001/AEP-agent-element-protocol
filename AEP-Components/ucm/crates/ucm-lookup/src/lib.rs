//! System-1 tool lookup for UCM.
//!
//! System-1 answers one question: which UCM function, unit, constant or formula fits a task.
//! It never answers the calculation. A reply holds catalog entries exactly as the catalog
//! has them, so it cannot carry a result, a number taken from the request or a program with
//! the request values filled in.
//!
//! Tier one is keyword scoring over the compile time catalog and needs no model.
//! Tier two is an optional ranker model; this crate only checks its output, see `accept_ranked`.

#![forbid(unsafe_code)]

use aep_ucm_core::{catalog, Library};
use serde_json::{json, Value as J};
use std::collections::HashMap;

pub const REPLY_SCHEMA: &str = "ucm-lookup-reply-v1";

/// Words that carry no meaning for tool choice.
const STOP: [&str; 34] = [
    "a",
    "an",
    "the",
    "of",
    "to",
    "in",
    "on",
    "for",
    "and",
    "or",
    "with",
    "by",
    "at",
    "from",
    "is",
    "are",
    "be",
    "what",
    "how",
    "much",
    "many",
    "do",
    "does",
    "i",
    "my",
    "me",
    "into",
    "per",
    "as",
    "this",
    "that",
    "it",
    "calculate",
    "compute",
];

fn tokens(s: &str) -> Vec<String> {
    s.to_lowercase()
        .split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .filter(|t| !t.is_empty() && !STOP.contains(t) && !t.chars().all(|c| c.is_ascii_digit()))
        .map(|t| t.to_string())
        .collect()
}

/// Light stemming so "payments" finds "payment" and "converting" finds "convert".
fn stem(t: &str) -> String {
    for suf in ["ations", "ation", "ings", "ing", "ies", "es", "s", "ed"] {
        if t.len() > suf.len() + 3 {
            if let Some(b) = t.strip_suffix(suf) {
                return b.to_string();
            }
        }
    }
    t.to_string()
}

struct Doc {
    entry: J,
    id: String,
    name: String,
    /// Weighted bag of stems.
    terms: HashMap<String, f64>,
    phrases: Vec<String>,
}

pub struct Index {
    docs: Vec<Doc>,
    idf: HashMap<String, f64>,
    pub library_digest: String,
}

fn add_terms(terms: &mut HashMap<String, f64>, text: &str, w: f64) {
    for t in tokens(text) {
        *terms.entry(stem(&t)).or_insert(0.0) += w;
    }
}

impl Index {
    pub fn build(lib: &Library) -> Index {
        let mut docs = Vec::new();
        for e in catalog(lib) {
            let s = |k: &str| e.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
            let aliases: Vec<String> = e
                .get("aliases")
                .and_then(|x| x.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(|y| y.to_lowercase()))
                        .collect()
                })
                .unwrap_or_default();
            let mut terms = HashMap::new();
            add_terms(&mut terms, &s("name").replace(['_', '.'], " "), 4.0);
            for a in &aliases {
                add_terms(&mut terms, a, 3.0);
            }
            add_terms(&mut terms, &s("category"), 1.5);
            add_terms(&mut terms, &s("description"), 1.0);
            add_terms(&mut terms, &s("signature"), 0.5);
            let mut phrases = aliases.clone();
            phrases.push(s("name").to_lowercase());
            docs.push(Doc {
                id: s("id"),
                name: s("name").to_lowercase(),
                terms,
                phrases,
                entry: e,
            });
        }
        let n = docs.len() as f64;
        let mut df: HashMap<String, f64> = HashMap::new();
        for d in &docs {
            for t in d.terms.keys() {
                *df.entry(t.clone()).or_insert(0.0) += 1.0;
            }
        }
        let idf = df
            .into_iter()
            .map(|(t, c)| (t, ((n + 1.0) / (c + 0.5)).ln()))
            .collect();
        Index {
            docs,
            idf,
            library_digest: lib.digest.clone(),
        }
    }

    pub fn len(&self) -> usize {
        self.docs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.docs.is_empty()
    }

    pub fn ids(&self) -> Vec<String> {
        self.docs.iter().map(|d| d.id.clone()).collect()
    }

    pub fn entry(&self, id: &str) -> Option<&J> {
        self.docs.iter().find(|d| d.id == id).map(|d| &d.entry)
    }

    /// Tier one: keyword scoring. Returns (entry id, score) best first.
    pub fn search(&self, query: &str, k: usize) -> Vec<(String, f64)> {
        let q = query.to_lowercase();
        let qt: Vec<String> = tokens(&q).iter().map(|t| stem(t)).collect();
        // A unit symbol written as is ("km", "psi") is a strong hint for the unit entry.
        let raw: Vec<&str> = query
            .split(|c: char| c.is_whitespace() || c == ',' || c == '(' || c == ')')
            .filter(|t| !t.is_empty())
            .collect();
        let mut scored: Vec<(String, f64)> = self
            .docs
            .iter()
            .filter_map(|d| {
                let mut s = 0.0;
                for t in &qt {
                    if let Some(w) = d.terms.get(t) {
                        s += w * self.idf.get(t).copied().unwrap_or(0.0);
                    }
                }
                for p in &d.phrases {
                    if p.contains(' ') && q.contains(p.as_str()) {
                        s += 6.0;
                    }
                }
                if qt.contains(&d.name) {
                    s += 5.0;
                }
                // A query that is exactly an entry name finds it even when the name is a stop
                // word, such as the functions to and at.
                if q.trim() == d.name {
                    s += 20.0;
                }
                if d.id.starts_with("unit.") && raw.iter().any(|r| *r == d.name) {
                    s += 4.0;
                }
                if s > 0.0 {
                    Some((d.id.clone(), s))
                } else {
                    None
                }
            })
            .collect();
        // A query that names a unit is about units: lift the unit conversion functions.
        let unit_hits = scored
            .iter()
            .filter(|(id, s)| id.starts_with("unit.") && *s >= 4.0)
            .count();
        if unit_hits > 0 {
            for (id, bonus) in [("fn.to", 8.0), ("fn.q", 3.0)] {
                match scored.iter_mut().find(|(x, _)| x == id) {
                    Some(e) => e.1 += bonus,
                    None => scored.push((id.to_string(), bonus)),
                }
            }
        }
        scored.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.0.cmp(&b.0))
        });
        scored.truncate(k);
        scored
    }

    /// Build the reply. Entries are copied from the catalog unchanged.
    pub fn reply(&self, query: &str, tier: &str, ranked: &[(String, f64)]) -> J {
        let entries: Vec<J> = ranked
            .iter()
            .filter_map(|(id, score)| {
                self.entry(id)
                    .map(|e| json!({ "score": format!("{score:.3}"), "entry": e }))
            })
            .collect();
        json!({
            "ucm": REPLY_SCHEMA,
            "query": query,
            "tier": tier,
            "library_digest": self.library_digest,
            "note": "Lookup finds tools only. Write the UCM-IR program with your inputs and call eval; only eval gives a result.",
            "entries": entries,
        })
    }

    /// Check a tier two ranker answer: keep only ids that the index holds, in the given order,
    /// without repeats. Everything else the model wrote is dropped.
    pub fn accept_ranked(&self, model_ids: &[String], k: usize) -> Vec<(String, f64)> {
        let mut out: Vec<(String, f64)> = Vec::new();
        for id in model_ids {
            let id = id.trim();
            if self.entry(id).is_some() && !out.iter().any(|(x, _)| x == id) {
                let score = (k.saturating_sub(out.len())) as f64;
                out.push((id.to_string(), score));
            }
            if out.len() >= k {
                break;
            }
        }
        out
    }

    /// Short text of candidate entries for a tier two prompt: id, signature and description.
    pub fn shortlist_text(&self, ranked: &[(String, f64)]) -> String {
        ranked
            .iter()
            .filter_map(|(id, _)| self.entry(id))
            .map(|e| {
                format!(
                    "{} | {} | {}",
                    e["id"].as_str().unwrap_or(""),
                    e["signature"].as_str().unwrap_or(""),
                    e["description"].as_str().unwrap_or("")
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index() -> Index {
        Index::build(&Library::builtin().expect("lib"))
    }

    fn top(ix: &Index, q: &str, n: usize) -> Vec<String> {
        ix.search(q, n).into_iter().map(|x| x.0).collect()
    }

    #[test]
    fn finds_the_right_tool() {
        let ix = index();
        let cases = [
            (
                "monthly mortgage payment on a loan",
                "formula.finance.annuity_payment",
            ),
            ("convert 12 miles to kilometres", "fn.to"),
            ("standard deviation of a sample", "fn.stddev_sample"),
            ("split a bill into equal parts", "fn.allocate"),
            ("round to 2 decimal places bankers rounding", "fn.round"),
            ("number of days between two dates", "fn.days_between"),
            ("solve a system of linear equations", "fn.solve"),
            ("speed of light", "const.c"),
            ("pounds per square inch", "unit.psi"),
            ("net present value of cash flows", "formula.finance.npv"),
            ("greatest common divisor", "fn.gcd"),
            ("body mass index", "formula.health.bmi"),
            ("currency conversion with an exchange rate", "fn.convert"),
            ("time zone local time", "fn.instant"),
        ];
        for (q, want) in cases {
            let got = top(&ix, q, 3);
            assert!(
                got.iter().any(|g| g == want),
                "query {q:?}: want {want} in top 3, got {got:?}"
            );
        }
    }

    #[test]
    fn every_entry_is_found_by_name_and_aliases() {
        let ix = index();
        let mut misses = Vec::new();
        for id in ix.ids() {
            let e = ix.entry(&id).expect("entry").clone();
            let name = e["name"].as_str().unwrap_or("").replace(['_', '.'], " ");
            let mut queries = vec![name];
            for a in e["aliases"].as_array().into_iter().flatten().take(2) {
                queries.push(a.as_str().unwrap_or("").to_string());
            }
            for q in queries {
                if !top(&ix, &q, 5).contains(&id) {
                    misses.push(format!("{id} by {q:?}: {:?}", top(&ix, &q, 5)));
                }
            }
        }
        assert!(
            misses.is_empty(),
            "{} lookups missed:\n{}",
            misses.len(),
            misses.join("\n")
        );
    }

    #[test]
    fn reply_holds_catalog_entries_only() {
        let ix = index();
        let q = "what is 1234.5 EUR times 3 percent per year for 7 years compound interest";
        let r = ix.reply(q, "tier1", &ix.search(q, 5));
        let keys: Vec<&String> = r.as_object().expect("o").keys().collect();
        assert_eq!(keys.len(), 6);
        for e in r["entries"].as_array().expect("entries") {
            let id = e["entry"]["id"].as_str().expect("id");
            assert_eq!(
                Some(&e["entry"]),
                ix.entry(id),
                "entry {id} differs from the catalog"
            );
            assert_eq!(e.as_object().expect("o").len(), 2);
            let text = e["entry"].to_string();
            assert!(
                !text.contains("1234.5"),
                "a request number leaked into {id}"
            );
        }
    }

    #[test]
    fn ranker_output_is_filtered() {
        let ix = index();
        let ids = vec![
            "fn.round".to_string(),
            "the answer is 42".to_string(),
            "fn.round".to_string(),
            "fn.sqrt".to_string(),
        ];
        let got = ix.accept_ranked(&ids, 5);
        assert_eq!(
            got.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(),
            vec!["fn.round", "fn.sqrt"]
        );
    }

    #[test]
    fn tier_one_is_fast() {
        let ix = index();
        let qs = [
            "loan payment",
            "convert units",
            "median",
            "inverse matrix",
            "planck constant",
            "leap year",
            "percent change",
        ];
        let mut times = Vec::new();
        for _ in 0..50 {
            for q in qs {
                let t = std::time::Instant::now();
                let _ = ix.search(q, 5);
                times.push(t.elapsed());
            }
        }
        times.sort();
        let p95 = times[times.len() * 95 / 100];
        // The gate is p95 under 5 ms on the reference runner in a release build; a debug
        // build remains well under 50 ms.
        assert!(
            p95 < std::time::Duration::from_millis(50),
            "tier one p95 {p95:?}"
        );
    }
}
