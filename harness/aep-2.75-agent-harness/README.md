# AEP 2.75 Agent Harness

Version 2.75 | June 2026
Author: thePM001
Licence: Apache 2.0
Repository: https://github.com/thePM001/AEP-agent-element-protocol

## What's New in 2.75

- CLI Power Tools: aep doctor, verify, lint-policy, red-team scan
- Reference Policy Lattice: baseline security, deployment, writing, governance policies
- MCP Security Gateway: tool poisoning, typosquatting, drift detection
- Merkle-Tree Audit: tamper-evident decision records with Merkle proofs
- Intercept Proxy: one-command MCP proxy with policy-based tool blocking
- Multi-Agent Collaboration: supervisor, debate and delegation patterns
- AEP-Graph Orchestration: stateful persistent cyclic workflows
- Multi-Language Policies: OPA Rego, Cedar and GAP formats via transpilers
- YAML Policy Importer: import external policy formats

## Boot Registration

Every AEP-compliant agent must register via the harness before any work:
```bash
nla-harness boot <agent_name> <type> <version>
```

## Capability Profiles

Agents operate under GAP-based capability profiles defining allowed paths, network endpoints, tools and limits. See `agent-control-extreme/profiles/` for reference profiles.

## Evaluation Chain

15-step evaluation pipeline with 11 scanners, trust rings, covenants and SHA-256 evidence ledger with Merkle proofs.

## Policy Lattice

All policies form a lattice with guaranteed composition. See `policies/reference/` for the baseline policy set.
