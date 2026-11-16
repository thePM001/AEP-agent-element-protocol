//! The route matcher: judges one outbound request against the routes of a plan.
//!
//! A request names a scheme, a host and a port. The matcher judges the host name as
//! text. It never resolves it: the egress proxy resolves the name of an allowed
//! request itself and checks every address of the answer before it dials.
//!
//! Rules:
//! - A destination with no route is denied.
//! - An address literal in any spelling is denied. Routes name hosts, not addresses.
//! - A deny route wins over an allow route that matches the same request.
//! - A wildcard `*.example.com` matches every name below `example.com` and not
//!   `example.com` itself.

use serde::Serialize;

/// Scheme of a route.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Scheme {
    /// Plain HTTP.
    Http,
    /// HTTP over TLS, carried as a CONNECT tunnel.
    Https,
}

impl Scheme {
    /// Parses `http` or `https`.
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "http" => Some(Self::Http),
            "https" => Some(Self::Https),
            _ => None,
        }
    }
}

/// One route of a sandbox plan, with its host in normal form.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PlanRoute {
    /// Name of the route.
    pub name: String,
    /// Scheme.
    pub scheme: Scheme,
    /// Host name in lower case, or a wildcard `*.domain`.
    pub host: String,
    /// Port.
    pub port: u16,
    /// True for an allow route, false for a deny route.
    pub allow: bool,
}

/// Why a host is not a host name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostError {
    /// The host is an IPv4 or IPv6 address in some spelling.
    AddressLiteral,
    /// The host is empty, too long or holds a character no host name holds.
    Invalid,
}

/// Brings a host name into normal form: lower case, without one trailing dot.
///
/// Refuses an address literal. A name whose last label is a number, in decimal,
/// octal or hexadecimal spelling, is an address to every resolver that follows
/// `inet_aton`, so it is refused as a literal as well.
pub fn normalize_host(host: &str) -> Result<String, HostError> {
    if host.starts_with('[') || host.contains(':') {
        return Err(HostError::AddressLiteral);
    }
    let lower = host.to_ascii_lowercase();
    let name = lower.strip_suffix('.').unwrap_or(&lower);
    if name.is_empty() || name.len() > 253 {
        return Err(HostError::Invalid);
    }
    let mut last = "";
    for label in name.split('.') {
        if label.is_empty()
            || label.len() > 63
            || label.starts_with('-')
            || label.ends_with('-')
            || !label
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return Err(HostError::Invalid);
        }
        last = label;
    }
    if is_number(last) {
        return Err(HostError::AddressLiteral);
    }
    Ok(name.to_string())
}

/// True for a label that `inet_aton` reads as a number: decimal, octal or
/// hexadecimal with the prefix `0x`.
fn is_number(label: &str) -> bool {
    if let Some(hex) = label.strip_prefix("0x") {
        return hex.bytes().all(|b| b.is_ascii_hexdigit());
    }
    label.bytes().all(|b| b.is_ascii_digit())
}

/// Brings the host of a route into normal form. A route may start with `*.`.
pub fn normalize_route_host(host: &str) -> Result<String, HostError> {
    match host.strip_prefix("*.") {
        Some(domain) => {
            let domain = normalize_host(domain)?;
            if !domain.contains('.') {
                return Err(HostError::Invalid);
            }
            Ok(format!("*.{domain}"))
        }
        None => normalize_host(host),
    }
}

/// Why a request is denied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DenyReason {
    /// No route names the destination.
    NoRoute,
    /// A deny route names the destination.
    DenyRoute(String),
    /// The host is an address literal.
    AddressLiteral,
    /// The host is not a host name.
    InvalidHost,
}

/// The verdict on one request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RouteDecision {
    /// The request may leave through the named route to the host in normal form.
    Allow {
        /// Name of the route.
        route: String,
        /// Host in normal form. The proxy resolves exactly this name.
        host: String,
    },
    /// The request is refused.
    Deny(DenyReason),
}

fn host_matches(pattern: &str, host: &str) -> bool {
    match pattern.strip_prefix("*.") {
        Some(domain) => {
            host.len() > domain.len() + 1
                && host.ends_with(domain)
                && host.as_bytes()[host.len() - domain.len() - 1] == b'.'
        }
        None => pattern == host,
    }
}

/// Judges one request against the routes of a plan.
pub fn decide(routes: &[PlanRoute], scheme: Scheme, host: &str, port: u16) -> RouteDecision {
    let host = match normalize_host(host) {
        Ok(host) => host,
        Err(HostError::AddressLiteral) => return RouteDecision::Deny(DenyReason::AddressLiteral),
        Err(HostError::Invalid) => return RouteDecision::Deny(DenyReason::InvalidHost),
    };
    let mut allowed: Option<&PlanRoute> = None;
    for route in routes {
        if route.scheme != scheme || route.port != port || !host_matches(&route.host, &host) {
            continue;
        }
        if !route.allow {
            return RouteDecision::Deny(DenyReason::DenyRoute(route.name.clone()));
        }
        if allowed.is_none() {
            allowed = Some(route);
        }
    }
    match allowed {
        Some(route) => RouteDecision::Allow {
            route: route.name.clone(),
            host,
        },
        None => RouteDecision::Deny(DenyReason::NoRoute),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route(name: &str, scheme: Scheme, host: &str, port: u16, allow: bool) -> PlanRoute {
        PlanRoute {
            name: name.to_string(),
            scheme,
            host: host.to_string(),
            port,
            allow,
        }
    }

    fn gateway() -> Vec<PlanRoute> {
        vec![route(
            "gateway",
            Scheme::Https,
            "gateway.example.com",
            443,
            true,
        )]
    }

    fn allow(route: &str, host: &str) -> RouteDecision {
        RouteDecision::Allow {
            route: route.to_string(),
            host: host.to_string(),
        }
    }

    #[test]
    fn the_named_host_scheme_and_port_pass() {
        assert_eq!(
            decide(&gateway(), Scheme::Https, "gateway.example.com", 443),
            allow("gateway", "gateway.example.com")
        );
    }

    #[test]
    fn upper_case_and_a_trailing_dot_are_the_same_host() {
        assert_eq!(
            decide(&gateway(), Scheme::Https, "Gateway.EXAMPLE.com.", 443),
            allow("gateway", "gateway.example.com")
        );
    }

    #[test]
    fn another_port_scheme_or_host_has_no_route() {
        let no_route = RouteDecision::Deny(DenyReason::NoRoute);
        assert_eq!(
            decide(&gateway(), Scheme::Https, "gateway.example.com", 8443),
            no_route
        );
        assert_eq!(
            decide(&gateway(), Scheme::Http, "gateway.example.com", 443),
            no_route
        );
        assert_eq!(
            decide(&gateway(), Scheme::Https, "other.example.com", 443),
            no_route
        );
        assert_eq!(
            decide(&gateway(), Scheme::Https, "example.com", 443),
            no_route
        );
        assert_eq!(
            decide(&gateway(), Scheme::Https, "xgateway.example.com", 443),
            no_route
        );
        assert_eq!(
            decide(
                &gateway(),
                Scheme::Https,
                "gateway.example.com.evil.test",
                443
            ),
            no_route
        );
        assert_eq!(
            decide(&[], Scheme::Https, "gateway.example.com", 443),
            no_route
        );
    }

    #[test]
    fn every_spelling_of_an_address_is_refused_as_a_literal() {
        let routes = vec![route("any", Scheme::Http, "*.example.com", 80, true)];
        for host in [
            "192.0.2.1",
            "192.0.2.1.",
            "3221225985",
            "0xc0000201",
            "0300.0000.0002.0001",
            "192.0.513",
            "0xC0.0.2.1",
            "[2001:db8::1]",
            "2001:db8::1",
            "::1",
            "::ffff:192.0.2.1",
            "example.com.0x7f",
        ] {
            assert_eq!(
                decide(&routes, Scheme::Http, host, 80),
                RouteDecision::Deny(DenyReason::AddressLiteral),
                "{host}"
            );
        }
    }

    #[test]
    fn a_host_with_a_character_no_name_holds_is_invalid() {
        for host in [
            "",
            ".",
            "a..b",
            "exa mple.com",
            "a_b.example.com",
            "-a.example.com",
            "a-.example.com",
            "user@example.com",
            "example.com/path",
            "ex\u{e4}mple.com",
        ] {
            assert_eq!(
                decide(&gateway(), Scheme::Https, host, 443),
                RouteDecision::Deny(DenyReason::InvalidHost),
                "{host:?}"
            );
        }
        let long = format!("{}.example.com", "a".repeat(64));
        assert_eq!(
            decide(&gateway(), Scheme::Https, &long, 443),
            RouteDecision::Deny(DenyReason::InvalidHost)
        );
    }

    #[test]
    fn a_wildcard_matches_names_below_its_domain_only() {
        let routes = vec![route(
            "models",
            Scheme::Https,
            "*.models.example.com",
            443,
            true,
        )];
        assert_eq!(
            decide(&routes, Scheme::Https, "eu.models.example.com", 443),
            allow("models", "eu.models.example.com")
        );
        assert_eq!(
            decide(&routes, Scheme::Https, "a.b.models.example.com", 443),
            allow("models", "a.b.models.example.com")
        );
        let no_route = RouteDecision::Deny(DenyReason::NoRoute);
        assert_eq!(
            decide(&routes, Scheme::Https, "models.example.com", 443),
            no_route
        );
        assert_eq!(
            decide(&routes, Scheme::Https, "evilmodels.example.com", 443),
            no_route
        );
        assert_eq!(
            decide(&routes, Scheme::Https, "models.example.com.evil.test", 443),
            no_route
        );
    }

    #[test]
    fn a_deny_route_wins_over_an_allow_route_in_any_order() {
        let first = vec![
            route("all", Scheme::Https, "*.example.com", 443, true),
            route("not-admin", Scheme::Https, "admin.example.com", 443, false),
        ];
        let second = vec![first[1].clone(), first[0].clone()];
        for routes in [first, second] {
            assert_eq!(
                decide(&routes, Scheme::Https, "admin.example.com", 443),
                RouteDecision::Deny(DenyReason::DenyRoute("not-admin".to_string()))
            );
            assert_eq!(
                decide(&routes, Scheme::Https, "api.example.com", 443),
                allow("all", "api.example.com")
            );
        }
    }

    #[test]
    fn a_route_host_is_normalized_and_a_bare_wildcard_is_refused() {
        assert_eq!(
            normalize_route_host("*.Example.COM"),
            Ok("*.example.com".to_string())
        );
        assert_eq!(
            normalize_route_host("Gateway.example.com."),
            Ok("gateway.example.com".to_string())
        );
        assert_eq!(normalize_route_host("*.com"), Err(HostError::Invalid));
        assert_eq!(normalize_route_host("*"), Err(HostError::Invalid));
        assert_eq!(
            normalize_route_host("a.*.example.com"),
            Err(HostError::Invalid)
        );
        assert_eq!(
            normalize_route_host("*.192.0.2.1"),
            Err(HostError::AddressLiteral)
        );
        assert_eq!(
            normalize_route_host("192.0.2.1"),
            Err(HostError::AddressLiteral)
        );
    }
}
