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
aep harness register <agent_name> <type> <version>
```

## Capability Profiles

Agents operate under GAP-based capability profiles defining allowed paths, network endpoints, tools and limits. See `agent-control-extreme/profiles/` for reference profiles.

## Evaluation Chain

15-step evaluation pipeline with 11 scanners, trust rings, covenants and SHA-256 evidence ledger with Merkle proofs.

## Policy Lattice

All policies form a lattice with guaranteed composition. See `policies/reference/` for the baseline policy set.

## Data Permission System

AEP 2.75 includes per-agent data access control. Agents are restricted by trust ring:

| Ring | Path Access | Network | Rate Limit | Max File |
|------|------------|---------|------------|----------|
| sandbox | /tmp only | localhost:8080 | 10/min | 1 MB |
| user | /tmp, /home, /var/www | localhost + internet | 60/min | 10 MB |
| system | /tmp, /home, /var, /opt, /etc | full local + internet | 300/min | 100 MB |
| enterprise | / (everything) | unrestricted | 1000/min | 1 GB |

Permissions are checked before every agent operation. Unknown actions are denied by default.
