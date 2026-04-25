# Changelog

All notable changes to the Agent Element Protocol (AEP) will be documented in this file.

## [2.5.0] - 2026-04-25

### Added (Capabilities 10-11)
- **Lattice-Governed Knowledge Base** (Capability 10) -- scanner-validated ingestion, covenant-scoped retrieval, anti-context-rot ordering and JSONL storage. `KnowledgeIngestor` splits content into chunks and runs each through the scanner pipeline: hard failures reject, soft failures flag, clean chunks validate. `GovernedRetriever` applies TF-IDF scoring, covenant scope filtering, double scanning and anti-context-rot ordering (most relevant chunks at positions 1 and N to counteract U-shaped LLM attention erosion). `KnowledgeBaseManager` provides create, ingestFile, ingestText, query, stats and list operations with `.aep/knowledge/<name>/chunks.jsonl` persistence. Four new ledger entry types: `knowledge:ingest`, `knowledge:reject`, `knowledge:flag`, `knowledge:retrieve`. Policy gains `knowledge` config section with `enabled`, `bases`, `chunk_size`, `max_retrieval_chunks`, `anti_context_rot` and `double_scan` fields.
- **Governed Model Gateway** (Capability 11) -- multi-provider LLM gateway with per-request governance. `GovernedModelGateway` routes requests through the full evaluation chain including scanner pipeline and budget tracking. Four provider adapters: `AnthropicAdapter`, `OpenAIAdapter`, `OllamaAdapter`, `CustomAdapter`. `ProviderRegistry` manages adapter registration and selection. Streaming support with governed chunks. Policy gains `model_gateway` config section. CLI: `aep call <prompt> --model <model> --provider <provider> --policy <file>`.
- **Content Scanner Pipeline** -- six scanners (PII, injection, secrets, jailbreak, toxicity, URLs) orchestrated by `ScannerPipeline`. Each scanner configurable with hard or soft severity. Hard findings reject immediately. Soft findings trigger the recovery engine for automatic retry. Policy gains `scanners` config section.
- **Recovery Engine** -- automatic retry for soft violations with configurable max attempts and cooldown. Violations from covenant evaluation or scanner pipeline are retried through a callback before final rejection.
- **Workflow Phases** -- sequential workflow execution with typed verdicts (advance, rework, skip, fail). `WorkflowExecutor` enforces phase ordering and rework limits. Policy gains `workflow` config section with template definitions.
- **OpenTelemetry Exporter** -- `AEPTelemetryExporter` converts session events to OTEL spans for observability integration. Policy gains `telemetry` config section.
- **Token and Cost Tracking** -- per-session token counting and cost recording with `ActionResult.tokens` and `ActionResult.cost` fields. Session reports include totalTokens, totalCost and costSaved.
- **Two new built-in policies** -- `full-governance` (all capabilities enabled, knowledge base, scanners, workflows, telemetry, tracking) and `content-safety` (all scanners at hard severity, knowledge base enabled, strict forbidden patterns).
- **New CLI commands** -- `kb create|ingest|query|list|stats`, `scan <text>|--file <file>`, `call <prompt>`.
- **627 tests** covering all capabilities with zero regressions.

### Changed
- Policy schema version bumped to `"2.5"` in all eight policy files.
- Evaluation chain extended from 13 to 15 steps: Step 13 (knowledge retrieval validation) and Step 14 (content scanner pipeline).
- `PolicySchema` extended with `scanners`, `recovery`, `workflow`, `telemetry`, `tracking`, `knowledge` and `model_gateway` config sections.
- `LedgerEntryType` extended with `knowledge:ingest`, `knowledge:reject`, `knowledge:flag`, `knowledge:retrieve`, `scanner:finding`, `recovery:attempt` and `recovery:success` entry types.
- `ProofBundle.version` updated from `"2.2"` to `"2.5"`.
- Agent harness renamed from `aep-2.2-agent-harness` to `aep-2.5-agent-harness` and updated with 15-step chain, knowledge base awareness, content scanner and model gateway sections.
- CLI version updated to 2.5.0.
- Package version bumped to 2.5.0.

### Unchanged
- Three-layer architecture (Structure, Behaviour, Skin).
- Z-band hierarchy and prefix convention.
- AOT and JIT validation logic.
- All existing Rego policies.
- Lattice Memory and Basic Resolver.
- All existing SDK files.
- Licence (Apache 2.0).

## [2.2.0] - 2026-04-24

### Added (Capabilities 15-16)
- **Proof Bundles** -- portable, signed verification artifacts that package an entire session into a single `.aep-proof.json` file. Contains bundle ID, agent identity, covenant spec, session report, Merkle root, ledger hash, trust score, execution ring, drift score and Ed25519 signature. `ProofBundleBuilder` builds and serializes bundles; `ProofBundleVerifier` verifies signature, identity, covenant, expiry, and optionally full ledger hash and Merkle root matching. New `bundle:created` ledger entry type. Policy gains `session.auto_bundle` and `session.bundle_on_terminate`. CLI: `aep bundle <session-id>`, `aep bundle verify <file> [--ledger <file>]`.
- **Governed Task Decomposition** -- subtask trees as first-class governed structures. `TaskDecompositionManager` creates root tasks, decomposes into children with scope intersection (child can NEVER widen parent scope), validates actions against task scope, enforces action budgets, max depth and max children. Completion gates with six criterion types (`all_children_complete`, `tests_pass`, `no_violations`, `trust_above`, `drift_below`, `custom`). Subtree cancellation. Gateway gains Step 0 (task scope check) before the existing 12-step chain, making it 13 steps total. Intent drift is measured against current task description. Proof bundles include task tree. Policy gains `decomposition` config section. New `task:create`, `task:decompose`, `task:complete`, `task:fail`, `task:cancel` ledger entry types. CLI: `aep tasks <session-id> [--tree]`.

### Added
- **Trust Scoring with Decay** -- continuous trust score (0-1000) with five tiers (untrusted, provisional, standard, trusted, privileged), time-based decay, configurable penalties and rewards.
- **Execution Rings** -- four-ring privilege model (Ring 0 kernel through Ring 3 sandbox) with seven capability flags per ring (read, create, update, delete, network, spawn sub-agents, modify core). Automatic demotion on trust drop.
- **Behavioural Covenants** -- agent-declared constraint DSL (`covenant Name { permit/forbid/require rules; }`) with parser, evaluator and compiler. Forbid overrides permit. Conditions support `in`, `matches` and comparison operators.
- **Agent Identity** -- unified Ed25519/RSA identity system with `AgentIdentityManager` for creation, verification, expiry checks and compact serialisation.
- **Cross-Agent Verification** -- `verifyCounterparty()` and `generateProof()` handshake protocol with `ProofBundle` exchange and configurable `CovenantRequirement` rules.
- **Merkle Proofs** -- per-entry verification with `MerkleTree` class supporting `getRoot()`, `generateProof()` and static `verifyProof()`. L:/R: prefixed proof paths.
- **Post-Quantum Ledger Signatures** -- ML-DSA-65 (FIPS 204) simulation via HMAC-SHA512 with `generateQuantumKeyPair()`, `quantumSign()` and `quantumVerify()`.
- **RFC 3161 Timestamps** -- `TimestampQueue` with async/batched non-blocking `enqueue()`, `flush()`, auto-flush interval and `getToken()` for offline fallback.
- **Kill Switch** -- `KillSwitch` class with `killAll()` and `killSession()` supporting optional rollback and trust reset to zero.
- **Intent Drift Detection** -- `IntentDriftDetector` with four heuristics (tool category, target scope, frequency anomaly, repetition), configurable warmup period and drift threshold. Actions: warn, gate, deny or kill.
- **OWASP Agentic AI Top 10 Mapping** -- every OWASP risk mapped to specific AEP 2.2 defence mechanisms. New `aep owasp` CLI command.
- **Offline Signing with Sync** -- `OfflineLedger` for air-gapped environments with `append()`, `getQueue()`, `clear()` and `verifyLocalChain()`.
- **Optimistic Concurrency** -- `_version` field on AEP elements with `validateAEPWithVersion()` for conflict-free multi-agent mutations.
- **Streaming Validation with Early Abort** -- `AEPStreamValidator` intercepts agent output chunk by chunk, aborting on first violation. Five checks: covenant forbids, protected elements, z-band violations, structural violations and policy forbidden patterns. `StreamMiddleware` wraps any `ReadableStream<string>`. Aborts logged as `stream:abort` evidence entries. Model-agnostic.
- **System-wide Rate Limiting** -- shared counter across all sessions with configurable `max_actions_per_minute` in system policy config.
- **Webhook Gate Type** -- `approval: "webhook"` in gate definitions with `webhook_url` and `timeout_ms` fields.
- **Audit Report Formats** -- `aep report --format json|csv|html` CLI command for evidence ledger export.
- **New CLI commands** -- `kill`, `trust`, `ring`, `drift`, `identity create`, `identity verify`, `covenant parse`, `covenant verify`, `owasp`, `describe`, `report --format`.
- **Two new built-in policies** -- `multi-agent` (cross-agent verification with Ring 0 access) and `covenant-only` (minimal policy with covenant enforcement).
- **230 tests** covering all new and existing capabilities with zero regressions.

### Changed
- Policy schema version bumped to `"2.2"` in all policy files.
- `PolicySchema` extended with optional `trust`, `ring`, `covenant`, `intent`, `identity`, `quantum`, `timestamp`, `system` and `streaming` config sections.
- `CapabilitySchema` gains optional `min_trust_tier` field for trust-gated capabilities.
- `GateSchema` gains optional `webhook_url` and `timeout_ms` fields.
- `Verdict` type gains optional `trustDelta` field.
- `PolicyEvaluator` now runs a 12-step evaluation chain (session state, ring capability, system rate limit, per-session rate limit, intent drift, escalation, covenant, forbidden patterns, capability + trust tier, budget/limits, gates, cross-agent verification).
- `AgentGateway` manages per-session trust managers, ring managers, intent detectors and covenant evaluators. Automatic ring demotion on denial.
- `SessionManager` gains `maxConcurrentSessions`, `setMaxConcurrentSessions()` and `getActiveCount()`.
- CLI version updated to 2.2.0 with default policy version 2.2.
- Agent harness renamed from `aep-2.1-agent-harness` to `aep-2.2-agent-harness`.
- Package version bumped to 2.2.0.

### Unchanged
- Three-layer architecture (Structure, Behaviour, Skin).
- Z-band hierarchy and prefix convention.
- AOT and JIT validation logic.
- All existing Rego policies.
- Lattice Memory and Basic Resolver.
- All existing SDK files.
- Licence (Apache 2.0).

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

