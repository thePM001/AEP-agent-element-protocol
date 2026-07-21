# EU AI Act Control Matrix (AEP LRP)

Maturity: **enforced_v1_phase_c**. Honesty: compliance checking pack, not legal certification.

| control_id | Articles | Fail-closed deny_code | Phase |
| - | - | - | - |
| eu-ai-act.config.role-required | - | EU_AI_ACT_ROLE_MISSING | A |
| eu-ai-act.config.risk-class-required | - | EU_AI_ACT_RISK_CLASS_MISSING | A |
| eu-ai-act.config.pack-loaded | - | EU_AI_ACT_PACK_NOT_LOADED | A |
| eu-ai-act.art5.prohibited-practices | 5 | EU_AI_ACT_ART5_PROHIBITED | A |
| eu-ai-act.art9.rms-present | 9 | EU_AI_ACT_ART9_RMS_MISSING | A |
| eu-ai-act.art9.fria-record | 9, 27 | EU_AI_ACT_ART9_FRIA_MISSING | B |
| eu-ai-act.art10.data-governance | 10 | EU_AI_ACT_ART10_DATA_GOV_MISSING | A/B |
| eu-ai-act.art11.technical-docs-index | 11 | EU_AI_ACT_ART11_TECH_DOCS_MISSING | B |
| eu-ai-act.art12.logging-enabled | 12 | EU_AI_ACT_ART12_LOGGING_DISABLED | A |
| eu-ai-act.art13.transparency-export | 13, 50 | EU_AI_ACT_ART13_TRANSPARENCY_INCOMPLETE | A |
| eu-ai-act.identity.agent-identity | 13, 50 | EU_AI_ACT_IDENTITY_MISSING | B |
| eu-ai-act.art14.human-oversight-gate | 14 | EU_AI_ACT_ART14_NO_HUMAN_GATE | A |
| eu-ai-act.art15.execution-rings | 15 | EU_AI_ACT_ART15_UNCONSTRAINED | A |
| eu-ai-act.art61.retention-configured | 61 | EU_AI_ACT_ART61_RETENTION_MISSING | A |
| eu-ai-act.art73.incident-report-hook | 73 | EU_AI_ACT_ART73_INCIDENT_HOOK_MISSING | B |
| eu-ai-act.gpai.provider-declared | GPAI | EU_AI_ACT_GPAI_NOT_DECLARED | A/B |
| eu-ai-act.gpai.training-summary-hook | GPAI | EU_AI_ACT_GPAI_TRAINING_SUMMARY_MISSING | B |
| eu-ai-act.gpai.systemic-risk-flag | GPAI | EU_AI_ACT_GPAI_SYSTEMIC_FLAG_MISSING | B |
| eu-ai-act.platform.capability-present | - | EU_AI_ACT_PLATFORM_CAPABILITY_MISSING | B |

Checker: `AEP-Components/eu-ai-act-checker`
Pack: `AEP-Components/wizard/lrp/modules/eu-ai-act`
Gate: `AEP-Components/eu-ai-act-checker/gates/gate-eu-ai-act-lrp.sh`
| eu-ai-act.annex-iii.assistive-classify | Annex III (assistive) | EU_AI_ACT_ANNEX_III_MISMATCH | C |
