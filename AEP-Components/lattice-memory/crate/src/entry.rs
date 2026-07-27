use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Wire format aligned with `sdk/sdk-aep-memory.ts` MemoryEntry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntryJson {
    pub id: String,
    pub timestamp: String,
    pub element_id: String,
    pub domain: String,
    pub proposal: Value,
    pub result: String,
    #[serde(default)]
    pub errors: Vec<String>,
    #[serde(default)]
    pub traversal_path: Vec<String>,
    #[serde(default)]
    pub embedding: Vec<f32>,
    #[serde(default)]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySearchRequest {
    pub embedding: Vec<f32>,
    #[serde(default = "default_limit")]
    pub limit: usize,
    #[serde(default)]
    pub threshold: Option<f32>,
    #[serde(default)]
    pub accepted_only: bool,
}

fn default_limit() -> usize {
    5
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryHistoryRequest {
    pub element_id: String,
    #[serde(default)]
    pub result: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryCountRequest {
    pub element_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryMatchJson {
    pub entry: MemoryEntryJson,
    pub similarity: f32,
}

pub fn parse_timestamp_unix(iso: &str) -> u64 {
    // Prefer chrono-free parse: accept numeric unix in string
    if let Ok(v) = iso.parse::<u64>() {
        return v;
    }
    // Minimal ISO8601: take leading digits if present else now
    let digits: String = iso.chars().filter(|c| c.is_ascii_digit()).take(14).collect();
    if digits.len() >= 10 {
        digits[..10].parse().unwrap_or_else(|_| now_unix())
    } else {
        now_unix()
    }
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

