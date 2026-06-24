# AEP Subprotocol Registry

Offline-first catalog of **domain subprotocols** (same pattern as `registry/` for components). Every subprotocol is implemented as a **Rust crate** under this folder. There is no `src/subprotocols/` and no `config/` UI bundle.

## Layout

| Path | Crate | Purpose |
|------|-------|---------|
| `catalog.json` | - | Index of bundled subprotocols |
| `lib/subprotocols.mjs` | - | Node loader (manifest paths, UI layer resolution) |
| `core/` | `aep-subprotocol-core` | Shared validation primitives |
| `ui/` | `aep-subprotocol-ui` | Scene + FCR + theme validation |
| `commerce/` | `aep-subprotocol-commerce` | Spend caps, cart, checkout validation |
| `mcp-security/` | `aep-subprotocol-mcp-security` | MCP tool allowlist, typosquat, schema drift |
| `workflows/` | `aep-subprotocol-workflows` | Workflow step + transition registry |
| `rest-api/` | `aep-subprotocol-rest-api` | HTTP endpoint registry |
| `events/` | `aep-subprotocol-events` | Pub/sub event registry |
| `iac/` | `aep-subprotocol-iac` | IaC resource registry |
| `coding-governance/` | `aep-subprotocol-coding-governance` | Intent, blast radius, SIEE, solidify (AI coding) |
| `cli/` | `aep-subprotocol` | CLI binary for all domains |

## The pattern

Every subprotocol follows the same architecture:

```
1. REGISTRY   - define valid operations, types, fields, constraints
2. VALIDATOR  - check every agent-proposed action against the registry
3. REJECTION  - return specific errors so the agent can self-correct
4. EXECUTION  - apply only validated actions
```

Registries are **stateless**. Execution state is passed in by the caller.

## Build

Workspace root is the **repository root** (`Cargo.toml` at repo root):

```bash
cargo build --release -p aep-subprotocol
cargo test -p aep-subprotocol-core -p aep-subprotocol-commerce
```

Docker image build includes `aep-subprotocol` (see root `Dockerfile`).

## CLI

```bash
aep-subprotocol ui
aep-subprotocol commerce --action add_to_cart --payload '{"item":{...},"cart":{...}}'
aep-subprotocol workflows --action create_task --payload '{"title":"x"}'
aep-subprotocol rest-api --method POST --path /api/tasks --body '{"title":"x"}'
aep-subprotocol events --event-id task.created --payload '{"task_id":"T-1","title":"x","created_by":"a1"}' --correlation-id c1
aep-subprotocol iac --kind Deployment --spec '{"metadata":{"name":"api"},"spec":{"replicas":2,"template":{}}}'
aep-subprotocol mcp --tool read_file --input '{"path":"/tmp/x"}'
```

All commands print JSON `ValidationResult` to stdout and exit `1` on failure.

## TypeScript gateway bridge

The TypeScript gateway (`AEP-SDKs/typescript/aep-protocol/src/gateway.ts`) invokes Rust subprotocols via `subprotocol-rust.ts`, which execs the `aep-subprotocol` binary. Set `AEP_SUBPROTOCOL_BIN` to override the binary path.

Policy schemas (e.g. commerce limits) remain in TypeScript (`AEP-Subprotocols/commerce/lib/types.ts`). Validation logic is Rust-only.

## dynAEP UI paths

`dynAEP/dynaep-config.yaml` points at:

```yaml
aep_sources:
  scene: "./AEP-Subprotocols/ui/aep-scene.json"
  registry: "./AEP-Subprotocols/ui/aep-registry.yaml"
  theme: "./AEP-Subprotocols/ui/aep-theme.yaml"
```

## Per-subprotocol docs

| Subprotocol | README |
|-------------|--------|
| UI | [ui/README.md](ui/README.md) |
| Commerce | [commerce/README.md](commerce/README.md) |
| MCP Security | [mcp-security/README.md](mcp-security/README.md) |
| Workflows | [workflows/README.md](workflows/README.md) |
| REST API | [rest-api/README.md](rest-api/README.md) |
| Events | [events/README.md](events/README.md) |
| IaC | [iac/README.md](iac/README.md) |

## Add a new subprotocol

1. Create `AEP-Subprotocols/<id>/` with `Cargo.toml`, `src/lib.rs`, `manifest.json`.
2. Add the crate to root `Cargo.toml` workspace `members`.
3. Add a subcommand to `AEP-Subprotocols/cli/src/main.rs`.
4. Register in `catalog.json`.
5. Add `README.md` in the subprotocol folder.