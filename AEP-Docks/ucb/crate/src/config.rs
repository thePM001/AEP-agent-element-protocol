// @PAD: aep-ucb-public-contract-2.8.5
// @GCDE: gaplune-decode hmac-sha256:ab54811d1526a0253fdd14253ff4ed74c94aafc36362f2c29fc94a24eef11c06
use aep_ucb_perimeter_v1::{parse_profile, PredicateProfile, WireLimits};
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct UcbConfig {
    pub listen_host: String,
    pub listen_port: u16,
    pub data_dir: PathBuf,
    pub manifest_dir: PathBuf,
    pub api_key: Option<String>,
    pub strict_egress: bool,
    pub socket_base: PathBuf,
    pub predicate_profile: PredicateProfile,
    pub wire_limits: WireLimits,
    pub manifest_strict: bool,
}

impl UcbConfig {
    pub fn from_env() -> Self {
        let data_dir = std::env::var("AEP_DATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/data/aep"));
        let manifest_dir = std::env::var("AEP_TASK_MANIFEST_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| data_dir.join("ucb/manifests"));
        let profile_raw = std::env::var("UCB_PREDICATE_PROFILE").ok();
        let predicate_profile = parse_profile(profile_raw.as_deref()).unwrap_or(PredicateProfile::PerimeterV1);
        let manifest_strict = std::env::var("UCB_MANIFEST_STRICT")
            .map(|v| v != "0")
            .unwrap_or(true);
        Self {
            listen_host: std::env::var("UCB_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
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
            socket_base: std::env::var("AEP_SOCKET_BASE")
                .map(PathBuf::from)
                .unwrap_or_else(|_| data_dir.join("sockets")),
            predicate_profile,
            wire_limits: WireLimits::default(),
            manifest_strict,
        }
    }
}
