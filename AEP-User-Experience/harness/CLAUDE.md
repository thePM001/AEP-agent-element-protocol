# AEP 2.8 Agent Harness - Claude Code Governance Layer

## What This Is

This project enforces AEP (Agent Element Protocol) 2.8 governance on agent sessions. Every file edit, component creation and code generation is validated against the AEP registry, scene graph and theme. All runtime governance flows through the mandatory **AEP Base Node** local daemon.

AEP 2.8 adds: **Base Node** (four docking ports), **dynAEP Action Lattice**, **Lattice Channels**, **AgentMesh identity**, **Composer Lite** (port 8424), **setup agent**, **CAW Framework** (`aep-caw` Execution-Layer Security), **component registry**, **compliance LRP modules** and **conformance CC-01..CC-20**.

Inherited from 2.75e: AgentGateway, policy evaluation, evidence ledger, rollback, trust scoring, execution rings, covenants, scanners, Schema Builder, Policy Builder and economics engine.

Claude Code MUST read this file at the start of every session.

## Mandatory Pre-Edit Workflow

Before editing ANY file:

1. Run Base Node preflight: `node harness/aep-base-node-preflight.mjs`
2. Read `aep-scene.json`, `aep-registry.yaml`, `aep-theme.yaml` (if UI work)
3. Read `AEP-Base-Node/registry/catalog.json` when enabling protocol modules
4. After editing: `node harness/aep-validate.js`

## AEP 2.8 Base Node Rules

- Base Node is **mandatory** for all 2.8 installs. No remote server connection required.
- Docking ports: inference, validation, future, regulation under `AEP_SOCKET_BASE`
- LRPs register on the regulation dock. dynAEP events record on the validation dock.
- Activate via `setup-agent` or `docker exec <container> aep-setup-agent`
- Config: `~/.aep/base-node.json` or `/data/aep/base-node.json` in Docker
- CAW Framework: `aep-caw` for all shell exec when `caw_framework.enabled` in config (default true). Build: `cd AEP-Components/caw-framework && make build`

## Core AEP Rules (inherited 2.75e)

### Element Registration
- Every UI element MUST have `data-aep-id` matching `aep-registry.yaml` and `aep-scene.json`
- All colors from `aep-theme.yaml`. No hardcoded hex in components.

### AgentGateway and Evidence Ledger
- Mutations pass AgentGateway policy evaluation
- Actions append to `.claude/aep-evidence.jsonl` (append-only)

## Slash Commands

- `/aep-preflight` - Load registry and AgentGateway policy check
- `/aep-validate` - Post-edit validation
- `/aep-register` - Register new UI element
- `/aep-base-node` - Base Node health, docks and registry preflight

## Violation Severity

CRITICAL and HIGH violations MUST be fixed before commit. See 2.75e harness for full severity table.

## SAFETY RULES - IMMUTABLE

Enforced by `harness/aep-safety-guard.js`. AI agents MUST NOT disable sandbox, modify safety files, auto-commit without `.claude/auto-commit-approved` or exfiltrate data to undeclared endpoints.