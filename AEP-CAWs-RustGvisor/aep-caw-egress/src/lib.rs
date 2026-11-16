//! Egress proxy of the CAW of AEP.
//!
//! A sandbox has no network device. The only way out is one Unix socket that the gate
//! mounts into the sandbox for one command. This crate serves that socket.
//!
//! A client speaks the HTTP proxy protocol on the socket:
//!
//! - `CONNECT host:port` opens a tunnel for HTTPS. The proxy never sees inside it.
//! - A request with an absolute `http://` URL is forwarded as plain HTTP.
//!
//! For every request the proxy does these steps and stops at the first that fails:
//!
//! 1. Read the request head with a size bound.
//! 2. Judge the scheme, the host name and the port against the routes of the plan.
//!    A destination with no route, an address literal in any spelling and a deny
//!    route are refused.
//! 3. Resolve the host name itself, once.
//! 4. Check every address of the answer with `aep-egress-address`. One refused
//!    address refuses the whole answer, so a name that also answers with a private
//!    address never passes.
//! 5. Dial one of the checked addresses and no other.
//!
//! A tunnel is streamed in both directions and never buffered. Every request leaves
//! one event, allowed or denied, for the audit log.

use std::io::{Read, Write};
use std::net::{Shutdown, SocketAddr, TcpStream, ToSocketAddrs};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use aep_caw_policy::route::{decide, DenyReason, PlanRoute, RouteDecision, Scheme};
use aep_egress_address::{check_resolved, EgressPolicy};

/// Largest request head the proxy reads.
pub const MAX_HEAD_BYTES: usize = 16 * 1024;

/// Resolves a host name to its addresses.
pub trait Resolver: Send + Sync {
    /// All addresses of `host` with `port`, or the reason the lookup failed.
    fn resolve(&self, host: &str, port: u16) -> Result<Vec<SocketAddr>, String>;
}

/// The resolver of the operating system.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemResolver;

impl Resolver for SystemResolver {
    fn resolve(&self, host: &str, port: u16) -> Result<Vec<SocketAddr>, String> {
        (host, port)
            .to_socket_addrs()
            .map(Iterator::collect)
            .map_err(|e| e.to_string())
    }
}

/// What a proxy needs to judge and to dial.
#[derive(Clone)]
pub struct ProxyConfig {
    /// The routes of the sandbox plan.
    pub routes: Vec<PlanRoute>,
    /// Which address classes a resolved name may have. Public only by default.
    pub address_policy: EgressPolicy,
    /// The resolver.
    pub resolver: Arc<dyn Resolver>,
    /// Longest wait for a connection to the destination.
    pub connect_timeout: Duration,
    /// Longest silence on a connection before it is closed.
    pub idle_timeout: Duration,
}

impl ProxyConfig {
    /// A proxy for the given routes with the system resolver and public addresses only.
    pub fn new(routes: Vec<PlanRoute>) -> Self {
        Self {
            routes,
            address_policy: EgressPolicy::STRICT,
            resolver: Arc::new(SystemResolver),
            connect_timeout: Duration::from_secs(10),
            idle_timeout: Duration::from_secs(300),
        }
    }
}

/// Why a request did not leave.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal {
    /// The request head is not a proxy request the CAW serves.
    Malformed(String),
    /// The request head is larger than [`MAX_HEAD_BYTES`].
    HeadTooLarge,
    /// No route names the destination.
    NoRoute,
    /// A deny route names the destination.
    DenyRoute(String),
    /// The host is an address literal.
    AddressLiteral,
    /// The host is not a host name.
    InvalidHost,
    /// The name did not resolve.
    Lookup(String),
    /// An address of the answer is not allowed.
    Address(String),
    /// No checked address took the connection.
    Dial(String),
}

impl Refusal {
    /// Short name for audit lines.
    pub fn name(&self) -> &'static str {
        match self {
            Self::Malformed(_) => "malformed",
            Self::HeadTooLarge => "head-too-large",
            Self::NoRoute => "no-route",
            Self::DenyRoute(_) => "deny-route",
            Self::AddressLiteral => "address-literal",
            Self::InvalidHost => "invalid-host",
            Self::Lookup(_) => "lookup",
            Self::Address(_) => "address",
            Self::Dial(_) => "dial",
        }
    }

    /// True when the policy refused the request. A lookup or dial that failed for a
    /// destination the policy allows is a failure, not a refusal of the policy.
    pub fn is_policy(&self) -> bool {
        !matches!(
            self,
            Self::Lookup(_) | Self::Dial(_) | Self::Malformed(_) | Self::HeadTooLarge
        )
    }

    fn detail(&self) -> String {
        match self {
            Self::Malformed(text) | Self::Lookup(text) | Self::Address(text) | Self::Dial(text) => {
                text.clone()
            }
            Self::DenyRoute(route) => format!("route {route}"),
            Self::HeadTooLarge => format!("the request head is larger than {MAX_HEAD_BYTES} bytes"),
            Self::NoRoute => "no route names this destination".to_string(),
            Self::AddressLiteral => "a route names a host, not an address".to_string(),
            Self::InvalidHost => "the host is not a host name".to_string(),
        }
    }

    fn status(&self) -> &'static str {
        match self {
            Self::Malformed(_) => "400 Bad Request",
            Self::HeadTooLarge => "431 Request Header Fields Too Large",
            Self::Lookup(_) | Self::Dial(_) => "502 Bad Gateway",
            _ => "403 Forbidden",
        }
    }
}

/// What happened to one request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EgressEvent {
    /// `http` or `https`. Empty when the head could not be read.
    pub scheme: String,
    /// The host as the request named it.
    pub host: String,
    /// The port the request named.
    pub port: u16,
    /// The route and the dialed address of an allowed request.
    pub allowed: Option<(String, SocketAddr)>,
    /// Why the request did not leave.
    pub refusal: Option<Refusal>,
}

/// One parsed request head.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Request {
    scheme: Scheme,
    host: String,
    port: u16,
    /// For plain HTTP: the head to send to the destination, in origin form.
    forward_head: Option<Vec<u8>>,
}

fn malformed(text: &str) -> Refusal {
    Refusal::Malformed(text.to_string())
}

/// Splits `host:port`. An IPv6 literal comes in brackets.
fn split_authority(authority: &str, default_port: Option<u16>) -> Result<(String, u16), Refusal> {
    let (host, port) = if let Some(rest) = authority.strip_prefix('[') {
        let end = rest
            .find(']')
            .ok_or_else(|| malformed("an address in brackets is not closed"))?;
        let after = &rest[end + 1..];
        (format!("[{}]", &rest[..end]), after.strip_prefix(':'))
    } else {
        match authority.rsplit_once(':') {
            Some((host, port)) => (host.to_string(), Some(port)),
            None => (authority.to_string(), None),
        }
    };
    let port = match port {
        Some(text) => text
            .parse::<u16>()
            .ok()
            .filter(|p| *p != 0 && text.bytes().all(|b| b.is_ascii_digit()))
            .ok_or_else(|| malformed("the port is not a number from 1 to 65535"))?,
        None => default_port.ok_or_else(|| malformed("the request names no port"))?,
    };
    if host.is_empty() || host.contains(['@', '/', '?', '#', ' ']) {
        return Err(malformed("the host of the request is not plain"));
    }
    Ok((host, port))
}

/// Reads a request head: `CONNECT host:port` or a request with an absolute `http://` URL.
fn parse_head(head: &[u8]) -> Result<Request, Refusal> {
    let text = std::str::from_utf8(head).map_err(|_| malformed("the request head is not text"))?;
    let (line, rest) = text
        .split_once("\r\n")
        .ok_or_else(|| malformed("the request has no first line"))?;
    let mut parts = line.split(' ');
    let (Some(method), Some(target), Some(version), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(malformed(
            "the first line is not method, target and version",
        ));
    };
    if version != "HTTP/1.1" && version != "HTTP/1.0" {
        return Err(malformed("the version is not HTTP/1.0 or HTTP/1.1"));
    }
    if method.is_empty() || !method.bytes().all(|b| b.is_ascii_uppercase()) {
        return Err(malformed("the method is not plain"));
    }
    if method == "CONNECT" {
        let (host, port) = split_authority(target, None)?;
        return Ok(Request {
            scheme: Scheme::Https,
            host,
            port,
            forward_head: None,
        });
    }
    let after = target
        .strip_prefix("http://")
        .ok_or_else(|| malformed("the target is neither CONNECT nor an absolute http URL"))?;
    let (authority, path) = match after.find(['/', '?']) {
        Some(at) if after.as_bytes()[at] == b'/' => (&after[..at], after[at..].to_string()),
        Some(at) => (&after[..at], format!("/{}", &after[at..])),
        None => (after, "/".to_string()),
    };
    let (host, port) = split_authority(authority, Some(80))?;
    // The head is sent on in origin form. Headers that belong to the hop to the
    // proxy are dropped and the connection ends with the reply.
    let mut out =
        format!("{method} {path} {version}\r\nHost: {authority}\r\nConnection: close\r\n");
    for header in rest.split("\r\n").filter(|h| !h.is_empty()) {
        let name = header
            .split(':')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if name.is_empty() || !header.contains(':') {
            return Err(malformed("a header line has no name"));
        }
        if matches!(
            name.as_str(),
            "host" | "connection" | "proxy-connection" | "proxy-authorization" | "keep-alive"
        ) {
            continue;
        }
        out.push_str(header);
        out.push_str("\r\n");
    }
    out.push_str("\r\n");
    Ok(Request {
        scheme: Scheme::Http,
        host,
        port,
        forward_head: Some(out.into_bytes()),
    })
}

/// Reads until the end of the request head. Returns the head and what came after it.
fn read_head(stream: &mut UnixStream) -> Result<(Vec<u8>, Vec<u8>), Refusal> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 2048];
    loop {
        if let Some(end) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
            let rest = buffer.split_off(end + 4);
            buffer.truncate(end + 2);
            return Ok((buffer, rest));
        }
        if buffer.len() > MAX_HEAD_BYTES {
            return Err(Refusal::HeadTooLarge);
        }
        let read = stream
            .read(&mut chunk)
            .map_err(|e| malformed(&format!("read: {e}")))?;
        if read == 0 {
            return Err(malformed("the connection ended inside the request head"));
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
}

/// Judges a request and dials its destination. Returns the route, the stream and
/// the dialed address.
fn admit(
    config: &ProxyConfig,
    request: &Request,
) -> Result<(String, TcpStream, SocketAddr), Refusal> {
    let (route, host) = match decide(&config.routes, request.scheme, &request.host, request.port) {
        RouteDecision::Allow { route, host } => (route, host),
        RouteDecision::Deny(DenyReason::NoRoute) => return Err(Refusal::NoRoute),
        RouteDecision::Deny(DenyReason::DenyRoute(name)) => return Err(Refusal::DenyRoute(name)),
        RouteDecision::Deny(DenyReason::AddressLiteral) => return Err(Refusal::AddressLiteral),
        RouteDecision::Deny(DenyReason::InvalidHost) => return Err(Refusal::InvalidHost),
    };
    let answer = config
        .resolver
        .resolve(&host, request.port)
        .map_err(Refusal::Lookup)?;
    let checked = check_resolved(answer, &config.address_policy)
        .map_err(|e| Refusal::Address(e.to_string()))?;
    let mut last = String::from("no address");
    for address in checked {
        match TcpStream::connect_timeout(&address, config.connect_timeout) {
            Ok(stream) => return Ok((route, stream, address)),
            Err(e) => last = format!("{address}: {e}"),
        }
    }
    Err(Refusal::Dial(last))
}

fn refuse(stream: &mut UnixStream, refusal: &Refusal) {
    let body = format!("aep-caw egress: {}: {}\n", refusal.name(), refusal.detail());
    let reply = format!(
        "HTTP/1.1 {}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        refusal.status(),
        body.len()
    );
    let _ = stream.write_all(reply.as_bytes());
    let _ = stream.shutdown(Shutdown::Both);
}

/// Copies both directions until both sides are done. Nothing is kept in memory
/// beyond one chunk.
fn relay(client: UnixStream, upstream: TcpStream) {
    let (Ok(mut client_read), Ok(mut upstream_write)) = (client.try_clone(), upstream.try_clone())
    else {
        return;
    };
    let up = std::thread::spawn(move || {
        let _ = std::io::copy(&mut client_read, &mut upstream_write);
        let _ = upstream_write.shutdown(Shutdown::Write);
    });
    let (mut upstream_read, mut client_write) = (upstream, client);
    let _ = std::io::copy(&mut upstream_read, &mut client_write);
    let _ = client_write.shutdown(Shutdown::Write);
    let _ = up.join();
}

fn serve(config: &ProxyConfig, mut client: UnixStream, events: &Sender<EgressEvent>) {
    let _ = client.set_read_timeout(Some(config.idle_timeout));
    let _ = client.set_write_timeout(Some(config.idle_timeout));
    let mut event = EgressEvent {
        scheme: String::new(),
        host: String::new(),
        port: 0,
        allowed: None,
        refusal: None,
    };
    let parsed = read_head(&mut client)
        .and_then(|(head, rest)| parse_head(&head).map(|request| (request, rest)));
    let (request, rest) = match parsed {
        Ok(pair) => pair,
        Err(refusal) => {
            refuse(&mut client, &refusal);
            event.refusal = Some(refusal);
            let _ = events.send(event);
            return;
        }
    };
    event.scheme = match request.scheme {
        Scheme::Http => "http".to_string(),
        Scheme::Https => "https".to_string(),
    };
    event.host.clone_from(&request.host);
    event.port = request.port;
    let (route, mut upstream, address) = match admit(config, &request) {
        Ok(found) => found,
        Err(refusal) => {
            refuse(&mut client, &refusal);
            event.refusal = Some(refusal);
            let _ = events.send(event);
            return;
        }
    };
    event.allowed = Some((route, address));
    let _ = events.send(event);
    let _ = upstream.set_read_timeout(Some(config.idle_timeout));
    let _ = upstream.set_write_timeout(Some(config.idle_timeout));
    let started = match &request.forward_head {
        Some(head) => upstream.write_all(head),
        None => client.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n"),
    }
    .and_then(|()| upstream.write_all(&rest));
    if started.is_ok() {
        relay(client, upstream);
    }
}

/// Why the proxy cannot serve its socket.
#[derive(Debug, thiserror::Error)]
pub enum ProxyError {
    /// The socket cannot be bound.
    #[error("egress socket {path}: {source}")]
    Bind {
        /// Path of the socket.
        path: PathBuf,
        /// The error of the operating system.
        source: std::io::Error,
    },
}

/// A running proxy on one Unix socket.
pub struct EgressProxy {
    path: PathBuf,
    stop: Arc<AtomicBool>,
    accept: Option<JoinHandle<()>>,
    events: Receiver<EgressEvent>,
}

impl EgressProxy {
    /// Binds the socket at `path` and serves it until [`EgressProxy::finish`].
    /// The path must not exist yet.
    pub fn start(path: &Path, config: ProxyConfig) -> Result<Self, ProxyError> {
        let listener = UnixListener::bind(path).map_err(|source| ProxyError::Bind {
            path: path.to_path_buf(),
            source,
        })?;
        let stop = Arc::new(AtomicBool::new(false));
        let (sender, events) = channel();
        let flag = Arc::clone(&stop);
        let accept = std::thread::spawn(move || {
            for stream in listener.incoming() {
                if flag.load(Ordering::SeqCst) {
                    return;
                }
                let Ok(stream) = stream else { continue };
                let config = config.clone();
                let sender = sender.clone();
                std::thread::spawn(move || serve(&config, stream, &sender));
            }
        });
        Ok(Self {
            path: path.to_path_buf(),
            stop,
            accept: Some(accept),
            events,
        })
    }

    /// Stops the proxy and returns the events of every request it saw.
    pub fn finish(mut self) -> Vec<EgressEvent> {
        self.stop.store(true, Ordering::SeqCst);
        // One connection wakes the accept loop so that it sees the flag.
        let _ = UnixStream::connect(&self.path);
        if let Some(handle) = self.accept.take() {
            let _ = handle.join();
        }
        let _ = std::fs::remove_file(&self.path);
        // A request in flight sends its event when its head is judged. A short wait
        // lets the last ones arrive.
        let mut events = Vec::new();
        while let Ok(event) = self.events.recv_timeout(Duration::from_millis(50)) {
            events.push(event);
        }
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::net::TcpListener;

    /// A resolver with a fixed table.
    struct Table(BTreeMap<String, Vec<SocketAddr>>);

    impl Resolver for Table {
        fn resolve(&self, host: &str, port: u16) -> Result<Vec<SocketAddr>, String> {
            self.0
                .get(host)
                .map(|addrs| {
                    addrs
                        .iter()
                        .map(|a| {
                            SocketAddr::new(a.ip(), if a.port() == 0 { port } else { a.port() })
                        })
                        .collect()
                })
                .ok_or_else(|| format!("{host}: name not known"))
        }
    }

    fn route(name: &str, scheme: Scheme, host: &str, port: u16, allow: bool) -> PlanRoute {
        PlanRoute {
            name: name.to_string(),
            scheme,
            host: host.to_string(),
            port,
            allow,
        }
    }

    /// A destination on loopback that answers every connection with one line and
    /// echoes what it read after it.
    fn destination() -> (SocketAddr, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("address");
        let handle = std::thread::spawn(move || {
            for stream in listener.incoming().take(8) {
                let Ok(mut stream) = stream else { return };
                std::thread::spawn(move || {
                    let mut seen = [0u8; 4096];
                    let read = stream.read(&mut seen).unwrap_or(0);
                    let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nsaw:");
                    let _ = stream.write_all(&seen[..read]);
                    let _ = stream.shutdown(Shutdown::Both);
                });
            }
        });
        (address, handle)
    }

    struct Fixture {
        proxy: Option<EgressProxy>,
        socket: PathBuf,
        dir: PathBuf,
    }

    impl Fixture {
        fn new(
            name: &str,
            routes: Vec<PlanRoute>,
            names: &[(&str, Vec<SocketAddr>)],
            loopback: bool,
        ) -> Self {
            let dir =
                std::env::temp_dir().join(format!("caw-egress-{}-{name}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("temp dir");
            let socket = dir.join("egress.sock");
            let mut config = ProxyConfig::new(routes);
            config.resolver = Arc::new(Table(
                names
                    .iter()
                    .map(|(n, a)| (n.to_string(), a.clone()))
                    .collect(),
            ));
            config.address_policy = EgressPolicy {
                allow_loopback: loopback,
                allow_private: false,
            };
            config.connect_timeout = Duration::from_secs(2);
            config.idle_timeout = Duration::from_secs(5);
            let proxy = EgressProxy::start(&socket, config).expect("start");
            Self {
                proxy: Some(proxy),
                socket,
                dir,
            }
        }

        fn ask(&self, request: &[u8]) -> String {
            let mut stream = UnixStream::connect(&self.socket).expect("connect");
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("timeout");
            stream.write_all(request).expect("write");
            let _ = stream.shutdown(Shutdown::Write);
            let mut reply = Vec::new();
            let _ = stream.read_to_end(&mut reply);
            String::from_utf8_lossy(&reply).into_owned()
        }

        fn finish(mut self) -> Vec<EgressEvent> {
            let events = self
                .proxy
                .take()
                .map(EgressProxy::finish)
                .unwrap_or_default();
            let _ = std::fs::remove_dir_all(&self.dir);
            events
        }
    }

    fn gateway(port: u16) -> Vec<PlanRoute> {
        vec![
            route("gateway", Scheme::Https, "gateway.example.com", port, true),
            route("docs", Scheme::Http, "docs.example.com", port, true),
        ]
    }

    #[test]
    fn a_tunnel_to_a_named_host_and_port_is_streamed() {
        let (address, _server) = destination();
        let f = Fixture::new(
            "tunnel",
            gateway(address.port()),
            &[("gateway.example.com", vec![address])],
            true,
        );
        let reply = f.ask(format!("CONNECT gateway.example.com:{} HTTP/1.1\r\nHost: x\r\n\r\nhello-through-the-tunnel", address.port()).as_bytes());
        assert!(
            reply.starts_with("HTTP/1.1 200 Connection Established\r\n\r\n"),
            "{reply}"
        );
        assert!(reply.ends_with("saw:hello-through-the-tunnel"), "{reply}");
        let events = f.finish();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].scheme, "https");
        assert_eq!(events[0].host, "gateway.example.com");
        assert_eq!(events[0].allowed, Some(("gateway".to_string(), address)));
        assert_eq!(events[0].refusal, None);
    }

    #[test]
    fn plain_http_is_forwarded_in_origin_form_without_the_proxy_headers() {
        let (address, _server) = destination();
        let f = Fixture::new(
            "http",
            gateway(address.port()),
            &[("docs.example.com", vec![address])],
            true,
        );
        let reply = f.ask(
            format!(
                "GET http://docs.example.com:{}/guide?x=1 HTTP/1.1\r\nHost: other\r\nProxy-Authorization: secret\r\nProxy-Connection: keep-alive\r\nAccept: text/plain\r\n\r\n",
                address.port()
            )
            .as_bytes(),
        );
        assert!(reply.starts_with("HTTP/1.1 200 OK"), "{reply}");
        assert!(reply.contains(&format!("saw:GET /guide?x=1 HTTP/1.1\r\nHost: docs.example.com:{}\r\nConnection: close\r\nAccept: text/plain\r\n\r\n", address.port())), "{reply}");
        assert!(!reply.contains("secret"));
        assert!(!reply.contains("Proxy-Connection"));
        assert_eq!(f.finish()[0].scheme, "http");
    }

    #[test]
    fn upper_case_and_a_trailing_dot_reach_the_same_route() {
        let (address, _server) = destination();
        let f = Fixture::new(
            "dot",
            gateway(address.port()),
            &[("gateway.example.com", vec![address])],
            true,
        );
        let reply = f.ask(
            format!(
                "CONNECT Gateway.EXAMPLE.com.:{} HTTP/1.1\r\n\r\n",
                address.port()
            )
            .as_bytes(),
        );
        assert!(reply.starts_with("HTTP/1.1 200 "), "{reply}");
        f.finish();
    }

    #[test]
    fn a_destination_with_no_route_is_refused_with_one_event() {
        let f = Fixture::new("no-route", gateway(443), &[], true);
        for request in [
            "CONNECT other.example.com:443 HTTP/1.1\r\n\r\n",
            "CONNECT gateway.example.com:8443 HTTP/1.1\r\n\r\n",
            "GET http://gateway.example.com:443/ HTTP/1.1\r\n\r\n",
            "CONNECT gateway.example.com.evil.test:443 HTTP/1.1\r\n\r\n",
        ] {
            let reply = f.ask(request.as_bytes());
            assert!(
                reply.starts_with("HTTP/1.1 403 Forbidden"),
                "{request}: {reply}"
            );
            assert!(reply.contains("no-route"), "{reply}");
        }
        let events = f.finish();
        assert_eq!(events.len(), 4);
        assert!(events
            .iter()
            .all(|e| e.refusal == Some(Refusal::NoRoute) && e.allowed.is_none()));
    }

    #[test]
    fn every_spelling_of_an_address_is_refused_before_any_lookup() {
        let f = Fixture::new(
            "literal",
            vec![route("any", Scheme::Https, "*.example.com", 443, true)],
            &[],
            true,
        );
        for host in [
            "127.0.0.1",
            "2130706433",
            "0x7f000001",
            "0177.0.0.1",
            "127.1",
            "[::1]",
            "[::ffff:127.0.0.1]",
            "169.254.169.254",
        ] {
            let reply = f.ask(format!("CONNECT {host}:443 HTTP/1.1\r\n\r\n").as_bytes());
            assert!(
                reply.starts_with("HTTP/1.1 403 Forbidden"),
                "{host}: {reply}"
            );
            assert!(reply.contains("address-literal"), "{host}: {reply}");
        }
        let events = f.finish();
        assert_eq!(events.len(), 8);
        assert!(events
            .iter()
            .all(|e| e.refusal == Some(Refusal::AddressLiteral)));
    }

    #[test]
    fn a_name_with_one_private_answer_is_refused_as_a_whole() {
        let (address, _server) = destination();
        let private: SocketAddr = "10.0.0.5:0".parse().expect("address");
        let metadata: SocketAddr = "169.254.169.254:0".parse().expect("address");
        let f = Fixture::new(
            "rebind",
            vec![route(
                "any",
                Scheme::Https,
                "*.example.com",
                address.port(),
                true,
            )],
            &[
                ("two.example.com", vec![address, private]),
                ("meta.example.com", vec![metadata]),
                ("loop.example.com", vec![address]),
            ],
            true,
        );
        for host in ["two.example.com", "meta.example.com"] {
            let reply =
                f.ask(format!("CONNECT {host}:{} HTTP/1.1\r\n\r\n", address.port()).as_bytes());
            assert!(
                reply.starts_with("HTTP/1.1 403 Forbidden"),
                "{host}: {reply}"
            );
        }
        let events = f.finish();
        assert!(events
            .iter()
            .all(|e| matches!(e.refusal, Some(Refusal::Address(_)))));

        let strict = Fixture::new(
            "rebind-strict",
            vec![route(
                "any",
                Scheme::Https,
                "*.example.com",
                address.port(),
                true,
            )],
            &[("loop.example.com", vec![address])],
            false,
        );
        let reply = strict.ask(
            format!(
                "CONNECT loop.example.com:{} HTTP/1.1\r\n\r\n",
                address.port()
            )
            .as_bytes(),
        );
        assert!(reply.starts_with("HTTP/1.1 403 Forbidden"), "{reply}");
        assert!(matches!(
            strict.finish()[0].refusal,
            Some(Refusal::Address(_))
        ));
    }

    #[test]
    fn a_deny_route_wins_and_names_itself() {
        let f = Fixture::new(
            "deny",
            vec![
                route("all", Scheme::Https, "*.example.com", 443, true),
                route("not-admin", Scheme::Https, "admin.example.com", 443, false),
            ],
            &[],
            true,
        );
        let reply = f.ask(b"CONNECT admin.example.com:443 HTTP/1.1\r\n\r\n");
        assert!(reply.contains("route not-admin"), "{reply}");
        assert_eq!(
            f.finish()[0].refusal,
            Some(Refusal::DenyRoute("not-admin".to_string()))
        );
    }

    #[test]
    fn a_name_that_does_not_resolve_and_a_closed_port_are_failures_not_policy() {
        let closed = {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
            listener.local_addr().expect("address")
        };
        let f = Fixture::new(
            "fail",
            vec![route(
                "any",
                Scheme::Https,
                "*.example.com",
                closed.port(),
                true,
            )],
            &[("closed.example.com", vec![closed])],
            true,
        );
        let unknown = f.ask(
            format!(
                "CONNECT unknown.example.com:{} HTTP/1.1\r\n\r\n",
                closed.port()
            )
            .as_bytes(),
        );
        assert!(unknown.starts_with("HTTP/1.1 502 Bad Gateway"), "{unknown}");
        let dial = f.ask(
            format!(
                "CONNECT closed.example.com:{} HTTP/1.1\r\n\r\n",
                closed.port()
            )
            .as_bytes(),
        );
        assert!(dial.starts_with("HTTP/1.1 502 Bad Gateway"), "{dial}");
        let events = f.finish();
        assert!(matches!(events[0].refusal, Some(Refusal::Lookup(_))));
        assert!(matches!(events[1].refusal, Some(Refusal::Dial(_))));
        assert!(events
            .iter()
            .all(|e| e.refusal.as_ref().is_some_and(|r| !r.is_policy())));
        assert!(Refusal::NoRoute.is_policy() && Refusal::AddressLiteral.is_policy());
    }

    #[test]
    fn a_head_above_the_bound_and_a_broken_head_are_refused() {
        let f = Fixture::new("head", gateway(443), &[], true);
        let mut large = b"CONNECT gateway.example.com:443 HTTP/1.1\r\nX-Fill: ".to_vec();
        large.extend(std::iter::repeat_n(b'a', MAX_HEAD_BYTES + 4096));
        large.extend_from_slice(b"\r\n\r\n");
        assert!(f.ask(&large).starts_with("HTTP/1.1 431 "));
        for request in [
            "CONNECT gateway.example.com HTTP/1.1\r\n\r\n",
            "CONNECT gateway.example.com:0 HTTP/1.1\r\n\r\n",
            "CONNECT gateway.example.com:99999 HTTP/1.1\r\n\r\n",
            "CONNECT gateway.example.com:+443 HTTP/1.1\r\n\r\n",
            "CONNECT user@gateway.example.com:443 HTTP/1.1\r\n\r\n",
            "GET /relative HTTP/1.1\r\n\r\n",
            "GET https://gateway.example.com/ HTTP/1.1\r\n\r\n",
            "GET http://docs.example.com/ HTTP/2\r\n\r\n",
            "get http://docs.example.com/ HTTP/1.1\r\n\r\n",
            "CONNECT  gateway.example.com:443 HTTP/1.1\r\n\r\n",
            "GET http://docs.example.com/ HTTP/1.1\r\nno-colon-line\r\n\r\n",
            "\r\n\r\n",
            "CONNECT gateway.example.com:443 HTTP/1.1\r\n",
        ] {
            let reply = f.ask(request.as_bytes());
            assert!(
                reply.starts_with("HTTP/1.1 400 Bad Request"),
                "{request:?}: {reply}"
            );
        }
        let events = f.finish();
        assert_eq!(events.len(), 14);
        assert_eq!(events[0].refusal, Some(Refusal::HeadTooLarge));
        assert!(events[1..]
            .iter()
            .all(|e| matches!(e.refusal, Some(Refusal::Malformed(_)))));
    }

    #[test]
    fn the_socket_is_gone_after_the_proxy_finished() {
        let f = Fixture::new("gone", gateway(443), &[], true);
        let socket = f.socket.clone();
        assert!(socket.exists());
        assert!(f.finish().is_empty());
        assert!(!socket.exists());
    }

    #[test]
    fn authorities_split_into_host_and_port() {
        assert_eq!(
            split_authority("a.example.com:443", None),
            Ok(("a.example.com".to_string(), 443))
        );
        assert_eq!(
            split_authority("a.example.com", Some(80)),
            Ok(("a.example.com".to_string(), 80))
        );
        assert_eq!(
            split_authority("[2001:db8::1]:443", None),
            Ok(("[2001:db8::1]".to_string(), 443))
        );
        assert_eq!(
            split_authority("[2001:db8::1]", Some(80)),
            Ok(("[2001:db8::1]".to_string(), 80))
        );
        for bad in [
            "",
            ":443",
            "a.example.com:",
            "a.example.com:x",
            "[2001:db8::1",
            "a b:443",
            "a/b:443",
        ] {
            assert!(split_authority(bad, None).is_err(), "{bad:?}");
        }
    }
}
