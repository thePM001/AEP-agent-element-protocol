use aep_subprotocol_coding_governance::validate_action as validate_coding_governance;
use aep_subprotocol_commerce::{CommercePolicy, CommerceValidator};
use aep_subprotocol_core::ValidationResult;
use aep_subprotocol_events::EventRegistry;
use aep_subprotocol_iac::IacRegistry;
use aep_subprotocol_mcp_security::{McpSecurityRegistry, ToolDefinition};
use aep_subprotocol_rest_api::ApiRegistry;
use aep_subprotocol_ui::UiBundle;
use aep_subprotocol_workflows::WorkflowRegistry;
use clap::{Parser, Subcommand};
use serde_json::Value;
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "aep-subprotocol", version = "2.8.0")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Ui {
        #[arg(long, default_value = "AEP-Subprotocols/ui/aep-scene.json")]
        scene: PathBuf,
        #[arg(long, default_value = "AEP-Subprotocols/ui/aep-registry.yaml")]
        registry: PathBuf,
        #[arg(long, default_value = "AEP-Subprotocols/ui/aep-theme.yaml")]
        theme: PathBuf,
    },
    Commerce {
        #[arg(long)]
        action: String,
        #[arg(long)]
        payload: String,
        #[arg(long, default_value = ".aep/commerce")]
        spend_dir: PathBuf,
        #[arg(long)]
        policy: Option<String>,
    },
    Workflows {
        #[arg(long)]
        action: String,
        #[arg(long, default_value = "{}")]
        payload: String,
        #[arg(long)]
        state: Option<String>,
        #[arg(long, default_value = "AEP-Subprotocols/workflows/reference-registry.json")]
        registry: PathBuf,
    },
    RestApi {
        #[arg(long)]
        method: String,
        #[arg(long)]
        path: String,
        #[arg(long)]
        body: Option<String>,
        #[arg(long, default_value = "AEP-Subprotocols/rest-api/reference-registry.json")]
        registry: PathBuf,
    },
    Events {
        #[arg(long)]
        event_id: String,
        #[arg(long, default_value = "{}")]
        payload: String,
        #[arg(long)]
        producer: Option<String>,
        #[arg(long)]
        correlation_id: Option<String>,
        #[arg(long, default_value = "AEP-Subprotocols/events/reference-registry.json")]
        registry: PathBuf,
    },
    Iac {
        #[arg(long)]
        kind: String,
        #[arg(long)]
        spec: String,
        #[arg(long, default_value = "AEP-Subprotocols/iac/reference-registry.json")]
        registry: PathBuf,
    },
    Mcp {
        #[arg(long)]
        tool: String,
        #[arg(long, default_value = "{}")]
        input: String,
    },
    CodingGovernance {
        #[arg(long)]
        action: String,
        #[arg(long, default_value = "{}")]
        payload: String,
    },
}

fn main() {
    let cli = Cli::parse();
    let result = match cli.command {
        Commands::Ui {
            scene,
            registry,
            theme,
        } => match UiBundle::load(&scene, &registry, &theme) {
            Ok(bundle) => bundle.validate(),
            Err(e) => ValidationResult::fail_one(e),
        },
        Commands::Commerce {
            action,
            payload,
            spend_dir,
            policy,
        } => {
            let payload: Value = serde_json::from_str(&payload).unwrap_or(Value::Null);
            let pol: CommercePolicy = policy
                .map(|p| serde_json::from_str(&p).unwrap_or_default())
                .unwrap_or_default();
            let mut v = CommerceValidator::new(pol, spend_dir);
            let r = v.validate_action(&action, &payload);
            ValidationResult {
                valid: r.valid,
                errors: r.errors,
                detail: None,
            }
        }
        Commands::Workflows {
            action,
            payload,
            state,
            registry,
        } => {
            let payload: Value = serde_json::from_str(&payload).unwrap_or(Value::Null);
            match WorkflowRegistry::load_reference(registry.to_str().unwrap_or("")) {
                Ok(reg) => reg.validate_step(&action, &payload, state.as_deref()),
                Err(e) => ValidationResult::fail_one(e),
            }
        }
        Commands::RestApi {
            method,
            path,
            body,
            registry,
        } => {
            let body = body
                .map(|b| serde_json::from_str(&b).unwrap_or(Value::Null));
            match ApiRegistry::load_reference(registry.to_str().unwrap_or("")) {
                Ok(reg) => reg.validate_call(&method, &path, body.as_ref(), None),
                Err(e) => ValidationResult::fail_one(e),
            }
        }
        Commands::Events {
            event_id,
            payload,
            producer,
            correlation_id,
            registry,
        } => {
            let payload: Value = serde_json::from_str(&payload).unwrap_or(Value::Null);
            match EventRegistry::load_reference(registry.to_str().unwrap_or("")) {
                Ok(reg) => reg.validate_event(
                    &event_id,
                    &payload,
                    producer.as_deref(),
                    correlation_id.as_deref(),
                ),
                Err(e) => ValidationResult::fail_one(e),
            }
        }
        Commands::Iac {
            kind,
            spec,
            registry,
        } => {
            let spec: Value = serde_json::from_str(&spec).unwrap_or(Value::Null);
            match IacRegistry::load_reference(registry.to_str().unwrap_or("")) {
                Ok(reg) => reg.validate_resource(&kind, &spec),
                Err(e) => ValidationResult::fail_one(e),
            }
        }
        Commands::CodingGovernance { action, payload } => {
            let payload: Value = serde_json::from_str(&payload).unwrap_or(Value::Null);
            validate_coding_governance(&action, &payload)
        }
        Commands::Mcp { tool, input } => {
            let input: Value = serde_json::from_str(&input).unwrap_or(Value::Null);
            let mut reg = McpSecurityRegistry::new();
            reg.register_tool(ToolDefinition {
                name: "read_file".into(),
                description: "Read file".into(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "required": ["path"],
                    "properties": { "path": { "type": "string" } },
                    "additionalProperties": false
                }),
            });
            reg.validate_tool_call(&tool, &input, None)
        }
    };

    println!("{}", serde_json::to_string(&result).unwrap_or_default());
    if !result.valid {
        std::process::exit(1);
    }
}