# AEP 2.8 Agent Harness

Version 2.8.0 | June 2026
Author: thePM001
Licence: Apache 2.0
Public repository: https://github.com/thePM001/AEP-agent-element-protocol

## What's New in 2.8

- **AEP Base Node** mandatory local daemon with four docking ports
- **dynAEP merged** into main repo (Action Lattice, PAD router)
- **Lattice Channels** PQEncryptedCapsule transport
- **AgentMesh** SPIFFE/DID identity on lattice frames
- **Composer Lite** WASM visual canvas on port 8424
- **Setup agent** post-install activation and inference registration
- **Component registry** offline catalog plus optional GitHub extension merge
- **Compliance LRP modules** EU AI Act, GDPR, SOC 2, HIPAA, NIST AI RMF, ISO 42001
- **Conformance runner** CC-01 through CC-12 public tier battery
- **Docker image** full offline protocol (no remote server required)

Inherited from 2.75e: 15-step evaluation chain, 11 scanners, evidence ledger, Schema Builder, Policy Builder, economics engine.

## Boot Registration

Every AEP 2.8 agent session must register before work:

```bash
# UI / registry validation
node harness/aep-validate.js

# Base Node and registry preflight
node ../aep-base-node-preflight.mjs

# Full activation (Docker or local)
node ../../AEP-Components/cca/setup-agent.mjs
# or: docker exec <container> aep-setup-agent
```

## Capability Profiles

Agents operate under GAP-based capability profiles. Authoritative source: `AEP-Components/gap/policies/reference/` (compile via `gap-compile.mjs`).

## Evaluation Chain

15-step evaluation pipeline with 11 scanners, trust rings, covenants and SHA-256 evidence ledger with Merkle proofs. Base Node records dynAEP events on the validation dock.

## Component Registry

Enable optional modules via setup-agent or Composer Lite `POST /api/registry/install`. Catalog: `AEP-Base-Node/registry/catalog.json`.

## Docker Quick Start

```bash
docker compose -f docker-compose.public.yml up -d
docker compose -f docker-compose.public.yml exec aep aep-setup-agent
open http://localhost:8424
```

## Scripts

| Script | Purpose |
|--------|---------|
| `harness/aep-validate.js` | UI element registry/scene/theme validation |
| `harness/aep-safety-guard.js` | Immutable safety rules |
| `harness/aep-economics.js` | Cost economics wiring |
| `../aep-base-node-preflight.mjs` | Base Node health, docks, registry |