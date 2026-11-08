//! Operations shared by the HTTP API, MCP and the CLI.

use crate::ranker::Ranker;
use crate::store::Store;
use aep_ucm_core::{evaluate, explain, load_program, Library, Limits, Program};
use aep_ucm_lookup::Index;
use aep_ucm_receipt::{issue, verify_replay, verify_signature, NodeKey, ProgramSource, ReceiptError};
use serde_json::{json, Value as J};
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct ApiError {
    pub code: String,
    pub message: String,
    pub status: u16,
}

impl ApiError {
    pub fn new(code: &str, message: impl Into<String>, status: u16) -> ApiError {
        ApiError {
            code: code.into(),
            message: message.into(),
            status,
        }
    }

    pub fn bad(code: &str, message: impl Into<String>) -> ApiError {
        Self::new(code, message, 400)
    }

    pub fn to_json(&self) -> J {
        json!({ "ok": false, "error": { "code": self.code, "message": self.message } })
    }
}

impl From<aep_ucm_core::UcmError> for ApiError {
    fn from(e: aep_ucm_core::UcmError) -> Self {
        let status = if e.code() == "budget_exceeded" { 422 } else { 400 };
        ApiError::new(e.code(), e.to_string(), status)
    }
}

impl From<ReceiptError> for ApiError {
    fn from(e: ReceiptError) -> Self {
        ApiError::new(e.code(), e.to_string(), 400)
    }
}

pub type ApiResult = std::result::Result<J, ApiError>;

#[derive(Debug, Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub data_dir: PathBuf,
    pub api_key: Option<String>,
    pub trusted_keys_file: Option<PathBuf>,
    pub ceiling: Limits,
    pub ranker_url: Option<String>,
    pub ranker_model: String,
    pub ranker_key_file: Option<PathBuf>,
    pub lattice_record: bool,
    pub lattice_log_bin: PathBuf,
    pub lattice_db: Option<PathBuf>,
    pub max_concurrent: usize,
}

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|v| !v.trim().is_empty())
}

fn env_u64(k: &str, d: u64) -> u64 {
    env(k).and_then(|v| v.parse().ok()).unwrap_or(d)
}

impl Config {
    pub fn from_env() -> Config {
        let aep_data = env("AEP_DATA").unwrap_or_else(|| "/data/aep".into());
        let data_dir = env("UCM_DATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(&aep_data).join("ucm"));
        let c = Limits::CEILING;
        Config {
            host: env("UCM_HOST").unwrap_or_else(|| "127.0.0.1".into()),
            port: env("UCM_PORT").and_then(|v| v.parse().ok()).unwrap_or(8414),
            data_dir,
            api_key: env("UCM_API_KEY"),
            trusted_keys_file: env("UCM_TRUSTED_KEYS").map(PathBuf::from),
            ceiling: Limits {
                steps: env_u64("UCM_BUDGET_CEILING_STEPS", c.steps),
                bits: env_u64("UCM_BUDGET_CEILING_BITS", c.bits),
                len: env_u64("UCM_BUDGET_CEILING_LEN", c.len),
                millis: env_u64("UCM_BUDGET_CEILING_MILLIS", c.millis),
            },
            ranker_url: env("UCM_LOOKUP_RANKER_URL"),
            ranker_model: env("UCM_LOOKUP_RANKER_MODEL").unwrap_or_else(|| "ucm-lookup".into()),
            ranker_key_file: env("UCM_LOOKUP_RANKER_KEY_FILE").map(PathBuf::from),
            lattice_record: env("UCM_LATTICE_RECORD").as_deref() == Some("1"),
            lattice_log_bin: env("AEP_LATTICE_LOG_BIN")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("aep-lattice-log")),
            lattice_db: env("AEP_LATTICE_DB").map(PathBuf::from),
            max_concurrent: env_u64("UCM_MAX_CONCURRENT", 4) as usize,
        }
    }
}

pub struct Engine {
    pub cfg: Config,
    pub lib: Library,
    pub index: Index,
    pub key: NodeKey,
    pub store: Store,
    pub ranker: Option<Ranker>,
    trusted: Vec<String>,
}

fn program_from(req: &J) -> std::result::Result<Program, ApiError> {
    let text = req.get("program").and_then(|x| x.as_str());
    let json_form = req.get("program_json");
    match (text, json_form) {
        (Some(t), None) => Ok(load_program(Some(t), None)?),
        (None, Some(j)) => Ok(load_program(None, Some(j))?),
        _ => Err(ApiError::bad("form_error", "give exactly one of program (text) or program_json")),
    }
}

impl Engine {
    pub fn open(cfg: Config) -> Result<Arc<Engine>, String> {
        let lib = Library::builtin().map_err(|e| format!("library: {e}"))?;
        let index = Index::build(&lib);
        std::fs::create_dir_all(&cfg.data_dir).map_err(|e| format!("{}: {e}", cfg.data_dir.display()))?;
        let key = NodeKey::load_or_create(&cfg.data_dir.join("ucm-sign.key")).map_err(|e| e.to_string())?;
        let store = Store::open(&cfg.data_dir).map_err(|e| format!("receipt store: {e}"))?;
        let mut trusted = vec![key.public_hex.clone()];
        if let Some(f) = &cfg.trusted_keys_file {
            let raw = std::fs::read_to_string(f).map_err(|e| format!("{}: {e}", f.display()))?;
            trusted.extend(
                raw.lines()
                    .map(|l| l.trim().to_string())
                    .filter(|l| !l.is_empty() && !l.starts_with('#')),
            );
        }
        let ranker = Ranker::from_config(&cfg)?;
        Ok(Arc::new(Engine {
            cfg,
            lib,
            index,
            key,
            store,
            ranker,
            trusted,
        }))
    }

    pub fn capabilities(&self) -> J {
        json!({
            "service": "aep-ucm",
            "engine_build": aep_ucm_core::engine_build(),
            "node_id": self.key.node_id,
            "public_key": self.key.public_hex,
            "library_version": self.lib.version,
            "library_digest": self.lib.digest,
            "tzdb": aep_ucm_core::time::tzdb_version(),
            "budget_default": Limits::DEFAULT.to_json(),
            "budget_ceiling": self.cfg.ceiling.to_json(),
            "lookup_tiers": if self.ranker.is_some() { json!(["1", "2"]) } else { json!(["1"]) },
            "receipt_schema": aep_ucm_receipt::RECEIPT_SCHEMA,
            "endpoints": ["GET /health", "GET /ucm/v1/capabilities", "GET /ucm/v1/catalog", "POST /ucm/v1/lookup", "POST /ucm/v1/eval", "POST /ucm/v1/verify", "POST /ucm/v1/explain", "GET /ucm/v1/receipts/{id}", "POST /ucm/v1/mcp"],
            "auth": if self.cfg.api_key.is_some() { "key required for POST" } else { "loopback, no key" },
        })
    }

    fn limits(&self, req: &J) -> std::result::Result<Limits, ApiError> {
        let base = Limits {
            steps: Limits::DEFAULT.steps.min(self.cfg.ceiling.steps),
            bits: Limits::DEFAULT.bits.min(self.cfg.ceiling.bits),
            len: Limits::DEFAULT.len.min(self.cfg.ceiling.len),
            millis: Limits::DEFAULT.millis.min(self.cfg.ceiling.millis),
        };
        Ok(Limits::lowered(base, self.cfg.ceiling, req.get("budget"))?)
    }

    /// Evaluate and issue a signed receipt. Blocking: call from a blocking thread.
    pub fn evaluate(&self, req: &J) -> ApiResult {
        let p = program_from(req)?;
        let inputs = req.get("inputs").cloned().unwrap_or(json!({}));
        let limits = self.limits(req)?;
        // A program counts as a library program only when it is the reviewed formula text.
        let source = match req.get("library_formula").and_then(|x| x.as_str()) {
            Some(id) => {
                let f = self
                    .lib
                    .formula(id)
                    .ok_or_else(|| ApiError::bad("unbound_name", format!("formula {id}")))?;
                if aep_ucm_core::program_hash(&f.program)? != aep_ucm_core::program_hash(&p)? {
                    return Err(ApiError::bad(
                        "library_mismatch",
                        format!("program differs from library formula {id}"),
                    ));
                }
                ProgramSource::Library
            }
            None => ProgramSource::Agent,
        };
        let outcome = evaluate(&p, &inputs, limits, &self.lib)?;
        let receipt = issue(&self.key, &p, &inputs, &outcome, &self.lib, source)?;
        let ledger = self
            .store
            .put(&receipt, &self.cfg)
            .map_err(|e| ApiError::new("store_error", e, 500))?;
        Ok(json!({
            "ok": true,
            "result": outcome.result_json(),
            "result_type": outcome.result_ty.name(),
            "receipt_id": receipt["receipt_id"],
            "receipt": receipt,
            "ledger": ledger,
        }))
    }

    /// Run a program without a receipt or store write. Used by batch mode for differential tests.
    pub fn evaluate_unsigned(&self, req: &J) -> ApiResult {
        let p = program_from(req)?;
        let inputs = req.get("inputs").cloned().unwrap_or(json!({}));
        let outcome = evaluate(&p, &inputs, self.limits(req)?, &self.lib)?;
        Ok(json!({ "ok": true, "result": outcome.result_json() }))
    }

    pub fn verify(&self, req: &J) -> ApiResult {
        let receipt = match req.get("receipt") {
            Some(J::String(id)) => self
                .store
                .get(id)
                .ok_or_else(|| ApiError::new("not_found", format!("no stored receipt {id}"), 404))?,
            Some(r) => r.clone(),
            None => return Err(ApiError::bad("form_error", "missing receipt")),
        };
        let mode = req.get("mode").and_then(|x| x.as_str()).unwrap_or("signature");
        let check = match mode {
            "signature" => verify_signature(&receipt, &self.trusted)?,
            "replay" => verify_replay(&receipt, &self.trusted, &self.lib)?,
            other => {
                return Err(ApiError::bad(
                    "form_error",
                    format!("mode must be signature or replay, got {other}"),
                ))
            }
        };
        Ok(
            json!({ "ok": true, "mode": mode, "receipt_id": check.receipt_id, "node_id": check.node_id, "trusted": if check.trusted { "true" } else { "false" } }),
        )
    }

    pub fn explain(&self, req: &J) -> ApiResult {
        let p = program_from(req)?;
        let mut e = explain(&p, &self.lib)?;
        e["ok"] = J::Bool(true);
        Ok(e)
    }

    pub fn catalog(&self) -> J {
        aep_ucm_core::catalog_document(&self.lib)
    }

    /// System-1 lookup. Tier two runs only when a ranker is configured and the caller allows it.
    pub async fn lookup(&self, req: &J) -> ApiResult {
        let query = req
            .get("query")
            .and_then(|x| x.as_str())
            .ok_or_else(|| ApiError::bad("form_error", "missing query"))?;
        if query.len() > 2000 {
            return Err(ApiError::bad("form_error", "query longer than 2000 bytes"));
        }
        let k = req
            .get("k")
            .and_then(|x| x.as_str().and_then(|s| s.parse().ok()).or(x.as_u64()))
            .unwrap_or(5)
            .clamp(1, 20) as usize;
        let tier = req.get("tier").and_then(|x| x.as_str()).unwrap_or("auto");
        let shortlist = self.index.search(query, (k * 4).max(12));
        if tier != "1" {
            if let Some(r) = &self.ranker {
                match r.rank(query, &self.index, &shortlist, k).await {
                    Ok(ranked) if !ranked.is_empty() => return Ok(self.index.reply(query, "tier2", &ranked)),
                    Ok(_) => {}
                    Err(e) => tracing::warn!("tier two ranker failed, tier one answers: {e}"),
                }
            } else if tier == "2" {
                return Err(ApiError::bad("ranker_off", "no tier two ranker is configured"));
            }
        }
        let mut top = shortlist;
        top.truncate(k);
        Ok(self.index.reply(query, "tier1", &top))
    }

    pub fn receipt(&self, id: &str) -> ApiResult {
        self.store
            .get(id)
            .ok_or_else(|| ApiError::new("not_found", format!("no stored receipt {id}"), 404))
    }
}
