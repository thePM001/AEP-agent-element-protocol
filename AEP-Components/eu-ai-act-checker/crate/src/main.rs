//! CLI for EU AI Act LRP checker.
use clap::{Parser, Subcommand};
use eu_ai_act_checker::{
    classify_annex_iii, evaluate_action, export_transparency_report_with_opts, run_fixture, validate_config,
    ActionRequest, ClassifyRequest, ControlPack, EuAiActConfig, TransparencyReport,
};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
#[command(name = "eu-ai-act-checker", about = "AEP EU AI Act LRP fail-closed checker")]
struct Cli {
    #[arg(long, env = "EU_AI_ACT_PACK_ROOT", default_value = "EU-AI-ACT-PACK.json")]
    pack_root: PathBuf,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Validate eu_ai_act config JSON
    ValidateConfig {
        #[arg(long)]
        config: PathBuf,
    },
    /// Evaluate action JSON against config JSON
    Evaluate {
        #[arg(long)]
        config: PathBuf,
        #[arg(long)]
        action: PathBuf,
    },
    /// Validate transparency report JSON
    Transparency {
        #[arg(long)]
        report: PathBuf,
        #[arg(long, default_value_t = false)]
        require_agent_identity: bool,
    },
    /// Run a golden fixture file
    Fixture {
        #[arg(long)]
        path: PathBuf,
    },
    /// Assistive Annex use-case classification (not a legal determination)
    Classify {
        #[arg(long)]
        input: PathBuf,
    },
    /// Run all fixtures embedded in EU-AI-ACT-PACK.json
    Conformance,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let pack = match ControlPack::load(&cli.pack_root) {
        Ok(p) => p,
        Err(e) => {
            eprintln!(
                "{{\"decision\":\"deny\",\"deny_code\":\"EU_AI_ACT_PACK_NOT_LOADED\",\"message\":\"{e}\"}}"
            );
            return ExitCode::from(2);
        }
    };

    let decision = match cli.cmd {
        Cmd::ValidateConfig { config } => {
            let cfg: EuAiActConfig = match read_json(&config) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("{e}");
                    return ExitCode::from(2);
                }
            };
            validate_config(&pack, &cfg)
        }
        Cmd::Evaluate { config, action } => {
            let cfg: EuAiActConfig = match read_json(&config) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("{e}");
                    return ExitCode::from(2);
                }
            };
            let act: ActionRequest = match read_json(&action) {
                Ok(a) => a,
                Err(e) => {
                    eprintln!("{e}");
                    return ExitCode::from(2);
                }
            };
            evaluate_action(&pack, &cfg, &act)
        }
        Cmd::Transparency {
            report,
            require_agent_identity,
        } => {
            let r: TransparencyReport = match read_json(&report) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("{e}");
                    return ExitCode::from(2);
                }
            };
            export_transparency_report_with_opts(&r, require_agent_identity)
        }
        Cmd::Fixture { path } => {
            let fix: serde_json::Value = match read_json(&path) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("{e}");
                    return ExitCode::from(2);
                }
            };
            match run_fixture(&pack, &fix) {
                Ok(d) => d,
                Err(e) => {
                    eprintln!("{e}");
                    return ExitCode::from(2);
                }
            }
        }
        Cmd::Classify { input } => {
            let req: ClassifyRequest = match read_json(&input) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("{e}");
                    return ExitCode::from(2);
                }
            };
            let result = classify_annex_iii(&pack, &req);
            println!("{}", serde_json::to_string(&result).unwrap_or_else(|_| "{}".into()));
            return ExitCode::SUCCESS;
        }
                Cmd::Conformance => {
            let mut failed = 0u32;
            let mut passed = 0u32;
            let map = match pack.catalog.get("fixtures").and_then(|v| v.as_object()) {
                Some(m) if !m.is_empty() => m,
                _ => {
                    eprintln!("FAIL: pack has no embedded fixtures (definition file incomplete)");
                    return ExitCode::from(2);
                }
            };
            for (name, fix) in map {
                let expect = fix.get("expect").cloned().unwrap_or_default();
                let expect_decision = expect
                    .get("decision")
                    .and_then(|v| v.as_str())
                    .unwrap_or("allow");
                let expect_code = expect.get("deny_code").and_then(|v| v.as_str());
                match run_fixture(&pack, fix) {
                    Ok(d) => {
                        let got = if d.is_deny() { "deny" } else { "allow" };
                        let code_ok = match expect_code {
                            Some(c) => d.deny_code.as_deref() == Some(c),
                            None => true,
                        };
                        if got == expect_decision && code_ok {
                            passed += 1;
                            println!("PASS {name}");
                        } else {
                            failed += 1;
                            eprintln!(
                                "FAIL {name} expected {expect_decision}/{expect_code:?} got {got}/{:?}",
                                d.deny_code
                            );
                        }
                    }
                    Err(e) => {
                        failed += 1;
                        eprintln!("FAIL {name} err {e}");
                    }
                }
            }
            println!("conformance passed={passed} failed={failed}");
            if failed > 0 {
                return ExitCode::from(1);
            }
            return ExitCode::SUCCESS;
        }
    };

    println!(
        "{}",
        serde_json::to_string(&decision).unwrap_or_else(|_| "{}".into())
    );
    if decision.is_deny() {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

fn read_json<T: serde::de::DeserializeOwned>(path: &std::path::Path) -> Result<T, String> {
    let s = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&s).map_err(|e| e.to_string())
}
