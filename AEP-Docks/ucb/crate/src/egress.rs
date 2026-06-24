//! Egress proxy: credential injection + firewall-style access rules (Airlock patterns).

use serde::{Deserialize, Serialize};

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
    #[serde(default)]
    pub auth_token_env: Option<String>,
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

pub fn match_route<'a>(cfg: &'a EgressConfig, path: &str) -> Option<&'a EgressRoute> {
    cfg.routes
        .iter()
        .find(|r| path.starts_with(&r.path_prefix))
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
    let strip = route.strip_prefix.as_deref().unwrap_or(&route.path_prefix);
    let upstream_path = if remainder_path.starts_with(strip) {
        remainder_path.replacen(strip, "", 1)
    } else {
        remainder_path.to_string()
    };
    let url = format!(
        "{}{}",
        route.upstream.trim_end_matches('/'),
        upstream_path
    );
    let client = reqwest::Client::new();
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
        if let Ok(token) = std::env::var(env_key) {
            req = req.header("Authorization", format!("Bearer {token}"));
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
    fn implicit_deny_without_match() {
        let rules = vec![AccessRule {
            action: "ALLOW".into(),
            method: "POST".into(),
            path: "/v1/chat/completions".into(),
        }];
        assert!(!evaluate_access(&rules, "GET", "/v1/models"));
        assert!(evaluate_access(&rules, "POST", "/v1/chat/completions"));
    }
}