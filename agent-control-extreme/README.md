# Agent Control Extreme - Standalone Reference Implementation

A COMPLETE, SELF-CONTAINED production control hub for zero-trust agent governance.
Works with nothing but Bash + curl + Git. GAP Runtime is optional enhancement,
never required.

## Philosophy

```
Agent Control Extreme is the operational control plane.
GAP Runtime is the governance kernel (Rust, 15-step lattice).
They are INDEPENDENT. Extreme works without GAP. GAP deepens governance.
```

This folder contains everything needed for agent governance OUTSIDE the GAP
Rust Runtime: bootstrapping, session management, policy enforcement (local),
deployment gating, validation, and observability hooks.

GAP is the brain (policy engine, scanners, proof chains). Extreme is the body
(session registry, boot flow, deployment gate, operational tooling).

## What This Contains

```
agent-control-extreme/
├── README.md                       # This file
├── bootstrap/
│   ├── agent-bootstrap.sh          # Boot script with locking + backoff
│   ├── agent-harness.sh            # Master harness (CORE commands)
│   └── agent-validate.sh           # Validation runner
├── policies/ (symlink to ../agent-control-hub/policies)
│   └── *.policy                    # Shared policies
├── registry/                       # Session + component registries
│   ├── component-registry.md
│   └── agent-sessions.json
├── config/
│   ├── control-hub.env             # Environment template
│   └── deploy-checks.sh            # Deployment gate (WHAT/WHY/IMPACT/ROLLBACK/DURATION)
└── services/
    ├── docker-compose.yml          # Full stack with optional GAP
    └── gap-hermes-integration.md   # How GAP can enhance governance (reference doc)
```

## Core Commands (Zero Dependencies)

Every command works with just Bash + curl + Git API:

```
nla-harness boot <name> <type> <ver>       Register session (MUST run first)
nla-harness register --kind <t> --id <n>   Register component
nla-harness validate --path <dir>          Run validation checks
nla-harness policies --severity critical    List policies by severity
nla-harness check-policies --text "..."     Local policy compliance scan
nla-harness deploy-check --url ... --file . Run deployment approval gate
nla-harness status                          Show hub status
```

## Optional GAP Commands

These require `gap-server` running on port 3200. All core commands still
work without them:

```
nla-harness gap-scan --text "..." --scanners pii,injection    Deep 11-scanner analysis
nla-harness gap-execute --yaml file.gap --input '{}'          Governed instruction execution
nla-harness gap-status                                        GAP health check
```

## Improvements Over agent-control-hub

### 1. Concurrency Safety
Exponential backoff with advisory Git lock file. Two simultaneous boots
cannot race on agent-sessions.json. Configurable retry count and backoff.

### 2. Token Security
`CONTROL_HUB_TOKEN` via environment only. Never passed as CLI argument.
Never visible in `ps` output. Optional: secrets manager sidecar support.

### 3. Proper CLI Parsing
Full `getopts` with `--kind`, `--id`, `--desc`, `--path`, `--severity`,
`--text`, `--file` flags. Consistent error codes. Structured JSON logging.

### 4. Dedicated Validation
`agent-validate.sh` replaces inline Python one-liner. Supports marker
checks, ShellCheck integration, trailing-whitespace detection, and
configurable extension filters.

### 5. Local Policy Enforcement
`check-policies` command runs 7 local policy checks without GAP:
- Network bind (no 0.0.0.0)
- Gray text prohibition
- Em-dash prohibition
- Secret leakage
- Deployment domain allowlist
- License enforcement (Apache 2.0 only)
- Raw IP URL prohibition

### 6. Deployment Gate
`deploy-checks.sh` enforces the full deployment policy:
- Domain allowlist (tasty/taskstar only)
- WHAT + WHY + IMPACT + ROLLBACK + DURATION prompt structure
- Raw command chain rejection
- Explicit human approval
- Audit logging to `/var/log/agent-control/deployments.log`

### 7. Containerization
`docker-compose.yml` with gap-server, PostgreSQL (optional), Prometheus,
and Grafana (optional). Control hub volume-mounts to Git repo.

## Quick Start

```bash
# Export your token
export CONTROL_HUB_TOKEN="your-gitea-token"

# Set hub URL (default: http://100.118.184.18:3003)
export CONTROL_HUB_URL="http://your-gitea:3003"

# Install
sudo cp bootstrap/agent-harness.sh /usr/local/bin/nla-harness
sudo cp bootstrap/agent-bootstrap.sh /usr/local/bin/nla-agent-boot
sudo cp bootstrap/agent-validate.sh /usr/local/bin/nla-validate
sudo cp config/deploy-checks.sh /usr/local/bin/nla-deploy-check
sudo chmod +x /usr/local/bin/nla-harness /usr/local/bin/nla-agent-boot

# Test
nla-harness status
nla-harness policies
nla-harness check-policies --text "test output: no violations here"
```

## How Agents Use This

Every agent, on every spawn, runs:

```bash
nla-harness boot mypm+ cli 2.0
```

This single command:
1. Authenticates with the control hub
2. Acquires a concurrency lock
3. Registers the agent session with identity and heartbeat data
4. Returns "AGENT AUTHORIZED" or fails

If boot fails, the agent cannot work. There is no bypass.

## GAP Integration

GAP Runtime adds deep governance (15-step lattice, 11 regex scanners, Rego
policies, proof chains). When installed, the harness auto-detects it and
exposes `gap-scan`, `gap-execute`, `gap-status` commands.

Installing GAP does NOT disable any core command. The harness always works
standalone. GAP is enhancement, not requirement.

See `services/gap-hermes-integration.md` for the full integration spec.

## Differences from agent-control-hub

| Feature | agent-control-hub | agent-control-extreme |
|---------|-------------------|-----------------------|
| Token handling | CLI argument | Environment only |
| Concurrency | Race condition on JSON | Lock + backoff |
| CLI parsing | Positional | getopts with flags |
| Validation | Inline Python one-liner | Dedicated script |
| Policy scanning | None | Local 7-check engine |
| Deployment gate | Text policy only | Enforcement script |
| Logging | stdout | Structured JSON |
| Containerization | None | docker-compose.yml |
| GAP integration | None | Optional enhancement |

## License

Apache 2.0

Copyright 2026 New Lisbon Agency

Licensed under the Apache License, Version 2.0.
