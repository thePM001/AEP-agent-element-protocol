# Compliance LRP Modules (AEP)

**Honesty:** Enabling a regulation LRP installs a **compliance checking pack**. It does **not** certify an organisation under the EU AI Act or any other framework.

## EU AI Act: one definition, one gate

| What | Path |
|------|------|
| **Definition (SSOT)** | `AEP-Components/eu-ai-act-checker/EU-AI-ACT-PACK.json` |
| **Gate** | `AEP-Components/eu-ai-act-checker/gates/gate-eu-ai-act.sh` |

```bash
./AEP-Components/eu-ai-act-checker/gates/gate-eu-ai-act.sh
```

That is the entire EU AI Act checking surface. No multi-file control catalog.

## Other LRP modules

| LRP ID | Framework | Reference policy |
|--------|-----------|------------------|
| `eu-ai-act` | EU AI Act | `AEP-Policy-System/reference/eu-ai-act.gap` |
| `gdpr` | GDPR | `AEP-Policy-System/reference/gdpr.gap` |
| `soc2-type2` | SOC 2 Type II | `AEP-Policy-System/reference/soc2-type2.gap` |
| `hipaa` | HIPAA | `AEP-Policy-System/reference/hipaa.gap` |
| `nist-ai-rmf` | NIST AI RMF 1.0 | `AEP-Policy-System/reference/nist-ai-rmf.gap` |
| `iso-42001` | ISO/IEC 42001 | `AEP-Policy-System/reference/iso-42001.gap` |

Module manifests: `AEP-Components/wizard/lrp/modules/*.json`.
