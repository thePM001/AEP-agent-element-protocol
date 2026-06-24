# AEP CAW Framework

**CAW (Containerized Agentic Workflows)** is AEP 2.8 Execution-Layer Security (ELS). It is a **core Base Node capability** (`caw-framework`, `default_enabled: true`) that enforces policy on shell, file, network, process, database wire and LLM traffic at runtime.

Forked from [agentsh](https://github.com/canyonroad/agentsh) under Apache 2.0. See [NOTICE](./NOTICE).

| Property | Value |
|----------|-------|
| Component ID | `caw-framework` |
| Kind | `daemon` |
| Binary | `aep-caw` |
| Shell shim | `aep-caw-shell-shim` |
| Go module | `github.com/nla-aep/aep-caw-framework` |
| Manifest | `AEP-Base-Node/registry/components/caw-framework.json` |
| Config (runtime) | `{AEP_DATA}/caw-framework/server-config.yaml` |
| Base Node block | `base-node.json` -> `caw_framework` |

---

## Architecture

```
User / coding agent
        |
        v
  aep-caw exec (ELS)     file, network, process, subprocess, DB wire, LLM proxy
        |
        v
  AEP Base Node          lattice channels, LRPs, EPSCOM, evidence ledger
        |
        v
  CCA + Composer         plan generation, topology, activation
```

**Two layers, one stack:** CAW governs what runs on the host. AEP governs protocol compliance and audit.

---

## CCA integration (mandatory for shell workloads)

CCA treats `caw-framework` as core:

| Stage | Behavior |
|-------|----------|
| **Default plan** | Enabled via `default_enabled: true` in catalog |
| **Intent rules** | Coding agents, CAW, shell enforcement intents auto-enable CAW + proxy + session + mcp-security |
| **LLM prompt** | `cca-prompt.mjs` instructs always enable CAW for coding agents |
| **Plan execute** | `plan-executor.mjs` writes `policy_sections.caw_framework` and `config.caw_framework` |
| **Lattice audit** | `CAW_HOST_DETECT` event on validation dock after `aep-caw detect` |
| **Pairs** | `cca.json` pairs_with includes caw-framework |

### CCA example intent

```bash
aep-cca plan --intent "3 coding agents with CAW shell enforcement and Postgres evidence"
aep-cca execute
```

Generated plan includes `caw-framework` in `components[]` and `caw_framework` policy block.

---

## Build and verify

### Dependencies (Linux)

```bash
apt-get install -y libseccomp-dev pkg-config protobuf-compiler
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
```

### Build

```bash
cd AEP-Components/caw-framework
export PATH="$(go env GOPATH)/bin:$PATH"
make proto    # regenerate pty protobuf (required after clone)
make build    # bin/aep-caw + bin/aep-caw-shell-shim
```

### Smoke test

```bash
./bin/aep-caw detect
SID=$(./bin/aep-caw session create --workspace . --json | jq -r .id)
./bin/aep-caw exec "$SID" -- echo "CAW OK"
```

---

## Operator quick start

```bash
export AEP_DATA=/data/aep
export AEP_CAW_BIN=$PWD/bin/aep-caw

# CCA activates CAW on plan execute; manual probe:
node -e "
import { probeCawHost } from './lib/caw-service.mjs';
console.log(await probeCawHost(process.env));
"

# Enforced session
SID=$(./bin/aep-caw session create --workspace . --json | jq -r .id)
./bin/aep-caw exec "$SID" -- ls -la
```

---

## AEP integration modules

| File | Role |
|------|------|
| `lib/lattice-bridge.mjs` | Resolve `aep-caw` binary, build `caw_framework` config, emit `CAW_AUDIT_EVENT` |
| `lib/caw-service.mjs` | Materialize server config, `probeCawHost()`, detached `startCawServer()` |

### Base Node config shape

```json
{
  "caw_framework": {
    "enabled": true,
    "binary": "/path/to/aep-caw",
    "config_path": "/data/aep/caw-framework/server-config.yaml",
    "policy_name": "default",
    "server_port": 18080,
    "shell_shim": true,
    "lattice_audit": true,
    "mode": "enforce"
  }
}
```

---

## Policy engine

Per-operation decisions: `allow`, `deny`, `approve`, `redirect`, `audit`, `soft_delete`.

| Domain | Examples |
|--------|----------|
| Files | read, write, delete, redirect outside workspace |
| Commands | block `rm`, redirect `curl` to audited wrapper |
| Network | DNS, TCP connect, HTTP service routing |
| Database | Postgres wire protocol per-statement policy |
| LLM | proxy with DLP redaction and usage tracking |
| MCP | tool whitelist, version pinning, cross-server exfil detection |

Default policy: `configs/policies/default.yaml`. Server config: `configs/server-config.yaml`.

---

## Agent rules (AGENTS.md)

When `caw-framework` is enabled in the active plan:

1. Run shell via `aep-caw exec $SID -- <cmd>`, never raw bash/zsh
2. Create session first: `aep-caw session create --workspace .`
3. Use JSON output for tooling: `aep-caw exec --output json --events summary`
4. CAW audit events flow to lattice as `CAW_AUDIT_EVENT`

See [AGENTS.md](./AGENTS.md) for copy-paste agent snippets.

---

## Testing

Conformance **CC-20**:

```bash
cd AEP-Components/conformance/harness
./node_modules/.bin/vitest run ../../../AEP-NOSHIP/tests/conformance/caw-framework.test.mjs
```

Includes: catalog registration, manifest capabilities, CCA plan wiring, binary resolve, config defaults, live `aep-caw detect` when binary built.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `aep-caw` panic on start | Corrupt protobuf descriptors | Run `make proto` then `make build` |
| `detect --json` fails | Flag does not exist | Use `probeCawHost()` or plain `aep-caw detect` |
| Binary not found | Not built | `make build`, set `AEP_CAW_BIN` |
| libseccomp missing | Build dep | `apt-get install libseccomp-dev` |
| Low protection score | Minimal seccomp mode | Expected in containers; use `aep-caw detect config` |
| CCA plan missing CAW | Intent without coding/CAW keywords | CAW still default_enabled; check catalog |

---

## Platform support

| Platform | Status |
|----------|--------|
| Linux | Full enforcement (recommended) |
| WSL2 | Full Linux-equivalent |
| macOS ESF+NE | Alpha |
| Windows native | WSL2 recommended; minifilter pending |

See `docs/platform-comparison.md` for details.

---

## Related

- [AGENTS.md](./AGENTS.md) - AI agent operating instructions
- [../cca/README.md](../cca/README.md) - CCA deployment planner
- [../cca/AGENTS.md](../cca/AGENTS.md) - CCA agent rules including CAW
- Upstream feature docs in `docs/` (renamed from agentsh)