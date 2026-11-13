# 02 / UCB

Status: normative. Stability: evolving. The HTTP interface and the manifest rule are tested and the perimeter profile still changes.

## What it is

The Universal Connect Bridge (UCB) is the secured docking port for systems outside AEP. An external agent framework, an MCP server or a custom HTTP agent hands its work to UCB. UCB checks the task manifest, the written contract of this agent, validates the content and sends the work to the Base Node as a sealed capsule. The external system never touches a dock socket.

## Place among the 18

UCB receives work from external systems and hands sealed capsules over the Lattice Channels (08) to the validation dock of the AEP Base Node (01). The Admit Gate (04) judges each capsule and UCB reports the answer to the caller. Task manifests are written in GAP (06). Identities come from AgentMesh (13).

## What ships in 2.9

- The service `aep-ucb` on port 8412 with key authentication for every route except health and capabilities.
- Ingest with a mandatory task manifest. A missing or provisional manifest refuses the ingest and UCB invents no contract.
- One validator process per ingest check, `aep-ucb-validate`, confined by a seccomp filter.
- Model delegation, rollback of the last journal record, an egress proxy bound to the manifest, a local manifest compiler and an MCP adapter.
- A hash chained journal.
- The page describes UCB as the foundation of the internal docking ports. In this tree the internal docks are Unix sockets inside the Base Node crate and components of the tree use them directly. UCB as the shared foundation of those docks is planned. UCB is optional and `UCB=0` turns it off.

## Layout

| Path | Role |
|------|------|
| `crate/` | The crate `aep-ucb` with the binaries `aep-ucb` and `aep-ucb-validate` |
| `perimeter-v1/` | The crate `aep-ucb-perimeter-v1`, the default content profile |
| `HISTORY.md` | The public attach record |
| `AEP-Base-Node/AEP-Docks/` | Dock specs and the list of regulated HTTP docks |
| `AEP-Base-Node/AEP-Docks/universal-connect/` | The Universal Connect Dock for optional module downloads through UCB |
| `AEP-Components/dock-line-reader/` | Source check on the dock line reader |
| `AEP-Components/dock-post-beat-collect/` | The collect of a result by capsule hash after the pulse |
| `AEP-Components/dock-request-poison/` | Source check: a poisoned lock answers and never aborts |
| `AEP-Components/egress-address/` | The shared address check for every outbound request |

## Interfaces

The sections Service, HTTP API, MCP, Authentication and Environment variables below list every route, tool, key source and variable.

To attach a foreign wrap, start aep-ucb on port 8412 with UCB_API_KEY set. Send ingest, delegate, rollback, egress, compile-manifest or mcp only with that key. Health and capabilities remain public and every ingest needs a task manifest.

## What UCB is

UCB is optional. Native AEP components talk to Base Node directly. UCB exists for operators who attach a non-AEP wrap with a stored or provided task manifest. Prime Agent and Polygres are not default compose services.

| UCB is | UCB is not |
|--------|------------|
| Optional attach gateway on port 8412 | A second evaluator |
| Manifest gate at ingest | A synthesizer of contracts |
| DenyReport in kernel shape | A trust rank service |
| Capabilities ingest, delegate, health, rollback, egress, compile-manifest and mcp | A protocol member list of foreign frameworks |

## Perimeter

Default Predicate Profile is perimeter-v1. Content checks call the scanner pack and return a scanner id rather than four English phrases. Paper 005 VSA remains off unless the operator names profile paper005-vsa. That named profile is not a substitute for manifests, signatures and SSRF controls.

Ingest default body cap is 256 KiB, ingest hard cap is 2 MiB and egress default body cap is 1 MiB. Validate wait is 2 s, dock wait is 5 s, egress connect wait is 5 s and egress total wait is 15 s. The hash-chained journal rotates when it reaches 32 MiB.

Every ingest check runs in its own aep-ucb-validate process, never inside aep-ucb. The validator confines itself with a seccomp filter before it reads the request. The filter allows reading the request, writing the result, memory management and exit. Any other system call kills the process, so a check cannot open files, reach the network or start processes. aep-ucb writes the request to the validator while it reads the result to the end and only then waits for the exit, so no request or result size can stall the pair. Two checks run at a time. A check that does not answer inside the validate wait is killed and the ingest is denied with validate timeout. A validator that is missing, fails or answers with an unreadable result denies the ingest with validate join refused. aep-ucb-validate must be installed beside aep-ucb.

## Service

| Property | Value |
|----------|-------|
| Binary | aep-ucb |
| Validator binary | aep-ucb-validate, installed beside aep-ucb |
| Port | 8412 (UCB_PORT) |
| Host | 127.0.0.1 (UCB_HOST) |
| Health | GET /health or GET /ucb/v1/health |
| Capabilities | GET /ucb/v1/capabilities |

## HTTP API

| Endpoint | Auth | Description |
|----------|------|-------------|
| GET /health | No | Service health |
| GET /ucb/v1/capabilities | No | ingest, delegate, health, rollback, egress, compile-manifest and mcp |
| POST /ucb/v1/ingest | Yes | Validate and attach a foreign wrap with a task manifest |
| POST /ucb/v1/delegate | Yes | Lattice-gated model delegation |
| POST /ucb/v1/rollback | Yes | Roll back the named tail journal record after Base Node ACK |
| POST /ucb/v1/egress | Yes | Manifest-scoped egress with an audit row and header isolation |
| POST /ucb/v1/compile-manifest | Yes | Compile provided GAP text or JSON with gap-manifest-v1 |
| POST /ucb/v1/mcp | Yes | JSON-RPC adapter for UCB tools |

Protected endpoints accept Authorization: Bearer KEY or X-UCB-API-Key: KEY. Operator key is UCB_API_KEY, foreign agents use per-agent keys from ucb-agent-keys.json and agent keys cannot rollback. Public UCB ships a local gap-manifest-v1 compiler and does not claim a restricted remote GAP engine.

### Ingest

Every ingest needs a task manifest. Provide task_manifest on the ingest body, store a non-provisional manifest for that agent or compile provided GAP text or JSON with the local compiler. If none exist, ingest refuses with ManifestMissing. A provisional stored manifest refuses with ManifestProvisional. Trust fields on the body or the manifest refuse. Synthesis URLs are not a public source and dock-first send remains while the journal persists only after collect-all Admit allow. When collect-all Admit refuses, ingest reports ok false, admit rows are on the reply and the journal is not persisted. Enqueue with a digest and no event_id is not Admit.

Session bind:

- SessionMissing when the frame has session_id and the manifest does not
- SessionRequired when the manifest binds session_id and the frame omitted it
- SessionMismatch when the two session_id values differ

### Delegate

Audits on the inference dock then calls the configured OpenAI-compatible endpoint. Set ingest_result true only when a task manifest already exists for that agent. Failed ingest surfaces as ok false with DenyReport fields.

### Rollback

Body field diff_ids must name exactly one tail journal record. A steps count is refused. Rollback of a non-tail id is refused until Base Node ACK of the tail. The journal is hash-chained.

### Egress

Egress writes an audit row, strips caller Authorization and connection headers and refuses credential inject on unsigned or provisional manifests. Response bytes follow the egress cap.

### Compile

POST /ucb/v1/compile-manifest compiles provided GAP text or JSON with the local gap-manifest-v1 compiler. Ingest also compiles provided GAP text when the body carries that source.

## MCP

MCP tools are ucb_ingest, ucb_delegate, ucb_rollback, ucb_health and ucb_compile_manifest, served by POST /ucb/v1/mcp as JSON-RPC behind the same auth as other protected endpoints, with mutating tools needing an authenticated key and malformed tool arguments refused. Rollback on MCP also requires exactly one named tail id.

## Authentication

| Source | Resolution |
|--------|------------|
| UCB_API_KEY env | Operator key when set |
| Hash store under AEP_DATA | No plaintext recovery file. Preview on first boot stderr |
| Per-agent keys under AEP_DATA | Agent keys cannot rollback |

On first boot without UCB_API_KEY, aep-ucb prints a key preview to stderr. Capture it immediately or set UCB_API_KEY explicitly. The public capabilities endpoint never exposes key material.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| UCB_PORT | 8412 | Listen port |
| UCB_HOST | 127.0.0.1 | Bind address |
| UCB_BASE_PATH | empty | Optional URL prefix |
| UCB_API_KEY | auto | Operator key for protected endpoints |
| AEP_TASK_MANIFEST_DIR | AEP_DATA/ucb/manifests | Manifest store |
| AEP_DATA | /data/aep | Data directory |
| AEP_SOCKET_BASE | AEP_DATA/sockets | Base Node Unix sockets |
| AEP_LATTICE_LOG_BIN | aep-lattice-log | Lattice seal and record CLI |
| UCB | 1 | Docker: set 0 to disable |

## Build and run

From the repository root build packages aep-base-node and aep-ucb in release. Point AEP_LATTICE_LOG_BIN at the built aep-lattice-log binary. Start Base Node then start aep-ucb with UCB_API_KEY set. Docker is the first operator path.

## Testing

Run cargo test for package aep-ucb.

## Foreign attach through UCB

UCB is **not** part of the mandatory AEP kernel path. It exists for one purpose: let operators **safely attach non-AEP systems** (LangGraph, MCP servers, AutoGen, CrewAI, custom HTTP agents, etc.) to an AEP hyperlattice without giving those stacks raw lattice socket access.

**If you do not need foreign attach, do not run UCB.** Native AEP components (CAW) use `lattice-transport` directly against Base Node docks. Skipping UCB is valid. Attaching foreign agents without UCB or without a task manifest is **at your own risk** - AEP will not invent a contract for you.

### What UCB does

| Capability | Description |
|------------|-------------|
| Ingress | Validate foreign payloads (P_P, P_S, P_C, P_R), translate to lattice events, seal to validation dock |
| Manifest gate | Require a real task manifest before integration |
| Egress | Manifest-scoped HTTP proxy with credential injection (`egress.routes`) |
| MCP bridge | `ucb_ingest`, `ucb_delegate`, `ucb_rollback`, `ucb_health` tools |
| Rollback | Extend-Write diff journal with lattice-gated rollback |

### What UCB does **not** do

| Anti-pattern | Why |
|--------------|-----|
| Replace `lattice-transport` for internal components | Internal lattice steps must not route through UCB |
| Auto-generate task manifests | **No hardcoded fallback.** No `provisional_fallback`. No silent provisional contracts |
| Force itself on every deployment | `UCB=0` in Docker; omit `aep-ucb` binary if unused |
| Substitute for CAW / GAP policy | Manifest is a contract gate, not a policy author |

### Task manifest required at ingest (refuse on miss)

Every `POST /ucb/v1/ingest` needs a manifest from **one** of these sources:

| Priority | Source | How |
|----------|--------|-----|
| 1 | **Provided** | Include `task_manifest` on the ingest JSON body (`synthesized_by: provided`) |
| 2 | **Stored** | Reuse a previously saved non-provisional manifest for `agent_id` in `AEP_TASK_MANIFEST_DIR` |
| 3 | **Synthesis tier** | Call an HTTP endpoint you configure (all tiers optional; unset = no auto-synthesis) |

If none apply, UCB returns **422 rejected** with an explicit error. This is intentional.

Optional synthesis tiers (strict priority, first success wins):

| Tier | Mechanism | Env var |
|------|-----------|---------|
| 1 | GAP constrained decoding | `UCB_GAP_ENGINE_URL` (endpoint you host yourself) |
| 2 | Other constrained decoding (e.g. dottxt-compatible) | `UCB_CONSTRAINED_DECODER_URL` |
| 3 | LLM structured output | `UCB_LLM_SYNTHESIS_URL` |

Tier 1 (GAP constrained decoding engine) is not shipped in the public OSS repo. Configure `UCB_GAP_ENGINE_URL` to your licensed or self-hosted tier-1 endpoint.

### Example: ingest with caller-provided manifest

```bash
curl -s -H "Authorization: Bearer $UCB_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "protocol": "langgraph",
    "session_id": "sess-1",
    "provenance": { "source": "langgraph", "protocol": "1.0", "session_id": "sess-1" },
    "payload": { "subject": "LangGraph", "predicate": "integrates_via", "object": "UCB" },
    "task_manifest": {
      "manifest_version": "1",
      "id": "tm-sess-1",
      "agent_id": "ucb-foreign-langgraph",
      "session_id": "sess-1",
      "intent": {
        "summary": "LangGraph integrates via UCB",
        "allowed_operations": ["ucb.ingest"]
      },
      "trust": { "tier": "standard", "max_trust_score": 500 },
      "provisional": false,
      "synthesized_by": "provided"
    }
  }' \
  http://$AEP_HOST:8412/ucb/v1/ingest
```

### Example: ingest **without** manifest (rejected)

```bash
# No task_manifest, no synthesis URLs configured -> 422
curl -s -H "Authorization: Bearer $UCB_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "protocol": "mcp",
    "session_id": "sess-1",
    "provenance": { "source": "mcp", "protocol": "1.0", "session_id": "sess-1" },
    "payload": { "x": 1 }
  }' \
  http://$AEP_HOST:8412/ucb/v1/ingest
# -> {"ok":false,"status":"rejected","error":"task manifest required: ..."}
```

### Disable UCB entirely

```bash
# Docker: foreign attach off, Base Node still runs
UCB=0 docker compose -f docker-compose.public.yml up -d

# Bare metal: do not start aep-ucb
```

Canonical implementation: [`AEP-Base-Node/AEP-Docks/ucb/README.md`](./README.md). GAP manifest template: [`AEP-Components/gap/policies/reference/task-manifest-v1.gap`](../../../AEP-Components/gap/policies/reference/task-manifest-v1.gap).

## Limits

- UCB is no second evaluator. The Admit Gate (04) in the Base Node (01) judges.
- UCB writes no policy and no manifest for an agent.
- Components of this tree do not route through UCB.

## Run and test

```bash
cargo build --release -p aep-base-node -p aep-ucb
cargo test -p aep-ucb -p aep-ucb-perimeter-v1
```

## Related documents

- `AEP-Base-Node/AEP-Docks/ucb/HISTORY.md` for the attach record
- `AEP-Base-Node/AEP-Docks/README.md` for all docks
- `AEP-User-Experience/docs/FOREIGN-ATTACH.md` and `AEP-User-Experience/docs/UCB-ATTACH-NOTES.md` for the attach guides
- `AEP-Components/gap/policies/reference/task-manifest-v1.gap` for the manifest template
