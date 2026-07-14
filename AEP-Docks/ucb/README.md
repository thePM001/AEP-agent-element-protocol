# Universal Connect Bridge (UCB)

**UCB is a distinct AEP 2.8 component.** It is the secured perimeter for **foreign ingress** and **internet egress** only. Native AEP components continue to use `lattice-transport` directly against Base Node docks - UCB is not inserted into internal lattice hops.

- **Runtime:** Rust binary `aep-ucb` (`crate/`)
- **Registry:** `AEP-Base-Node/registry/components/ucb.json`
- **Paper:** [NLA Research Paper 005 - Universal Connect Bridge](https://github.com/thePM001/UCB-UniversalConnectBridge-research-paper-005)
- **Legacy MJS:** `server.mjs` + `lib/` deprecated (reference and unit-test imports only)

## What UCB is (and is not)

**UCB is optional.** Native AEP components use `lattice-transport` directly. UCB exists for operators who want to attach **non-AEP foreign stacks** (LangGraph, MCP, AutoGen, etc.) to the lattice with manifest-scoped ingress and egress. If you do not run UCB, foreign attachment is at your own risk.

| UCB **is** | UCB **is not** |
|------------|----------------|
| Optional secured HTTP/MCP dock on NLA port `8412` | Mandatory for internal AEP traffic |
| Foreign payload translation (phi) to DynAep lattice events | A replacement for Composer Lite (`:8424`) |
| Task manifest gate at ingress (caller-provided or configured synthesis) | A system that invents provisional contracts when you skip configuration |
| Manifest-scoped egress proxy with credential injection | A raw lattice socket endpoint for foreign stacks |
| Extend-Write diff journal with rollback | An unauthenticated open bridge |

## Architecture

```
Foreign stack (LangGraph, MCP, AutoGen, ...)
 |
 | HTTP / MCP JSON-RPC (API key auth)
 v
+------------------+
| aep-ucb (Rust) | :8412
+--------+---------+
 |
 +----+----+---------+----------+----------+
 | | | | |
 v v v v v
 validator bridge delegate egress diff-journal
 (P_R..P_P) (ingest) (LLM) (proxy) (rollback)
 | | | |
 +----+----+---------+----------+
 |
 v
 aep-lattice-log + Unix sockets (validation, inference, ...)
 |
 v
 AEP Base Node daemon + action-lattice.db
```

**Security invariants**

- `docking_port` allowlist: `validation_engine`, `inference_engine`, `future_features`, `regulation_module`
- Path traversal in `docking_port` rejected (`../`, `/`)
- Ingest/rollback are dock-first: lattice send succeeds before diff journal mutation
- Base Node enforces task manifests on docks when `AEP_DOCK_STRICT_IDENTITY=1`

## Service

| Property | Value |
|----------|-------|
| Binary | `aep-ucb` |
| Port | `8412` (`UCB_PORT`) |
| Host | `0.0.0.0` (`UCB_HOST`) |
| Base path | optional (`UCB_BASE_PATH`) |
| Health | `GET /health` or `GET /ucb/v1/health` |
| Capabilities | `GET /ucb/v1/capabilities` |

## HTTP API

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | No | Service + lattice dock health |
| `GET /ucb/v1/capabilities` | No | Protocols, operations, MCP tools |
| `POST /ucb/v1/ingest` | Yes | Validate, synthesize manifest, integrate |
| `POST /ucb/v1/delegate` | Yes | Lattice-gated LLM delegation |
| `POST /ucb/v1/rollback` | Yes | Roll back last N diff records |
| `GET /ucb/v1/diff` | Yes | List diff journal entries |
| `GET /ucb/v1/manifests/:agent_id` | Yes | Read synthesized task manifest |
| `POST/GET /ucb/v1/egress/*` | Yes | Manifest-scoped egress proxy |
| `POST /mcp` | Yes | MCP JSON-RPC bridge |

Protected endpoints accept `Authorization: Bearer <key>` or `X-UCB-API-Key: <key>`.

### Ingest

Four coherence predicates (Paper 005):

| Predicate | Checks |
|-----------|--------|
| **P_P** | Provenance (`source`, `protocol`, `session_id`) |
| **P_S** | Payload has structural content |
| **P_C** | No forbidden destructive patterns |
| **P_R** | Resonance / duplicate binding fingerprint threshold |

```bash
curl -s -H "Authorization: Bearer $UCB_API_KEY" \
 -H "Content-Type: application/json" \
 -d '{
 "protocol": "langgraph",
 "session_id": "sess-1",
 "payload": {
 "subject": "LangGraph",
 "predicate": "integrates_via",
 "object": "UCB"
 },
 "provenance": {
 "source": "langgraph",
 "protocol": "1.0",
 "session_id": "sess-1"
 }
 }' \
 http://127.0.0.1:8412/ucb/v1/ingest
```

### Task manifest at ingress (required, never auto-invented)

Every ingest needs a task manifest contract. UCB does **not** synthesize a fallback manifest when you skip configuration. Provide one of:

| Source | How |
|--------|-----|
| **Provided** | Include `task_manifest` on the ingest body (`synthesized_by: provided`) |
| **Stored** | Reuse a previously saved non-provisional manifest for `agent_id` |
| **Synthesis tier** | Configure one or more optional HTTP tiers below |

Optional synthesis tiers (strict priority, first success wins):

| Tier | Mechanism | Env var | Availability |
|------|-----------|---------|--------------|
| 1 | GAP constrained decoding | `UCB_GAP_ENGINE_URL` | NLA internal and licensed customers only |
| 2 | Other constrained decoding (e.g. dottxt-compatible) | `UCB_CONSTRAINED_DECODER_URL` | Customer-deployed decoder service |
| 3 | LLM structured output | `UCB_LLM_SYNTHESIS_URL` | Any OpenAI-compatible structured endpoint |

If no manifest source applies, ingest is **rejected**. That is intentional: attaching foreign agents without a contract is the operator's risk, not AEP's.

Tier-1 GAP synthesis is not bundled in the public OSS repo. Set `UCB_GAP_ENGINE_URL` to your production or licensed tier-1 endpoint.

Manifests written to `AEP_TASK_MANIFEST_DIR` (default `$AEP_DATA/ucb/manifests`). Base Node reads the same directory.

### Delegate

Audits on `inference_engine` dock, then calls the configured OpenAI-compatible endpoint (`inference-config.json` or env). Set `ingest_result: true` to lattice-integrate the model output (failed ingest surfaces as `ok: false`).

### Egress

Routes come from the agent task manifest `egress.routes`. Each route supports `access_rules`, `upstream` and `auth_token_env` (Bearer injection from environment). Upstream `Content-Type` is preserved. Pass agent id via `X-AEP-Agent-Id`.

### Rollback

`steps` must be an integer from 1 to 100. Emits `UCB_ROLLBACK` on the lattice; journal truncation happens only after lattice success.

## MCP tools

| Tool | Purpose |
|------|---------|
| `ucb_ingest` | Same as HTTP ingest |
| `ucb_delegate` | Same as HTTP delegate |
| `ucb_rollback` | Same as HTTP rollback |
| `ucb_health` | Health snapshot |

## Authentication

| Source | Resolution |
|--------|------------|
| `UCB_API_KEY` env | Used directly when set (**recommended for production**) |
| `$AEP_DATA/ucb-api-key.json` | Auto-generated on first boot (`0o600`, hash-only on disk) |

On first boot without `UCB_API_KEY`, `aep-ucb` prints a key preview to stderr. Capture it immediately or set `UCB_API_KEY` explicitly. The public capabilities endpoint never exposes key material.

## Directory layout

```
ucb/
 crate/ Rust implementation (canonical)
 src/
 main.rs Binary entry
 http.rs Axum router
 bridge.rs Ingest + rollback
 delegate.rs Lattice-gated LLM delegation
 egress.rs Manifest-scoped egress proxy
 manifest.rs Task manifest synthesis tiers
 ingress.rs P_P / P_S / P_C / P_R validation
 lattice.rs aep-lattice-log + Unix socket transport
 journal.rs Extend-Write JSONL diff journal
 auth.rs API key guard
 mcp.rs MCP JSON-RPC adapter
 server.mjs DEPRECATED legacy entry
 lib/ DEPRECATED MJS modules (validator tests import these)
 README.md
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `UCB_PORT` | `8412` | Listen port (NLA 84xx) |
| `UCB_HOST` | `0.0.0.0` | Bind address |
| `UCB_BASE_PATH` | _(empty)_ | Optional URL prefix |
| `UCB_API_KEY` | _(auto)_ | API key for protected endpoints |
| `UCB_GAP_ENGINE_URL` | _(unset)_ | Tier 1: NLA GAP constrained decoding engine (licensed) |
| `UCB_CONSTRAINED_DECODER_URL` | _(unset)_ | Tier 2: constrained decoder HTTP endpoint (e.g. dottxt-style) |
| `UCB_LLM_SYNTHESIS_URL` | _(unset)_ | Tier 3: LLM structured manifest synthesis |
| `UCB_EGRESS_STRICT` | `1` | Require manifest egress routes |
| `AEP_TASK_MANIFEST_DIR` | `$AEP_DATA/ucb/manifests` | Manifest store (UCB writes, Base Node reads) |
| `AEP_DOCK_STRICT_IDENTITY` | `0` | Base Node strict manifest enforcement |
| `AEP_DATA` | `/data/aep` | Data directory |
| `AEP_SOCKET_BASE` | `$AEP_DATA/sockets` | Base Node Unix sockets |
| `AEP_LATTICE_LOG_BIN` | `aep-lattice-log` | Lattice seal/record CLI |
| `AEP_LATTICE_STRICT` | `1` | Production lattice enforcement |
| `UCB` | `1` | Docker: set `0` to disable |

## Prerequisites

Running **AEP Base Node** daemon with docks open:

- `validation` (ingest/rollback)
- `inference` (delegate gateway audit)
- `future`, `regulation` (health probes)

## Build and run

```bash
# From repository root
cargo build --release -p aep-base-node -p aep-ucb
export AEP_LATTICE_LOG_BIN=$PWD/rust/target/release/aep-lattice-log

# Terminal 1: Base Node
./rust/target/release/aep-base-node --daemon --config ~/.aep/base-node.json

# Terminal 2: UCB
export UCB_API_KEY=your_key_here
./rust/target/release/aep-ucb
```

## Docker

UCB starts automatically (`UCB=1`, default):

```bash
docker compose -f docker-compose.public.yml up -d
# UCB: http://localhost:8412
```

Disable with `UCB=0`.

## Testing

```bash
# Rust unit tests
cargo test -p aep-ucb

# Full public conformance suite (includes UCB integration checks)
./AEP-Components/conformance/runner/run.sh

# E2E smoke (ephemeral port 8429)
./AEP-User-Experience/scripts/e2e-ucb-smoke.sh
```

## Supported foreign protocols

`langgraph`, `langchain`, `autogen`, `crewai`, `mcp`, `cursor`, `claude-code`, `codex`, `custom`, `http`

Unknown protocol strings normalize to `custom`.

## Related components

| Component | Port / transport | Role |
|-----------|------------------|------|
| Base Node | Unix sockets | Lattice dock host + manifest enforcement |
| lattice-transport | frames | Native inter-component wire format |
| Composer Lite | `:8424` | WASM visual canvas |
| Setup Agent | CLI | Inference config for delegate |

See also: [AEP-Base-Node/registry/components/ucb.json](../../AEP-Base-Node/registry/components/ucb.json), [AEP-Base-Node/registry/schemas/task-manifest-v1.json](../../AEP-Base-Node/registry/schemas/task-manifest-v1.json).