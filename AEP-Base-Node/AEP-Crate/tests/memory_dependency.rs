//! Admit does not depend on Lattice Memory.
//!
//! The Admit Gate and every wall crate of the live pass must build and judge without
//! the memory. The Base Node hands Admit a read-only view through a trait that the
//! Admit crate defines, so the dependency points from the Base Node to both and never
//! from Admit to the memory. This test reads the lock file of the workspace and the
//! manifests and sources of the Admit crates.
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

const MEMORY_PREFIX: &str = "aep-lattice-memory";

/// The crates that judge: the Admit Gate, its wall crates and the live pass.
const JUDGING_CRATES: &[(&str, &str)] = &[
    ("aep-admit", "AEP-Components/admit/crate"),
    (
        "aep-admit-writing-walls",
        "AEP-Components/admit-writing-walls/crate",
    ),
    (
        "aep-admit-channel-order-walls",
        "AEP-Components/admit-channel-order-walls/crate",
    ),
    (
        "aep-admit-temporal-bounds",
        "AEP-Components/admit-temporal-bounds/crate",
    ),
    (
        "aep-admit-budget-window",
        "AEP-Components/admit-budget-window/crate",
    ),
    ("aep-envelope-walls", "AEP-Components/envelope-walls/crate"),
    ("aep-envelope", "AEP-Components/envelope/crate"),
    ("aep-live-entry", "AEP-Components/live-entry/crate"),
    (
        "aep-admit-live-dock",
        "AEP-Components/admit-live-dock/crate",
    ),
    (
        "aep-one-live-evaluation",
        "AEP-Components/one-live-evaluation/crate",
    ),
    (
        "aep-policy-system-admit",
        "AEP-Components/policy-system-admit/crate",
    ),
    ("aep-kernel-types", "AEP-Components/kernel-types/crate"),
    (
        "aep-wall-set-backpressure",
        "AEP-Components/wall-set-backpressure/crate",
    ),
];

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// The packages of the lock file with the names of their dependencies.
fn lock_graph() -> BTreeMap<String, Vec<String>> {
    let text = match std::fs::read_to_string(workspace_root().join("Cargo.lock")) {
        Ok(text) => text,
        Err(e) => panic!("Cargo.lock: {e}"),
    };
    let mut graph: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut name: Option<String> = None;
    let mut in_dependencies = false;
    for line in text.lines() {
        let line = line.trim();
        if line == "[[package]]" {
            name = None;
            in_dependencies = false;
        } else if let Some(rest) = line.strip_prefix("name = ") {
            let package = rest.trim_matches('"').to_string();
            graph.entry(package.clone()).or_default();
            name = Some(package);
        } else if line == "dependencies = [" {
            in_dependencies = true;
        } else if line == "]" {
            in_dependencies = false;
        } else if in_dependencies {
            // A dependency line is a quoted name with an optional version and source.
            let dependency = line.trim_matches(|c| c == '"' || c == ',');
            let dependency = dependency.split(' ').next().unwrap_or("").to_string();
            if let Some(package) = &name {
                graph.entry(package.clone()).or_default().push(dependency);
            }
        }
    }
    graph
}

/// Every package a package depends on, directly or through others.
fn closure(graph: &BTreeMap<String, Vec<String>>, start: &str) -> BTreeSet<String> {
    let mut seen = BTreeSet::new();
    let mut open = vec![start.to_string()];
    while let Some(package) = open.pop() {
        for dependency in graph.get(&package).map(Vec::as_slice).unwrap_or(&[]) {
            if seen.insert(dependency.clone()) {
                open.push(dependency.clone());
            }
        }
    }
    seen
}

fn rust_sources(dir: &PathBuf, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            rust_sources(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

#[test]
fn admit_crate_has_no_memory_dependency() {
    let graph = lock_graph();
    assert!(
        graph.keys().any(|name| name.starts_with(MEMORY_PREFIX)),
        "the lock file holds no memory crate, so this test would prove nothing"
    );
    for (name, folder) in JUDGING_CRATES {
        assert!(graph.contains_key(*name), "{name} is not in the lock file");
        // The lock file: no memory crate anywhere below the crate.
        let below = closure(&graph, name);
        let memory: Vec<&String> = below
            .iter()
            .filter(|dependency| dependency.starts_with(MEMORY_PREFIX))
            .collect();
        assert!(memory.is_empty(), "{name} depends on {memory:?}");
        // The manifest: no line names the memory.
        let manifest = std::fs::read_to_string(workspace_root().join(folder).join("Cargo.toml"))
            .unwrap_or_else(|e| panic!("{folder}/Cargo.toml: {e}"));
        assert!(
            !manifest.contains("lattice-memory"),
            "{folder}/Cargo.toml names the memory"
        );
        // The sources: no file uses a memory crate.
        let mut sources = Vec::new();
        rust_sources(&workspace_root().join(folder).join("src"), &mut sources);
        assert!(!sources.is_empty(), "{folder} has no sources");
        for source in sources {
            let text = std::fs::read_to_string(&source).expect("source");
            assert!(
                !text.contains("aep_lattice_memory"),
                "{} uses a memory crate",
                source.display()
            );
        }
    }
}

#[test]
fn the_base_node_is_the_one_that_binds_admit_and_memory() {
    let graph = lock_graph();
    let below = closure(&graph, "aep-base-node");
    assert!(below.contains("aep-admit"));
    assert!(below.contains("aep-lattice-memory"));
    assert!(below.contains("aep-lattice-memory-core"));
    // The memory does not depend on Admit either.
    for memory in ["aep-lattice-memory", "aep-lattice-memory-core"] {
        let below = closure(&graph, memory);
        let admit: Vec<&String> = below
            .iter()
            .filter(|d| d.starts_with("aep-admit"))
            .collect();
        assert!(admit.is_empty(), "{memory} depends on {admit:?}");
    }
}

#[test]
fn the_memory_core_has_no_c_and_no_database_dependency() {
    let graph = lock_graph();
    let core = closure(&graph, "aep-lattice-memory-core");
    let store = closure(&graph, "aep-lattice-memory");
    for below in [&core, &store] {
        for banned in [
            "cc",
            "cmake",
            "cxx",
            "libsqlite3-sys",
            "rusqlite",
            "sqlite-vec",
            "usearch",
            "bindgen",
            "pkg-config",
        ] {
            assert!(!below.contains(banned), "the memory depends on {banned}");
        }
    }
    // The whole workspace is free of the two libraries the earlier store used.
    for gone in ["usearch", "sqlite-vec"] {
        assert!(!graph.contains_key(gone), "{gone} is in the lock file");
    }
}
