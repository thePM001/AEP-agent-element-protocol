use rusqlite::{Connection, OptionalExtension, params};
use rusqlite::ffi::sqlite3_auto_extension;
use sqlite_vec::sqlite3_vec_init;
use std::path::Path;

use crate::error::MemoryError;

pub fn register_sqlite_vec_extension() {
    unsafe {
        sqlite3_auto_extension(Some(std::mem::transmute::<
            *const (),
            unsafe extern "C" fn(
                *mut rusqlite::ffi::sqlite3,
                *mut *mut i8,
                *const rusqlite::ffi::sqlite3_api_routines,
            ) -> i32,
        >(sqlite3_vec_init as *const ())));
    }
}

pub fn open_connection(path: &Path) -> Result<Connection, MemoryError> {
    register_sqlite_vec_extension();
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")?;
    Ok(conn)
}

pub fn ensure_schema(conn: &Connection, embedding_dim: usize) -> Result<(), MemoryError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS lattice_memory_meta (
            key INTEGER PRIMARY KEY,
            entry_id TEXT NOT NULL UNIQUE,
            element_id TEXT NOT NULL,
            domain TEXT NOT NULL,
            outcome TEXT NOT NULL,
            recorded_at_unix INTEGER NOT NULL,
            embedding_dim INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_lattice_memory_element
            ON lattice_memory_meta(element_id);
        CREATE INDEX IF NOT EXISTS idx_lattice_memory_outcome
            ON lattice_memory_meta(outcome);",
    )?;
    migrate_payload_column(conn)?;

    let vec_table = format!("lattice_memory_vec_{embedding_dim}");
    let ddl = format!(
        "CREATE VIRTUAL TABLE IF NOT EXISTS {vec_table} USING vec0(
            embedding float[{embedding_dim}],
            +entry_id TEXT,
            +outcome TEXT
        );"
    );
    conn.execute_batch(&ddl)?;
    Ok(())
}

fn migrate_payload_column(conn: &Connection) -> Result<(), MemoryError> {
    let mut stmt = conn.prepare("PRAGMA table_info(lattice_memory_meta)")?;
    let cols = stmt.query_map([], |row| row.get::<_, String>(1))?;
    let has_payload = cols.filter_map(|r| r.ok()).any(|c| c == "payload_json");
    if !has_payload {
        conn.execute(
            "ALTER TABLE lattice_memory_meta ADD COLUMN payload_json TEXT",
            [],
        )?;
    }
    Ok(())
}

pub fn vec_table_name(embedding_dim: usize) -> String {
    format!("lattice_memory_vec_{embedding_dim}")
}

pub fn vec_version(conn: &Connection) -> Result<Option<String>, MemoryError> {
    let version: Option<String> = conn
        .query_row("SELECT vec_version()", [], |row| row.get(0))
        .optional()?;
    Ok(version)
}

#[derive(Debug, Clone)]
pub struct AttractorMeta {
    pub key: u64,
    pub entry_id: String,
    pub element_id: String,
    pub domain: String,
    pub outcome: String,
    pub recorded_at_unix: u64,
    pub payload_json: Option<String>,
}

#[allow(clippy::too_many_arguments)]
pub fn insert_meta(
    conn: &Connection,
    key: u64,
    entry_id: &str,
    element_id: &str,
    domain: &str,
    outcome: &str,
    recorded_at_unix: u64,
    embedding_dim: usize,
    payload_json: &str,
) -> Result<(), MemoryError> {
    conn.execute(
        "INSERT INTO lattice_memory_meta
            (key, entry_id, element_id, domain, outcome, recorded_at_unix, embedding_dim, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            key as i64,
            entry_id,
            element_id,
            domain,
            outcome,
            recorded_at_unix as i64,
            embedding_dim as i64,
            payload_json,
        ],
    )?;
    Ok(())
}

pub fn insert_vector(
    conn: &Connection,
    vec_table: &str,
    key: u64,
    embedding_json: &str,
    entry_id: &str,
    outcome: &str,
) -> Result<(), MemoryError> {
    let sql = format!(
        "INSERT INTO {vec_table}(rowid, embedding, entry_id, outcome)
         VALUES (?1, ?2, ?3, ?4)"
    );
    conn.execute(&sql, params![key as i64, embedding_json, entry_id, outcome])?;
    Ok(())
}

pub fn attractor_count(conn: &Connection) -> Result<u64, MemoryError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM lattice_memory_meta",
        [],
        |row| row.get(0),
    )?;
    Ok(count as u64)
}

pub fn fetch_meta_by_key(conn: &Connection, key: u64) -> Result<Option<AttractorMeta>, MemoryError> {
    let row = conn
        .query_row(
            "SELECT key, entry_id, element_id, domain, outcome, recorded_at_unix, payload_json
             FROM lattice_memory_meta WHERE key = ?1",
            params![key as i64],
            map_meta_row,
        )
        .optional()?;
    Ok(row)
}

pub fn fetch_history(
    conn: &Connection,
    element_id: &str,
    outcome: Option<&str>,
) -> Result<Vec<AttractorMeta>, MemoryError> {
    let mut out = Vec::new();
    if let Some(result) = outcome {
        let mut stmt = conn.prepare(
            "SELECT key, entry_id, element_id, domain, outcome, recorded_at_unix, payload_json
             FROM lattice_memory_meta
             WHERE element_id = ?1 AND outcome = ?2
             ORDER BY recorded_at_unix DESC",
        )?;
        let rows = stmt.query_map(params![element_id, result], map_meta_row)?;
        for row in rows {
            out.push(row?);
        }
    } else {
        let mut stmt = conn.prepare(
            "SELECT key, entry_id, element_id, domain, outcome, recorded_at_unix, payload_json
             FROM lattice_memory_meta
             WHERE element_id = ?1
             ORDER BY recorded_at_unix DESC",
        )?;
        let rows = stmt.query_map(params![element_id], map_meta_row)?;
        for row in rows {
            out.push(row?);
        }
    }
    Ok(out)
}

pub fn fetch_all_meta(conn: &Connection) -> Result<Vec<AttractorMeta>, MemoryError> {
    let mut stmt = conn.prepare(
        "SELECT key, entry_id, element_id, domain, outcome, recorded_at_unix, payload_json
         FROM lattice_memory_meta ORDER BY key ASC",
    )?;
    let rows = stmt.query_map([], map_meta_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn count_by_element(conn: &Connection, element_id: &str) -> Result<u64, MemoryError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM lattice_memory_meta WHERE element_id = ?1",
        params![element_id],
        |row| row.get(0),
    )?;
    Ok(count as u64)
}

fn map_meta_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AttractorMeta> {
    Ok(AttractorMeta {
        key: row.get::<_, i64>(0)? as u64,
        entry_id: row.get(1)?,
        element_id: row.get(2)?,
        domain: row.get(3)?,
        outcome: row.get(4)?,
        recorded_at_unix: row.get(5)?,
        payload_json: row.get(6)?,
    })
}

pub fn fetch_meta_by_entry_id(
    conn: &Connection,
    entry_id: &str,
) -> Result<Option<AttractorMeta>, MemoryError> {
    let row = conn
        .query_row(
            "SELECT key, entry_id, element_id, domain, outcome, recorded_at_unix, payload_json
             FROM lattice_memory_meta WHERE entry_id = ?1",
            params![entry_id],
            map_meta_row,
        )
        .optional()?;
    Ok(row)
}

pub fn embedding_to_json(values: &[f32]) -> String {
    let parts: Vec<String> = values.iter().map(|v| format!("{v:.6}")).collect();
    format!("[{}]", parts.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_vec_extension_loads() {
        let conn = open_connection(Path::new(":memory:")).unwrap();
        let version = vec_version(&conn).unwrap();
        assert!(version.is_some());
        ensure_schema(&conn, 8).unwrap();
        let table = vec_table_name(8);
        insert_meta(
            &conn,
            1,
            "mem-1",
            "CP-00001",
            "ui",
            "accepted",
            1_700_000_000,
            8,
            "{}",
        )
        .unwrap();
        let emb = embedding_to_json(&[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
        insert_vector(&conn, &table, 1, &emb, "mem-1", "accepted").unwrap();
        assert_eq!(attractor_count(&conn).unwrap(), 1);
    }
}