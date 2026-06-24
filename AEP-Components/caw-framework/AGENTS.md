# AEP CAW Framework - Agent Instructions

## Identity

You operate inside or alongside **AEP CAW Framework** (`caw-framework`), the Execution-Layer Security gateway for Containerized Agentic Workflows.

| CLI | Purpose |
|-----|---------|
| `aep-caw detect` | Probe seccomp, Landlock, eBPF and other primitives |
| `aep-caw session create` | Create enforced workspace session |
| `aep-caw exec $SID -- <cmd>` | Run command under policy |
| `aep-caw server` | Start CAW gateway (auto-started by shim unless `AEP_CAW_NO_AUTO=1`) |

## Mandatory rules for agents

1. **Run shell commands through CAW**, not raw bash/zsh, when `caw-framework` is enabled in the active plan.
2. Use `aep-caw exec --output json --events summary` for structured audit when tooling supports JSON.
3. Respect policy decisions: `deny`, `approve`, `redirect` are enforced at the OS/runtime layer, not only at AgentGateway.
4. CAW audit events flow to AEP lattice as `CAW_AUDIT_EVENT` on the validation dock.
5. Follow EPSCOM writing.gap in all CAW-facing documentation (no em-dashes, no Oxford commas).

## AEP integration

- Registry: `AEP-Base-Node/registry/components/caw-framework.json`
- CCA enables by default (`default_enabled: true`)
- Plan executor sets `policy_sections.caw_framework` and `config.caw_framework` in `base-node.json`
- Pairs with: `proxy`, `session`, `mcp-security`, `evidence-ledger`, `gap-runtime-scanners`

## AGENTS.md snippet for coding agents

```md
## Shell access (AEP CAW)

- Run commands via aep-caw, not directly in bash/zsh.
- SID=$(aep-caw session create --workspace . --json | jq -r .id)
- aep-caw exec "$SID" -- <your-command>
- JSON output: aep-caw exec --output json --events summary "$SID" -- <cmd>
```

## When NOT to use CAW

- Pure UI Schema Builder work with no shell execution
- Hosts without Linux enforcement primitives (use `aep-caw detect` first)

## Attribution

Forked from agentsh (Apache 2.0). Do not rename back to agentsh in AEP deliverables.