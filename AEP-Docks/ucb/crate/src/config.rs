use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct UcbConfig {
    pub listen_host: String,
    pub listen_port: u16,
    pub data_dir: PathBuf,
    pub manifest_dir: PathBuf,
    pub api_key: Option<String>,
    pub strict_egress: bool,
    pub gap_engine_url: Option<String>,
    /// Tier 2: non-GAP constrained decoders (e.g. dottxt-compatible HTTP endpoints).
    pub constrained_decoder_url: Option<String>,
    pub llm_synthesis_url: Option<String>,
    pub socket_base: PathBuf,
}

impl UcbConfig {
    pub fn has_synthesis_tier(&self) -> bool {
        self.gap_engine_url.is_some()
            || self.constrained_decoder_url.is_some()
            || self.llm_synthesis_url.is_some()
    }

    pub fn from_env() -> Self {
        let data_dir = std::env::var("AEP_DATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/data/aep"));
        let manifest_dir = std::env::var("AEP_TASK_MANIFEST_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| data_dir.join("ucb/manifests"));
        Self {
            listen_host: std::env::var("UCB_HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            listen_port: std::env::var("UCB_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(8412),
            data_dir: data_dir.clone(),
            manifest_dir,
            api_key: std::env::var("UCB_API_KEY").ok(),
            strict_egress: std::env::var("UCB_EGRESS_STRICT")
                .map(|v| v != "0")
                .unwrap_or(true),
            gap_engine_url: std::env::var("UCB_GAP_ENGINE_URL").ok(),
            constrained_decoder_url: std::env::var("UCB_CONSTRAINED_DECODER_URL").ok(),
            llm_synthesis_url: std::env::var("UCB_LLM_SYNTHESIS_URL").ok(),
            socket_base: std::env::var("AEP_SOCKET_BASE")
                .map(PathBuf::from)
                .unwrap_or_else(|_| data_dir.join("sockets")),
        }
    }
}