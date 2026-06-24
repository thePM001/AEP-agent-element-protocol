use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use usearch::{Index, IndexOptions, MetricKind, ScalarKind};

use crate::entry::{MemoryEntryJson, MemoryMatchJson, parse_timestamp_unix};
use crate::error::MemoryError;
use crate::sqlite::{
    attractor_count, count_by_element, embedding_to_json, ensure_schema, fetch_all_meta,
    fetch_history, fetch_meta_by_entry_id, fetch_meta_by_key, insert_meta, insert_vector,
    open_connection, vec_table_name,
    vec_version, AttractorMeta,
};

pub const DEFAULT_EMBEDDING_DIM: usize = 128;
pub const DEFAULT_SIMILARITY_THRESHOLD: f32 = 0.95;
pub const MAX_ATTRACTORS: usize = 2000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AttractorRecord {
    pub entry_id: String,
    pub element_id: String,
    pub domain: String,
    pub outcome: String,
    pub recorded_at_unix: u64,
    pub embedding: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AttractorMatch {
    pub record: AttractorRecord,
    pub similarity: f32,
    pub distance: f32,
}

pub struct LatticeMemoryStore {
    db_path: PathBuf,
    usearch_path: PathBuf,
    conn: Connection,
    index: Index,
    embedding_dim: usize,
    similarity_threshold: f32,
    next_key: u64,
}

impl LatticeMemoryStore {
    pub fn open(
        db_path: impl AsRef<Path>,
        embedding_dim: usize,
        similarity_threshold: f32,
    ) -> Result<Self, MemoryError> {
        let db_path = db_path.as_ref().to_path_buf();
        let usearch_path = Self::usearch_sidecar_path(&db_path);
        let conn = open_connection(&db_path)?;
        ensure_schema(&conn, embedding_dim)?;

        let mut store = Self {
            db_path,
            usearch_path,
            conn,
            index: Self::build_index(embedding_dim)?,
            embedding_dim,
            similarity_threshold,
            next_key: 1,
        };
        store.bootstrap_index()?;
        Ok(store)
    }

    pub fn open_default(db_path: impl AsRef<Path>) -> Result<Self, MemoryError> {
        Self::open(db_path, DEFAULT_EMBEDDING_DIM, DEFAULT_SIMILARITY_THRESHOLD)
    }

    fn usearch_sidecar_path(db_path: &Path) -> PathBuf {
        let mut path = db_path.to_path_buf();
        if let Some(name) = path.file_name() {
            let sidecar = format!("{}.usearch", name.to_string_lossy());
            path.set_file_name(sidecar);
        } else {
            path.set_extension("usearch");
        }
        path
    }

    fn build_index(embedding_dim: usize) -> Result<Index, MemoryError> {
        let options = IndexOptions {
            dimensions: embedding_dim,
            metric: MetricKind::Cos,
            quantization: ScalarKind::F32,
            connectivity: 16,
            expansion_add: 128,
            expansion_search: 64,
            ..IndexOptions::default()
        };
        let index = Index::new(&options).map_err(|e| MemoryError::Usearch(e.to_string()))?;
        index
            .reserve(MAX_ATTRACTORS)
            .map_err(|e| MemoryError::Usearch(e.to_string()))?;
        Ok(index)
    }

    fn ensure_index_capacity(&self) -> Result<(), MemoryError> {
        let existing = self.attractor_count()? as usize;
        let headroom = existing.saturating_add(64).max(64);
        let reserve_to = headroom.min(MAX_ATTRACTORS);
        self.index
            .reserve(reserve_to)
            .map_err(|e| MemoryError::Usearch(e.to_string()))?;
        Ok(())
    }

    fn bootstrap_index(&mut self) -> Result<(), MemoryError> {
        if self.usearch_path.exists() {
            if let Ok(()) = self.index.load(self.usearch_path.to_string_lossy().as_ref()) {
                self.next_key = self.max_key_from_sql()?.saturating_add(1);
                self.ensure_index_capacity()?;
                return Ok(());
            }
            tracing::warn!(
                path = %self.usearch_path.display(),
                "USearch sidecar corrupt or mismatched; rebuilding from sqlite-vec"
            );
        }
        self.rebuild_usearch_from_sql()?;
        Ok(())
    }

    fn max_key_from_sql(&self) -> Result<u64, MemoryError> {
        let max_key: Option<i64> = self.conn.query_row(
            "SELECT MAX(key) FROM lattice_memory_meta",
            [],
            |row| row.get(0),
        )?;
        Ok(max_key.unwrap_or(0) as u64)
    }

    fn rebuild_usearch_from_sql(&mut self) -> Result<(), MemoryError> {
        self.index = Self::build_index(self.embedding_dim)?;
        let mut stmt = self.conn.prepare(
            "SELECT key, entry_id, element_id, domain, outcome, recorded_at_unix, embedding_dim
             FROM lattice_memory_meta ORDER BY key ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)? as u64,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, u64>(5)?,
                row.get::<_, i64>(6)? as usize,
            ))
        })?;

        let vec_table = vec_table_name(self.embedding_dim);
        for row in rows {
            let (key, entry_id, element_id, domain, outcome, recorded_at_unix, dim) = row?;
            if dim != self.embedding_dim {
                continue;
            }
            let embedding = self.fetch_embedding_from_vec_table(&vec_table, key)?;
            let normalized = normalize_embedding(&embedding, self.embedding_dim);
            self.index
                .add(key, &normalized)
                .map_err(|e| MemoryError::Usearch(e.to_string()))?;
            let _ = (entry_id, element_id, domain, outcome, recorded_at_unix);
        }
        self.next_key = self.max_key_from_sql()?.saturating_add(1);
        self.persist_usearch()?;
        Ok(())
    }

    fn fetch_embedding_from_vec_table(
        &self,
        vec_table: &str,
        key: u64,
    ) -> Result<Vec<f32>, MemoryError> {
        let sql = format!("SELECT embedding FROM {vec_table} WHERE rowid = ?1");
        let blob: Vec<u8> = self.conn.query_row(&sql, rusqlite::params![key as i64], |row| {
            row.get(0)
        })?;
        decode_vec0_f32_blob(&blob, self.embedding_dim)
    }

    pub fn sqlite_vec_version(&self) -> Option<String> {
        vec_version(&self.conn).ok().flatten()
    }

    pub fn attractor_count(&self) -> Result<u64, MemoryError> {
        attractor_count(&self.conn)
    }

    pub fn embedding_dim(&self) -> usize {
        self.embedding_dim
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    pub fn search(
        &self,
        query: &[f32],
        limit: usize,
    ) -> Result<Vec<AttractorMatch>, MemoryError> {
        self.search_with_options(query, limit, self.similarity_threshold, false)
    }

    pub fn search_with_options(
        &self,
        query: &[f32],
        limit: usize,
        threshold: f32,
        accepted_only: bool,
    ) -> Result<Vec<AttractorMatch>, MemoryError> {
        let normalized = normalize_embedding(query, self.embedding_dim);
        let matches = self
            .index
            .search(&normalized, limit.max(1))
            .map_err(|e| MemoryError::Usearch(e.to_string()))?;

        let mut results = Vec::new();
        for (key, distance) in matches.keys.iter().zip(matches.distances.iter()) {
            let similarity = 1.0 - distance;
            if similarity < threshold {
                continue;
            }
            let Some(meta) = fetch_meta_by_key(&self.conn, *key)? else {
                continue;
            };
            if accepted_only && meta.outcome != "accepted" {
                continue;
            }
            let vec_table = vec_table_name(self.embedding_dim);
            let embedding = self.fetch_embedding_from_vec_table(&vec_table, *key)?;
            results.push(AttractorMatch {
                record: AttractorRecord {
                    entry_id: meta.entry_id,
                    element_id: meta.element_id,
                    domain: meta.domain,
                    outcome: meta.outcome,
                    recorded_at_unix: meta.recorded_at_unix,
                    embedding,
                },
                similarity,
                distance: *distance,
            });
        }
        results.sort_by(|a, b| {
            b.similarity
                .partial_cmp(&a.similarity)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        Ok(results)
    }

    pub fn record_entry(&mut self, entry: &MemoryEntryJson) -> Result<u64, MemoryError> {
        if entry.embedding.is_empty() {
            return Err(MemoryError::MissingEmbedding);
        }
        let payload = serde_json::to_string(entry)?;
        let record = AttractorRecord {
            entry_id: entry.id.clone(),
            element_id: entry.element_id.clone(),
            domain: entry.domain.clone(),
            outcome: entry.result.clone(),
            recorded_at_unix: parse_timestamp_unix(&entry.timestamp),
            embedding: entry.embedding.clone(),
        };
        let key = self.record_internal(record, &payload)?;
        Ok(key)
    }

    fn record_internal(&mut self, record: AttractorRecord, payload_json: &str) -> Result<u64, MemoryError> {
        if self.attractor_count()? >= MAX_ATTRACTORS as u64 {
            return Err(MemoryError::Other(format!(
                "attractor cap reached ({MAX_ATTRACTORS})"
            )));
        }
        let embedding = normalize_embedding(&record.embedding, self.embedding_dim);
        let key = self.next_key;
        self.next_key += 1;

        insert_meta(
            &self.conn,
            key,
            &record.entry_id,
            &record.element_id,
            &record.domain,
            &record.outcome,
            record.recorded_at_unix,
            self.embedding_dim,
            payload_json,
        )?;

        let vec_table = vec_table_name(self.embedding_dim);
        let emb_json = embedding_to_json(&embedding);
        insert_vector(
            &self.conn,
            &vec_table,
            key,
            &emb_json,
            &record.entry_id,
            &record.outcome,
        )?;

        self.index
            .add(key, &embedding)
            .map_err(|e| MemoryError::Usearch(e.to_string()))?;
        self.persist_usearch()?;
        Ok(key)
    }

    pub fn record(&mut self, record: AttractorRecord) -> Result<u64, MemoryError> {
        let payload = serde_json::to_string(&MemoryEntryJson {
            id: record.entry_id.clone(),
            timestamp: record.recorded_at_unix.to_string(),
            element_id: record.element_id.clone(),
            domain: record.domain.clone(),
            proposal: serde_json::json!({}),
            result: record.outcome.clone(),
            errors: vec![],
            traversal_path: vec![],
            embedding: record.embedding.clone(),
            metadata: None,
        })?;
        self.record_internal(record, &payload)
    }

    pub fn search_entries(
        &self,
        query: &[f32],
        limit: usize,
        threshold: Option<f32>,
        accepted_only: bool,
    ) -> Result<Vec<MemoryMatchJson>, MemoryError> {
        let thr = threshold.unwrap_or(self.similarity_threshold);
        let matches = self.search_with_options(query, limit, thr, accepted_only)?;
        Ok(matches
            .into_iter()
            .map(|m| MemoryMatchJson {
                entry: self.match_to_entry(&m),
                similarity: m.similarity,
            })
            .collect())
    }

    pub fn history_entries(
        &self,
        element_id: &str,
        outcome: Option<&str>,
    ) -> Result<Vec<MemoryEntryJson>, MemoryError> {
        let rows = fetch_history(&self.conn, element_id, outcome)?;
        let vec_table = vec_table_name(self.embedding_dim);
        rows.into_iter()
            .map(|m| {
                let embedding = self.fetch_embedding_from_vec_table(&vec_table, m.key).ok();
                self.meta_to_entry(&m, embedding)
            })
            .collect()
    }

    pub fn export_entries(&self) -> Result<Vec<MemoryEntryJson>, MemoryError> {
        let rows = fetch_all_meta(&self.conn)?;
        let vec_table = vec_table_name(self.embedding_dim);
        rows.into_iter()
            .map(|meta| {
                let embedding = self
                    .fetch_embedding_from_vec_table(&vec_table, meta.key)
                    .ok();
                self.meta_to_entry(&meta, embedding)
            })
            .collect()
    }

    pub fn validation_count(&self, element_id: &str) -> Result<u64, MemoryError> {
        count_by_element(&self.conn, element_id)
    }

    fn meta_to_entry(
        &self,
        meta: &AttractorMeta,
        embedding: Option<Vec<f32>>,
    ) -> Result<MemoryEntryJson, MemoryError> {
        if let Some(payload) = &meta.payload_json {
            if let Ok(mut entry) = serde_json::from_str::<MemoryEntryJson>(payload) {
                if entry.embedding.is_empty() {
                    if let Some(emb) = embedding {
                        entry.embedding = emb;
                    }
                }
                return Ok(entry);
            }
        }
        Ok(MemoryEntryJson {
            id: meta.entry_id.clone(),
            timestamp: meta.recorded_at_unix.to_string(),
            element_id: meta.element_id.clone(),
            domain: meta.domain.clone(),
            proposal: serde_json::json!({}),
            result: meta.outcome.clone(),
            errors: vec![],
            traversal_path: vec![],
            embedding: embedding.unwrap_or_default(),
            metadata: None,
        })
    }

    fn match_to_entry(&self, m: &AttractorMatch) -> MemoryEntryJson {
        if let Ok(Some(meta)) = fetch_meta_by_entry_id(&self.conn, &m.record.entry_id) {
            if let Ok(entry) = self.meta_to_entry(&meta, Some(m.record.embedding.clone())) {
                return entry;
            }
        }
        MemoryEntryJson {
            id: m.record.entry_id.clone(),
            timestamp: m.record.recorded_at_unix.to_string(),
            element_id: m.record.element_id.clone(),
            domain: m.record.domain.clone(),
            proposal: serde_json::json!({}),
            result: m.record.outcome.clone(),
            errors: vec![],
            traversal_path: vec![],
            embedding: m.record.embedding.clone(),
            metadata: None,
        }
    }

    fn persist_usearch(&self) -> Result<(), MemoryError> {
        if let Some(parent) = self.usearch_path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        self.index
            .save(self.usearch_path.to_string_lossy().as_ref())
            .map_err(|e| MemoryError::Usearch(e.to_string()))
    }
}

fn normalize_embedding(values: &[f32], dim: usize) -> Vec<f32> {
    let mut out = vec![0.0_f32; dim];
    let copy_len = values.len().min(dim);
    out[..copy_len].copy_from_slice(&values[..copy_len]);
    let norm: f32 = out.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm > 0.0 {
        for v in &mut out {
            *v /= norm;
        }
    }
    out
}

fn decode_vec0_f32_blob(blob: &[u8], dim: usize) -> Result<Vec<f32>, MemoryError> {
    if blob.len() == dim * 4 {
        let mut out = vec![0.0_f32; dim];
        for (i, chunk) in blob.chunks_exact(4).enumerate() {
            out[i] = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }
        return Ok(out);
    }
    // sqlite-vec may return JSON for some insert paths; try parsing
    let text = std::str::from_utf8(blob)
        .map_err(|e| MemoryError::Other(format!("embedding decode: {e}")))?;
    let parsed: Vec<f32> = serde_json::from_str(text)
        .map_err(|e| MemoryError::Other(format!("embedding json decode: {e}")))?;
    Ok(normalize_embedding(&parsed, dim))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("aep-lattice-memory-{name}-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let sidecar = LatticeMemoryStore::usearch_sidecar_path(&path);
        let _ = std::fs::remove_file(&sidecar);
        path
    }

    fn now_unix() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    #[test]
    fn record_and_search_attractor() {
        let path = temp_db("roundtrip");
        let mut store = LatticeMemoryStore::open(&path, 8, 0.9).unwrap();
        assert!(store.sqlite_vec_version().is_some());

        let base = vec![1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
        store
            .record(AttractorRecord {
                entry_id: "mem-accepted-1".into(),
                element_id: "CP-00001".into(),
                domain: "ui".into(),
                outcome: "accepted".into(),
                recorded_at_unix: now_unix(),
                embedding: base.clone(),
            })
            .unwrap();

        let query = vec![0.99, 0.01, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
        let hits = store.search(&query, 3).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].similarity >= 0.9);
        assert_eq!(hits[0].record.entry_id, "mem-accepted-1");

        // Re-open: USearch sidecar + sqlite-vec persistence
        drop(store);
        let store2 = LatticeMemoryStore::open(&path, 8, 0.9).unwrap();
        assert_eq!(store2.attractor_count().unwrap(), 1);
        let hits2 = store2.search(&query, 3).unwrap();
        assert_eq!(hits2.len(), 1);
    }
}