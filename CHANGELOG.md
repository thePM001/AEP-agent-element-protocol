# Changelog

All notable changes to the Agent Element Protocol (AEP) will be documented in this file.

## [2.1.0] - 2026-04-24

### Added
- **Session Governance** -- managed session lifecycle with state tracking, statistics, escalation rules and session reports.
- **Policy Engine** -- YAML-based policy DSL controlling capabilities, scopes, limits, gates, forbidden patterns and rate limits per session.
- **AEP-aware policy capabilities** -- element_prefixes, z_bands and exclude_ids scoping for fine-grained AEP element governance.
- **Evidence Ledger** -- append-only JSONL audit trail with SHA-256 hash chaining and tamper detection.
- **Rollback and Compensation** -- reversible mutations with pre-mutation state backup and AEP scene graph restoration.
- **Agent Gateway** -- unified entry point combining policy evaluation, AEP structural validation and evidence recording.
- **MCP Proxy mode** -- transparent governance proxy for Claude Code, Cursor, Codex and any MCP-compatible agent.
- **Shell Proxy mode** -- policy-enforced command execution wrapper.
- **CLI commands** -- `aep init`, `aep proxy`, `aep exec`, `aep validate`, `aep report`.
- **Agent init generators** for Claude Code (CLAUDE.md + settings.json), Cursor (mcp.json + rules) and Codex (AGENTS.md).
- **Built-in policies** -- coding-agent, aep-builder, readonly-auditor, strict-production.
- **Ledger verification** -- cryptographic chain integrity checking with exact break-point reporting.
- **Session escalation rules** -- automatic pause or human check-in after configurable action counts, time intervals or denial thresholds.
- **Comprehensive test suite** -- 71 tests covering session governance, policy engine, evidence ledger, rollback, gateway and MCP proxy.

### Changed
- `aep_version` bumped from `"2.0"` to `"2.1"` in all config files.
- Validation flow extended -- policy evaluation runs BEFORE structural validation.
- Evidence ledger captures both policy decisions and AEP structural validation results.

### Unchanged
- Three-layer architecture (Structure, Behaviour, Skin).
- Z-band hierarchy and prefix convention.
- AOT and JIT validation logic.
- All existing Rego policies.
- Lattice Memory and Basic Resolver.
- All existing SDK files.
- Licence (Apache 2.0).

---

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
