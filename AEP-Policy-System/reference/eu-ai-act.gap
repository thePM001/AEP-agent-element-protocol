{
  "address": {
    "domain": "aep.reference.compliance.eu-ai-act",
    "id": "eu-ai-act.v1"
  },
  "pattern": {
    "guard": "true",
    "input": {
      "type": "object",
      "schema": "aep.reference.compliance.eu-ai-act.request.v1"
    },
    "output": {
      "type": "object",
      "schema": "aep.reference.compliance.eu-ai-act.decision.v1"
    },
    "constraints": [
      "role_required",
      "risk_class_required",
      "pack_loaded",
      "prohibited_practices",
      "rms_present_high_risk",
      "human_oversight_gate",
      "logging_enabled_high_risk",
      "execution_rings_high_risk",
      "retention_configured_high_risk",
      "transparency_export_complete",
      "fria_record_public_context",
      "technical_docs_provider",
      "incident_reporting_enabled",
      "gpai_training_summary",
      "gpai_systemic_risk_declared",
      "agent_identity_on_export"
    ],
    "invariants": [
      {
        "expr": "role_present_when_enabled",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "role_required_validator",
        "description": "eu_ai_act.role required when LRP enabled"
      },
      {
        "expr": "risk_class_present_when_enabled",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "risk_class_required_validator",
        "description": "eu_ai_act.risk_class required when LRP enabled"
      },
      {
        "expr": "no_prohibited_practices",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "prohibited_practices_validator",
        "description": "Art. 5 prohibited practice patterns denied"
      },
      {
        "expr": "high_impact_requires_gate",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "human_oversight_gate_validator",
        "description": "Art. 14 human gate for high-impact actions when high_risk"
      },
      {
        "expr": "high_risk_rms_present",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "rms_present_validator",
        "description": "Art. 9 risk management system evidence for high_risk"
      },
      {
        "expr": "high_risk_logging_enabled",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "logging_enabled_validator",
        "description": "Art. 12 logging enabled for high_risk"
      },
      {
        "expr": "no_full_unconstrained_high_risk",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "execution_rings_validator",
        "description": "Art. 15 no full_unconstrained scope for high_risk"
      },
      {
        "expr": "retention_days_positive_high_risk",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "retention_configured_validator",
        "description": "Art. 61 retention_days required for high_risk"
      },
      {
        "expr": "transparency_report_complete",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "transparency_export_validator",
        "description": "Art. 13/50 transparency export schema complete"
      },
      {
        "expr": "fria_when_public_context",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "fria_record_validator",
        "description": "Art. 9/27 FRIA for deployer public_context"
      },
      {
        "expr": "tech_docs_provider_high_risk",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "technical_docs_validator",
        "description": "Art. 11 technical docs for provider high_risk"
      },
      {
        "expr": "incident_hook_high_risk",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "incident_report_hook_validator",
        "description": "Art. 73 incident reporting enabled"
      },
      {
        "expr": "gpai_training_summary",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "gpai_training_summary_validator",
        "description": "GPAI training summary present"
      },
      {
        "expr": "gpai_systemic_declared",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "gpai_systemic_risk_validator",
        "description": "GPAI systemic risk flag declared"
      },
      {
        "expr": "agent_identity_export",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "agent_identity_validator",
        "description": "Agent identity on transparency export when required"
      }
    ]
  },
  "action": {
    "type": "pipeline",
    "steps": [
      "Load pack AEP-Components/wizard/lrp/modules/eu-ai-act",
      "Run eu-ai-act-checker validate_config and evaluate_action fail-closed"
    ]
  },
  "weight": 1,
  "composition": {
    "type": "atomic"
  },
  "metadata": {
    "provenance": "aep.reference.compliance.eu-ai-act",
    "version": "1.3.0",
    "stability": "stable",
    "trust_ring": "governance",
    "lrp_id": "eu-ai-act",
    "framework": "EU AI Act",
    "maturity": "enforced_v1_phase_c",
    "control_catalog": "AEP-Components/wizard/lrp/modules/eu-ai-act/CONTROL-CATALOG.json",
    "checker": "eu-ai-act-checker",
    "honesty": "compliance checking pack not legal certification"
  }
}
