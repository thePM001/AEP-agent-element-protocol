//! Fail-closed EU AI Act LRP compliance checker for AEP regulation pack `eu-ai-act`.
//! Phase A+B control evaluation (config, action, transparency export).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

const VALID_ROLES: &[&str] = &["provider", "deployer", "importer", "distributor"];
const VALID_CLASSES: &[&str] = &["prohibited", "high_risk", "limited", "minimal", "gpai"];
const HIGH_RISK_REQUIRED_CAPS: &[&str] = &["gates", "evidence_ledger"];

const DEFAULT_PROHIBITED_TAGS: &[&str] = &[
    "social_scoring",
    "subliminal_manipulation",
    "exploit_vulnerability_harm",
    "untargeted_facial_scrape",
    "emotion_inference_workplace",
    "biometric_categorisation_sensitive",
    "real_time_remote_biometric_id_public",
];

#[derive(Debug, Error)]
pub enum CheckerError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("pack: {0}")]
    Pack(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EuAiActConfig {
    #[serde(default)]
    pub enabled: bool,
    pub role: Option<String>,
    pub risk_class: Option<String>,
    pub retention_days: Option<u64>,
    #[serde(default = "default_true")]
    pub logging_enabled: bool,
    #[serde(default = "default_true")]
    pub high_impact_requires_gate: bool,
    pub oversight_mode: Option<String>,
    pub risk_management_system: Option<Value>,
    pub data_governance_policy: Option<Value>,
    pub technical_documentation_index: Option<Value>,
    pub fria_record: Option<Value>,
    #[serde(default)]
    pub public_context: bool,
    #[serde(default)]
    pub require_fria: bool,
    pub capability_scope: Option<String>,
    #[serde(default)]
    pub gpai_provider: bool,
    pub gpai_training_summary: Option<Value>,
    /// None means flag not declared; Some(bool) means declared.
    pub gpai_systemic_risk: Option<bool>,
    #[serde(default)]
    pub incident_reporting_enabled: bool,
    #[serde(default)]
    pub enforce_platform_caps: bool,
    #[serde(default)]
    pub platform_capabilities: Vec<String>,
    #[serde(default)]
    pub require_agent_identity: bool,
    #[serde(default)]
    pub enforce_annex_iii: bool,
    #[serde(default)]
    pub annex_iii_use_cases: Vec<String>,
    #[serde(default)]
    pub annex_iii_tags: Vec<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionRequest {
    #[serde(rename = "type")]
    pub action_type: Option<String>,
    pub name: Option<String>,
    pub impact: Option<String>,
    pub gate_approval_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub serious_incident: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransparencyReport {
    pub session_id: Option<String>,
    pub role: Option<String>,
    pub risk_class: Option<String>,
    pub actions_summary: Option<Vec<Value>>,
    pub merkle_root: Option<String>,
    pub agent_identity: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DecisionKind {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Decision {
    pub decision: DecisionKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deny_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub control_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub articles: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl Decision {
    pub fn allow() -> Self {
        Self {
            decision: DecisionKind::Allow,
            deny_code: None,
            control_id: None,
            articles: vec![],
            message: None,
        }
    }

    pub fn deny(code: &str, control_id: &str, articles: &[&str], message: &str) -> Self {
        Self {
            decision: DecisionKind::Deny,
            deny_code: Some(code.to_string()),
            control_id: Some(control_id.to_string()),
            articles: articles.iter().map(|s| s.to_string()).collect(),
            message: Some(message.to_string()),
        }
    }

    pub fn is_deny(&self) -> bool {
        matches!(self.decision, DecisionKind::Deny)
    }
}

#[derive(Debug, Clone)]
pub struct ControlPack {
    pub root: PathBuf,
    pub catalog: Value,
    pub risk_classes: Value,
    pub roles: Value,
    pub article_map: Value,
    pub annex_assist: Value,
}

impl ControlPack {
    pub fn load(root: impl AsRef<Path>) -> Result<Self, CheckerError> {
        let root = root.as_ref().to_path_buf();
        let catalog_path = root.join("CONTROL-CATALOG.json");
        if !catalog_path.is_file() {
            return Err(CheckerError::Pack(format!(
                "missing CONTROL-CATALOG.json under {}",
                root.display()
            )));
        }
        let catalog: Value = serde_json::from_str(&fs::read_to_string(&catalog_path)?)?;
        let risk_classes: Value =
            serde_json::from_str(&fs::read_to_string(root.join("RISK-CLASSES.json"))?)?;
        let roles: Value = serde_json::from_str(&fs::read_to_string(root.join("ROLES.json"))?)?;
        let article_map: Value =
            serde_json::from_str(&fs::read_to_string(root.join("ARTICLE-MAP.json"))?)?;
        let annex_path = root.join("ANNEX-III-ASSIST.json");
        let annex_assist: Value = if annex_path.is_file() {
            serde_json::from_str(&fs::read_to_string(&annex_path)?)?
        } else {
            serde_json::json!({"use_cases":[]})
        };
        let controls = catalog
            .get("controls")
            .and_then(|c| c.as_array())
            .ok_or_else(|| CheckerError::Pack("controls array missing".into()))?;
        if controls.is_empty() {
            return Err(CheckerError::Pack("controls array empty".into()));
        }
        Ok(Self {
            root,
            catalog,
            risk_classes,
            roles,
            article_map,
            annex_assist,
        })
    }

    pub fn control_count(&self) -> usize {
        self.catalog
            .get("controls")
            .and_then(|c| c.as_array())
            .map(|a| a.len())
            .unwrap_or(0)
    }
}

fn fria_valid(v: &Value) -> bool {
    v.get("fria_id")
        .and_then(|x| x.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false)
        && v.get("summary")
            .and_then(|x| x.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false)
}

fn tech_docs_valid(v: &Value) -> bool {
    v.get("documents")
        .and_then(|d| d.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false)
}

fn training_summary_valid(v: &Value) -> bool {
    v.get("content")
        .and_then(|c| c.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false)
        || v.get("version")
            .and_then(|c| c.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false)
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassifyRequest {
    #[serde(default)]
    pub use_cases: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassifyResult {
    pub suggested_class: String,
    pub matched_use_cases: Vec<String>,
    pub annex_refs: Vec<String>,
    pub confidence: String,
    pub honesty: String,
}

fn class_rank(c: &str) -> u8 {
    match c {
        "prohibited" => 50,
        "high_risk" => 40,
        "gpai" => 30,
        "limited" => 20,
        "minimal" => 10,
        _ => 0,
    }
}

/// Assistive Annex III / use-case classification (not a legal determination).
pub fn classify_annex_iii(pack: &ControlPack, req: &ClassifyRequest) -> ClassifyResult {
    let empty = vec![];
    let cases = pack
        .annex_assist
        .get("use_cases")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    let mut matched: Vec<(String, String, Vec<String>)> = vec![];
    for uc in cases {
        let id = uc.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let suggested = uc
            .get("suggested_class")
            .and_then(|v| v.as_str())
            .unwrap_or("minimal");
        let refs: Vec<String> = uc
            .get("annex_refs")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        let keywords: Vec<String> = uc
            .get("keywords")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        let id_hit = req.use_cases.iter().any(|u| u == id);
        let tag_hit = req.tags.iter().any(|t| {
            let tl = t.to_lowercase();
            keywords.iter().any(|k| tl.contains(&k.to_lowercase())) || tl == id
        });
        if id_hit || tag_hit {
            matched.push((id.to_string(), suggested.to_string(), refs));
        }
    }
    if matched.is_empty() {
        return ClassifyResult {
            suggested_class: "minimal".into(),
            matched_use_cases: vec![],
            annex_refs: vec![],
            confidence: "low".into(),
            honesty: "Assistive only; no use-case match. Not a legal determination.".into(),
        };
    }
    matched.sort_by(|a, b| class_rank(&b.1).cmp(&class_rank(&a.1)));
    let top = &matched[0];
    let mut annex_refs = vec![];
    let mut ids = vec![];
    for m in &matched {
        ids.push(m.0.clone());
        for r in &m.2 {
            if !annex_refs.contains(r) {
                annex_refs.push(r.clone());
            }
        }
    }
    ClassifyResult {
        suggested_class: top.1.clone(),
        matched_use_cases: ids,
        annex_refs,
        confidence: if matched.len() == 1 { "medium".into() } else { "high".into() },
        honesty: "Assistive Annex mapping only. Not a legal determination of Annex III status.".into(),
    }
}

fn annex_iii_config_ok(pack: &ControlPack, cfg: &EuAiActConfig) -> Decision {
    if !cfg.enforce_annex_iii {
        return Decision::allow();
    }
    if cfg.annex_iii_use_cases.is_empty() && cfg.annex_iii_tags.is_empty() {
        return Decision::deny(
            "EU_AI_ACT_ANNEX_III_MISMATCH",
            "eu-ai-act.annex-iii.assistive-classify",
            &[],
            "enforce_annex_iii requires annex_iii_use_cases or annex_iii_tags",
        );
    }
    let req = ClassifyRequest {
        use_cases: cfg.annex_iii_use_cases.clone(),
        tags: cfg.annex_iii_tags.clone(),
    };
    let result = classify_annex_iii(pack, &req);
    let declared = cfg.risk_class.as_deref().unwrap_or("");
    if declared != result.suggested_class {
        // Allow if declared is stricter than suggestion
        if class_rank(declared) >= class_rank(&result.suggested_class) && declared != "minimal" {
            // still require exact for prohibited/high_risk suggestions
            if result.suggested_class == "prohibited" && declared != "prohibited" {
                return Decision::deny(
                    "EU_AI_ACT_ANNEX_III_MISMATCH",
                    "eu-ai-act.annex-iii.assistive-classify",
                    &[],
                    &format!(
                        "assistive class {} requires risk_class prohibited (got {})",
                        result.suggested_class, declared
                    ),
                );
            }
            if result.suggested_class == "high_risk" && class_rank(declared) < class_rank("high_risk") {
                return Decision::deny(
                    "EU_AI_ACT_ANNEX_III_MISMATCH",
                    "eu-ai-act.annex-iii.assistive-classify",
                    &[],
                    &format!(
                        "assistive class {} does not match risk_class {}",
                        result.suggested_class, declared
                    ),
                );
            }
            if result.suggested_class == "high_risk" && declared == "high_risk" {
                return Decision::allow();
            }
            if result.suggested_class != declared && class_rank(declared) < class_rank(&result.suggested_class) {
                return Decision::deny(
                    "EU_AI_ACT_ANNEX_III_MISMATCH",
                    "eu-ai-act.annex-iii.assistive-classify",
                    &[],
                    &format!(
                        "assistive class {} does not match risk_class {}",
                        result.suggested_class, declared
                    ),
                );
            }
            return Decision::allow();
        }
        return Decision::deny(
            "EU_AI_ACT_ANNEX_III_MISMATCH",
            "eu-ai-act.annex-iii.assistive-classify",
            &[],
            &format!(
                "assistive class {} does not match risk_class {}",
                result.suggested_class, declared
            ),
        );
    }
    Decision::allow()
}

/// Validate session config when LRP is enabled.
pub fn validate_config(pack: &ControlPack, cfg: &EuAiActConfig) -> Decision {
    if !cfg.enabled {
        return Decision::allow();
    }

    let role = match cfg.role.as_deref() {
        Some(r) if VALID_ROLES.contains(&r) => r,
        Some(_) | None => {
            return Decision::deny(
                "EU_AI_ACT_ROLE_MISSING",
                "eu-ai-act.config.role-required",
                &[],
                "eu_ai_act.role is required when eu-ai-act LRP is enabled",
            );
        }
    };

    let class = match cfg.risk_class.as_deref() {
        Some(c) if VALID_CLASSES.contains(&c) => c,
        Some(_) | None => {
            return Decision::deny(
                "EU_AI_ACT_RISK_CLASS_MISSING",
                "eu-ai-act.config.risk-class-required",
                &[],
                "eu_ai_act.risk_class is required when eu-ai-act LRP is enabled",
            );
        }
    };

    if class == "high_risk" {
        if cfg.enforce_platform_caps {
            for cap in HIGH_RISK_REQUIRED_CAPS {
                if !cfg.platform_capabilities.iter().any(|c| c == cap) {
                    return Decision::deny(
                        "EU_AI_ACT_PLATFORM_CAPABILITY_MISSING",
                        "eu-ai-act.platform.capability-present",
                        &[],
                        &format!("required platform capability missing: {cap}"),
                    );
                }
            }
        }
        if cfg.retention_days.unwrap_or(0) == 0 {
            return Decision::deny(
                "EU_AI_ACT_ART61_RETENTION_MISSING",
                "eu-ai-act.art61.retention-configured",
                &["61"],
                "retention_days must be a positive integer for high_risk",
            );
        }
        if !cfg.logging_enabled {
            return Decision::deny(
                "EU_AI_ACT_ART12_LOGGING_DISABLED",
                "eu-ai-act.art12.logging-enabled",
                &["12"],
                "logging_enabled must be true for high_risk",
            );
        }
        match &cfg.risk_management_system {
            Some(rms)
                if rms.get("version").and_then(|v| v.as_str()).is_some()
                    && rms
                        .get("risk_tiers")
                        .and_then(|v| v.as_array())
                        .map(|a| !a.is_empty())
                        .unwrap_or(false)
                    && rms.get("owner").and_then(|v| v.as_str()).is_some() => {}
            _ => {
                return Decision::deny(
                    "EU_AI_ACT_ART9_RMS_MISSING",
                    "eu-ai-act.art9.rms-present",
                    &["9"],
                    "risk_management_system evidence required for high_risk",
                );
            }
        }
        if cfg.capability_scope.as_deref() == Some("full_unconstrained") {
            return Decision::deny(
                "EU_AI_ACT_ART15_UNCONSTRAINED",
                "eu-ai-act.art15.execution-rings",
                &["15"],
                "full_unconstrained capability_scope forbidden for high_risk",
            );
        }
        if !cfg.incident_reporting_enabled {
            return Decision::deny(
                "EU_AI_ACT_ART73_INCIDENT_HOOK_MISSING",
                "eu-ai-act.art73.incident-report-hook",
                &["73"],
                "incident_reporting_enabled must be true for high_risk",
            );
        }
        if role == "provider" {
            if cfg.data_governance_policy.is_none() {
                return Decision::deny(
                    "EU_AI_ACT_ART10_DATA_GOV_MISSING",
                    "eu-ai-act.art10.data-governance",
                    &["10"],
                    "data_governance_policy required for provider high_risk",
                );
            }
            match &cfg.technical_documentation_index {
                Some(docs) if tech_docs_valid(docs) => {}
                _ => {
                    return Decision::deny(
                        "EU_AI_ACT_ART11_TECH_DOCS_MISSING",
                        "eu-ai-act.art11.technical-docs-index",
                        &["11"],
                        "technical_documentation_index.documents required for provider high_risk",
                    );
                }
            }
        }
        if role == "deployer" && (cfg.public_context || cfg.require_fria) {
            match &cfg.fria_record {
                Some(fria) if fria_valid(fria) => {}
                _ => {
                    return Decision::deny(
                        "EU_AI_ACT_ART9_FRIA_MISSING",
                        "eu-ai-act.art9.fria-record",
                        &["9", "27"],
                        "fria_record required for deployer high_risk public_context",
                    );
                }
            }
        }
    }

    if class == "gpai" && role == "provider" {
        if !cfg.gpai_provider {
            return Decision::deny(
                "EU_AI_ACT_GPAI_NOT_DECLARED",
                "eu-ai-act.gpai.provider-declared",
                &[],
                "gpai_provider must be true when risk_class is gpai for provider",
            );
        }
        match &cfg.gpai_training_summary {
            Some(s) if training_summary_valid(s) => {}
            _ => {
                return Decision::deny(
                    "EU_AI_ACT_GPAI_TRAINING_SUMMARY_MISSING",
                    "eu-ai-act.gpai.training-summary-hook",
                    &[],
                    "gpai_training_summary required for GPAI provider",
                );
            }
        }
        if cfg.gpai_systemic_risk.is_none() {
            return Decision::deny(
                "EU_AI_ACT_GPAI_SYSTEMIC_FLAG_MISSING",
                "eu-ai-act.gpai.systemic-risk-flag",
                &[],
                "gpai_systemic_risk boolean must be declared for GPAI provider",
            );
        }
    }

    let annex_decision = annex_iii_config_ok(pack, cfg);
    if annex_decision.is_deny() {
        return annex_decision;
    }

    Decision::allow()
}

/// Evaluate a runtime action against Phase A+B controls.
pub fn evaluate_action(pack: &ControlPack, cfg: &EuAiActConfig, action: &ActionRequest) -> Decision {
    if !cfg.enabled {
        return Decision::allow();
    }

    let cfg_decision = validate_config(pack, cfg);
    if cfg_decision.is_deny() {
        return cfg_decision;
    }

    let name_l = action.name.as_deref().unwrap_or("").to_lowercase();
    let tags_l: Vec<String> = action.tags.iter().map(|t| t.to_lowercase()).collect();
    for tag in DEFAULT_PROHIBITED_TAGS {
        let hit = tags_l.iter().any(|t| t == tag)
            || name_l.contains(&tag.replace('_', "."))
            || name_l.contains(tag)
            || (*tag == "social_scoring"
                && (name_l.contains("social_score") || name_l.contains("social-score")));
        if hit {
            return Decision::deny(
                "EU_AI_ACT_ART5_PROHIBITED",
                "eu-ai-act.art5.prohibited-practices",
                &["5"],
                "action matches prohibited practices catalog",
            );
        }
    }

    let class = cfg.risk_class.as_deref().unwrap_or("");
    if class == "high_risk" {
        if cfg.capability_scope.as_deref() == Some("full_unconstrained") {
            return Decision::deny(
                "EU_AI_ACT_ART15_UNCONSTRAINED",
                "eu-ai-act.art15.execution-rings",
                &["15"],
                "full_unconstrained capability_scope forbidden for high_risk",
            );
        }
        let impact = action.impact.as_deref().unwrap_or("low");
        if cfg.high_impact_requires_gate && impact.eq_ignore_ascii_case("high") {
            let gate = action.gate_approval_id.as_deref().unwrap_or("");
            if gate.is_empty() {
                return Decision::deny(
                    "EU_AI_ACT_ART14_NO_HUMAN_GATE",
                    "eu-ai-act.art14.human-oversight-gate",
                    &["14"],
                    "high-impact action requires human gate approval when eu-ai-act high_risk is enabled",
                );
            }
        }
        if action.serious_incident && !cfg.incident_reporting_enabled {
            return Decision::deny(
                "EU_AI_ACT_ART73_INCIDENT_HOOK_MISSING",
                "eu-ai-act.art73.incident-report-hook",
                &["73"],
                "serious_incident requires incident_reporting_enabled",
            );
        }
    }

    Decision::allow()
}

/// Validate transparency report export.
pub fn export_transparency_report(report: &TransparencyReport) -> Decision {
    export_transparency_report_with_opts(report, false)
}

/// Validate transparency report with optional agent identity requirement.
pub fn export_transparency_report_with_opts(
    report: &TransparencyReport,
    require_agent_identity: bool,
) -> Decision {
    if report.session_id.as_deref().unwrap_or("").is_empty()
        || report.role.as_deref().unwrap_or("").is_empty()
        || report.risk_class.as_deref().unwrap_or("").is_empty()
        || report.actions_summary.is_none()
    {
        return Decision::deny(
            "EU_AI_ACT_ART13_TRANSPARENCY_INCOMPLETE",
            "eu-ai-act.art13.transparency-export",
            &["13", "50"],
            "transparency report missing required fields",
        );
    }
    if require_agent_identity
        && report
            .agent_identity
            .as_deref()
            .unwrap_or("")
            .is_empty()
    {
        return Decision::deny(
            "EU_AI_ACT_IDENTITY_MISSING",
            "eu-ai-act.identity.agent-identity",
            &["13", "50"],
            "agent_identity required on transparency export",
        );
    }
    Decision::allow()
}

/// Run a golden fixture JSON file (test helper).
pub fn run_fixture(pack: &ControlPack, fixture: &Value) -> Result<Decision, CheckerError> {
    if let Some(classify) = fixture.get("classify") {
        let req: ClassifyRequest = serde_json::from_value(classify.clone())?;
        let result = classify_annex_iii(pack, &req);
        let expect = fixture.get("expect").cloned().unwrap_or_default();
        let want = expect
            .get("suggested_class")
            .and_then(|v| v.as_str())
            .unwrap_or("minimal");
        if result.suggested_class != want {
            return Ok(Decision::deny(
                "EU_AI_ACT_ANNEX_III_MISMATCH",
                "eu-ai-act.annex-iii.assistive-classify",
                &[],
                &format!(
                    "classify suggested {} expected {}",
                    result.suggested_class, want
                ),
            ));
        }
        return Ok(Decision::allow());
    }
    if let Some(report) = fixture.get("report") {
        let r: TransparencyReport = serde_json::from_value(report.clone())?;
        let require_id = fixture
            .get("require_agent_identity")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        return Ok(export_transparency_report_with_opts(&r, require_id));
    }
    let cfg: EuAiActConfig = serde_json::from_value(
        fixture
            .get("config")
            .cloned()
            .unwrap_or(Value::Object(Default::default())),
    )?;
    if let Some(action) = fixture.get("action") {
        let a: ActionRequest = serde_json::from_value(action.clone())?;
        return Ok(evaluate_action(pack, &cfg, &a));
    }
    Ok(validate_config(pack, &cfg))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pack() -> ControlPack {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../wizard/lrp/modules/eu-ai-act");
        ControlPack::load(root).expect("load pack")
    }

    fn base_high_risk_deployer() -> EuAiActConfig {
        EuAiActConfig {
            enabled: true,
            role: Some("deployer".into()),
            risk_class: Some("high_risk".into()),
            retention_days: Some(180),
            logging_enabled: true,
            high_impact_requires_gate: true,
            oversight_mode: Some("human_in_the_loop".into()),
            risk_management_system: Some(serde_json::json!({
                "version": "1",
                "risk_tiers": ["high"],
                "owner": "ops"
            })),
            data_governance_policy: None,
            technical_documentation_index: None,
            fria_record: None,
            public_context: false,
            require_fria: false,
            capability_scope: Some("ring_2".into()),
            gpai_provider: false,
            gpai_training_summary: None,
            gpai_systemic_risk: None,
            incident_reporting_enabled: true,
            enforce_platform_caps: false,
            platform_capabilities: vec![
                "gates".into(),
                "evidence_ledger".into(),
                "lattice_log".into(),
                "execution_rings".into(),
            ],
            require_agent_identity: false,
            enforce_annex_iii: false,
            annex_iii_use_cases: vec![],
            annex_iii_tags: vec![],
        }
    }

    #[test]
    fn deny_missing_role() {
        let p = pack();
        let mut cfg = base_high_risk_deployer();
        cfg.role = None;
        let d = validate_config(&p, &cfg);
        assert_eq!(d.deny_code.as_deref(), Some("EU_AI_ACT_ROLE_MISSING"));
    }

    #[test]
    fn deny_fria_when_public_context() {
        let p = pack();
        let mut cfg = base_high_risk_deployer();
        cfg.public_context = true;
        cfg.require_fria = true;
        let d = validate_config(&p, &cfg);
        assert_eq!(d.deny_code.as_deref(), Some("EU_AI_ACT_ART9_FRIA_MISSING"));
    }

    #[test]
    fn deny_provider_without_tech_docs() {
        let p = pack();
        let mut cfg = base_high_risk_deployer();
        cfg.role = Some("provider".into());
        cfg.data_governance_policy = Some(serde_json::json!({"version":"1"}));
        let d = validate_config(&p, &cfg);
        assert_eq!(
            d.deny_code.as_deref(),
            Some("EU_AI_ACT_ART11_TECH_DOCS_MISSING")
        );
    }

    #[test]
    fn allow_gpai_full() {
        let p = pack();
        let cfg = EuAiActConfig {
            enabled: true,
            role: Some("provider".into()),
            risk_class: Some("gpai".into()),
            retention_days: None,
            logging_enabled: true,
            high_impact_requires_gate: true,
            oversight_mode: None,
            risk_management_system: None,
            data_governance_policy: None,
            technical_documentation_index: None,
            fria_record: None,
            public_context: false,
            require_fria: false,
            capability_scope: None,
            gpai_provider: true,
            gpai_training_summary: Some(serde_json::json!({"version":"1","content":"sum"})),
            gpai_systemic_risk: Some(false),
            incident_reporting_enabled: false,
            enforce_platform_caps: false,
            platform_capabilities: vec![],
            require_agent_identity: false,
            enforce_annex_iii: false,
            annex_iii_use_cases: vec![],
            annex_iii_tags: vec![],
        };
        assert!(!validate_config(&p, &cfg).is_deny());
    }

    #[test]
    fn deny_high_impact_without_gate() {
        let p = pack();
        let cfg = base_high_risk_deployer();
        let action = ActionRequest {
            action_type: Some("tool_call".into()),
            name: Some("shell.exec".into()),
            impact: Some("high".into()),
            gate_approval_id: None,
            tags: vec![],
            serious_incident: false,
        };
        let d = evaluate_action(&p, &cfg, &action);
        assert_eq!(d.deny_code.as_deref(), Some("EU_AI_ACT_ART14_NO_HUMAN_GATE"));
    }

    #[test]
    fn deny_social_scoring() {
        let p = pack();
        let cfg = base_high_risk_deployer();
        let action = ActionRequest {
            action_type: Some("tool_call".into()),
            name: Some("social_score.rank_citizens".into()),
            impact: Some("high".into()),
            gate_approval_id: Some("g".into()),
            tags: vec!["social_scoring".into()],
            serious_incident: false,
        };
        let d = evaluate_action(&p, &cfg, &action);
        assert_eq!(d.deny_code.as_deref(), Some("EU_AI_ACT_ART5_PROHIBITED"));
    }

    #[test]
    fn annex_iii_mismatch_denies() {
        let p = pack();
        let mut cfg = base_high_risk_deployer();
        cfg.role = Some("provider".into());
        cfg.risk_class = Some("minimal".into());
        cfg.enforce_annex_iii = true;
        cfg.annex_iii_use_cases = vec!["employment_hr".into()];
        cfg.data_governance_policy = Some(serde_json::json!({"version":"1"}));
        cfg.technical_documentation_index =
            Some(serde_json::json!({"documents":["d1"]}));
        // minimal skips high_risk block; annex still runs
        let d = validate_config(&p, &cfg);
        assert_eq!(d.deny_code.as_deref(), Some("EU_AI_ACT_ANNEX_III_MISMATCH"));
    }

    #[test]
    fn annex_iii_classify_employment() {
        let p = pack();
        let r = classify_annex_iii(
            &p,
            &ClassifyRequest {
                use_cases: vec!["employment_hr".into()],
                tags: vec![],
            },
        );
        assert_eq!(r.suggested_class, "high_risk");
    }

    #[test]
    fn identity_required_on_export() {
        let r = TransparencyReport {
            session_id: Some("s".into()),
            role: Some("deployer".into()),
            risk_class: Some("high_risk".into()),
            actions_summary: Some(vec![]),
            merkle_root: None,
            agent_identity: None,
        };
        let d = export_transparency_report_with_opts(&r, true);
        assert_eq!(d.deny_code.as_deref(), Some("EU_AI_ACT_IDENTITY_MISSING"));
    }
}
