//! Unified content scanner over an Aho-Corasick automaton.
//! @PAD: aep-sdk-dynaep-scanner
//! @GCDE: gaplune.code.v1

use super::aho::AhoCorasick;

#[derive(Debug, Clone)]
pub struct ScannerPattern {
    pub pattern_id: String,
    pub literal: String,
    pub severity: String,
}

#[derive(Debug, Clone)]
pub struct ScanHit {
    pub pattern_id: String,
    pub severity: String,
    pub match_start: usize,
    pub match_end: usize,
}

pub struct UnifiedScanner {
    patterns: Vec<ScannerPattern>,
    ac: AhoCorasick,
}

impl UnifiedScanner {
    pub fn new(patterns: Vec<ScannerPattern>) -> Self {
        let lits: Vec<String> = patterns.iter().map(|p| p.literal.clone()).collect();
        let ac = AhoCorasick::new(&lits);
        Self { patterns, ac }
    }
    pub fn scan(&self, text: &str) -> Vec<ScanHit> {
        let mut hits = Vec::new();
        for (pi, start, end) in self.ac.find(text) {
            let p = &self.patterns[pi];
            hits.push(ScanHit {
                pattern_id: p.pattern_id.clone(),
                severity: p.severity.clone(),
                match_start: start,
                match_end: end,
            });
            if p.severity == "hard" { return hits; }
        }
        hits
    }
}
