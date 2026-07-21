# AEP 2.75 Reference Policy Lattice

This is the official AEP reference policy lattice. It provides baseline security, deployment, writing and governance policies that serve as a template for all AEP implementations.

## Lattice Structure

```
SYSTEM (most permissive - top of lattice)
 |
 +-- governance.gap (code access, browser sandbox, session registration, violation reporting)
 |
 +-- deployment.gap (human approval, domain restriction, rollback, evidence ledger)
 |
 +-- writing.gap (em-dash, en-dash, double-hyphen, Oxford comma, text brightness)
 |
 +-- security.gap (PII, secrets, injection, network bind, unicode)
 |
 +-- network-egress-no-smtp.gap (SMTP / ports 25-465-587; added 2026-07-21)
 |
SANDBOX (most restrictive - bottom of lattice)
```

## Usage

Copy any policy to your project's policies/ directory and customize:
```bash
cp AEP-Policy-System/reference/security.gap my-project/policies/
```

All reference policies are pre-validated with zero structural errors. Validate your own policies with `aep lint-policy`.

## Customization

1. Add your allowed domains to deployment.gap
2. Add your specific PII patterns to security.gap
3. Adjust trust rings per your agent hierarchy
4. Compose multiple policies via lattice join/meet operations

## Platform mandatory policies (not LRPs)

LRPs are sovereign states, regional unions, and international bodies and their regulations. Platform policies live under EPSCOM / hyperlattice mandatory rules:

| File | Rule ID | Purpose |
|------|---------|---------|
| `../lattice-channel-mandatory.gap` | (YAML rules list) | Platform transport and distribution mandatory rules |



## Compliance reference policies (LRPs)

Regulation LRP modules ship starter GAP templates (enable via wizard or `base_node.lrps`):

| File | LRP ID | Framework |
|------|--------|-----------|
| `eu-ai-act.gap` | `eu-ai-act` | EU AI Act |
| `gdpr.gap` | `gdpr` | GDPR |
| `soc2-type2.gap` | `soc2-type2` | SOC 2 Type II |
| `hipaa.gap` | `hipaa` | HIPAA |
| `nist-ai-rmf.gap` | `nist-ai-rmf` | NIST AI RMF 1.0 |
| `iso-42001.gap` | `iso-42001` | ISO/IEC 42001 |

See [AEP-Components/wizard/README.md](../../AEP-Components/wizard/README.md) for LRP install and dock wiring.

## Validation

```bash
aep lint-policy AEP-Policy-System/reference/security.gap
aep lint-policy AEP-Policy-System/reference/network-egress-no-smtp.gap
aep lint-policy AEP-Policy-System/reference/deployment.gap
aep lint-policy AEP-Policy-System/reference/writing.gap
aep lint-policy AEP-Policy-System/reference/governance.gap
aep lint-policy AEP-Policy-System/reference/eu-ai-act.gap
```
