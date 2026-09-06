//! AEP 2.8 Rust SDK - lattice-gated transport via `aep-lattice-log`.

use serde_json::{json, Value};
use std::env;
use std::io::Write;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use url::Url;

#[derive(Debug, Clone, Default)]
pub struct GatewayMeta {
    pub agent_id: Option<String>,
    pub channel_id: Option<String>,
    pub contract_id: Option<String>,
    pub event_type: Option<String>,
    pub session_id: Option<String>,
    pub trust_score: Option<i64>,
    pub gateway: Option<String>,
    pub payload_extra: Option<Value>,
}

fn lattice_strict_enabled() -> Result<bool, String> {
    if env::var("AEP_LATTICE_STRICT").unwrap_or_else(|_| "1".into()) == "0" {
        if env::var("AEP_LATTICE_STRICT_DEV").map(|v| v == "1").unwrap_or(false) {
            return Ok(false);
        }
        return Err(
            "AEP_LATTICE_STRICT=0 refused outside AEP_LATTICE_STRICT_DEV=1 (fail-closed)".into(),
        );
    }
    Ok(true)
}

fn resolve_socket_base() -> PathBuf {
    if let Ok(base) = env::var("AEP_SOCKET_BASE") {
        return PathBuf::from(base);
    }
    let data = env::var("AEP_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| dirs_home().join(".aep"));
    data.join("sockets")
}

fn dirs_home() -> PathBuf {
    env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("/tmp"))
}

fn resolve_lattice_log_bin() -> String {
    env::var("AEP_LATTICE_LOG_BIN")
        .or_else(|_| env::var("AEP_LATTICE_LOG_CLI"))
        .unwrap_or_else(|_| "aep-lattice-log".into())
}

fn resolve_config_path() -> Option<PathBuf> {
    let data = env::var("AEP_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| dirs_home().join(".aep"));
    let path = data.join("base-node.json");
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

pub fn build_lattice_frame(event: Value) -> Result<Value, String> {
    let mut args = Vec::new();
    if let Some(cfg) = resolve_config_path() {
        args.push("--config".into());
        args.push(cfg.display().to_string());
    }
    args.push("build-frame".into());
    let mut child = Command::new(resolve_lattice_log_bin())
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn aep-lattice-log: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let payload = serde_json::to_string(&event).map_err(|e| e.to_string())?;
        stdin.write_all(payload.as_bytes()).map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    let parsed: Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    if parsed.get("frame").is_none() {
        return Err("aep-lattice-log build-frame missing LatticeChannelFrame".into());
    }
    Ok(parsed)
}

fn dock_suffix(dock_port: &str) -> &str {
    match dock_port {
        "inference_engine" => "inference",
        "validation_engine" => "validation",
        "future_features" => "future",
        "regulation_module" => "regulation",
        _ => dock_port,
    }
}

fn send_lattice_line(socket_path: &Path, line: &str) -> Result<String, String> {
    use std::io::Read;
    use std::os::unix::net::UnixStream;
    let mut conn = UnixStream::connect(socket_path)
        .map_err(|e| format!("connect {socket_path:?}: {e}"))?;
    conn.set_read_timeout(Some(Duration::from_secs(8)))
        .map_err(|e| e.to_string())?;
    conn.set_write_timeout(Some(Duration::from_secs(8)))
        .map_err(|e| e.to_string())?;
    conn.write_all(line.as_bytes())
        .and_then(|_| conn.write_all(b"\n"))
        .map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    conn.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&buf);
    Ok(text.lines().next().unwrap_or("").trim().to_string())
}

pub fn lattice_dock_request(socket_base: &Path, dock_port: &str, event: Value) -> Result<Value, String> {
    let socket_path = socket_base.join(dock_suffix(dock_port));
    let sealed = build_lattice_frame(event)?;
    let wire = json!({ "frame": sealed.get("frame").cloned().unwrap_or(Value::Null) });
    let line = send_lattice_line(&socket_path, &wire.to_string())?;
    let resp: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
    if resp.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return Err(resp
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("lattice frame rejected")
            .into());
    }
    Ok(resp)
}

fn http_from_dock_allow(resp: &Value) -> Result<Vec<u8>, String> {
    let http = match resp.get("http") {
        Some(h) if h.is_null() == false => h,
        _ => return Err(String::from("lattice-gated-fetch: dock allow did not return http")),
    };
    let b64s = http.get("body_b64").and_then(|v| v.as_str()).unwrap_or("");
    decode_body_b64(b64s)
}

fn decode_body_b64(s: &str) -> Result<Vec<u8>, String> {
    if s.is_empty() {
        return Ok(Vec::new());
    }
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            b'=' => None,
            _ => None,
        }
    }
    let bytes = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < bytes.len() {
        let a = val(bytes[i]).unwrap_or(0);
        let b = if i + 1 < bytes.len() { val(bytes[i + 1]).unwrap_or(0) } else { 0 };
        let c = if i + 2 < bytes.len() { val(bytes[i + 2]) } else { None };
        let d = if i + 3 < bytes.len() { val(bytes[i + 3]) } else { None };
        out.push((a << 2) | (b >> 4));
        if let Some(cv) = c {
            out.push(((b & 0x0f) << 4) | (cv >> 2));
            if let Some(dv) = d {
                out.push(((cv & 0x03) << 6) | dv);
            }
        }
        i = i.saturating_add(4);
    }
    Ok(out)
}

#[derive(Debug, Clone, Copy)]
struct SsrfPolicy {
    allow_loopback: bool,
    allow_private: bool,
}

impl SsrfPolicy {
    fn from_env() -> Self {
        Self {
            allow_loopback: env::var("AEP_LATTICE_ALLOW_LOOPBACK")
                .map(|v| v == "1")
                .unwrap_or(false),
            allow_private: env::var("AEP_LATTICE_ALLOW_PRIVATE")
                .map(|v| v == "1")
                .unwrap_or(false),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AddrClass {
    Public,
    Loopback,
    Private,
    LinkLocal,
    Unspecified,
}

fn parse_ipv4_numeric_part(part: &str) -> Option<u32> {
    if part.is_empty() {
        return None;
    }
    if let Some(hex) = part.strip_prefix("0x").or_else(|| part.strip_prefix("0X")) {
        if hex.is_empty() || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        return u32::from_str_radix(hex, 16).ok();
    }
    if part.len() > 1 && part.starts_with('0') && part.bytes().all(|b| (b'0'..=b'7').contains(&b)) {
        return u32::from_str_radix(part, 8).ok();
    }
    if part.bytes().all(|b| b.is_ascii_digit()) {
        return part.parse::<u32>().ok();
    }
    None
}

fn parse_weird_ipv4(host: &str) -> Option<Ipv4Addr> {
    if host.is_empty() || host.contains(':') {
        return None;
    }
    let parts: Vec<&str> = host.split('.').collect();
    if parts.is_empty() || parts.len() > 4 {
        return None;
    }
    let nums: Vec<u32> = parts
        .iter()
        .copied()
        .map(parse_ipv4_numeric_part)
        .collect::<Option<Vec<_>>>()?;
    match nums.as_slice() {
        [a] => Some(Ipv4Addr::from(*a)),
        [a, b] if *a <= 0xff && *b <= 0x00ff_ffff => Some(Ipv4Addr::new(
            *a as u8,
            ((*b >> 16) & 0xff) as u8,
            ((*b >> 8) & 0xff) as u8,
            (*b & 0xff) as u8,
        )),
        [a, b, c] if *a <= 0xff && *b <= 0xff && *c <= 0xffff => Some(Ipv4Addr::new(
            *a as u8,
            *b as u8,
            ((*c >> 8) & 0xff) as u8,
            (*c & 0xff) as u8,
        )),
        [a, b, c, d] if *a <= 0xff && *b <= 0xff && *c <= 0xff && *d <= 0xff => {
            Some(Ipv4Addr::new(*a as u8, *b as u8, *c as u8, *d as u8))
        }
        _ => None,
    }
}

fn classify_v4(ip: Ipv4Addr) -> AddrClass {
    if ip.is_unspecified() || ip.octets()[0] == 0 {
        AddrClass::Unspecified
    } else if ip.is_loopback() {
        AddrClass::Loopback
    } else if ip.is_link_local() {
        AddrClass::LinkLocal
    } else if ip.is_private() {
        AddrClass::Private
    } else if ip.is_broadcast() {
        AddrClass::Private
    } else {
        AddrClass::Public
    }
}

fn v6_mapped_or_compatible_v4(ip: Ipv6Addr) -> Option<Ipv4Addr> {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return Some(v4);
    }
    if ip == Ipv6Addr::LOCALHOST || ip == Ipv6Addr::UNSPECIFIED {
        return None;
    }
    let s = ip.segments();
    if s[0] == 0 && s[1] == 0 && s[2] == 0 && s[3] == 0 && s[4] == 0 && s[5] == 0 {
        return ip.to_ipv4();
    }
    None
}

fn classify_ip(ip: IpAddr) -> AddrClass {
    match ip {
        IpAddr::V4(v4) => classify_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6_mapped_or_compatible_v4(v6) {
                classify_v4(v4)
            } else if v6.is_loopback() {
                AddrClass::Loopback
            } else if v6.is_unspecified() {
                AddrClass::Unspecified
            } else if v6.is_unicast_link_local() {
                AddrClass::LinkLocal
            } else if v6.is_unique_local() {
                AddrClass::Private
            } else {
                AddrClass::Public
            }
        }
    }
}

fn deny_addr(ip: IpAddr, policy: &SsrfPolicy) -> Result<(), String> {
    match classify_ip(ip) {
        AddrClass::Public => Ok(()),
        AddrClass::Loopback | AddrClass::Unspecified => {
            if policy.allow_loopback {
                Ok(())
            } else {
                Err("lattice-gated-fetch: loopback blocked".into())
            }
        }
        AddrClass::Private | AddrClass::LinkLocal => {
            if policy.allow_private {
                Ok(())
            } else {
                Err("lattice-gated-fetch: private/metadata host blocked".into())
            }
        }
    }
}

fn is_metadata_name(host: &str) -> bool {
    let h = host.trim_end_matches('.').to_ascii_lowercase();
    h == "metadata"
        || h == "metadata.google.internal"
        || h.ends_with(".internal")
        || h.ends_with(".local")
}

fn lookup_ips(host: &str) -> Result<Vec<IpAddr>, String> {
    let mut ips: Vec<IpAddr> = (host, 0u16)
        .to_socket_addrs()
        .map_err(|e| format!("lattice-gated-fetch: DNS resolve failed: {e}"))?
        .map(|sa| sa.ip())
        .collect();
    ips.sort();
    ips.dedup();
    if ips.is_empty() {
        return Err("lattice-gated-fetch: DNS resolve returned no addresses".into());
    }
    Ok(ips)
}

fn assert_url_not_ssrf(raw: &str) -> Result<(), String> {
    assert_url_not_ssrf_with_lookup(raw, &SsrfPolicy::from_env(), lookup_ips)
}

fn assert_url_not_ssrf_with_lookup<F>(
    raw: &str,
    policy: &SsrfPolicy,
    lookup: F,
) -> Result<(), String>
where
    F: Fn(&str) -> Result<Vec<IpAddr>, String>,
{
    let parsed = Url::parse(raw).map_err(|_| "lattice-gated-fetch: invalid URL".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("lattice-gated-fetch: blocked or invalid URL scheme".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("lattice-gated-fetch: userinfo host spoof blocked".into());
    }
    let host = match parsed.host() {
        Some(url::Host::Ipv4(v4)) => {
            deny_addr(IpAddr::V4(v4), policy)?;
            return Ok(());
        }
        Some(url::Host::Ipv6(v6)) => {
            deny_addr(IpAddr::V6(v6), policy)?;
            return Ok(());
        }
        Some(url::Host::Domain(d)) => d.to_ascii_lowercase(),
        None => return Err("lattice-gated-fetch: invalid URL".into()),
    };
    if host.is_empty() {
        return Err("lattice-gated-fetch: invalid URL".into());
    }
    if is_metadata_name(&host) {
        if policy.allow_private {
            return Ok(());
        }
        return Err("lattice-gated-fetch: private/metadata host blocked".into());
    }
    if let Some(v4) = parse_weird_ipv4(&host) {
        deny_addr(IpAddr::V4(v4), policy)?;
        return Ok(());
    }
    let ips = lookup(&host)?;
    if ips.is_empty() {
        return Err("lattice-gated-fetch: DNS resolve returned no addresses".into());
    }
    for ip in ips {
        deny_addr(ip, policy)?;
    }
    Ok(())
}

pub fn lattice_gated_fetch_url(url: &str, method: &str, meta: GatewayMeta) -> Result<Vec<u8>, String> {
    assert_url_not_ssrf(url)?;
    if !lattice_strict_enabled()? {
        return Ok(Vec::new());
    }
    let socket_base = resolve_socket_base();
    let mut payload = json!({
        "url": url,
        "method": method,
        "gateway": meta.gateway.clone().unwrap_or_else(|| "http".into()),
    });
    if let Some(extra) = meta.payload_extra {
        if let Some(obj) = payload.as_object_mut() {
            if let Some(extra_obj) = extra.as_object() {
                for (k, v) in extra_obj {
                    obj.insert(k.clone(), v.clone());
                }
            }
        }
    }
    let event = json!({
        "agent_id": meta.agent_id.clone().unwrap_or_else(|| "lattice-gateway".into()),
        "channel_id": meta.channel_id.clone().unwrap_or_else(|| "ch-outbound-gateway".into()),
        "contract_id": meta.contract_id.clone().unwrap_or_else(|| "lattice-channel-default".into()),
        "event_type": meta.event_type.clone().unwrap_or_else(|| "LATTICE_GATEWAY_REQUEST".into()),
        "session_id": meta.session_id.clone().unwrap_or_else(|| "gateway-session".into()),
        "docking_port": "inference_engine",
        "trust_score": meta.trust_score.unwrap_or(0),
        "payload": payload,
    });
    let resp = lattice_dock_request(&socket_base, "inference_engine", event)?;
    let inference = socket_base.join("inference");
    if !inference.exists() {
        return Err(format!(
            "inference_engine dock required for lattice-gated fetch: {}",
            inference.display()
        ));
    }
    http_from_dock_allow(&resp)
}

#[cfg(test)]
mod ssrf_tests {
    use super::*;

    fn deny_policy() -> SsrfPolicy {
        SsrfPolicy {
            allow_loopback: false,
            allow_private: false,
        }
    }

    fn stub(host: &str, ips: Vec<IpAddr>) -> impl Fn(&str) -> Result<Vec<IpAddr>, String> {
        let expected = host.to_string();
        move |h| {
            if h == expected {
                Ok(ips.clone())
            } else {
                Err(format!("unexpected host {h}"))
            }
        }
    }

    #[test]
    fn decimal_ipv4_loopback_denied() {
        let err = assert_url_not_ssrf_with_lookup(
            "http://2130706433/",
            &deny_policy(),
            |_| unreachable!("decimal must not DNS"),
        )
        .unwrap_err();
        assert!(err.contains("loopback"), "{err}");
    }

    #[test]
    fn octal_ipv4_loopback_denied() {
        let err = assert_url_not_ssrf_with_lookup(
            "http://0177.0.0.1/",
            &deny_policy(),
            |_| unreachable!("octal must not DNS"),
        )
        .unwrap_err();
        assert!(err.contains("loopback"), "{err}");
    }

    #[test]
    fn ipv6_mapped_loopback_denied() {
        let err = assert_url_not_ssrf_with_lookup(
            "http://[::ffff:127.0.0.1]/",
            &deny_policy(),
            |_| unreachable!("literal must not DNS"),
        )
        .unwrap_err();
        assert!(err.contains("loopback"), "{err}");
    }

    #[test]
    fn userinfo_host_spoof_denied() {
        let err = assert_url_not_ssrf_with_lookup(
            "http://evil.example@127.0.0.1/",
            &deny_policy(),
            |_| unreachable!("userinfo must not DNS"),
        )
        .unwrap_err();
        assert!(err.contains("userinfo"), "{err}");
    }

    #[test]
    fn dns_to_private_denied() {
        let err = assert_url_not_ssrf_with_lookup(
            "https://public.example/",
            &deny_policy(),
            stub("public.example", vec![IpAddr::from(Ipv4Addr::new(10, 1, 2, 3))]),
        )
        .unwrap_err();
        assert!(err.contains("private"), "{err}");
    }

    #[test]
    fn dns_to_loopback_denied() {
        let err = assert_url_not_ssrf_with_lookup(
            "https://rebind.example/",
            &deny_policy(),
            stub(
                "rebind.example",
                vec![
                    IpAddr::from(Ipv4Addr::new(1, 1, 1, 1)),
                    IpAddr::from(Ipv4Addr::LOCALHOST),
                ],
            ),
        )
        .unwrap_err();
        assert!(err.contains("loopback"), "{err}");
    }

    #[test]
    fn dns_to_public_allowed() {
        assert_url_not_ssrf_with_lookup(
            "https://public.example/",
            &deny_policy(),
            stub("public.example", vec![IpAddr::from(Ipv4Addr::new(1, 1, 1, 1))]),
        )
        .unwrap();
    }

    #[test]
    fn public_literal_allowed() {
        assert_url_not_ssrf_with_lookup(
            "https://1.1.1.1/",
            &deny_policy(),
            |_| unreachable!("literal must not DNS"),
        )
        .unwrap();
    }

    #[test]
    fn rfc1918_literal_denied() {
        let err = assert_url_not_ssrf_with_lookup(
            "http://192.168.1.1/",
            &deny_policy(),
            |_| unreachable!("literal must not DNS"),
        )
        .unwrap_err();
        assert!(err.contains("private"), "{err}");
    }

    #[test]
    fn metadata_name_denied_without_dns() {
        let err = assert_url_not_ssrf_with_lookup(
            "http://metadata.google.internal/",
            &deny_policy(),
            |_| unreachable!("metadata must not DNS"),
        )
        .unwrap_err();
        assert!(err.contains("metadata"), "{err}");
    }

    #[test]
    fn localhost_resolves_and_denies() {
        let err = assert_url_not_ssrf("http://localhost/foo").unwrap_err();
        assert!(
            err.contains("loopback") || err.contains("DNS"),
            "{err}"
        );
    }

    #[test]
    fn allow_loopback_hatch() {
        let policy = SsrfPolicy {
            allow_loopback: true,
            allow_private: false,
        };
        assert_url_not_ssrf_with_lookup(
            "http://127.0.0.1/",
            &policy,
            |_| unreachable!("literal must not DNS"),
        )
        .unwrap();
    }

    #[test]
    fn allow_private_hatch() {
        let policy = SsrfPolicy {
            allow_loopback: false,
            allow_private: true,
        };
        assert_url_not_ssrf_with_lookup(
            "http://10.0.0.1/",
            &policy,
            |_| unreachable!("literal must not DNS"),
        )
        .unwrap();
    }

    #[test]
    fn empty_dns_denied() {
        let err = assert_url_not_ssrf_with_lookup(
            "https://empty.example/",
            &deny_policy(),
            |_| Ok(Vec::new()),
        )
        .unwrap_err();
        assert!(err.contains("DNS") || err.contains("no addresses"), "{err}");
    }
}
