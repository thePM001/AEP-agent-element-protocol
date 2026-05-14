# Hermes Governance Plugin

Standalone Hermes plugin that enforces NLA policy governance on every tool call.
Zero external dependencies. No GAP Runtime required. No paid products.

## What it does

Intercepts Hermes tool calls and enforces 8 local policy checks before execution.
GAP Runtime integration is a SEPARATE paid add-on (see gap-bridge addon).

```
Hermes Agent decides: do something
        │
        ▼
Governance Plugin intercepts
        │
        ▼
8 local policy checks (embedded)
   → double-hyphens? BLOCK
   → 0.0.0.0 bind? BLOCK
   → MIT license? BLOCK
   → etc.
        │
   PASS? → tool executes
   FAIL? → injected rejection, tool never runs
```

## Installation

```bash
git clone https://github.com/thePM001/AEP-agent-element-protocol.git
cd agent-control-extreme/services/hermes-governance-plugin
bash install.sh
```

## Architecture

```
hermes_governance/
├── __init__.py          # Module exports
├── plugin.py            # Hermes plugin entry + monkey-patch dispatch
├── checks.py            # 8 local policy checks (embedded, no GAP)
├── deploy_gate.py       # WHAT/WHY/IMPACT/ROLLBACK/DURATION enforcement
└── install.sh           # One-command install
```

## The 8 local checks

Built into the plugin. No network call. Sub-millisecond.

1. Network bind: no 0.0.0.0
2. Gray text: color below #F0F0F0
3. Double-hyphens: word separators forbidden
4. Em-dashes: U+2013/U+2014 forbidden
5. Secret leakage: API key patterns
6. Deployment domain: tasty/taskstar only
7. License: MIT blocked (Apache 2.0 only)
8. Raw IP URLs: domain names only

## Optional: GAP Bridge (paid addon)

The `gap-bridge` addon connects to GAP Runtime for deep governance:
15-step lattice, 11 regex scanners, Rego policies, proof chains.

Install separately:
```bash
hermes plugins install gap-bridge  # requires GAP Runtime license
```
