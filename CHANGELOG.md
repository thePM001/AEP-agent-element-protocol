# Changelog

All notable changes to the Agent Element Protocol (AEP) will be documented in this file.

## [2.0.0] - 2026-04-18

### Added
- **Lattice Memory** (`sdk/sdk-aep-memory.py`, `sdk/sdk-aep-memory.ts`) — append-only validation memory with vector similarity search, fast-path attractor matching, audit trail export, and two storage backends (InMemoryFabric, SQLiteFabric).
- **Basic Resolver** (`sdk/sdk-aep-resolver.py`, `sdk/sdk-aep-resolver.ts`) — stateless, read-only proposal router that maps agent proposals to the correct validator pipeline (ui, workflow, api, event, iac), collects constraints, and queries memory for fast-path hits.
- **Memory Rego policies** (`aep-memory-policy.rego`) — OPA/Rego rules for memory entry validation (result values, registered elements, zero-error accepted entries).
- **TLA+ specifications** (`docs/TLA+/AEP.tla`, `docs/TLA+/AEP_Memory.tla`) — standalone formal specs for core AEP invariants and memory-specific invariants including `MemoryDoesNotAffectDecision` and `MemoryAppendOnly`.
- **Documentation** — `docs/LATTICE-MEMORY.md` (architecture, API reference, storage backends), `docs/RESOLVER.md` (routing logic, registry integration, API reference), `docs/MIGRATION-v1-to-v2.md` (step-by-step migration guide).
- **Examples** — `examples/with-memory/demo.py` (memory recording, attractor search, fast-path), `examples/with-resolver/demo.py` (multi-domain routing, memory integration).
- **Test suite** — `tests/test_memory.py`, `tests/test_resolver.py`, `tests/test_protocols.py`, `tests/test_validator.py`.
- Optional `memory_key` field on scene elements for memory persistence association.
- Optional `memory_persistence` field on registry entries for validation history tracking.
- Four new reserved names: `AEP Lattice Memory`, `AEP Basic Resolver`, `AEP Hyper-Resolver`, `AEP Memory Fabric`.

### Changed
- `aep_version` bumped from `"1.1"` to `"2.0"` in `aep-scene.json`, `aep-registry.yaml`, `aep-theme.yaml`.

### Unchanged
- All existing SDK files (`sdk-aep-core.ts`, `sdk-aep-python.py`, `sdk-aep-protocols.py`, `sdk-aep-react.tsx`, `sdk-aep-vue.ts`) — fully preserved, no modifications.
- Existing Rego policies (`aep-policy.rego`) — unchanged and compatible.
- Three-layer architecture (Structure, Behaviour, Skin) — unchanged.
- Z-band hierarchy — unchanged.
- Element ID convention (`XX-NNNNN`) — unchanged.
- Apache 2.0 license — unchanged.

## [1.1.0] - 2026-04-16

### Added
- Four protocol extension registries (`sdk-aep-protocols.py`): WorkflowRegistry, APIRegistry, EventRegistry, IaCRegistry.
- Pre-built registries for task management, CRUD APIs, event-driven systems, Kubernetes resources.
- TypeScript SDK (`sdk-aep-core.ts`) with types, validators, style resolver.
- React integration (`sdk-aep-react.tsx`) and Vue integration (`sdk-aep-vue.ts`).
- Python SDK (`sdk-aep-python.py`) with AEPConfig loader and validators.
- OPA/Rego forbidden pattern policies (`aep-policy.rego`).
- Schema versioning (`aep_version`, `schema_revision`) in all config files.
- Template Nodes for dynamic element validation.
- TLA+ formal specification of AEP invariants (inline in README).
- License transition from MIT to Apache 2.0.

## [1.0.0] - 2026-04-01

### Added
- Initial AEP protocol specification.
- Three-layer architecture: Structure (`aep-scene.json`), Behaviour (`aep-registry.yaml`), Skin (`aep-theme.yaml`).
- Z-band hierarchy for deterministic z-index ordering.
- AEP prefix convention (`XX-NNNNN`).
- AOT and JIT validation modes.
