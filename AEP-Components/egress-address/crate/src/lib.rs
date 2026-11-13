//! One address check for every outbound request of AEP.
//!
//! The Base Node gateway request and the UCB egress proxy both call this crate. The
//! JavaScript module `AEP-Components/egress-address/lib/egress-address.mjs` carries the
//! same range list, and the vector file `AEP-Components/egress-address/vectors/
//! egress-address-vectors.json` holds both to the same answer for every row.
//!
//! The check runs in three steps. [`check_url`] reads the URL without any name lookup:
//! scheme, user info, an address literal or one of the reserved names. [`resolve_checked`]
//! looks the name up once and checks every address it returns. The caller then connects
//! only to the returned addresses, so the name is never resolved a second time between the
//! check and the connection. [`read_body_bounded`] reads a reply body and stops one byte
//! past the cap.

use std::fmt;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use url::Url;

/// Class of one address. The policy decides per class.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddrClass {
    /// Globally reachable unicast.
    Public,
    /// 127.0.0.0/8 and ::1.
    Loopback,
    /// 0.0.0.0/8 and ::. A connection to it reaches the host itself.
    Unspecified,
    /// RFC 1918, unique local fc00::/7 and the deprecated site local fec0::/10.
    Private,
    /// Shared address space 100.64.0.0/10 of carrier grade NAT and some cloud metadata.
    Shared,
    /// 169.254.0.0/16 and fe80::/10, home of the cloud metadata services.
    LinkLocal,
    /// Documentation, network test, protocol assignment, multicast, the reserved block, the
    /// IPv6 transition ranges and every IPv6 address outside 2000::/3.
    Reserved,
}

impl AddrClass {
    /// Name of the class as the vector file writes it.
    pub fn as_str(&self) -> &'static str {
        match self {
            AddrClass::Public => "public",
            AddrClass::Loopback => "loopback",
            AddrClass::Unspecified => "unspecified",
            AddrClass::Private => "private",
            AddrClass::Shared => "shared",
            AddrClass::LinkLocal => "link_local",
            AddrClass::Reserved => "reserved",
        }
    }
}

impl fmt::Display for AddrClass {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// IPv4 ranges that are not public, as (network, prefix length, class).
pub const V4_RANGES: &[(u32, u8, AddrClass)] = &[
    (0x0000_0000, 8, AddrClass::Unspecified), // 0.0.0.0/8 this network
    (0x0A00_0000, 8, AddrClass::Private),     // 10.0.0.0/8
    (0x6440_0000, 10, AddrClass::Shared),     // 100.64.0.0/10 shared address space
    (0x7F00_0000, 8, AddrClass::Loopback),    // 127.0.0.0/8
    (0xA9FE_0000, 16, AddrClass::LinkLocal),  // 169.254.0.0/16
    (0xAC10_0000, 12, AddrClass::Private),    // 172.16.0.0/12
    (0xC000_0000, 24, AddrClass::Reserved),   // 192.0.0.0/24 protocol assignments
    (0xC000_0200, 24, AddrClass::Reserved),   // 192.0.2.0/24 documentation
    (0xC058_6300, 24, AddrClass::Reserved),   // 192.88.99.0/24 6to4 relay anycast
    (0xC0A8_0000, 16, AddrClass::Private),    // 192.168.0.0/16
    (0xC612_0000, 15, AddrClass::Reserved),   // 198.18.0.0/15 network device tests
    (0xC633_6400, 24, AddrClass::Reserved),   // 198.51.100.0/24 documentation
    (0xCB00_7100, 24, AddrClass::Reserved),   // 203.0.113.0/24 documentation
    (0xE000_0000, 4, AddrClass::Reserved),    // 224.0.0.0/4 multicast
    (0xF000_0000, 4, AddrClass::Reserved),    // 240.0.0.0/4 reserved and broadcast
];

/// IPv6 ranges inside or beside 2000::/3 that are not public, as (network, prefix length,
/// class). The unspecified, loopback and mapped addresses are decided before this table.
pub const V6_RANGES: &[(u128, u8, AddrClass)] = &[
    (0, 96, AddrClass::Reserved), // ::/96 IPv4 compatible, deprecated
    (
        0x0000_0000_0000_0000_ffff_0000_0000_0000,
        96,
        AddrClass::Reserved,
    ), // ::ffff:0:0:0/96 translated
    (
        0x0064_ff9b_0000_0000_0000_0000_0000_0000,
        96,
        AddrClass::Reserved,
    ), // 64:ff9b::/96 NAT64
    (
        0x0064_ff9b_0001_0000_0000_0000_0000_0000,
        48,
        AddrClass::Reserved,
    ), // 64:ff9b:1::/48 local NAT64
    (
        0x0100_0000_0000_0000_0000_0000_0000_0000,
        64,
        AddrClass::Reserved,
    ), // 100::/64 discard
    (
        0x2001_0000_0000_0000_0000_0000_0000_0000,
        23,
        AddrClass::Reserved,
    ), // 2001::/23 incl. Teredo 2001::/32
    (
        0x2001_0db8_0000_0000_0000_0000_0000_0000,
        32,
        AddrClass::Reserved,
    ), // 2001:db8::/32 documentation
    (
        0x2002_0000_0000_0000_0000_0000_0000_0000,
        16,
        AddrClass::Reserved,
    ), // 2002::/16 6to4
    (
        0x3fff_0000_0000_0000_0000_0000_0000_0000,
        20,
        AddrClass::Reserved,
    ), // 3fff::/20 documentation
    (
        0x5f00_0000_0000_0000_0000_0000_0000_0000,
        16,
        AddrClass::Reserved,
    ), // 5f00::/16 SRv6 SIDs
    (
        0xfc00_0000_0000_0000_0000_0000_0000_0000,
        7,
        AddrClass::Private,
    ), // fc00::/7 unique local
    (
        0xfe80_0000_0000_0000_0000_0000_0000_0000,
        10,
        AddrClass::LinkLocal,
    ), // fe80::/10
    (
        0xfec0_0000_0000_0000_0000_0000_0000_0000,
        10,
        AddrClass::Private,
    ), // fec0::/10 site local
    (
        0xff00_0000_0000_0000_0000_0000_0000_0000,
        8,
        AddrClass::Reserved,
    ), // ff00::/8 multicast
];

fn v4_in(addr: u32, net: u32, len: u8) -> bool {
    if len == 0 {
        return true;
    }
    let mask = u32::MAX << (32 - u32::from(len));
    addr & mask == net & mask
}

fn v6_in(addr: u128, net: u128, len: u8) -> bool {
    if len == 0 {
        return true;
    }
    let mask = u128::MAX << (128 - u32::from(len));
    addr & mask == net & mask
}

/// Class of one IPv4 address.
pub fn classify_v4(ip: Ipv4Addr) -> AddrClass {
    let a = u32::from(ip);
    for (net, len, class) in V4_RANGES {
        if v4_in(a, *net, *len) {
            return *class;
        }
    }
    AddrClass::Public
}

/// Class of one IPv6 address. A mapped address ::ffff:a.b.c.d takes the class of its IPv4
/// address, because the system connects to that IPv4 address.
pub fn classify_v6(ip: Ipv6Addr) -> AddrClass {
    if ip.is_unspecified() {
        return AddrClass::Unspecified;
    }
    if ip.is_loopback() {
        return AddrClass::Loopback;
    }
    if let Some(v4) = ip.to_ipv4_mapped() {
        return classify_v4(v4);
    }
    let a = u128::from(ip);
    for (net, len, class) in V6_RANGES {
        if v6_in(a, *net, *len) {
            return *class;
        }
    }
    // Only 2000::/3 holds global unicast. Everything else is unassigned.
    if v6_in(a, 0x2000_0000_0000_0000_0000_0000_0000_0000, 3) {
        AddrClass::Public
    } else {
        AddrClass::Reserved
    }
}

/// Class of one address.
pub fn classify_ip(ip: IpAddr) -> AddrClass {
    match ip {
        IpAddr::V4(v4) => classify_v4(v4),
        IpAddr::V6(v6) => classify_v6(v6),
    }
}

/// Which classes an outbound request may reach besides the public ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct EgressPolicy {
    /// Loopback and unspecified addresses, for a host that runs its upstream locally.
    pub allow_loopback: bool,
    /// Private, shared and link local addresses and the metadata names, for an upstream
    /// inside the private network of the host.
    pub allow_private: bool,
}

impl EgressPolicy {
    /// Public addresses only.
    pub const STRICT: EgressPolicy = EgressPolicy {
        allow_loopback: false,
        allow_private: false,
    };

    /// The policy of the operator: AEP_LATTICE_ALLOW_LOOPBACK=1 and
    /// AEP_LATTICE_ALLOW_PRIVATE=1 each open one class group. Any other value keeps it shut.
    pub fn from_env() -> Self {
        Self {
            allow_loopback: std::env::var("AEP_LATTICE_ALLOW_LOOPBACK").is_ok_and(|v| v == "1"),
            allow_private: std::env::var("AEP_LATTICE_ALLOW_PRIVATE").is_ok_and(|v| v == "1"),
        }
    }

    /// Whether the policy admits the class. Reserved addresses are never admitted.
    pub fn allows(&self, class: AddrClass) -> bool {
        match class {
            AddrClass::Public => true,
            AddrClass::Loopback | AddrClass::Unspecified => self.allow_loopback,
            AddrClass::Private | AddrClass::Shared | AddrClass::LinkLocal => self.allow_private,
            AddrClass::Reserved => false,
        }
    }
}

/// Why an outbound request was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EgressDeny {
    /// The text is not a URL or carries no host.
    InvalidUrl,
    /// Only http and https leave the host.
    Scheme(String),
    /// User info in the authority hides the real host from a reader of the URL.
    Userinfo,
    /// A reserved name that is refused without a lookup.
    Name { host: String, class: AddrClass },
    /// An address of a class that the policy does not admit.
    Address { ip: IpAddr, class: AddrClass },
    /// The name lookup failed.
    Lookup(String),
    /// The name lookup returned no address.
    NoAddress,
}

impl EgressDeny {
    /// The class that closed the request, when an address or name decided it.
    pub fn class(&self) -> Option<AddrClass> {
        match self {
            EgressDeny::Name { class, .. } | EgressDeny::Address { class, .. } => Some(*class),
            _ => None,
        }
    }
}

impl fmt::Display for EgressDeny {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EgressDeny::InvalidUrl => f.write_str("egress: invalid URL"),
            EgressDeny::Scheme(s) => write!(f, "egress: scheme {s} is not http or https"),
            EgressDeny::Userinfo => f.write_str("egress: user info in the URL is refused"),
            EgressDeny::Name { host, class } => {
                write!(f, "egress: host {host} is a {class} name and is refused")
            }
            EgressDeny::Address { ip, class } => {
                write!(f, "egress: address {ip} is {class} and is refused")
            }
            EgressDeny::Lookup(e) => write!(f, "egress: name lookup failed: {e}"),
            EgressDeny::NoAddress => f.write_str("egress: name lookup returned no address"),
        }
    }
}

impl std::error::Error for EgressDeny {}

/// Class of a reserved name, decided without a lookup. localhost names reach the host
/// itself and the metadata, internal and local names reach the network of the host.
pub fn name_class(host: &str) -> Option<AddrClass> {
    let h = host.trim_end_matches('.').to_ascii_lowercase();
    if h == "localhost" || h.ends_with(".localhost") {
        return Some(AddrClass::Loopback);
    }
    if h == "metadata"
        || h == "metadata.google.internal"
        || h.ends_with(".internal")
        || h.ends_with(".local")
    {
        return Some(AddrClass::LinkLocal);
    }
    None
}

/// The destination of a URL that passed [`check_url`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EgressTarget {
    /// The parsed URL.
    pub url: Url,
    /// The host as the URL holds it, without brackets for an IPv6 literal.
    pub host: String,
    /// The port of the URL or the default port of its scheme.
    pub port: u16,
    /// The address when the host is an address literal.
    pub literal: Option<IpAddr>,
}

fn check_addr(ip: IpAddr, policy: &EgressPolicy) -> Result<(), EgressDeny> {
    let class = classify_ip(ip);
    if policy.allows(class) {
        Ok(())
    } else {
        Err(EgressDeny::Address { ip, class })
    }
}

/// Check one address against the policy.
pub fn check_ip(ip: IpAddr, policy: &EgressPolicy) -> Result<(), EgressDeny> {
    check_addr(ip, policy)
}

/// Read a URL and check everything that needs no lookup: the scheme, the user info, an
/// address literal and the reserved names. The URL parser reads every IPv4 spelling the
/// WHATWG URL standard knows, so 0x7f.1, 2130706433 and 0177.0.0.1 all reach the range
/// list as 127.0.0.1.
pub fn check_url(raw: &str, policy: &EgressPolicy) -> Result<EgressTarget, EgressDeny> {
    let url = Url::parse(raw).map_err(|_| EgressDeny::InvalidUrl)?;
    let scheme = url.scheme().to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err(EgressDeny::Scheme(scheme));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(EgressDeny::Userinfo);
    }
    let port = url.port_or_known_default().ok_or(EgressDeny::InvalidUrl)?;
    let (host, literal) = match url.host() {
        Some(url::Host::Ipv4(v4)) => (v4.to_string(), Some(IpAddr::V4(v4))),
        Some(url::Host::Ipv6(v6)) => (v6.to_string(), Some(IpAddr::V6(v6))),
        Some(url::Host::Domain(d)) => {
            let d = d.to_ascii_lowercase();
            if d.is_empty() {
                return Err(EgressDeny::InvalidUrl);
            }
            (d, None)
        }
        None => return Err(EgressDeny::InvalidUrl),
    };
    match literal {
        Some(ip) => check_addr(ip, policy)?,
        None => {
            if let Some(class) = name_class(&host) {
                if !policy.allows(class) {
                    return Err(EgressDeny::Name { host, class });
                }
            }
        }
    }
    Ok(EgressTarget {
        url,
        host,
        port,
        literal,
    })
}

/// Check every address of a lookup. All of them must pass, so a name with one public and
/// one private answer is refused. The result is the set the caller pins its connection to.
pub fn check_resolved(
    addrs: impl IntoIterator<Item = SocketAddr>,
    policy: &EgressPolicy,
) -> Result<Vec<SocketAddr>, EgressDeny> {
    let mut out: Vec<SocketAddr> = Vec::new();
    for sa in addrs {
        check_addr(sa.ip(), policy)?;
        if !out.contains(&sa) {
            out.push(sa);
        }
    }
    if out.is_empty() {
        return Err(EgressDeny::NoAddress);
    }
    Ok(out)
}

/// Resolve the host of a checked target once and check every address. A literal host
/// returns its own address. This call blocks on the system resolver, so an async caller
/// resolves with its own runtime and passes the answer to [`check_resolved`].
pub fn resolve_checked(
    target: &EgressTarget,
    policy: &EgressPolicy,
) -> Result<Vec<SocketAddr>, EgressDeny> {
    if let Some(ip) = target.literal {
        check_addr(ip, policy)?;
        return Ok(vec![SocketAddr::new(ip, target.port)]);
    }
    let addrs = (target.host.as_str(), target.port)
        .to_socket_addrs()
        .map_err(|e| EgressDeny::Lookup(e.to_string()))?;
    check_resolved(addrs, policy)
}

/// A reply body over its cap.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BodyError {
    /// The body carries more than `cap` bytes.
    TooLarge { cap: usize },
    /// The read failed.
    Read(String),
}

impl fmt::Display for BodyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BodyError::TooLarge { cap } => write!(f, "egress: reply body over {cap} bytes"),
            BodyError::Read(e) => write!(f, "egress: reply body read failed: {e}"),
        }
    }
}

impl std::error::Error for BodyError {}

/// Read a reply body and stop one byte past the cap, so a large or endless body never
/// sits in memory whole before the size check.
pub fn read_body_bounded<R: Read>(reader: R, cap: usize) -> Result<Vec<u8>, BodyError> {
    let limit = u64::try_from(cap).unwrap_or(u64::MAX).saturating_add(1);
    let mut out = Vec::new();
    reader
        .take(limit)
        .read_to_end(&mut out)
        .map_err(|e| BodyError::Read(e.to_string()))?;
    if out.len() > cap {
        return Err(BodyError::TooLarge { cap });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn vectors() -> Value {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../vectors/egress-address-vectors.json");
        let text = std::fs::read_to_string(&path).expect("vector file");
        serde_json::from_str(&text).expect("vector json")
    }

    fn policy_named(vectors: &Value, name: &str) -> EgressPolicy {
        let p = &vectors["policies"][name];
        EgressPolicy {
            allow_loopback: p["allow_loopback"].as_bool().expect("allow_loopback"),
            allow_private: p["allow_private"].as_bool().expect("allow_private"),
        }
    }

    #[test]
    fn every_address_vector_has_its_class_and_verdicts() {
        let v = vectors();
        let mut wrong = Vec::new();
        for row in v["addresses"].as_array().expect("addresses") {
            let text = row["ip"].as_str().expect("ip");
            let ip: IpAddr = text.parse().expect("vector ip parses");
            let class = classify_ip(ip);
            if class.as_str() != row["class"].as_str().expect("class") {
                wrong.push(format!("{text}: class {class}"));
            }
            for (name, want) in row["allowed"].as_object().expect("allowed") {
                let policy = policy_named(&v, name);
                let got = check_ip(ip, &policy).is_ok();
                if Some(got) != want.as_bool() {
                    wrong.push(format!("{text}: policy {name} gave {got}"));
                }
            }
        }
        assert!(wrong.is_empty(), "{wrong:?}");
    }

    #[test]
    fn every_url_vector_has_its_verdict_without_a_lookup() {
        let v = vectors();
        let policy = policy_named(&v, "default");
        let mut wrong = Vec::new();
        for row in v["urls"].as_array().expect("urls") {
            let url = row["url"].as_str().expect("url");
            let got = check_url(url, &policy);
            let want_allow = row["verdict"] == "allow";
            match (&got, want_allow) {
                (Ok(t), true) => {
                    if t.literal.is_none() {
                        wrong.push(format!("{url}: allowed without a literal address"));
                    }
                }
                (Err(e), false) => {
                    if let Some(want_class) = row["class"].as_str() {
                        if e.class().map(|c| c.as_str()) != Some(want_class) {
                            wrong.push(format!("{url}: closed by {e}"));
                        }
                    }
                }
                (Ok(_), false) => wrong.push(format!("{url}: allowed")),
                (Err(e), true) => wrong.push(format!("{url}: refused by {e}")),
            }
        }
        assert!(wrong.is_empty(), "{wrong:?}");
    }

    #[test]
    fn every_class_of_the_vector_file_is_a_class_of_the_crate() {
        let v = vectors();
        let listed: Vec<&str> = v["classes"]
            .as_array()
            .expect("classes")
            .iter()
            .filter_map(|c| c.as_str())
            .collect();
        for class in [
            AddrClass::Public,
            AddrClass::Loopback,
            AddrClass::Unspecified,
            AddrClass::Private,
            AddrClass::Shared,
            AddrClass::LinkLocal,
            AddrClass::Reserved,
        ] {
            assert!(listed.contains(&class.as_str()), "{class}");
        }
        assert_eq!(listed.len(), 7);
    }

    #[test]
    fn one_refused_answer_refuses_the_whole_lookup() {
        let public: SocketAddr = "1.1.1.1:443".parse().expect("addr");
        let private: SocketAddr = "10.0.0.1:443".parse().expect("addr");
        assert_eq!(
            check_resolved([public], &EgressPolicy::STRICT),
            Ok(vec![public])
        );
        assert!(matches!(
            check_resolved([public, private], &EgressPolicy::STRICT),
            Err(EgressDeny::Address { .. })
        ));
        assert_eq!(
            check_resolved(Vec::new(), &EgressPolicy::STRICT),
            Err(EgressDeny::NoAddress)
        );
    }

    #[test]
    fn literal_target_resolves_to_itself_without_a_lookup() {
        let target = check_url("https://1.1.1.1:8443/x", &EgressPolicy::STRICT).expect("ok");
        assert_eq!(target.port, 8443);
        let pinned = resolve_checked(&target, &EgressPolicy::STRICT).expect("pinned");
        assert_eq!(
            pinned,
            vec!["1.1.1.1:8443".parse::<SocketAddr>().expect("addr")]
        );
    }

    #[test]
    fn each_allow_flag_opens_its_classes_and_reserved_stays_shut() {
        let loopback = EgressPolicy {
            allow_loopback: true,
            allow_private: false,
        };
        assert!(check_url("http://127.0.0.1:9/", &loopback).is_ok());
        assert!(check_url("http://localhost/", &loopback).is_ok());
        assert!(check_url("http://169.254.169.254/", &loopback).is_err());
        assert!(check_url("http://10.0.0.1/", &loopback).is_err());
        let private = EgressPolicy {
            allow_loopback: false,
            allow_private: true,
        };
        assert!(check_url("http://10.0.0.1/", &private).is_ok());
        assert!(check_url("http://100.64.0.1/", &private).is_ok());
        assert!(check_url("http://metadata.google.internal/", &private).is_ok());
        assert!(check_url("http://127.0.0.1/", &private).is_err());
        let both = EgressPolicy {
            allow_loopback: true,
            allow_private: true,
        };
        for reserved in [
            "http://[64:ff9b::7f00:1]/",
            "http://[2002:7f00:1::1]/",
            "http://198.18.0.1/",
            "http://224.0.0.1/",
        ] {
            assert!(check_url(reserved, &both).is_err(), "{reserved}");
        }
    }

    #[test]
    fn body_read_stops_one_byte_past_the_cap() {
        let data = [7u8; 100];
        assert_eq!(read_body_bounded(&data[..], 100).expect("fits").len(), 100);
        assert_eq!(
            read_body_bounded(&data[..], 99),
            Err(BodyError::TooLarge { cap: 99 })
        );
        // An endless body ends at cap plus one byte.
        let endless = std::io::repeat(1u8);
        assert_eq!(
            read_body_bounded(endless, 4096),
            Err(BodyError::TooLarge { cap: 4096 })
        );
    }
}
