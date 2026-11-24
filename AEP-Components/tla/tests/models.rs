//! Walls on the shipped models that run in every `cargo test`, with or without TLC.

use std::path::PathBuf;

const MODELS: [&str; 5] = [
    "AdmitConjunction",
    "DockPulse",
    "LastApplied",
    "TemporalBounds",
    "WrapComplete",
];

fn model_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read(name: &str) -> String {
    let path = model_dir().join(name);
    match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => panic!("{}: {e}", path.display()),
    }
}

#[test]
fn the_five_models_ship_and_nothing_else() {
    let mut found: Vec<String> = std::fs::read_dir(model_dir())
        .map(|rd| {
            rd.filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "tla"))
                .filter_map(|p| p.file_stem().map(|s| s.to_string_lossy().into_owned()))
                .collect()
        })
        .unwrap_or_default();
    found.sort();
    assert_eq!(found, MODELS.map(String::from).to_vec());
}

#[test]
fn every_model_passes_the_config_walls() {
    for m in MODELS {
        let tla = read(&format!("{m}.tla"));
        let cfg = read(&format!("{m}.cfg"));
        assert_eq!(
            aep_tla_verify::module_name(&tla).as_deref(),
            Some(m),
            "{m}: module name"
        );
        let problems = aep_tla_verify::config_problems(&tla, Some(&cfg));
        assert!(problems.is_empty(), "{m}: {problems:?}");
    }
}

#[test]
fn no_config_switches_the_deadlock_check_off() {
    for m in MODELS {
        let cfg = read(&format!("{m}.cfg"));
        assert!(cfg.contains("CHECK_DEADLOCK TRUE"), "{m}");
        assert!(!cfg.contains("CHECK_DEADLOCK FALSE"), "{m}");
    }
}

fn cfg_constant(cfg: &str, name: &str) -> i64 {
    let prefix = format!("CONSTANT {name} = ");
    let line = cfg
        .lines()
        .find_map(|l| l.trim().strip_prefix(prefix.as_str()))
        .unwrap_or_else(|| panic!("no constant {name}"));
    line.trim()
        .parse()
        .unwrap_or_else(|e| panic!("constant {name}: {e}"))
}

#[test]
fn temporal_bounds_match_the_dock_path() {
    let cfg = read("TemporalBounds.cfg");
    assert_eq!(
        cfg_constant(&cfg, "MaxDrift"),
        aep_base_node_pulse::MAX_DRIFT_MS
    );
    assert_eq!(
        cfg_constant(&cfg, "MaxAge"),
        aep_base_node_pulse::MAX_AGE_MS
    );
}
