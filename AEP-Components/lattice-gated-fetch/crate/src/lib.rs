//! The kernel outbound request of the one granted gateway path.
//!
//! The Base Node sends an HTTP request for an agent only for an admitted event whose
//! action path is [`GATEWAY_ACTION_PATH`]. Admit decides that the lattice and the hub grant
//! the path to the signer and that the destination sits on the operator route list
//! ([`GatewayRoutes`]). The request itself runs on a thread of its own, off the pulse: it
//! checks every address of the destination with aep-egress-address, connects only to those
//! checked addresses and reads at most [`MAX_HTTP_BODY`] bytes of the reply.
//!
//! A url field of any other event is data and never becomes a request.
use aep_egress_address::{check_url, read_body_bounded, resolve_checked, EgressDeny};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The policy of the address check. The name is kept for the callers of this crate.
pub use aep_egress_address::EgressPolicy as SsrfPolicy;

/// The one action path on which the kernel sends an outbound request.
pub const GATEWAY_ACTION_PATH: &str = "gateway:outbound_http";
/// Largest reply body the kernel reads. A longer body fails the request.
pub const MAX_HTTP_BODY: usize = 8 * 1024 * 1024;
/// Time to open the connection to one checked address.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// Time for the whole request, from the connection to the last byte of the reply.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
/// Environment variable that names the route list file.
pub const GATEWAY_ROUTES_ENV: &str = "AEP_GATEWAY_ROUTES";
/// File name of the route list inside the data folder of the Base Node.
pub const GATEWAY_ROUTES_FILE: &str = "gateway-routes.json";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GatewaySpec {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DockHttp {
    pub status: u16,
    #[serde(default)]
    pub status_text: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body_b64: String,
}

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

/// Action path of an opened event, empty when it names none.
pub fn action_path_of(event: &Value) -> &str {
    event
        .get("action_path")
        .and_then(|v| v.as_str())
        .unwrap_or("")
}

/// The gateway request of an opened event.
///
/// None when the event is not on [`GATEWAY_ACTION_PATH`], whatever fields it carries. On
/// the gateway path the request is read from the payload only: url, method, headers and
/// body or body_b64. A gateway event without a url or with a body that does not decode is
/// an error, which closes the route wall of Admit.
pub fn gateway_request_of(event: &Value) -> Option<Result<GatewaySpec, String>> {
    if action_path_of(event) != GATEWAY_ACTION_PATH {
        return None;
    }
    Some(read_gateway_request(event))
}

fn read_gateway_request(event: &Value) -> Result<GatewaySpec, String> {
    let payload = event
        .get("payload")
        .ok_or_else(|| String::from("gateway request carries no payload"))?;
    let url = payload
        .get("url")
        .and_then(|v| v.as_str())
        .filter(|u| !u.is_empty())
        .ok_or_else(|| String::from("gateway request carries no url"))?;
    let method = match payload.get("method") {
        None | Some(Value::Null) => String::from("GET"),
        Some(Value::String(m)) if !m.is_empty() => m.to_ascii_uppercase(),
        Some(_) => return Err(String::from("gateway request method is not a name")),
    };
    let mut headers = Vec::new();
    if let Some(h) = payload.get("headers") {
        let obj = h
            .as_object()
            .ok_or_else(|| String::from("gateway request headers are not an object"))?;
        for (k, v) in obj {
            let s = v
                .as_str()
                .ok_or_else(|| format!("gateway request header {k} is not text"))?;
            headers.push((k.clone(), s.to_string()));
        }
    }
    let body = match (payload.get("body_b64"), payload.get("body")) {
        (Some(Value::String(b)), _) if !b.is_empty() => b64()
            .decode(b)
            .map_err(|_| String::from("gateway request body_b64 does not decode"))?,
        (Some(Value::String(_)), _) => Vec::new(),
        (Some(_), _) => return Err(String::from("gateway request body_b64 is not text")),
        (None, Some(Value::String(s))) => s.as_bytes().to_vec(),
        (None, Some(Value::Null)) | (None, None) => Vec::new(),
        (None, Some(_)) => return Err(String::from("gateway request body is not text")),
    };
    Ok(GatewaySpec {
        url: url.to_string(),
        method,
        headers,
        body,
    })
}

/// The gateway request of a dock plaintext. None when the plaintext is not JSON, is not on
/// the gateway path or carries a malformed request.
pub fn gateway_spec_from_plaintext(plaintext: &[u8]) -> Option<GatewaySpec> {
    let value: Value = serde_json::from_slice(plaintext).ok()?;
    gateway_request_of(&value).and_then(Result::ok)
}

/// One destination that the operator opens for the gateway path.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GatewayRoute {
    /// Name of the route in the deny reports.
    pub id: String,
    /// http or https.
    pub scheme: String,
    /// Host name or address literal, compared after URL normalisation.
    pub host: String,
    /// Port. The default port of the scheme when left out.
    #[serde(default)]
    pub port: Option<u16>,
    /// Path prefix, matched on a path segment boundary. "/" opens every path.
    #[serde(default = "root_prefix")]
    pub path_prefix: String,
    /// Methods of the route, in capitals.
    pub methods: Vec<String>,
}

fn root_prefix() -> String {
    String::from("/")
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RouteFile {
    routes: Vec<GatewayRoute>,
}

/// The operator route list of the gateway path. An empty list refuses every request.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GatewayRoutes {
    routes: Vec<GatewayRoute>,
}

/// The host of a URL as the URL standard writes it, so that 127.1 and 127.0.0.1 or an
/// upper case name compare equal.
fn normalized_host(scheme: &str, host: &str) -> Option<String> {
    let probe = if host.contains(':') && !host.starts_with('[') {
        format!("{scheme}://[{host}]/")
    } else {
        format!("{scheme}://{host}/")
    };
    let url = url::Url::parse(&probe).ok()?;
    url.host_str().map(|h| h.to_ascii_lowercase())
}

fn path_on_prefix(path: &str, prefix: &str) -> bool {
    if prefix == "/" || prefix.is_empty() {
        return true;
    }
    if prefix.ends_with('/') {
        return path.starts_with(prefix);
    }
    path == prefix || path.starts_with(&format!("{prefix}/"))
}

impl GatewayRoutes {
    /// A list that refuses every request.
    pub fn empty() -> Self {
        Self::default()
    }

    /// Read a route list from its JSON text: {"routes": [{"id", "scheme", "host", "port",
    /// "path_prefix", "methods"}]}. Every route is checked, and one bad route refuses the
    /// whole list.
    pub fn parse(text: &str) -> Result<Self, String> {
        let file: RouteFile = serde_json::from_str(text)
            .map_err(|e| format!("gateway route list does not parse: {e}"))?;
        let mut routes = Vec::with_capacity(file.routes.len());
        for mut r in file.routes {
            if r.id.trim().is_empty() {
                return Err(String::from("gateway route without an id"));
            }
            r.scheme = r.scheme.to_ascii_lowercase();
            if r.scheme != "http" && r.scheme != "https" {
                return Err(format!(
                    "gateway route {}: scheme is not http or https",
                    r.id
                ));
            }
            r.host = normalized_host(&r.scheme, r.host.trim())
                .ok_or_else(|| format!("gateway route {}: host does not parse", r.id))?;
            if !r.path_prefix.starts_with('/') {
                return Err(format!(
                    "gateway route {}: path_prefix must start with /",
                    r.id
                ));
            }
            if r.methods.is_empty() {
                return Err(format!("gateway route {}: no method", r.id));
            }
            for m in r.methods.iter_mut() {
                *m = m.to_ascii_uppercase();
                if m.is_empty() || !m.bytes().all(|b| b.is_ascii_uppercase()) {
                    return Err(format!("gateway route {}: method {m} is not a name", r.id));
                }
            }
            routes.push(r);
        }
        Ok(Self { routes })
    }

    /// Read the route list file. A missing file is an empty list.
    pub fn load(path: &Path) -> Result<Self, String> {
        match fs::read_to_string(path) {
            Ok(text) => Self::parse(&text),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::empty()),
            Err(e) => Err(format!(
                "gateway route list {} does not read: {e}",
                path.display()
            )),
        }
    }

    /// The route list of a Base Node: the file that AEP_GATEWAY_ROUTES names, else
    /// gateway-routes.json in the data folder.
    pub fn load_for_data_dir(data_dir: &Path) -> Result<Self, String> {
        let path = match std::env::var(GATEWAY_ROUTES_ENV) {
            Ok(p) if !p.trim().is_empty() => PathBuf::from(p.trim()),
            _ => data_dir.join(GATEWAY_ROUTES_FILE),
        };
        Self::load(&path)
    }

    pub fn len(&self) -> usize {
        self.routes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.routes.is_empty()
    }

    /// The route that opens this request. The scheme, the host, the port, the path and the
    /// method must all match one route.
    pub fn route_for(&self, spec: &GatewaySpec) -> Result<&GatewayRoute, String> {
        let url = url::Url::parse(&spec.url)
            .map_err(|_| String::from("gateway request url does not parse"))?;
        let scheme = url.scheme().to_ascii_lowercase();
        let host = url
            .host_str()
            .map(|h| h.to_ascii_lowercase())
            .ok_or_else(|| String::from("gateway request url has no host"))?;
        let port = url.port_or_known_default();
        let method = spec.method.to_ascii_uppercase();
        for r in &self.routes {
            let route_port = r.port.or(match r.scheme.as_str() {
                "https" => Some(443),
                _ => Some(80),
            });
            if r.scheme == scheme
                && r.host == host
                && route_port == port
                && path_on_prefix(url.path(), &r.path_prefix)
                && r.methods.contains(&method)
            {
                return Ok(r);
            }
        }
        Err(format!(
            "{method} {scheme}://{host}:{} is on no gateway route",
            port.unwrap_or(0)
        ))
    }
}

fn deny_text(e: &EgressDeny) -> String {
    match e {
        EgressDeny::InvalidUrl => String::from("lattice-gated-fetch: invalid URL"),
        EgressDeny::Scheme(_) => String::from("lattice-gated-fetch: blocked or invalid URL scheme"),
        EgressDeny::Userinfo => String::from("lattice-gated-fetch: userinfo host spoof blocked"),
        EgressDeny::Lookup(d) => format!("lattice-gated-fetch: DNS resolve failed: {d}"),
        EgressDeny::NoAddress => {
            String::from("lattice-gated-fetch: DNS resolve returned no addresses")
        }
        EgressDeny::Name { .. } | EgressDeny::Address { .. } => {
            let what = match e.class() {
                Some(aep_egress_address::AddrClass::Loopback)
                | Some(aep_egress_address::AddrClass::Unspecified) => "loopback blocked",
                _ => "private/metadata host blocked",
            };
            format!("lattice-gated-fetch: {what} ({e})")
        }
    }
}

/// Check a URL and every address of its host against the policy.
pub fn assert_url_not_ssrf(raw: &str, policy: &SsrfPolicy) -> Result<(), String> {
    let target = check_url(raw, policy).map_err(|e| deny_text(&e))?;
    resolve_checked(&target, policy).map_err(|e| deny_text(&e))?;
    Ok(())
}

/// Bound HTTP of an admitted gateway request, with the policy of the environment.
pub fn execute_bound_http_after_allow(spec: &GatewaySpec) -> Result<DockHttp, String> {
    execute_bound_http_after_allow_with_policy(spec, &SsrfPolicy::from_env())
}

/// Bound HTTP of an admitted gateway request.
///
/// The call blocks, so the Base Node runs it on a thread of its own and never on the pulse
/// or on an async worker. The host is resolved once, every address is checked and the
/// connection goes only to those addresses, so a second answer of the name server cannot
/// move the request. Redirects are not followed and the reply body is read with a bound.
pub fn execute_bound_http_after_allow_with_policy(
    spec: &GatewaySpec,
    policy: &SsrfPolicy,
) -> Result<DockHttp, String> {
    if spec.url.is_empty() {
        return Err(String::from("lattice-gated-fetch: missing url"));
    }
    let target = check_url(&spec.url, policy).map_err(|e| deny_text(&e))?;
    let pinned = resolve_checked(&target, policy).map_err(|e| deny_text(&e))?;
    let method = if spec.method.is_empty() {
        String::from("GET")
    } else {
        spec.method.to_ascii_uppercase()
    };
    let mut builder = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT);
    if target.literal.is_none() {
        builder = builder.resolve_to_addrs(&target.host, &pinned);
    }
    let client = builder
        .build()
        .map_err(|e| format!("lattice-gated-fetch: http client: {e}"))?;
    let reqwest_method =
        reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut rb = client.request(reqwest_method, target.url.as_str());
    for (k, v) in &spec.headers {
        let lk = k.to_ascii_lowercase();
        if lk == "host" || lk == "content-length" || lk == "connection" || lk == "transfer-encoding"
        {
            continue;
        }
        rb = rb.header(k, v);
    }
    if !spec.body.is_empty() {
        rb = rb.body(spec.body.clone());
    }
    let resp = rb
        .send()
        .map_err(|e| format!("lattice-gated-fetch: bound http failed: {e}"))?;
    if resp
        .content_length()
        .is_some_and(|n| n > MAX_HTTP_BODY as u64)
    {
        return Err(String::from("lattice-gated-fetch: response too large"));
    }
    let status = resp.status().as_u16();
    let status_text = resp.status().canonical_reason().unwrap_or("").to_string();
    let mut headers = Vec::new();
    for (k, v) in resp.headers().iter() {
        headers.push((k.to_string(), v.to_str().unwrap_or("").to_string()));
    }
    let body = read_body_bounded(resp, MAX_HTTP_BODY).map_err(|e| match e {
        aep_egress_address::BodyError::TooLarge { .. } => {
            String::from("lattice-gated-fetch: response too large")
        }
        aep_egress_address::BodyError::Read(d) => {
            format!("lattice-gated-fetch: body read failed: {d}")
        }
    })?;
    Ok(DockHttp {
        status,
        status_text,
        headers,
        body_b64: b64().encode(&body),
    })
}

/// Client consumes dock http after allow. Missing http is Deny. Do not ordinary fetch.
pub fn http_from_dock_allow(dock_json: &str) -> Result<DockHttp, String> {
    let v: Value = serde_json::from_str(dock_json).map_err(|e| e.to_string())?;
    if v.get("ok").and_then(|x| x.as_bool()) != Some(true) {
        return Err(v
            .get("error")
            .and_then(|x| x.as_str())
            .unwrap_or("lattice frame rejected")
            .into());
    }
    let http = match v.get("http") {
        Some(h) if !h.is_null() => h,
        _ => {
            return Err(String::from(
                "lattice-gated-fetch: dock allow did not return http",
            ))
        }
    };
    serde_json::from_value::<DockHttp>(http.clone())
        .map_err(|_| String::from("lattice-gated-fetch: dock allow did not return http"))
}

fn extract_fn(src: &str, needle: &str) -> String {
    let start = match src.find(needle) {
        Some(v) => v,
        None => return String::new(),
    };
    let rest = &src[start..];
    let brace = match rest.find('{') {
        Some(v) => v,
        None => return rest.to_string(),
    };
    let bytes = rest.as_bytes();
    let mut i = brace;
    let mut depth: i32 = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            depth += 1;
        } else if bytes[i] == b'}' {
            depth -= 1;
            if depth == 0 {
                return rest[..=i].to_string();
            }
        }
        i = i.saturating_add(1);
    }
    rest.to_string()
}

fn strip_line_comments(src: &str) -> String {
    let mut out = String::new();
    for line in src.lines() {
        if let Some(i) = line.find("//") {
            out.push_str(&line[..i]);
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

fn compact(src: &str) -> String {
    src.chars().filter(|c| !c.is_whitespace()).collect()
}

fn prod_src(src: &str) -> String {
    match src.find("#[cfg(test)]") {
        Some(i) => src[..i].to_string(),
        None => src.to_string(),
    }
}

fn after_dock_in(body: &str) -> String {
    let needles = [
        "latticeDockRequest",
        "lattice_dock_request",
        "buildLatticeFrame",
        "build_lattice_frame",
    ];
    let mut cut: Option<usize> = None;
    for n in needles {
        if let Some(i) = body.rfind(n) {
            cut = Some(match cut {
                Some(c) if c > i => c,
                Some(_) => i,
                None => i,
            });
        }
    }
    match cut {
        Some(i) => body[i..].to_string(),
        None => body.to_string(),
    }
}

fn after_dock_region(src: &str) -> String {
    let body = prod_src(src);
    if let Some(i) = body.find("def lattice_gated_fetch") {
        return after_dock_in(&body[i..]);
    }
    let js = extract_fn(&body, "function latticeGatedFetch");
    if !js.is_empty() {
        return after_dock_in(&js);
    }
    let rs = extract_fn(&body, "fn lattice_gated_fetch_url");
    if !rs.is_empty() {
        return after_dock_in(&rs);
    }
    after_dock_in(&body)
}

fn has_ordinary_fetch(compact_after: &str) -> bool {
    let bad = [
        "returnfetch(",
        "fetch(url",
        "fetch(String(url)",
        "globalThis.fetch(",
        "window.fetch(",
        "urlopen(",
        "urllib.request.urlopen",
        "urllib.request.Request",
        "reqwest::get",
        "ureq::get",
        "ureq::request",
    ];
    for b in bad {
        if compact_after.contains(b) {
            return true;
        }
    }
    false
}

/// Fail if latticeGatedFetch still calls ordinary fetch after dock allow.
pub fn scan_no_ordinary_fetch_after_dock_allow(src: &str) -> Result<String, String> {
    let stripped = strip_line_comments(src);
    let after = after_dock_region(&stripped);
    let compact_after = compact(&after);
    if has_ordinary_fetch(&compact_after) {
        return Err(String::from("ordinary fetch after dock allow"));
    }
    Ok(String::from("ok no ordinary fetch after dock allow"))
}

/// Fail if production docking.rs does not attach bound http after allow, or reads a
/// gateway request without the gateway path check of `gateway_request_of`.
pub fn scan_dock_attaches_bound_http(src: &str) -> Result<String, String> {
    let prod = compact(&strip_line_comments(&prod_src(src)));
    if !prod.contains("execute_bound_http_after_allow") {
        return Err(String::from("dock allow path does not execute bound http"));
    }
    if !prod.contains("gateway_request_of") && !prod.contains("gateway_spec_from_plaintext") {
        return Err(String::from("dock allow path does not parse gateway spec"));
    }
    if !src.contains("http:") {
        return Err(String::from("DockFrameResponse missing http field"));
    }
    Ok(String::from("ok dock allow attaches bound http"))
}

/// Production source of the Base Node docking module: mod.rs, then each child
/// file in AEP-Crate/src/docking in name order, without the test file. Each
/// file is cut at its own test tail so no child is lost behind mod.rs tests.
fn read_docking_module(base_node: &std::path::Path) -> Result<String, String> {
    let dir = base_node.join("AEP-Crate").join("src").join("docking");
    let entries = match std::fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(e) => return Err(format!("missing docking module: {e}")),
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".rs") && n != "tests.rs")
        .collect();
    names.sort_by(|a, b| (a != "mod.rs").cmp(&(b != "mod.rs")).then(a.cmp(b)));
    let mut out = String::new();
    for n in names {
        match std::fs::read_to_string(dir.join(&n)) {
            Ok(text) => {
                let prod = match text.find("#[cfg(test)]") {
                    Some(i) => &text[..i],
                    None => text.as_str(),
                };
                out.push_str(prod);
                out.push('\n');
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    if out.trim().is_empty() {
        return Err(String::from("empty docking module"));
    }
    Ok(out)
}

fn walk_to_workspace() -> PathBuf {
    let mut dir = if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        PathBuf::from(m)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    let mut i = 0usize;
    while i < 12 {
        let hangar = ["AEP", "Base", "Node"].join("-");
        let probe = dir
            .join(&hangar)
            .join("AEP-Crate")
            .join("src")
            .join("docking")
            .join("mod.rs");
        if probe.is_file() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i = i.saturating_add(1);
    }
    PathBuf::from(".")
}

fn read_src(path: &Path, label: &str) -> Result<String, String> {
    if !path.is_file() {
        return Err(format!("missing {label} source"));
    }
    match fs::read_to_string(path) {
        Ok(v) => {
            if v.is_empty() {
                Err(format!("empty {label} source"))
            } else {
                Ok(v)
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

fn twin_at(root: &Path, parts: &[&str]) -> PathBuf {
    let mut p = root.to_path_buf();
    for part in parts {
        p = p.join(part);
    }
    p
}

/// Client twins that ship in the public tree. The SDK twins moved out of the
/// public tree, so the gate checks the lattice-channels client library only.
fn client_twins(root: &Path) -> Vec<(String, PathBuf)> {
    let lib = ["AEP-Components", "lattice-channels", "lib"];
    let out = vec![
        (
            String::from("lattice-channels-ts"),
            twin_at(root, &[lib[0], lib[1], lib[2], "lattice-gated-fetch.ts"]),
        ),
        (
            String::from("lattice-channels-mjs"),
            twin_at(root, &[lib[0], lib[1], lib[2], "lattice-gated-fetch.mjs"]),
        ),
        (
            String::from("lattice-channels-js"),
            twin_at(root, &[lib[0], lib[1], lib[2], "lattice-gated-fetch.js"]),
        ),
        (
            String::from("lattice-transport-mjs"),
            twin_at(root, &[lib[0], lib[1], lib[2], "lattice-transport.mjs"]),
        ),
    ];
    out
}

/// Run live the earlier law change gate on docking.rs and lattice-gated-fetch twins.
pub fn run_gate() -> Result<i32, String> {
    let root = walk_to_workspace();
    let hangar = ["AEP", "Base", "Node"].join("-");
    let dock_src = read_docking_module(&root.join(&hangar))?;
    let dock = scan_dock_attaches_bound_http(&dock_src)?;
    let mut proofs: Vec<String> = Vec::new();
    proofs.push(dock);
    for (label, path) in client_twins(&root) {
        let src = read_src(&path, &label)?;
        let scan = scan_no_ordinary_fetch_after_dock_allow(&src)?;
        let mut line = String::from("ok twin=");
        line.push_str(&label);
        line.push(char::from(32));
        line.push_str(&scan);
        proofs.push(line);
    }
    for proof in proofs {
        let mut line = String::from("aep-lattice-gated-fetch ok proof=");
        line.push_str(&proof);
        line.push(char::from(10));
        let _ = std::io::stdout().write_all(line.as_bytes());
    }
    Ok(0)
}

pub mod gateway_spec_from_plaintext {
    pub struct GatewaySpecFromPlaintext {
        pub plaintext: String,
        pub spec: String,
    }
    impl Default for GatewaySpecFromPlaintext {
        fn default() -> Self {
            Self::new()
        }
    }

    impl GatewaySpecFromPlaintext {
        pub fn new() -> Self {
            Self {
                plaintext: String::new(),
                spec: String::new(),
            }
        }
        /// Parse dock plaintext for a LATTICE_GATEWAY_REQUEST url and method
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.spec = match super::gateway_spec_from_plaintext(self.plaintext.as_bytes()) {
                Some(s) => s.url,
                None => String::new(),
            };
            Ok(())
        }
    }
}

pub mod execute_bound_http_after_allow {
    pub struct ExecuteBoundHttpAfterAllow {
        pub spec: String,
        pub http: String,
    }
    impl Default for ExecuteBoundHttpAfterAllow {
        fn default() -> Self {
            Self::new()
        }
    }

    impl ExecuteBoundHttpAfterAllow {
        pub fn new() -> Self {
            Self {
                spec: String::new(),
                http: String::new(),
            }
        }
        /// After dock allow execute bound HTTP for the admitted url
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::gateway_spec_from_plaintext(self.spec.as_bytes()) {
                Some(s) => match super::execute_bound_http_after_allow(&s) {
                    Ok(h) => self.http = serde_json::to_string(&h).unwrap_or_default(),
                    Err(e) => self.http = e,
                },
                None => self.http = String::from("not a gateway request"),
            }
            Ok(())
        }
    }
}

pub mod http_from_dock_allow {
    pub struct HttpFromDockAllow {
        pub dock_json: String,
        pub http: String,
    }
    impl Default for HttpFromDockAllow {
        fn default() -> Self {
            Self::new()
        }
    }

    impl HttpFromDockAllow {
        pub fn new() -> Self {
            Self {
                dock_json: String::new(),
                http: String::new(),
            }
        }
        /// Client consumes dock http after allow. Missing http is Deny
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.http = match super::http_from_dock_allow(&self.dock_json) {
                Ok(h) => serde_json::to_string(&h).unwrap_or_default(),
                Err(e) => e,
            };
            Ok(())
        }
    }
}

pub mod scan_no_ordinary_fetch_after_dock_allow {
    pub struct ScanNoOrdinaryFetchAfterDockAllow {
        pub src: String,
        pub scan: String,
    }
    impl Default for ScanNoOrdinaryFetchAfterDockAllow {
        fn default() -> Self {
            Self::new()
        }
    }

    impl ScanNoOrdinaryFetchAfterDockAllow {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }
        /// Fail if latticeGatedFetch still calls ordinary fetch after dock allow
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.scan = match super::scan_no_ordinary_fetch_after_dock_allow(&self.src) {
                Ok(v) => v,
                Err(e) => e,
            };
            Ok(())
        }
    }
}

pub mod run_gate {
    pub struct RunGate {
        pub src: String,
        pub scan: String,
    }
    impl Default for RunGate {
        fn default() -> Self {
            Self::new()
        }
    }

    impl RunGate {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }
        /// Run live the earlier law change gate on docking.rs and lattice-gated-fetch twins
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.scan = match super::run_gate() {
                Ok(_) => String::from("ok"),
                Err(e) => e,
            };
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fail() {
        panic!("test check failed");
    }

    #[test]
    fn ping_is_not_gateway() {
        let src = br#"{"event_type":"LATTICE_HEALTH_PING","payload":{"probe":true}}"#;
        if gateway_spec_from_plaintext(src).is_some() {
            fail();
        }
    }

    #[test]
    fn gateway_parses_url() {
        let src = br#"{"event_type":"LATTICE_GATEWAY_REQUEST","action_path":"gateway:outbound_http","payload":{"url":"https://example.com/x","method":"get"}}"#;
        match gateway_spec_from_plaintext(src) {
            Some(s) => {
                if s.url != "https://example.com/x" || s.method != "GET" {
                    fail();
                }
            }
            None => fail(),
        }
    }

    /// A url field outside the gateway path is data: no spec, whatever the event type.
    #[test]
    fn url_field_outside_the_gateway_path_is_no_request() {
        for src in [
            br#"{"event_type":"LATTICE_GATEWAY_REQUEST","payload":{"url":"https://example.com/x"}}"#.as_slice(),
            br#"{"action_path":"action:write","payload":{"url":"https://example.com/x"}}"#.as_slice(),
            br#"{"action_path":"root:ping","url":"https://example.com/x","payload":{}}"#.as_slice(),
            br#"{"action_path":"gateway:outbound_http","url":"https://example.com/x","payload":{}}"#.as_slice(),
        ] {
            assert!(gateway_spec_from_plaintext(src).is_none(), "{}", String::from_utf8_lossy(src));
        }
    }

    #[test]
    fn malformed_gateway_request_is_an_error_not_a_request() {
        for event in [
            serde_json::json!({"action_path": GATEWAY_ACTION_PATH}),
            serde_json::json!({"action_path": GATEWAY_ACTION_PATH, "payload": {"method": "GET"}}),
            serde_json::json!({"action_path": GATEWAY_ACTION_PATH, "payload": {"url": "https://a.example/", "body_b64": "%%%"}}),
            serde_json::json!({"action_path": GATEWAY_ACTION_PATH, "payload": {"url": "https://a.example/", "headers": ["x"]}}),
            serde_json::json!({"action_path": GATEWAY_ACTION_PATH, "payload": {"url": "https://a.example/", "method": 7}}),
        ] {
            assert!(
                matches!(gateway_request_of(&event), Some(Err(_))),
                "{event}"
            );
        }
        let ok = serde_json::json!({"action_path": GATEWAY_ACTION_PATH, "payload": {"url": "https://a.example/", "body": "hi", "headers": {"x-a": "1"}}});
        let spec = gateway_request_of(&ok).expect("gateway").expect("spec");
        assert_eq!(spec.body, b"hi".to_vec());
        assert_eq!(spec.headers, vec![(String::from("x-a"), String::from("1"))]);
    }

    fn routes() -> GatewayRoutes {
        GatewayRoutes::parse(
            r#"{"routes":[
                {"id":"api","scheme":"https","host":"API.Example.com","path_prefix":"/v1","methods":["get","post"]},
                {"id":"local","scheme":"http","host":"127.1","port":8080,"methods":["GET"]}
            ]}"#,
        )
        .expect("routes")
    }

    fn spec(method: &str, url: &str) -> GatewaySpec {
        GatewaySpec {
            url: String::from(url),
            method: String::from(method),
            headers: Vec::new(),
            body: Vec::new(),
        }
    }

    #[test]
    fn route_list_matches_scheme_host_port_path_and_method() {
        let r = routes();
        assert_eq!(r.len(), 2);
        assert_eq!(
            r.route_for(&spec("GET", "https://api.example.com/v1"))
                .map(|x| x.id.as_str()),
            Ok("api")
        );
        assert!(r
            .route_for(&spec("POST", "https://api.example.com:443/v1/chat"))
            .is_ok());
        assert!(r
            .route_for(&spec("GET", "http://127.0.0.1:8080/any"))
            .is_ok());
        for (method, url) in [
            ("DELETE", "https://api.example.com/v1/x"),
            ("GET", "http://api.example.com/v1"),
            ("GET", "https://api.example.com:8443/v1"),
            ("GET", "https://api.example.com/v10"),
            ("GET", "https://api.example.com/"),
            ("GET", "https://api.example.com.evil.example/v1"),
            ("GET", "http://127.0.0.1/any"),
            ("GET", "not a url"),
        ] {
            assert!(r.route_for(&spec(method, url)).is_err(), "{method} {url}");
        }
        assert!(GatewayRoutes::empty()
            .route_for(&spec("GET", "https://api.example.com/v1"))
            .is_err());
    }

    #[test]
    fn a_bad_route_refuses_the_whole_list() {
        for text in [
            r#"{"routes":[{"id":"x","scheme":"ftp","host":"a.example","methods":["GET"]}]}"#,
            r#"{"routes":[{"id":"x","scheme":"https","host":"a.example","methods":[]}]}"#,
            r#"{"routes":[{"id":"x","scheme":"https","host":"a.example","path_prefix":"v1","methods":["GET"]}]}"#,
            r#"{"routes":[{"id":"","scheme":"https","host":"a.example","methods":["GET"]}]}"#,
            r#"{"routes":[{"id":"x","scheme":"https","host":"a.example","methods":["GET"],"extra":1}]}"#,
            r#"{"routes":[{"id":"x","scheme":"https","host":"a.example","methods":["G T"]}]}"#,
            "not json",
        ] {
            assert!(GatewayRoutes::parse(text).is_err(), "{text}");
        }
    }

    #[test]
    fn missing_route_file_is_an_empty_list() {
        let dir = std::env::temp_dir().join(format!("aep-gw-routes-{}", std::process::id()));
        let routes = GatewayRoutes::load(&dir.join("absent.json")).expect("empty");
        assert!(routes.is_empty());
    }

    /// The reply body is read with a bound: a body one byte over the cap fails the request
    /// and is never held whole.
    #[test]
    fn reply_over_the_body_cap_fails_the_request() {
        use std::io::Read;
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let th = std::thread::spawn(move || {
            if let Ok((mut s, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = s.read(&mut buf);
                // No content length: the body runs until the connection closes.
                let _ = s.write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n");
                let chunk = vec![b'a'; 64 * 1024];
                let mut sent = 0usize;
                while sent <= MAX_HTTP_BODY {
                    if s.write_all(&chunk).is_err() {
                        break;
                    }
                    sent += chunk.len();
                }
            }
        });
        let policy = SsrfPolicy {
            allow_loopback: true,
            allow_private: false,
        };
        let res = execute_bound_http_after_allow_with_policy(
            &spec("GET", &format!("http://127.0.0.1:{port}/big")),
            &policy,
        );
        assert_eq!(
            res,
            Err(String::from("lattice-gated-fetch: response too large"))
        );
        let _ = th.join();
    }

    #[test]
    fn missing_http_is_deny() {
        match http_from_dock_allow("{\"ok\":true}") {
            Err(e) => {
                if !e.contains("did not return http") {
                    fail();
                }
            }
            Ok(_) => fail(),
        }
    }

    #[test]
    fn http_from_dock_allow_204() {
        let j = "{\"ok\":true,\"http\":{\"status\":204,\"status_text\":\"No Content\",\"headers\":[],\"body_b64\":\"\"}}";
        match http_from_dock_allow(j) {
            Ok(h) => {
                if h.status != 204 {
                    fail();
                }
            }
            Err(_) => fail(),
        }
    }

    #[test]
    fn scan_detects_ordinary_fetch() {
        let src = "function latticeGatedFetch(url){ latticeDockRequest(); return fetch(url); }";
        match scan_no_ordinary_fetch_after_dock_allow(src) {
            Err(e) => {
                if !e.contains("ordinary fetch") {
                    fail();
                }
            }
            Ok(_) => fail(),
        }
    }

    #[test]
    fn scan_accepts_dock_http() {
        let src = "function latticeGatedFetch(url){ const resp = latticeDockRequest(); return responseFromDockAllow(resp); }";
        match scan_no_ordinary_fetch_after_dock_allow(src) {
            Ok(_) => {}
            Err(_) => fail(),
        }
    }

    #[test]
    fn scan_allows_strict_zero_before_dock() {
        let src = "function latticeGatedFetch(url){ if (!strict) return fetch(url); const resp = latticeDockRequest(); return responseFromDockAllow(resp); }";
        match scan_no_ordinary_fetch_after_dock_allow(src) {
            Ok(_) => {}
            Err(_) => fail(),
        }
    }

    #[test]
    fn loopback_denied() {
        let spec = GatewaySpec {
            url: String::from("http://127.0.0.1:9"),
            method: String::from("GET"),
            headers: Vec::new(),
            body: Vec::new(),
        };
        let policy = SsrfPolicy {
            allow_loopback: false,
            allow_private: false,
        };
        match execute_bound_http_after_allow_with_policy(&spec, &policy) {
            Err(e) => {
                if !e.contains("loopback") {
                    fail();
                }
            }
            Ok(_) => fail(),
        }
    }

    #[test]
    fn hatched_loopback_204() {
        use std::io::Read;
        use std::net::TcpListener;
        let listener = match TcpListener::bind("127.0.0.1:0") {
            Ok(v) => v,
            Err(_) => {
                fail();
                return;
            }
        };
        let addr = match listener.local_addr() {
            Ok(v) => v,
            Err(_) => {
                fail();
                return;
            }
        };
        let th = std::thread::spawn(move || {
            if let Ok((mut s, _)) = listener.accept() {
                let mut buf = [0u8; 512];
                let _ = s.read(&mut buf);
                let _ = s.write_all(
                    b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                );
            }
        });
        let spec = GatewaySpec {
            url: format!("http://127.0.0.1:{}", addr.port()),
            method: String::from("GET"),
            headers: Vec::new(),
            body: Vec::new(),
        };
        let policy = SsrfPolicy {
            allow_loopback: true,
            allow_private: false,
        };
        match execute_bound_http_after_allow_with_policy(&spec, &policy) {
            Ok(h) => {
                if h.status != 204 {
                    fail();
                }
            }
            Err(_) => fail(),
        }
        let _ = th.join();
    }

    #[test]
    fn live_gate_passes() {
        match run_gate() {
            Ok(_) => {}
            Err(_) => fail(),
        }
    }

    /// The shared egress vectors: every url row gets the same verdict from the address
    /// check of the kernel outbound request as from every other copy.
    #[test]
    fn egress_url_vectors_hold_for_the_kernel_request() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../egress-address/vectors/egress-address-vectors.json");
        let text = std::fs::read_to_string(&path).expect("vector file");
        let vectors: Value = serde_json::from_str(&text).expect("vector json");
        let policy = SsrfPolicy {
            allow_loopback: false,
            allow_private: false,
        };
        let mut wrong = Vec::new();
        for row in vectors["urls"].as_array().expect("urls") {
            let url = row["url"].as_str().expect("url");
            let want_allow = row["verdict"] == "allow";
            let got_allow = assert_url_not_ssrf(url, &policy).is_ok();
            if got_allow != want_allow {
                wrong.push(url.to_string());
            }
        }
        assert!(wrong.is_empty(), "rows with the wrong verdict: {wrong:?}");
    }
}
