# AEP Policy System

This folder belongs to component 06 (GAP) and the README of the whole component is `AEP-Components/gap/README.md`. It contains the policy files of a deployment, the presets and the two builders. GAP is the one authoring form the Admit Gate (04) loads, so only the GAP files under `reference/` become live walls of the kernel.

## Policy files

| Path | Role |
|------|------|
| `reference/` | The reference policy lattice in GAP: writing, security, deployment, governance, budget, network egress, computed claims and the compliance modules for the EU AI Act, GDPR, HIPAA, ISO 42001, NIST AI RMF and SOC 2. These files load as live Admit walls |
| `*.gap` in this folder | Further GAP policies, for example `lattice-channel-mandatory.gap` and `public-plain-english.gap` |
| `*.policy.yaml` | Presets for the host layer: `strict-production`, `full-governance`, `coding-agent`, `multi-agent`, `content-safety`, `covenant-only`, `readonly-auditor`, `aep-builder` and `network-egress-no-smtp`. The Admit layer does not read them |
| `aep-policy.rego`, `aep-memory-policy.rego` | Rego files for the host layer. The Admit layer does not read them |

## Documents

| Path | Topic |
|------|-------|
| [`SETUP.md`](SETUP.md) | Quick setup of the policy lattice and of a live Admit GAP file |
| [`AUTHORING-FORM.md`](AUTHORING-FORM.md) | Which authoring form reaches the Admit layer and which program reads each form |
| [`reference/README.md`](reference/README.md) | The structure of the reference policy lattice |

## Builders

| Path | Role |
|------|------|
| [`policy-builder/`](policy-builder/README.md) | The Policy Builder: invariant detection from data, Rego rule generation, coverage tracking and impact projection |
| [`schema-builder/`](schema-builder/README.md) | The Schema Builder: schema creation and validation from data with MLE estimation, spectral analysis, permissiveness scoring and module detection. It is a study tool and the Docker image does not start it |

## Run and test

The crates of the Admit Gate load and test the reference files, so run these commands from the repository root:

```bash
cargo test -p aep-policy-system-admit -p aep-policy-leftover-skins -p aep-admit-writing-walls
```
