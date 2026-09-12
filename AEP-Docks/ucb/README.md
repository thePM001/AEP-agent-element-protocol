# Universal Connect Bridge (UCB)

To attach a foreign wrap, start aep-ucb on port 8412 with UCB_API_KEY set. Send ingest, delegate, rollback, egress, compile-manifest or mcp only with that key. Health and capabilities stay public. Every ingest needs a task manifest.

## What UCB is

UCB is optional. Native AEP components talk to Base Node directly. UCB exists for operators who attach a non-AEP wrap with a stored or provided task manifest. Prime Agent and Polygres are not default compose services.

| UCB is | UCB is not |
|--------|------------|
| Optional attach gateway on NLA port 8412 | A second evaluator |
| Manifest gate at ingest | A synthesizer of contracts |
| DenyReport in kernel shape | A trust rank service |
| Capabilities ingest, delegate, health, rollback, egress, compile-manifest and mcp | A protocol member list of foreign frameworks |

## Perimeter

Default Predicate Profile is perimeter-v1. Content checks call the scanner pack and return a scanner id rather than four English phrases. Paper 005 VSA stays off unless the operator names profile paper005-vsa. That named profile is not a substitute for manifests, signatures and SSRF controls.

Ingest default body cap is 256 KiB, ingest hard cap is 2 MiB and egress default body cap is 1 MiB. Validate wait is 2 s, dock wait is 5 s, egress connect wait is 5 s and egress total wait is 15 s. The hash-chained journal rotates when it reaches 32 MiB.

## Service

| Property | Value |
|----------|-------|
| Binary | aep-ucb |
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

Every ingest needs a task manifest. Provide task_manifest on the ingest body, store a non-provisional manifest for that agent or compile provided GAP text or JSON with the local compiler. If none exist, ingest refuses with ManifestMissing. A provisional stored manifest refuses with ManifestProvisional. Trust fields on the body or the manifest refuse. Synthesis URLs are not a public source and dock-first send stays while the journal persists only after collect-all Admit allow. When collect-all Admit refuses, ingest reports ok false, admit rows are on the reply and the journal is not persisted. Enqueue with a digest and no event_id is not Admit.

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
