// @PAD: aep-ucb-public-contract-2.8.5
// @GCDE: gaplune-decode hmac-sha256:ab54811d1526a0253fdd14253ff4ed74c94aafc36362f2c29fc94a24eef11c06
//! AEP Universal Connect Bridge (UCB) - Rust binary entry point.

use aep_ucb::auth::bootstrap_auth;
use aep_ucb::bridge::UcbRuntime;
use aep_ucb::config::UcbConfig;
use aep_ucb::http::{build_router, AppState};
use clap::Parser;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

#[derive(Debug, Parser)]
#[command(name = "aep-ucb", about = "AEP 2.8.5 Universal Connect Bridge (Rust)")]
struct Cli {
    #[arg(long, env = "UCB_HOST")]
    host: Option<String>,
    #[arg(long, env = "UCB_PORT")]
    port: Option<u16>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("aep_ucb=info".parse()?))
        .init();

    let cli = Cli::parse();
    let mut config = UcbConfig::from_env();
    if let Some(host) = cli.host {
        config.listen_host = host;
    }
    if let Some(port) = cli.port {
        config.listen_port = port;
    }

    let runtime = Arc::new(UcbRuntime::new(config.clone())?);
    let env_key = std::env::var("UCB_API_KEY").ok();
    let (auth, material) = bootstrap_auth(&config.data_dir, env_key.as_deref());

    if material.source == "generated" {
        if let Some(preview) = &material.key_preview {
            eprintln!(
                "UCB API key generated. Use Authorization: Bearer <key> for protected endpoints."
            );
            eprintln!("UCB key preview: {preview}");
        }
    }

    let base_path = std::env::var("UCB_BASE_PATH")
        .unwrap_or_default()
        .trim()
        .trim_end_matches('/')
        .to_string();

    let state = AppState {
        runtime,
        auth,
        base_path,
    };

    let app = build_router(state);
    let addr = format!("{}:{}", config.listen_host, config.listen_port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    eprintln!(
        "AEP Universal Connect Bridge (UCB) listening on http://{addr} [rust]"
    );
    eprintln!("Secured dock: foreign ingress + internet egress only (no internal lattice attach)");

    axum::serve(listener, app).await?;
    Ok(())
}