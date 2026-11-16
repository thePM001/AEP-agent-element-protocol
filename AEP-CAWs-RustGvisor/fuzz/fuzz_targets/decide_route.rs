#![no_main]
//! Any text as the host of a request: a host that passes is the named host of the one
//! route and never an address.

use aep_caw_policy::route::{decide, PlanRoute, RouteDecision, Scheme};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let Ok(host) = std::str::from_utf8(data) else {
        return;
    };
    let routes = [PlanRoute {
        name: "gateway".to_string(),
        scheme: Scheme::Https,
        host: "*.example.com".to_string(),
        port: 443,
        allow: true,
    }];
    if let RouteDecision::Allow { host: normal, .. } = decide(&routes, Scheme::Https, host, 443) {
        assert!(normal.ends_with(".example.com"));
        assert!(normal.parse::<std::net::IpAddr>().is_err());
    }
});
