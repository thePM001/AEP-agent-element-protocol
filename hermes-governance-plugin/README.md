# Hermes Governance Plugin

Standalone Hermes plugin for policy enforcement on tool calls.
Zero external dependencies. No paid products. Fully configurable.

## What it does

Intercepts Hermes tool calls and enforces configurable policy checks before
execution. All checks are controlled via environment variables.

```
Hermes Agent decides: do something
        |
        v
Governance Plugin intercepts
        |
        v
Configurable policy checks (embedded)
   -> forbidden address bind ? BLOCK
   -> double-hyphens ? BLOCK
   -> secret leakage ? BLOCK
   -> etc.
        |
   PASS ? -> tool executes
   FAIL ? -> rejection injected, tool never runs
```

## Installation

```bash
git clone <this-repo>
cd agent-control-extreme/services/hermes-governance-plugin
bash install.sh
```

## Architecture

```
hermes_governance/
├── __init__.py          # Module exports
├── plugin.py            # Hermes plugin entry + monkey-patch dispatch
├── checks.py            # Configurable policy checks (embedded)
├── deploy_gate.py       # Deployment gate enforcement (configurable)
└── install.sh           # One-command install
```

## Configuration

All checks are configured via environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `POLICY_NETWORK_BIND` | `0\.0\.0\.0` | Forbidden bind addresses |
| `POLICY_GRAY_TEXT` | regex | Low-brightness color detection |
| `POLICY_DOUBLE_HYPHEN` | ` -- \|^-- \| --$` | Double-hyphen word separators |
| `POLICY_EM_DASH` | Unicode | Em-dash/en-dash detection |
| `POLICY_SECRETS` | regex | Secret/token patterns |
| `POLICY_DOMAIN_ALLOWLIST` | (empty) | Comma-separated allowed domains |
| `POLICY_LICENSE` | (empty) | Forbidden license pattern |
| `POLICY_RAW_IP` | regex | Raw IP URL detection |
| `POLICY_REQUIRED_SECTIONS` | WHAT,WHY,IMPACT,ROLLBACK,DURATION | Deploy prompt sections |
| `POLICY_FORBIDDEN_COMMANDS` | rm -rf,git push --force,DROP TABLE | Blocked commands |

## Optional: Deep Governance Addon

For advanced governance (regex scanners, proof chains, lattice evaluation),
install the paid addon separately. The base plugin remains fully functional
without it.
