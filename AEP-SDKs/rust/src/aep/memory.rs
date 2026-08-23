//! Read-only memory fabric. Validation logic never consults this for accept/deny.
//! @PAD: aep-sdk-memory
//! @GCDE: gaplune.code.v1

#[derive(Debug, Clone)]
pub struct MemoryEntry {
    pub id: String,
    pub kind: String,
    pub vector: Vec<f64>,
    pub accepted: bool,
}

pub fn cosine_similarity(a: &[f64], b: &[f64]) -> Result<f64, String> {
    if a.len() != b.len() {
        return Err(format!("Vector length mismatch: {} vs {}", a.len(), b.len()));
    }
    if a.is_empty() {
        return Ok(0.0);
    }
    let mut dot = 0.0;
    let mut mag_a = 0.0;
    let mut mag_b = 0.0;
    for (ai, bi) in a.iter().zip(b.iter()) {
        dot += ai * bi;
        mag_a += ai * ai;
        mag_b += bi * bi;
    }
    if mag_a == 0.0 || mag_b == 0.0 {
        return Ok(0.0);
    }
    Ok(dot / (mag_a.sqrt() * mag_b.sqrt()))
}

#[derive(Debug, Default)]
pub struct InMemoryFabric {
    entries: Vec<MemoryEntry>,
}

impl InMemoryFabric {
    pub fn insert(&mut self, entry: MemoryEntry) {
        self.entries.push(entry);
    }

    pub fn nearest_accepted(&self, query: &[f64]) -> Option<(f64, MemoryEntry)> {
        let mut best: Option<(f64, MemoryEntry)> = None;
        for e in &self.entries {
            if !e.accepted {
                continue;
            }
            let Ok(score) = cosine_similarity(query, &e.vector) else {
                continue;
            };
            match &best {
                None => best = Some((score, e.clone())),
                Some((s, _)) if score > *s => best = Some((score, e.clone())),
                _ => {}
            }
        }
        best
    }
}
