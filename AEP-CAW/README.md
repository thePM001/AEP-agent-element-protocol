# AEP CAW Framework

**CAW (Containerized Agentic Workflows)** is AEP 2.8 Execution-Layer Security (ELS). It is the execution layer that this stack requires for coding agents and containerized agentic workflows: it enforces policy on shell, file, network, process, database wire and LLM traffic at runtime and it confines the host process that runs an agent command. The catalog ships the component default enabled, so a setup agent enables it for every coding agent plan. CAW is not a second evaluator because the walls belong to Base Node.

See [LICENSE](../LICENSE) for Apache 2.0 terms.

| Property | Value |
|----------|-------|
| Component ID | `caw-framework` |
| Kind | `daemon` |
| Binary | `aep-caw` |
| Shell adapter | `aep-caw-shell-adapter` |
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

**Two layers, one stack:** Base Node admits the envelope and keeps protocol compliance and the audit ledger, while CAW is the required execution layer that confines the command. A coding agent run needs both layers, because a wall pass on its own is not process governance and CAW is not optional in the shipped stack.

Every execution path probes the Base Node kernel dock before a command starts. The Base Node is the admission authority, so a host admission with a silent dock is not governance: CAW refuses the run and names the silent dock. See [Kernel dock gate](#kernel-dock-gate).

---

## CCA integration (mandatory for shell workloads)

CCA treats `caw-framework` as the required execution layer for coding agents and containerized agentic workflows. The setup agent prompt enables it for every coding agent plan, sets the enforce mode with the shell adapter and routes agent shell calls through `aep-caw exec` rather than a raw shell, so the readme and the setup agent describe one product:

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
cd AEP-CAW
export PATH="$(go env GOPATH)/bin:$PATH"
make proto    # regenerate pty protobuf (required after clone)
make build    # bin/aep-caw + bin/aep-caw-shell-adapter
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

## Kernel dock gate

The Base Node kernel publishes one Unix socket dock per port under the socket base and answers a newline delimited JSON ping with a pong. CAW runs the host workload, so every execution path checks that dock before a command starts. The check sits in the execution path itself rather than in a separate operator script, so a wrapped agent cannot run a command while the kernel that admits it is silent.

The check is on unless the config turns it off. It covers the plain exec, the streamed exec and the PTY start, so no entry point bypasses it.

| Setting | Default | Meaning |
|---------|---------|---------|
| `kernel_dock.enabled` | on | Refuse the run while the dock does not answer. Absent key means on. |
| `kernel_dock.socket_base` | resolved | Directory that holds the dock sockets. Empty means `AEP_SOCKET_BASE`, else `AEP_DATA/sockets`, else `$HOME/.aep/sockets`. |
| `kernel_dock.dock` | `validation_engine` | Dock the execution path probes. The validation dock carries the admission decision. |
| `kernel_dock.timeout` | `2s` | Dial and read deadline for one ping. |

### Refusal

A silent dock refuses the run with one named refusal on stderr and an HTTP 503 from the server:

```
aep-caw: kernel dock silent (rule=kernel-dock-silent dock=validation_engine socket=/data/aep/sockets/validation): dial unix /data/aep/sockets/validation: connect: no such file or directory
```

The refusal names the rule, the dock and the socket path, so the operator reads which dock stayed silent. The server also records a `kernel_dock_refused` event with the rule, the dock, the socket and the error text, so the refusal is part of the session evidence rather than only a line on a terminal.

```bash
# Stop the kernel dock and run a wrapped command: the command is refused.
aep-caw wrap -- bash -c 'echo hi'
# aep-caw: kernel dock silent (rule=kernel-dock-silent dock=validation_engine socket=...)
```

An operator who runs the conformance suite or the smoke script with no kernel at all sets `kernel_dock.enabled: false` in that run's config.

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
./node_modules/.bin/vitest run ../../../tests/conformance/caw-framework.test.mjs
```

Includes: catalog registration, manifest capabilities, CCA plan wiring, binary resolve, config defaults, live `aep-caw detect` when binary built.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `aep-caw` panic on start | Corrupt protobuf descriptors | Run `make proto` then `make build` |
| `kernel dock silent (rule=kernel-dock-silent)` | The Base Node kernel is not answering on its dock socket | Start the Base Node daemon (`aep-base-node --daemon`) or point `kernel_dock.socket_base` at the live socket directory |
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
- Feature docs in `docs/`
