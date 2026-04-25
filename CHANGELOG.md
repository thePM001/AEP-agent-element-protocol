# Changelog

All notable changes to the Agent Element Protocol (AEP) will be documented in this file.

## [2.5.4] - 2026-04-25

### Added (Domain Scanners)
- **Prediction Scanner** (Scanner 8) -- validates prediction and forecast patterns against configurable bounds. Four rules: extreme percentage detection (default >100%), certainty language blocking, missing confidence qualifier flagging and excessive timeframe detection. Config: `max_percentage`, `max_horizon_days`, `require_confidence`, `block_certainty_language`. Disabled by default (opt-in via `scanners.prediction.enabled: true`).
- **Brand Scanner** (Scanner 9) -- checks generated content against brand guidelines. Five rules: required phrase enforcement, forbidden phrase detection (hard severity), tone keyword verification, competitor mention flagging and trademark suffix enforcement. Config: `required_phrases`, `forbidden_phrases`, `tone_keywords`, `competitors`, `trademarks`.
- **Regulatory Scanner** (Scanner 10) -- ensures required regulatory disclosures are present. Five built-in checks: ad disclosure, financial disclaimer, medical disclaimer, affiliate disclosure and age restriction notices. Supports custom disclosure rules via `custom_disclosures` array. Default severity: hard.
- **Temporal Scanner** (Scanner 11) -- enforces time-related constraints on agent output. Four rules: stale date reference detection (with "as of" qualifier support), excessive future horizon flagging, undated statistic detection and expired promotional content flagging. Supports ISO, Month DD YYYY, DD/MM/YYYY, quarter and month-year date formats. Config: `max_future_days`, `check_stale_references`, `check_undated_statistics`, `check_expired_content`, `reference_date`.
- **32 new tests** (8 per scanner) with zero regressions.

### Changed
- `ScannersConfig` extended with `prediction`, `brand`, `regulatory` and `temporal` config fields.
- `ScannersConfigSchema` (Zod) gains four new scanner config schemas (all default disabled).
- `createDefaultPipeline()` supports opt-in for all four domain scanners.
- CLI `aep scan` gains `--scanners` flag for filtering specific scanners by name.
- Scanner pipeline grows from 8 to 12 possible scanners (7 default-on + 5 opt-in).
- Public exports updated with four new scanner classes and config types.

### Unchanged
- Three-layer architecture (Structure, Behaviour, Skin).
- All existing scanners, policies and SDK files.
- Licence (Apache 2.0).

## [2.5.3] - 2026-04-25

### Added (Fleet Governance for Swarm AI)
- **Fleet Manager** -- aggregates governance across all active sessions. `FleetManager` provides `getStatus()` (agent summaries with trust, ring, drift, cost and action counts), `enforceFleetPolicy()` (detects violations: agent limit, cost exceeded, ring saturation, drift cluster), `registerAgent()`/`deregisterAgent()`, `pauseFleet()`/`resumeFleet()`/`killFleet()`. Configurable via `fleet` policy section with `max_agents`, `max_total_cost_per_hour`, `max_ring0_agents` and `drift_pause_threshold`.
- **Fleet API** -- REST-style method handlers for fleet governance. `FleetAPI` wraps `FleetManager` with `getStatus()`, `getAgents()`, `getAgent(id)`, `getAlerts()`, `pauseFleet()`, `resumeFleet()` and `killFleet(rollback?)`.
- **Spawn Governor** -- validates child agent spawning. `SpawnGovernor` ensures child agents inherit a subset of their parent covenant (child cannot permit parent-forbidden actions, child cannot skip parent requires), child ring is same or lower privilege (higher number), child trust starts at parent trust * 0.8. Fleet capacity check before spawn.
- **Message Scanner** -- scans inter-agent messages through the scanner pipeline. `MessageScanner` prevents poisoned instructions, PII leaks and injection attempts between agents. Hard findings block, soft findings flag.
- **Fleet CLI** -- `aep fleet status|agents|pause|resume|kill [--rollback]`.
- **Gateway integration** -- fleet manager wired on first session with `fleet.enabled: true`. Fleet capacity check runs before system session limit. Message scanner wired from scanner pipeline. Fleet accessors: `getFleetManager()`, `getFleetAPI()`, `getSpawnGovernor()`, `getMessageScanner()`.
- **22 new tests** covering FleetManager, FleetAPI, SpawnGovernor, MessageScanner and gateway integration.

### Changed
- `PolicySchema` extended with optional `fleet` config section via `FleetPolicySchema`.
- `AgentGateway` gains fleet fields and four accessor methods.
- CLI gains `fleet` command with five subcommands.
- `index.ts` exports all fleet types and classes.

### Unchanged
- Three-layer architecture (Structure, Behaviour, Skin).
- Z-band hierarchy and prefix convention.
- All existing scanners, policies and SDK files.
- Licence (Apache 2.0).

## [2.5.2] - 2026-04-25

### Added (AI Engineer Coverage -- Capabilities A-C)
- **Data Profiling Scanner** (Capability A) -- 7th optional scanner performing five statistical checks on tabular and structured data: null rate, duplicate rate, outlier detection (z-score), schema consistency and class imbalance. `DataProfileScanner` implements the `Scanner` interface, parses CSV and JSON array inputs, configurable thresholds. Disabled by default (opt-in via `scanners.profiler.enabled: true`). Policy gains `profiler` config in `scanners` section with `null_rate_threshold`, `duplicate_rate_threshold`, `outlier_stddev` and `imbalance_ratio` fields. CLI: `aep profile <file>`.
- **ML Metrics Evaluator** (Capability B) -- `MLMetrics` class with pure static methods computing four metric families: classification (accuracy, precision, recall, F1, confusion matrix), regression (MSE, RMSE, MAE, R2, MAPE), retrieval (precision@k, recall@k, MRR, NDCG) and generation (exact match, avg length, empty rate). `compositeScore()` averages available metric scores into a single 0-1 value. `ReliabilityIndex` gains optional `mlScore` field weighted into theta via `ML_RELIABILITY_WEIGHTS`. `EvalReport` gains optional `mlMetrics` field. CLI: `aep metrics <file>`.
- **Governed Fine-Tuning Workflow Template** (Capability C) -- six-phase workflow definition wrapping fine-tuning processes with governance: DATA_PREPARATION, DATA_VALIDATION, TRAINING_CONFIG, TRAINING_EXECUTION, EVALUATION, DEPLOYMENT. `createFineTuningWorkflow()` factory with configurable `onFail` strategy. Each phase specifies role, ring, entry conditions, exit criteria and rework limits. CLI: `aep workflow init fine-tuning`, `aep workflow start fine-tuning`.
- **36 new tests** (10 profiler, 15 metrics, 11 workflow) with zero regressions. Total: 698 tests.

### Changed
- `ScannersConfigSchema` extended with `profiler` config (default disabled).
- `ReliabilityIndex` gains optional `mlScore` field; `ReliabilityWeights` gains optional `ml` weight.
- `ML_RELIABILITY_WEIGHTS` constant redistributes weights when ML score is present (hard 0.25, recovery 0.15, drift 0.10, trust 0.15, scanner 0.15, ml 0.20).
- `ProofBundleBuilder.computeReliability()` accepts optional `mlScore` parameter and incorporates it into theta.
- `EvalReport` gains optional `mlMetrics` field for ML evaluation results.
- Scanner pipeline `createDefaultPipeline()` supports profiler opt-in.
- CLI gains `profile`, `metrics` and `workflow` commands.

### Unchanged
- Three-layer architecture (Structure, Behaviour, Skin).
- Z-band hierarchy and prefix convention.
- All existing scanners, policies and SDK files.
- Licence (Apache 2.0).

## [2.5.1] - 2026-04-25

### Added (Commerce Subprotocol)
- **Commerce Subprotocol** -- validates agentic commerce workflows: product discovery, cart management, checkout, payment negotiation, fulfillment tracking and post-purchase actions. `CommerceValidator` enforces configurable policies including merchant allow/blocklists, product category blocking, transaction amount limits, daily spend tracking, human gate thresholds and payment method restrictions. `SpendTracker` accumulates daily spend with JSONL persistence at `.aep/commerce/spend.jsonl`. `CommerceRegistry` manages merchant profiles with capabilities and payment handlers. Six new ledger entry types: `commerce:discover`, `commerce:cart_update`, `commerce:checkout`, `commerce:payment`, `commerce:fulfillment`, `commerce:return`. Policy gains `commerce` config section with `enabled`, `max_transaction_amount`, `allowed_currencies`, `allowed_merchants`, `blocked_merchants`, `blocked_product_categories`, `require_human_gate_above`, `allowed_payment_methods` and `max_daily_spend`. Commerce covenant rules follow existing DSL syntax (`permit commerce:discover; forbid commerce:checkout (total > 500) [hard]`). CLI: `aep commerce status|merchants|spend`.

### Changed
- `PolicySchema` extended with optional `commerce` config section via `CommercePolicySchema`.
- `LedgerEntryType` extended with six commerce-specific entry types.
- 19 new tests covering add-to-cart, checkout, payment negotiation, return validation, spend tracking, registry and covenant enforcement.

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

