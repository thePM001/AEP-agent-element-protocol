//! Inference engine config resolution (mirrors setup-agent/lib/inference.mjs).

use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct InferenceConfig {
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub api_key_env: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SavedInference {
    provider: Option<String>,
    model: Option<String>,
    base_url: Option<String>,
    api_key_env: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BaseNodeFile {
    inference_engine: Option<SavedInference>,
}

pub fn resolve_inference_config(data_dir: &Path) -> Result<InferenceConfig, String> {
    if let Some(saved) = load_saved_config(data_dir) {
        let provider = normalize_provider(Some(saved.provider.as_deref().unwrap_or("llama_cpp")));
        let defaults = provider_defaults(&provider);
        return Ok(InferenceConfig {
            provider,
            model: saved.model.unwrap_or_else(|| defaults.0.to_string()),
            base_url: saved.base_url.unwrap_or_else(|| defaults.1.to_string()),
            api_key_env: saved
                .api_key_env
                .or_else(|| defaults.2.map(str::to_string)),
        });
    }

    let provider = normalize_provider(
        std::env::var("AEP_SETUP_LLM_PROVIDER")
            .or_else(|_| std::env::var("AEP_INFERENCE_PROVIDER"))
            .ok()
            .as_deref(),
    );
    let defaults = provider_defaults(&provider);
    Ok(InferenceConfig {
        provider,
        model: std::env::var("AEP_SETUP_LLM_MODEL")
            .or_else(|_| std::env::var("AEP_INFERENCE_MODEL"))
            .unwrap_or_else(|_| defaults.0.to_string()),
        base_url: std::env::var("AEP_SETUP_LLM_BASE_URL")
            .or_else(|_| std::env::var("AEP_INFERENCE_BASE_URL"))
            .unwrap_or_else(|_| defaults.1.to_string()),
        api_key_env: std::env::var("AEP_SETUP_LLM_API_KEY_ENV")
            .or_else(|_| std::env::var("AEP_INFERENCE_API_KEY_ENV"))
            .ok()
            .or_else(|| defaults.2.map(str::to_string)),
    })
}

pub fn resolve_api_key(inference: &InferenceConfig, data_dir: &Path) -> Option<String> {
    let env_key = inference.api_key_env.as_deref()?;
    if let Ok(v) = std::env::var(env_key) {
        if !v.is_empty() {
            return Some(v);
        }
    }
    read_inference_secrets(data_dir).get(env_key).cloned()
}

fn load_saved_config(data_dir: &Path) -> Option<SavedInference> {
    let config_path = data_dir.join("inference-config.json");
    if config_path.is_file() {
        if let Ok(text) = fs::read_to_string(&config_path) {
            if let Ok(parsed) = serde_json::from_str::<SavedInference>(&text) {
                if parsed.provider.is_some() {
                    return Some(parsed);
                }
            }
        }
    }
    let base_node = data_dir.join("base-node.json");
    if base_node.is_file() {
        if let Ok(text) = fs::read_to_string(&base_node) {
            if let Ok(parsed) = serde_json::from_str::<BaseNodeFile>(&text) {
                return parsed.inference_engine;
            }
        }
    }
    None
}

fn read_inference_secrets(data_dir: &Path) -> HashMap<String, String> {
    let path = data_dir.join("inference-secrets.env");
    let Ok(text) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    parse_env_file(&text)
}

fn parse_env_file(content: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((key, value)) = trimmed.split_once('=') else {
            continue;
        };
        out.insert(key.trim().to_string(), value.trim().to_string());
    }
    out
}

fn normalize_provider(raw: Option<&str>) -> String {
    match raw.unwrap_or("llama_cpp").to_lowercase().as_str() {
        "ollama" => "llama_cpp".into(),
        "openai" => "custom".into(),
        other => other.to_string(),
    }
}

fn provider_defaults(provider: &str) -> (&'static str, &'static str, Option<&'static str>) {
    match provider {
        "anthropic" => (
            "claude-sonnet-4-20250514",
            "https://api.anthropic.com",
            Some("ANTHROPIC_API_KEY"),
        ),
        "openrouter" => (
            "anthropic/claude-sonnet-4",
            "https://openrouter.ai/api/v1",
            Some("OPENROUTER_API_KEY"),
        ),
        "custom" => ("default", "http://127.0.0.1:8080/v1", Some("AEP_INFERENCE_API_KEY")),
        _ => ("local", "http://127.0.0.1:8080/v1", None),
    }
}