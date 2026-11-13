//! Egress proxy: credential injection + firewall-style access rules (Airlock patterns).

use aep_egress_address::{
    check_resolved, check_url, resolve_checked, EgressDeny, EgressPolicy, EgressTarget,
};
use aep_ucb_perimeter_v1::WireLimits;
use axum::http::HeaderMap;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;

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
    if !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return false;
    }
    // Default allow: UCB inject prefix, UCB auth prefix, and AEP connector tokens
    // (AEP_SLACK_BOT_TOKEN, AEP_NOTION_TOKEN, ...). Never bare AWS_*/PATH/HOME.
    if key.starts_with("UCB_EGRESS_") || key.starts_with("UCB_AUTH_") || key.starts_with("AEP_") {
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
    if let Some(prefix) = pattern.strip_suffix("/**") {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EgressAudit {
    pub agent_id: String,
    pub route: String,
    pub method: String,
    pub host: String,
    pub bytes: usize,
    pub status: u16,
    pub manifest_digest: String,
}

pub fn credential_inject_allowed(signed: bool, provisional: bool) -> bool {
    signed && !provisional
}

/// Deny auth_token_env unless inject is allowed (signed and non-provisional).
pub fn auth_token_env_denied(inject: bool, env_key: Option<&str>) -> bool {
    env_key.map(str::trim).filter(|s| !s.is_empty()).is_some() && !inject
}

pub fn audit_host(upstream: &str) -> String {
    reqwest::Url::parse(upstream)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| upstream.to_string())
}

pub fn response_over_cap(len: usize) -> bool {
    len > WireLimits::default().egress_default_bytes
}

pub fn is_isolated_caller_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "authorization"
            | "connection"
            | "keep-alive"
            | "proxy-connection"
            | "transfer-encoding"
            | "upgrade"
            | "te"
            | "trailer"
    )
}

pub fn strip_caller_headers(headers: &HeaderMap) -> HeaderMap {
    let mut out = HeaderMap::new();
    for (k, v) in headers.iter() {
        if !is_isolated_caller_header(k.as_str()) {
            out.append(k, v.clone());
        }
    }
    out
}

/// UCB egress reaches public addresses only. The range list is the one of
/// aep-egress-address, which the Base Node gateway and the JavaScript helpers share.
pub const UPSTREAM_POLICY: EgressPolicy = EgressPolicy::STRICT;

fn allow_http() -> bool {
    std::env::var("UCB_EGRESS_ALLOW_HTTP")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn upstream_deny(e: &EgressDeny) -> String {
    match e {
        EgressDeny::Lookup(_) | EgressDeny::NoAddress => {
            format!("upstream DNS resolve failed: {e}")
        }
        _ => format!("upstream refused: {e}"),
    }
}

/// Check an upstream URL without a name lookup: the scheme, the http opt-in, the user info,
/// an address literal and the reserved names. Default: https only unless
/// UCB_EGRESS_ALLOW_HTTP=1.
pub fn check_upstream_url(url: &str) -> Result<EgressTarget, String> {
    let target = check_url(url, &UPSTREAM_POLICY).map_err(|e| upstream_deny(&e))?;
    if target.url.scheme() == "http" && !allow_http() {
        return Err("http upstream denied (set UCB_EGRESS_ALLOW_HTTP=1 to allow)".into());
    }
    Ok(target)
}

/// SSRF gate for an upstream URL at configuration time: the checks of
/// [`check_upstream_url`] and every address of one blocking lookup. A request never relies
/// on this answer: [`pinned_client`] checks again and connects only to what it checked.
pub fn validate_upstream_url(url: &str) -> Result<(), String> {
    let target = check_upstream_url(url)?;
    resolve_checked(&target, &UPSTREAM_POLICY).map_err(|e| upstream_deny(&e))?;
    Ok(())
}

/// Resolve the host of a checked upstream once, on the async runtime, and check every
/// address. The result is the set the connection is pinned to.
pub async fn resolve_upstream(target: &EgressTarget) -> Result<Vec<SocketAddr>, String> {
    if let Some(ip) = target.literal {
        return Ok(vec![SocketAddr::new(ip, target.port)]);
    }
    let addrs = tokio::net::lookup_host((target.host.as_str(), target.port))
        .await
        .map_err(|e| format!("upstream DNS resolve failed: {e}"))?;
    check_resolved(addrs, &UPSTREAM_POLICY).map_err(|e| upstream_deny(&e))
}

/// A client for one upstream URL: checked, resolved once and pinned to the checked
/// addresses, with no redirects and the connect and total bounds of the wire limits.
pub async fn pinned_client(url: &str) -> Result<(reqwest::Client, String), String> {
    let target = check_upstream_url(url)?;
    let pinned = resolve_upstream(&target).await?;
    let limits = WireLimits::default();
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_millis(limits.egress_connect_ms))
        .timeout(std::time::Duration::from_millis(limits.egress_total_ms));
    if target.literal.is_none() {
        builder = builder.resolve_to_addrs(&target.host, &pinned);
    }
    let client = builder.build().map_err(|e| e.to_string())?;
    Ok((client, target.url.to_string()))
}

/// Read a reply body and stop one chunk past the cap, so a large body is refused before
/// it sits in memory whole.
pub async fn read_capped(res: reqwest::Response, cap: usize) -> Result<Vec<u8>, String> {
    if let Some(len) = res.content_length() {
        if len > cap as u64 {
            return Err("egress response over cap".into());
        }
    }
    let mut acc: Vec<u8> = Vec::new();
    let mut res = res;
    loop {
        match res.chunk().await {
            Ok(Some(chunk)) => {
                if acc.len().saturating_add(chunk.len()) > cap {
                    return Err("egress response over cap".into());
                }
                acc.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(acc)
}

pub async fn proxy_request(
    route: &EgressRoute,
    method: &str,
    remainder_path: &str,
    body: Option<Vec<u8>>,
) -> Result<ProxyResponse, String> {
    proxy_request_isolated(route, method, remainder_path, body, true, None).await
}

pub async fn proxy_request_isolated(
    route: &EgressRoute,
    method: &str,
    remainder_path: &str,
    body: Option<Vec<u8>>,
    inject: bool,
    caller_headers: Option<&HeaderMap>,
) -> Result<ProxyResponse, String> {
    if !evaluate_access(&route.access_rules, method, remainder_path) {
        return Ok(ProxyResponse {
            status: 403,
            content_type: Some("application/json".into()),
            body: br#"{"error":"access denied"}"#.to_vec(),
        });
    }
    check_upstream_url(&route.upstream)?;
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
    let url = format!("{}{}", route.upstream.trim_end_matches('/'), upstream_path);
    // The joined URL is checked again, its host resolved once and the connection pinned
    // to the checked addresses. Redirects are not followed.
    let (client, url) = pinned_client(&url).await?;
    let mut req = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "PATCH" => client.patch(&url),
        "DELETE" => client.delete(&url),
        "HEAD" => client.head(&url),
        _ => return Err(format!("unsupported method {method}")),
    };
    if auth_token_env_denied(inject, route.auth_token_env.as_deref()) {
        return Err("auth_token_env denied unless signed and non-provisional".into());
    }
    if let Some(headers) = caller_headers {
        let stripped = strip_caller_headers(headers);
        for (k, v) in stripped.iter() {
            let name = k.as_str();
            if name.eq_ignore_ascii_case("host") || name.eq_ignore_ascii_case("content-length") {
                continue;
            }
            req = req.header(k, v);
        }
    }
    if inject {
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
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let body = read_capped(res, WireLimits::default().egress_default_bytes).await?;
    Ok(ProxyResponse {
        status,
        content_type,
        body,
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

    /// Every url row that the shared egress vectors refuse is refused by the UCB upstream
    /// check too, without a lookup, and the public https row passes.
    #[test]
    fn upstream_check_holds_the_shared_egress_vectors() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../../AEP-Components/egress-address/vectors/egress-address-vectors.json");
        let text = std::fs::read_to_string(&path).expect("vector file");
        let vectors: serde_json::Value = serde_json::from_str(&text).expect("vector json");
        let mut wrong = Vec::new();
        for row in vectors["urls"].as_array().expect("urls") {
            let url = row["url"].as_str().expect("url");
            let refused = check_upstream_url(url).is_err();
            if row["verdict"] == "deny" && !refused {
                wrong.push(url.to_string());
            }
        }
        assert!(wrong.is_empty(), "{wrong:?}");
        assert!(check_upstream_url("https://1.1.1.1/x").is_ok());
        for blocked in [
            "https://100.64.0.1/",
            "https://[64:ff9b::7f00:1]/",
            "https://[2002:7f00:1::1]/",
            "https://198.18.0.1/",
        ] {
            assert!(check_upstream_url(blocked).is_err(), "{blocked}");
        }
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
    fn unsigned_provisional_cannot_inject() {
        assert!(!credential_inject_allowed(false, false));
        assert!(!credential_inject_allowed(true, true));
        assert!(credential_inject_allowed(true, false));
        assert!(auth_token_env_denied(false, Some("UCB_EGRESS_TOKEN")));
        assert!(!auth_token_env_denied(true, Some("UCB_EGRESS_TOKEN")));
        assert!(!auth_token_env_denied(false, None));
        assert!(!auth_token_env_denied(false, Some("")));
    }

    #[test]
    fn audit_host_and_response_cap() {
        assert_eq!(audit_host("https://example.com/v1/chat"), "example.com");
        assert_eq!(audit_host("not-a-url"), "not-a-url");
        let cap = WireLimits::default().egress_default_bytes;
        assert!(!response_over_cap(cap));
        assert!(response_over_cap(cap + 1));
    }

    #[test]
    fn strips_authorization_and_connection() {
        let mut h = HeaderMap::new();
        h.insert("authorization", "Bearer secret".parse().unwrap());
        h.insert("connection", "keep-alive".parse().unwrap());
        h.insert("x-request-id", "abc".parse().unwrap());
        let out = strip_caller_headers(&h);
        assert!(!out.contains_key("authorization"));
        assert!(!out.contains_key("connection"));
        assert!(out.contains_key("x-request-id"));
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
