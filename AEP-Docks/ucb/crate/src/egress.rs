//! Egress proxy: credential injection + firewall-style access rules (Airlock patterns).

use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessRule {
    pub action: String,
    pub method: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EgressRoute {
    pub path_prefix: String,
    pub upstream: String,
    #[serde(default)]
    pub strip_prefix: Option<String>,
    #[serde(default)]
    pub access_rules: Vec<AccessRule>,
    /// Env var name for bearer token. Must pass [`auth_token_env_allowed`].
    #[serde(default)]
    pub auth_token_env: Option<String>,
}

/// CRITICAL: only inject secrets from allowlisted env names.
/// Default prefixes: `UCB_EGRESS_`, `UCB_AUTH_`.
/// Extra names: comma-separated `UCB_EGRESS_SECRET_ENV_ALLOWLIST`.
pub fn auth_token_env_allowed(env_key: &str) -> bool {
    let key = env_key.trim();
    if key.is_empty() {
        return false;
    }
    // Reject path-like or shell metacharacters.
    if key.contains('/') || key.contains('\\') || key.contains('\0') || key.contains('=') {
        return false;
    }
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return false;
    }
    // Default allow: UCB inject prefix, UCB auth prefix, and AEP connector tokens
    // (AEP_SLACK_BOT_TOKEN, AEP_NOTION_TOKEN, ...). Never bare AWS_*/PATH/HOME.
    if key.starts_with("UCB_EGRESS_")
        || key.starts_with("UCB_AUTH_")
        || key.starts_with("AEP_")
    {
        return true;
    }
    if let Ok(list) = std::env::var("UCB_EGRESS_SECRET_ENV_ALLOWLIST") {
        return list
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .any(|e| e == key);
    }
    false
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EgressConfig {
    #[serde(default)]
    pub strict: bool,
    pub routes: Vec<EgressRoute>,
}

impl EgressConfig {
    pub fn from_manifest_egress(value: &serde_json::Value, strict: bool) -> Self {
        let routes = value
            .get("routes")
            .and_then(|r| r.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        Self { strict, routes }
    }
}

/// Normalize route prefixes so both `/{service}` and legacy `/ucb/v1/egress/{service}` match
/// the remainder path UCB evaluates after `/ucb/v1/egress/*` capture.
pub fn normalize_route_prefix(prefix: &str) -> String {
    let p = prefix.trim();
    if let Some(rest) = p.strip_prefix("/ucb/v1/egress") {
        if rest.is_empty() {
            return "/".to_string();
        }
        if rest.starts_with('/') {
            return rest.to_string();
        }
        return format!("/{rest}");
    }
    if p.is_empty() {
        return "/".to_string();
    }
    if p.starts_with('/') {
        p.to_string()
    } else {
        format!("/{p}")
    }
}

fn prefix_matches(path: &str, prefix: &str) -> bool {
    let p = normalize_route_prefix(prefix);
    if p == "/" {
        return path.starts_with('/');
    }
    // Path-boundary match: /slack matches /slack and /slack/... but not /slackevil
    path == p || path.starts_with(&format!("{p}/"))
}

/// TM-23 + HIGH path confusion: longest path-boundary match (not bare starts_with).
pub fn match_route<'a>(cfg: &'a EgressConfig, path: &str) -> Option<&'a EgressRoute> {
    let mut best: Option<&'a EgressRoute> = None;
    let mut best_len = 0usize;
    for r in &cfg.routes {
        if !prefix_matches(path, &r.path_prefix) {
            continue;
        }
        let nlen = normalize_route_prefix(&r.path_prefix).len();
        if nlen >= best_len {
            best_len = nlen;
            best = Some(r);
        }
    }
    best
}

pub fn evaluate_access(rules: &[AccessRule], method: &str, path: &str) -> bool {
    if rules.is_empty() {
        return false;
    }
    let m = method.to_uppercase();
    for rule in rules {
        let method_ok = rule.method == "ALL" || rule.method.to_uppercase() == m;
        if method_ok && path_matches(&rule.path, path) {
            return rule.action.to_uppercase() == "ALLOW";
        }
    }
    false
}

fn path_matches(pattern: &str, path: &str) -> bool {
    if pattern == path {
        return true;
    }
    if pattern.ends_with("/**") {
        let prefix = &pattern[..pattern.len() - 3];
        return path == prefix || path.starts_with(&format!("{prefix}/"));
    }
    if pattern.contains('*') {
        let parts: Vec<&str> = pattern.split('/').collect();
        let segs: Vec<&str> = path.split('/').collect();
        if parts.len() != segs.len() {
            return false;
        }
        return parts
            .iter()
            .zip(segs.iter())
            .all(|(p, s)| *p == "*" || p == s);
    }
    false
}

#[derive(Debug, Clone)]
pub struct ProxyResponse {
    pub status: u16,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

/// Fail-closed SSRF gate for egress upstream URLs.
pub fn validate_upstream_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalid upstream url: {e}"))?;
    let scheme = parsed.scheme().to_ascii_lowercase();
    if scheme != "https" && scheme != "http" {
        return Err(format!("upstream scheme not allowed: {scheme}"));
    }
    // Default: https only unless UCB_EGRESS_ALLOW_HTTP=1
    if scheme == "http" {
        let allow_http = std::env::var("UCB_EGRESS_ALLOW_HTTP")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        if !allow_http {
            return Err("http upstream denied (set UCB_EGRESS_ALLOW_HTTP=1 to allow)".into());
        }
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "upstream missing host".to_string())?;
    let host_l = host.to_ascii_lowercase();
    if host_l == "localhost"
        || host_l.ends_with(".localhost")
        || host_l == "metadata.google.internal"
        || host_l == "metadata"
    {
        return Err(format!("upstream host blocked: {host}"));
    }
    let port = parsed.port_or_known_default().unwrap_or(443);
    let addrs = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("upstream DNS resolve failed: {e}"))?;
    let mut saw = false;
    for addr in addrs {
        saw = true;
        if is_blocked_socket_addr(addr) {
            return Err(format!("upstream resolves to blocked address: {addr}"));
        }
    }
    if !saw {
        return Err("upstream DNS returned no addresses".into());
    }
    Ok(())
}

fn is_blocked_socket_addr(addr: SocketAddr) -> bool {
    match addr.ip() {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || v4.octets()[0] == 169 && v4.octets()[1] == 254 // link-local / cloud metadata
                || v4.octets()[0] == 0
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
                || v6.is_unspecified()
                || v6.to_ipv4_mapped().is_some_and(|v4| {
                    v4.is_loopback() || v4.is_private() || v4.is_link_local()
                })
        }
    }
}

pub async fn proxy_request(
    route: &EgressRoute,
    method: &str,
    remainder_path: &str,
    body: Option<Vec<u8>>,
) -> Result<ProxyResponse, String> {
    if !evaluate_access(&route.access_rules, method, remainder_path) {
        return Ok(ProxyResponse {
            status: 403,
            content_type: Some("application/json".into()),
            body: br#"{"error":"access denied"}"#.to_vec(),
        });
    }
    validate_upstream_url(&route.upstream)?;
    let strip = route.strip_prefix.as_deref().unwrap_or(&route.path_prefix);
    let upstream_path = if remainder_path.starts_with(strip) {
        remainder_path.replacen(strip, "", 1)
    } else {
        remainder_path.to_string()
    };
    // Block path traversal into absolute URLs via remainder
    if upstream_path.contains("://") || upstream_path.contains('\\') {
        return Err("egress path contains forbidden characters".into());
    }
    let url = format!(
        "{}{}",
        route.upstream.trim_end_matches('/'),
        upstream_path
    );
    // Re-validate full URL after join (redirect target still blocked by no-redirect).
    validate_upstream_url(&url)?;
    // MEDIUM: pin DNS to first safe SocketAddr to reduce rebinding TOCTOU window
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("invalid url: {e}"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "upstream missing host".to_string())?
        .to_string();
    let port = parsed.port_or_known_default().unwrap_or(443);
    let mut pinned: Option<std::net::SocketAddr> = None;
    for addr in (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|e| format!("upstream DNS re-resolve failed: {e}"))?
    {
        if is_blocked_socket_addr(addr) {
            return Err(format!("upstream re-resolve hit blocked address: {addr}"));
        }
        if pinned.is_none() {
            pinned = Some(addr);
        }
    }
    let pinned = pinned.ok_or_else(|| "upstream DNS re-resolve returned no addresses".to_string())?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .resolve(&host, pinned)
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "PATCH" => client.patch(&url),
        "DELETE" => client.delete(&url),
        "HEAD" => client.head(&url),
        _ => return Err(format!("unsupported method {method}")),
    };
    if let Some(env_key) = &route.auth_token_env {
        if !auth_token_env_allowed(env_key) {
            return Err(format!(
                "auth_token_env not allowlisted: {env_key} (use UCB_EGRESS_* / UCB_AUTH_* or UCB_EGRESS_SECRET_ENV_ALLOWLIST)"
            ));
        }
        if let Ok(token) = std::env::var(env_key) {
            if !token.is_empty() {
                req = req.header("Authorization", format!("Bearer {token}"));
            }
        }
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let res = req
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    Ok(ProxyResponse {
        status,
        content_type,
        body: bytes.to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_loopback_upstream() {
        assert!(validate_upstream_url("http://127.0.0.1/evil").is_err());
        assert!(validate_upstream_url("http://localhost/evil").is_err());
        assert!(validate_upstream_url("http://169.254.169.254/latest/meta-data").is_err());
    }

    #[test]
    fn allows_https_public_style_host_syntax() {
        // DNS may fail offline; accept either Ok or DNS error, never silent allow of private IP literal.
        let r = validate_upstream_url("https://example.com/v1");
        assert!(r.is_ok() || r.err().map(|e| e.contains("DNS")).unwrap_or(false));
    }

    #[test]
    fn implicit_deny_without_match() {
        let rules = vec![AccessRule {
            action: "ALLOW".into(),
            method: "POST".into(),
            path: "/v1/chat/completions".into(),
        }];
        assert!(!evaluate_access(&rules, "GET", "/v1/models"));
        assert!(evaluate_access(&rules, "POST", "/v1/chat/completions"));
    }

    #[test]
    fn secret_env_allowlist_prefixes() {
        assert!(auth_token_env_allowed("UCB_EGRESS_OPENAI_TOKEN"));
        assert!(auth_token_env_allowed("UCB_AUTH_BEARER"));
        assert!(auth_token_env_allowed("AEP_SLACK_BOT_TOKEN"));
        assert!(!auth_token_env_allowed("AWS_SECRET_ACCESS_KEY"));
        assert!(!auth_token_env_allowed("PATH"));
        assert!(!auth_token_env_allowed("HOME"));
        assert!(!auth_token_env_allowed("../etc/passwd"));
        assert!(!auth_token_env_allowed(""));
    }

    #[test]
    fn tm23_match_route_path_boundary_and_legacy_prefix() {
        let cfg = EgressConfig {
            strict: true,
            routes: vec![
                EgressRoute {
                    path_prefix: "/slack".into(),
                    upstream: "https://slack.com".into(),
                    strip_prefix: Some("/slack".into()),
                    access_rules: vec![],
                    auth_token_env: Some("AEP_SLACK_BOT_TOKEN".into()),
                },
                EgressRoute {
                    path_prefix: "/ucb/v1/egress/github".into(),
                    upstream: "https://api.github.com".into(),
                    strip_prefix: None,
                    access_rules: vec![],
                    auth_token_env: Some("AEP_GITHUB_TOKEN".into()),
                },
            ],
        };
        let slack = match_route(&cfg, "/slack/api/chat.postMessage").expect("slack");
        assert_eq!(slack.path_prefix, "/slack");
        assert!(match_route(&cfg, "/slackevil/x").is_none());
        let gh = match_route(&cfg, "/github/repos/x").expect("github legacy normalize");
        assert!(gh.path_prefix.contains("github"));
    }
}