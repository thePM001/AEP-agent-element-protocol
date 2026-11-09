//! Optional System-1 tier two: a small model ranks the tier one shortlist.
//! The model sees catalog ids, signatures and descriptions and may answer with ids only.
//! `Index::accept_ranked` drops every word that is not a catalog id, so nothing the model
//! writes can reach the caller except the choice and order of catalog entries.
//! Point UCM_LOOKUP_RANKER_URL at any OpenAI compatible chat completions endpoint, for
//! example the AEP model-gateway or a local Ollama.

use crate::engine::Config;
use aep_ucm_lookup::Index;
use serde_json::{json, Value as J};
use std::time::Duration;

pub struct Ranker {
    url: String,
    model: String,
    key: Option<String>,
    http: reqwest::Client,
}

const SYSTEM: &str = "You choose tools for an exact calculation engine. You never calculate. \
Reply with catalog ids from the list, one per line with the best first. Write nothing else.";

impl Ranker {
    pub fn from_config(cfg: &Config) -> Result<Option<Ranker>, String> {
        let Some(url) = cfg.ranker_url.clone() else {
            return Ok(None);
        };
        let key = match &cfg.ranker_key_file {
            Some(p) => Some(
                std::fs::read_to_string(p)
                    .map_err(|e| format!("{}: {e}", p.display()))?
                    .trim()
                    .to_string(),
            ),
            None => None,
        };
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Some(Ranker {
            url,
            model: cfg.ranker_model.clone(),
            key,
            http,
        }))
    }

    pub async fn rank(
        &self,
        query: &str,
        index: &Index,
        shortlist: &[(String, f64)],
        k: usize,
    ) -> Result<Vec<(String, f64)>, String> {
        let body = json!({
            "model": self.model,
            "temperature": 0,
            "max_tokens": 200,
            "messages": [
                { "role": "system", "content": SYSTEM },
                { "role": "user", "content": format!("Task: {query}\n\nCatalog:\n{}", index.shortlist_text(shortlist)) },
            ],
        });
        let mut req = self.http.post(&self.url).json(&body);
        if let Some(k) = &self.key {
            req = req.bearer_auth(k);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("ranker answered {}", resp.status()));
        }
        let v: J = resp.json().await.map_err(|e| e.to_string())?;
        let text = v["choices"][0]["message"]["content"].as_str().unwrap_or("");
        let ids: Vec<String> = text
            .split(|c: char| c == '\n' || c == ',' || c.is_whitespace())
            .map(|t| {
                t.trim_matches(|c: char| !(c.is_alphanumeric() || c == '.' || c == '_'))
                    .to_string()
            })
            .filter(|t| !t.is_empty())
            .collect();
        // Only ids from the shortlist count, so the model cannot pull in an unrelated entry.
        let allowed: Vec<String> = ids
            .into_iter()
            .filter(|id| shortlist.iter().any(|(s, _)| s == id))
            .collect();
        Ok(index.accept_ranked(&allowed, k))
    }
}
