//! Properties that hold for every input.

// Test code may use expect: a failed expect here is a failed test.
#![allow(clippy::expect_used)]

mod common;

use aep_caw_policy::classify::{Classifier, Observation};
use aep_caw_policy::plan::{compile, plan_digest, MountMode};
use aep_caw_policy::record::parse_record;
use aep_caw_policy::route::{decide, normalize_host, PlanRoute, RouteDecision, Scheme};
use aep_caw_policy::{in_root_trees, is_under};
use common::*;
use proptest::prelude::*;

fn label() -> impl Strategy<Value = String> {
    "[a-z][a-z0-9]{0,6}"
}

fn name() -> impl Strategy<Value = String> {
    prop::collection::vec(label(), 2..4).prop_map(|parts| parts.join("."))
}

fn segment() -> impl Strategy<Value = String> {
    "[a-z][a-z0-9_-]{0,5}"
}

fn routes() -> impl Strategy<Value = Vec<PlanRoute>> {
    prop::collection::vec(
        (
            name(),
            any::<bool>(),
            any::<bool>(),
            prop::sample::select(vec![80u16, 443, 8443]),
        ),
        0..5,
    )
    .prop_map(|items| {
        items
            .into_iter()
            .enumerate()
            .map(|(i, (host, wildcard, allow, port))| PlanRoute {
                name: format!("r{i}"),
                scheme: Scheme::Https,
                host: if wildcard { format!("*.{host}") } else { host },
                port,
                allow,
            })
            .collect()
    })
}

proptest! {
    #[test]
    fn an_address_literal_never_passes(
        routes in routes(),
        a in 0u8..=255, b in 0u8..=255, c in 0u8..=255, d in 0u8..=255,
        port in prop::sample::select(vec![80u16, 443, 8443]),
    ) {
        let spellings = [
            format!("{a}.{b}.{c}.{d}"),
            format!("{}", u32::from_be_bytes([a, b, c, d])),
            format!("0x{:08x}", u32::from_be_bytes([a, b, c, d])),
            format!("0{a:o}.0{b:o}.0{c:o}.0{d:o}"),
            format!("[::ffff:{a}.{b}.{c}.{d}]"),
            format!("{a}.{b}.{c}.{d}."),
        ];
        for host in spellings {
            prop_assert!(matches!(decide(&routes, Scheme::Https, &host, port), RouteDecision::Deny(_)), "{}", host);
        }
    }

    #[test]
    fn an_allowed_request_matches_an_allow_route_and_no_deny_route(
        routes in routes(),
        host in name(),
        sub in prop::option::of(label()),
        port in prop::sample::select(vec![80u16, 443, 8443]),
    ) {
        let asked = match sub { Some(s) => format!("{s}.{host}"), None => host };
        if let RouteDecision::Allow { route, host: normal } = decide(&routes, Scheme::Https, &asked, port) {
            let matches = |r: &PlanRoute| r.port == port && match r.host.strip_prefix("*.") {
                Some(domain) => normal.ends_with(&format!(".{domain}")),
                None => r.host == normal,
            };
            let named = routes.iter().find(|r| r.name == route);
            prop_assert!(named.is_some_and(|r| r.allow && matches(r)));
            prop_assert!(!routes.iter().any(|r| !r.allow && matches(r)));
        }
    }

    #[test]
    fn the_verdict_does_not_depend_on_case_or_a_trailing_dot(
        routes in routes(),
        host in name(),
        port in prop::sample::select(vec![80u16, 443]),
    ) {
        let plain = decide(&routes, Scheme::Https, &host, port);
        prop_assert_eq!(&plain, &decide(&routes, Scheme::Https, &host.to_ascii_uppercase(), port));
        prop_assert_eq!(&plain, &decide(&routes, Scheme::Https, &format!("{host}."), port));
    }

    #[test]
    fn a_normal_host_is_its_own_normal_form(host in "\\PC{0,40}") {
        if let Ok(normal) = normalize_host(&host) {
            prop_assert_eq!(normalize_host(&normal), Ok(normal.clone()));
            prop_assert!(!normal.ends_with('.'));
            prop_assert!(normal.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'.'));
        }
    }

    #[test]
    fn a_plan_is_sorted_stable_and_inside_the_allowed_trees(
        root in prop::collection::vec(segment(), 1..3),
        denied in prop::collection::vec(prop::collection::vec(prop::sample::select(vec!["a".to_string(), "b".to_string(), "c".to_string()]), 1..3), 0..4),
        read_only in prop::collection::vec(prop::collection::vec(prop::sample::select(vec!["a".to_string(), "b".to_string(), "c".to_string()]), 1..4), 0..4),
        compiled_runtime in any::<bool>(),
    ) {
        let root = format!("/home/{}", root.join("/"));
        let mut p = profile();
        p.compiled_runtime = compiled_runtime;
        let mut rules = Vec::new();
        for (i, parts) in denied.iter().enumerate() {
            rules.push(file_rule(&format!("deny-{i}"), &[&format!("{root}/{}/**", parts.join("/"))], &["*"], "deny"));
        }
        for (i, parts) in read_only.iter().enumerate() {
            rules.push(file_rule(&format!("no-write-{i}"), &[&format!("{root}/{}", parts.join("/"))], &WRITE, "deny"));
        }
        p.base_policy = policy("base", rules);
        let session = vars().with("PROJECT_ROOT", &root);
        let plan = compile(&p, &session).expect("compiles");

        prop_assert_eq!(&plan, &compile(&p, &session).expect("compiles"));
        prop_assert_eq!(&plan.digest, &plan_digest(&plan).expect("digest"));
        prop_assert_eq!(plan.mounts[0].path.as_str(), root.as_str());
        for (i, m) in plan.mounts.iter().enumerate() {
            prop_assert!(is_under(&m.path, &root));
            prop_assert!(!in_root_trees(&m.path));
            prop_assert_eq!(m.exec, compiled_runtime && m.mode != MountMode::Mask);
            for later in &plan.mounts[i + 1..] {
                prop_assert!(!is_under(&m.path, &later.path) || m.path == later.path);
                prop_assert_ne!(&m.path, &later.path);
            }
        }
        for parts in &denied {
            let hidden = format!("{root}/{}/file", parts.join("/"));
            prop_assert_eq!(plan.mount_of(&hidden).map(|m| m.mode), Some(MountMode::Mask));
        }
        // A deny rule only takes away: below a denied tree nothing is readable.
        for parts in &denied {
            let tree = format!("{root}/{}", parts.join("/"));
            for m in &plan.mounts {
                if is_under(&m.path, &tree) {
                    prop_assert_eq!(m.mode, MountMode::Mask);
                }
            }
        }
    }

    #[test]
    fn the_classifier_is_quiet_about_the_root_and_about_plain_missing_files(
        tree in prop::sample::select(aep_caw_policy::ROOT_TREES.to_vec()),
        rest in prop::collection::vec(segment(), 0..4),
        errno in 1i64..140,
    ) {
        let plan = compile(&profile(), &vars()).expect("compiles");
        let mut c = Classifier::new(&plan);
        let mut path = tree.to_string();
        for part in &rest {
            path.push('/');
            path.push_str(part);
        }
        let in_root = Observation::OpenFailed { path: path.clone(), errno, process: "p".to_string(), thread_group: 1 };
        prop_assert_eq!(c.observe(in_root), None);
        c.observe(Observation::ExecAsked { path, process: "p".to_string(), thread_group: 1 });
        let in_mount = Observation::OpenFailed {
            path: format!("/home/agent/project/{}", rest.join("/")).trim_end_matches('/').to_string(),
            errno: 2,
            process: "p".to_string(),
            thread_group: 1,
        };
        prop_assert_eq!(c.observe(in_mount), None);
        prop_assert!(c.finish().is_empty());
    }

    #[test]
    fn no_text_makes_the_record_parser_or_the_classifier_panic(
        text in "\\PC{0,200}",
        bytes in prop::collection::vec(any::<u8>(), 0..40),
        errno in any::<i64>(),
    ) {
        let _ = parse_record(&text);
        let plan = compile(&profile(), &vars()).expect("compiles");
        let mut c = Classifier::new(&plan);
        let _ = c.observe(Observation::OpenFailed { path: text.clone(), errno, process: text.clone(), thread_group: 1 });
        let _ = c.observe(Observation::ConnectFailed { address: bytes, errno, process: text.clone(), thread_group: 1 });
        let _ = c.observe(Observation::ExecAsked { path: text, process: String::new(), thread_group: 1 });
        let _ = c.finish();
    }
}
