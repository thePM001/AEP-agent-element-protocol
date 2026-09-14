# Changelog

## 2026-09-12 - Changelog catalog established

This project now keeps CHANGELOG.md at the repository root.
A dated entry that names the ticket id is required before that ticket can close.
Write DENY on miss. Policy nla-server-aep-ticket-close-changelog-mandatory.

## [2.8.6] - 2026-09-13 - CTRL-288-P9

Rename the agent control extreme tree to agent control hub. The Base Node folder carried a retired tone in its name while the component row and the mount profile role called the component the Agent Control Hub, so every reader had to translate the path. The folder is now AEP-Base-Node/agent-control-hub with its three files kept byte for byte, the docker ignore entry, the Base Node component row and the three root readme references name the new path and the old path is gone from the tree. The rename landed as one commit on main. This entry was restored after a later changelog write dropped it.

## [2.8.6] - 2026-09-13 - CTRL-288-P7

Say plainly what the multi base node is: an optional experimental surface. The tree presented the 2.8b federation mode as a shipped kernel component, with a readme section, a registry row and an artifact list that called every file shipped, while the default build compiles the single base node kernel only and nothing in the tree depends on the federation crate. The operator ruled that the mode is optional and experimental, so the readme files, the workspace manifest, the registry row and the artifact list now say so: the default is the single base node, the federation crate is built on purpose and no default run uses it. This entry was restored after a later changelog write dropped it.

## [2.8.6] - 2026-09-13 - CTRL-288-P5

Remove the retired upstream product name from the public ticket files. The public tree carried two copies of the CAW origin strip record and both still named the product that the 2.8.6 tree retired, so a reader could read the old lineage from a shipped record. The record text was rewritten so it describes the rename without the retired name and the internal dev ticket lane then left the public tree in a later commit, which is the stronger form of the same fix. The public tree returns zero hits for the retired product name. This entry was restored after a later changelog write dropped it.

## [2.8.6] - 2026-09-13 - CTRL-288-P6

Align the CAW readme with a stack where CAW is mandatory. The CAW readme called CAW an execution companion and said it is not a protocol component, while the setup agent makes CAW the required execution layer for coding agents, so the two documents described different products. The CAW readme now states the required execution layer role and the layers line names Base Node for the envelope and CAW for the confinement of the command. The setup agent readme carries the same role statement, so the readme and the setup agent prompt tell one story.

## [2.8.6] - 2026-09-13 - CTRL-288-P4

State the isolation rule in the wrap documents. The wrap readme, the operator note and the compiled note did not say that isolation lives in CAW, so a reader could take a passed wall as proof that the run was governed even when no CAW session wrapped the command. The three documents now carry the isolation sentence, they name CAW as the layer that confines the host process and they say that a wall pass is not execution confinement. The operator note later moved into the internal area and its text was folded into the public secure deployment guide. The isolation rule survives in both places. This entry was restored after a later changelog write dropped it.

## [2.8.6] - 2026-09-13 - CTRL-288-P2

Make the CAW execution path refuse a run while the Base Node kernel dock stays silent. Nothing in the CAW tree probed the kernel, so a host admission could proceed with no live kernel behind it while the preflight stayed in a separate operator script. The plain exec, the streamed exec and the PTY start now probe the configured dock and refuse the run with the named rule kernel-dock-silent, the server records a kernel_dock_refused event so the refusal is part of the evidence, a new internal/kerneldock package owns the probe, the server config gains the kernel_dock block whose default refuses and the README and the smoke script document and verify the refusal. This entry was restored after a later changelog write dropped it.

## [2.8.6] - 2026-09-13 - CTRL-288-P3

Publish one end to end run through every layer. A new operator example under AEP-User-Experience runs one command that walks the CAW session, the sealed capsule, the pulse, collect all, apply, the CAW exec, the dock attach and the ledger row twice: the refuse path first and the pass path second, with the transcript committed beside the note. Walking the layers in one run exposed five seams and each one is fixed in the same pass. The minimal wrap example kept path dependencies from its old home so it builds and runs again. The dock gateway had no way to name the lattice action path or the scene of a foreign attach so every sealed event refused at the dock Admit so the ingest body now carries action_path and target_id. The sealed stamp was truncated to the second and closed the 50 ms temporal wall for most of every second so the kernel now stamps the seal in milliseconds and freezes the kernel clock at that stamp. The shipped reference policies named an agent in the action slot of the permission field, which left a wildcard agent and closed the profile permission wall for every real action so the eleven reference documents now carry named grants in the object form. The dock line reader reported a clean end of stream as an oversized line, which wrote a false side channel row into the ledger on every closed connection so the kernel dock serve now probes the stream on that signal and a closed connection is no longer an anomaly while a line past the cap still is. The reader crate file itself stays untouched because a creation pad decode digest in it holds the banned digit pair and the write gate refuses that file in every direction.

## [2.8.6] - 2026-09-13 - Who may field rename and attach surface

Finish the who may field rename across the public tree. The kernel reads the field name agent_permission while the documents, the schemas and the shipped reference policies still used the old name, so a builder who followed the library docs wrote a field the kernel does not read. Every public document, schema and reference policy now carries the single field name, the reference policies grant named agents instead of a wildcard, the tree gains one public API document that matches the kernel facade and the permissions component ships a crate rather than a pointer file.

## [2.8.6] - 2026-09-13 - Public conformance workflow removed

Remove the public conformance workflow from the public tree, because the operator judged it to carry no value for the repository. The workflow file and its folder are gone, the target document no longer ties the conformance gate to CI and the suite stays available to run by hand. The removal landed as one commit on main.

## [2.8.6] - 2026-09-13 - Minimal wrap example home

Move the minimal wrap example from the root examples folder into AEP-User-Experience, because the example is operator facing and AEP-User-Experience is the operator UX home. The crate keeps its own manifest and lock file, the read path in the operator note and the named path list now point at the new home and the old folder is gone. The move landed as one commit on main.

## [2.8.6] - 2026-09-13 - WASM sandbox home

Move the WASM sandbox under the Composer Lite canvas, because the canvas is its only caller: the canvas offers a WASM Policy node, the composer route for wasm evaluate forwards to the sandbox socket and the composer library builds the sealed frame. The crate dependencies and the twelve path references were updated in the same commit and the workspace check passes.

## [2.8.6] - 2026-09-13 - NOSHIP-286-P7 rename follow up

Rename AEP-CCA to AEP-CCA-Central-Setup-Agent at the repository root. The old directory name answers 404 and the path form was rewritten in the twenty five files that named it. The rename landed as one commit on main.

## [2.8.6] - 2026-09-13 - NOSHIP-286-P7

Promote the CCA central setup agent to AEP-CCA at the repository root. The component moved out of the components folder, the path form was rewritten in every file that named it and the old path is gone. The move landed as one commit on main.

## [2.8.6] - 2026-09-13 - NOSHIP-286-P6

Promote the CAW framework to AEP-CAW at the repository root. The component moved out of the components folder, the path form was rewritten in every file that named it and the old path is gone. The move landed as one commit on main.

## [2.8.6] - 2026-09-13 - NOSHIP-286-P4

Build proof and CI for the public tree. The workspace now builds after the standalone dynAEP engine surface was implemented, the conformance suite runs green at twelve checks, a conformance workflow builds the tree and runs the suite on push and pull request, the numeric memory and latency targets moved to the internal target file and the wrap example now seals its payload, reports the pulse, collects every wall and prints a deny report on a denied path.

## [2.8.6] - 2026-09-13 - NOSHIP-286-P0

Remove every upstream product indicator from the public tree. The framework notice file and the framework licence file that carried the upstream copyright line are deleted, the upstream manual set under the framework docs directory is deleted, the demo scripts and recordings are renamed, the demo walkthrough and recording text is scrubbed and the one shipped dev note is scrubbed. The ticket closes on the receipt under internal-export-area.

## [2.8.5] - 2026-09-12 - UCB-285-P0

Ship UCB Predicate Profile perimeter-v1 as the default crate. Live aep-ucb parses Predicate Profile perimeter-v1 by default and keeps Paper 005 VSA off unless named.

## [2.8.5] - 2026-09-12 - UCB-285-P1

Wire aep-ucb P_C through the AEP scanner pack. Ingest content checks call the scanner pack and a secrets payload returns P_C with scanner Secrets.

## [2.8.5] - 2026-09-12 - UCB-285-P2

Bound UCB ingest and egress body size plus timeouts. Ingest uses a 256 KiB default cap and a 2 MiB hard cap with dock timeout 5s and a journal byte cap.

## [2.8.5] - 2026-09-12 - UCB-285-P3

Replace the one shared UCB API key with per-agent keys. Operator key remains UCB_API_KEY and agent keys cannot rollback while the plaintext recovery file is no longer written.

## [2.8.5] - 2026-09-12 - UCB-285-P4

Sign task manifests. Provisional cannot egress. Stored manifests carry a digest and a signature and unsigned or provisional objects cannot enable egress.

## [2.8.5] - 2026-09-12 - UCB-285-P5

Hash-chain the UCB journal and rollback by named diff ids. The journal is hash-chained and rollback of a non-tail diff id is refused until Base Node ACK of the tail.

## [2.8.5] - 2026-09-12 - UCB-285-P6

Ship a public local GAP TaskManifestV1 compiler or stop advertising tier 1. Public capabilities name a local gap-manifest-v1 compiler and no longer claim a licensed-only remote GAP engine.

## [2.8.5] - 2026-09-12 - UCB-285-P7

Ingest ACK waits for collect-all Admit allow. Dock-first send stays and the journal persists only after collect-all Admit allow with admit rows on the ingest reply.

## [2.8.5] - 2026-09-12 - UCB-285-P8

Egress audit row plus header isolation plus response cap. Egress writes an audit row, strips caller Authorization and connection headers and refuses credential inject on unsigned provisional manifests.

## [2.8.5] - 2026-09-12 - UCB-285-P9

Optional Paper 005 VSA profile after the dock is boring. Named profile paper005-vsa stays off in default tests and is not a substitute for manifests, signatures and SSRF controls.

All notable changes to the Agent Element Protocol (AEP) will be documented in this file.

## [2.8.x] - 2026-07-21 (21.07.2026) - intermittent / August patch track

> **Patch track note:** Standard policy enhancement for the AEP **2.8** line.
> Added **2026-07-21** (display **21.07.2026**) as part of intermittent 2.8 updates
> leading into the **August 2026** patch package, before **AEP 2.9** (planned September).

### Added (security / network egress)
- **`AEP-Policy-System/reference/network-egress-no-smtp.gap`** - reference lattice policy forbidding SMTP and message-submission TCP ports **25, 465 and the submission port**, plus common mail transport libraries and `smtp://` schemes
- **`AEP-Policy-System/network-egress-no-smtp.policy.yaml`** - operator-facing policy bundle (hard severity, `control_family: network_egress`)
- Lattice mandatory rules: `no-smtp-outbound-ports`, `no-smtp-mail-transport-libraries` in `lattice-channel-mandatory.gap`
- Operator note: host OUTPUT drop for the submission port family recommended on multi-tenant agent hosts
- Docs: control family splits **network egress** (live TCP) from **artifact placement** (policy/code publish paths)

### Clarifications
- CRM HTTPS task types labeled EMAIL are not SMTP
- `mailto:` browser handoff is not server-side SMTP
- No product terms from private platform stacks; this is pure AEP 2.8 public policy lattice material

## [2.8.0] - 2026-06-23

### Changed (dynAEP / SDK layout)
- **Removed `AEP-Components/dynAEP/sdk/`** - all SDKs live under `AEP-SDKs/` only
- Merged Action Lattice into `AEP-SDKs/typescript/dynaep/src/bridge.ts`; protocol source remains `AEP-Components/dynAEP/bridge/lattice/`
- Moved dynAEP React/CopilotKit bindings to `AEP-SDKs/react/`; CLI to `AEP-SDKs/typescript/dynaep/cli/`
- `produce-aep-sdks.mjs` syncs lattice protocol into SDK before TypeScript compile
- Updated dynAEP README §13 and observer adapter accuracy

### Added (policy system / CCA)
- **`cca/lib/policy-system-context.mjs`** - loads `AEP-Policy-System/reference/`, YAML presets, lattice mandatory rules, regulation LRP catalog
- **`cca/lib/policy-sections.mjs`** - builds `policy_sections` with per-LRP `gap_ref` for plan-executor and setup-agent
- CCA prompts inject full policy system via `registry-context.mjs` and `formatPolicySystemForPrompt()`
- Plans always include `policy_overrides.policy_lattice` and `policy_overrides.regulation_lrps` when compliance LRPs enabled
- `setup-agent.mjs` writes `config.policy_sections` on interactive install (parity with plan-executor)
- Conformance: `tests/conformance/cca-policy-system.test.mjs`

### Added
- **AEP Base Node** mandatory Rust daemon with inference, validation, future and regulation docking ports
- **Lattice Channels** with PQEncryptedCapsule (ML-KEM-768, AES-256-GCM, ML-DSA-65)
- **AgentMesh** identity layer (SPIFFE, DID, mTLS) for lattice channel transport
- **Lattice Memory** attractor store (sqlite-vec + USearch)
- **POTOMITAN** mesh fallback scaffold adapted from Yggdrasil
- **dynAEP** under `AEP-Components/dynAEP/`
- **Installation wizard** (`AEP-Components/wizard/install-wizard.mjs`) with regulation LRP catalog
- **Setup agent** for post-install activation (`AEP-Components/cca/setup-agent.mjs`)
- **Composer Lite** public WASM visual canvas on port 8424 (`AEP-Composer-Lite/`)
- **Conformance runner** with CC-01 through CC-15 checks (`AEP-Components/conformance/`)
- **WASM sandbox** optional policy eval proxy (`aep-wasm-sandbox`)
- **Docker public image** (`docker-compose.public.yml`, `Dockerfile`) with full offline protocol
- **Component registry** (`AEP-Base-Node/registry/`) for setup-agent and Composer Lite
- **Subprotocol registry** (`AEP-Subprotocols/`) - Rust domain validators + `aep-subprotocol` CLI
- **Canonical 2.8 layout**: `AEP-Base-Node/`, `AEP-Components/`, `AEP-SDKs/`, `AEP-Docks/`, `AEP-Connectors/`, `AEP-Policy-System/`, `AEP-User-Experience/`, `AEP-Composer-Lite/`
- **UCB** secured perimeter dock (`AEP-Docks/ucb/`) for non-AEP agent stacks
- **Compliance regulation LRPs** (EU AI Act, GDPR, SOC 2, HIPAA, NIST AI RMF, ISO 42001) with reference GAP policies
- Subprotocol and migration docs under `docs/`; phase execution under `plans/`

### Changed
- **LRP catalog taxonomy**: LRPs are sovereign/regional/international regulations only. Platform kernel contracts (`dynaep-action-lattice`, `lattice-channel-default`) and EPSCOM policies are not LRPs
- **Subprotocols unified** under `AEP-Subprotocols/` (Rust)
- Cargo workspace at repository root (`Cargo.toml`); unified build output under `rust/target/` via `.cargo/config.toml`
- TypeScript gateway commerce validation delegates to `aep-subprotocol` via `AEP-SDKs/typescript/aep-protocol/`
- Repository forked from `NLA-AEP-2.75-open-protocol` to `NLA-AEP-v2.8-open-source`
- Root README rewritten for 2.8 public tier scope
- `NAME-POLICY.md` moved to `docs/NAME-POLICY.md`
- `research-paper/` renamed to `AEP-Research-Paper/`
- Policy and schema builders under `AEP-Policy-System/policy-builder/` and `AEP-Policy-System/schema-builder/`
- Docks socket specs and UCD under `AEP-Docks/`

### Removed
- Stale root `tsconfig.json` and `.eslintrc.json` (orphaned after layout reorg; per-package TS configs remain in SDK/component trees)
- `examples/` directory
- CI stubs for the internal remote
- Duplicate `rust/Cargo.lock` copy

### Public vs internal scope
- **Shipped**: Base Node, Lattice Channels, AgentMesh, POTOMITAN, dynAEP, Composer Lite, component registry, `BIOSECURITY.md` at repo root
- **Not shipped** (``): tests, plans, internal docs, `NAME-POLICY.md`, conformance vitest harness sources
- Advanced validation engine features beyond the public tier are not included in this repository

## [2.75.0] - 2026-06-01

### Added
- CLI Power Tools: aep doctor, verify, lint-policy, red-team scan
- Multi-Language Policy Support: OPA Rego and Cedar transpilers
- MCP Security Gateway: tool poisoning, typosquatting and drift detection
- Merkle-Tree Audit Records with SHA-256 proof bundles
- AEP Intercept Proxy: one-command MCP proxy mode
- YAML Policy Importer for external policy formats
- Reference Policy Lattice: baseline security, deployment, writing, governance policies
- Multi-Agent Collaboration Primitives: supervisor, debate and delegation patterns
- AEP-Graph Orchestration Engine: stateful persistent cyclic workflows

### Changed
- Repository restructured: config/, policies/, unified subprotocols
- Trust rings documented as canonical access control model
- Harness and skill documentation updated for 2.75

## [2.6.0] - 2026-05-01

### Version Bump: AEP v2.5 -> v2.75
AEP v2.75 extends governance to the governance layer itself. Schemas and policies
are now validated with the same mathematical rigour applied to agent outputs.

### Added
- **Schema Builder** (Capability 12) - data-driven schema creation and validation with four analytical frameworks:
 - MLE estimation of constraint parameters from historical data (Fisher, 1922; Welford, 1962)
 - Graph spectral analysis of constraint coupling via Fiedler value and spectral gap (Fiedler, 1973; Chung, 1997)
 - Permissiveness scoring via acceptance distribution entropy (Amari, 2016; Cover & Thomas, 2006)
 - Modular decomposition via Louvain community detection (Blondel et al., 2008)
 - Composite validation score with configurable weights (default: MLE 0.35, spectral 0.25, permissiveness 0.25, modularity 0.15)
 - Decision thresholds: pass >= 0.8, review 0.5-0.8, reject < 0.5
 - Automated tightening proposals with MLE evidence
 - Online estimation update via Welford's algorithm
- **Policy Builder** (Capability 13) - data-driven Rego policy generation and validation:
 - Domain invariant detection from data (equality, inequality, membership, exclusion, conditional, temporal)
 - Rego deny rule generation from detected invariants
 - Invariant manifest with coverage tracking
 - Spectral impact analysis (projected Fiedler improvement from proposed rules)
 - MLE outlier rule generation
 - Spectral gap rule generation
- `/aepassist` schema commands: `schema build`, `schema validate`, `schema compare`, `schema tighten`
- `/aepassist` policy commands: `policy build`, `policy validate`, `policy gaps`
- Gateway integration: `validateSchemaProposal()`, `validatePolicyProposal()`, `getSchemaBuilderStats()`
- New evidence ledger entry types: `schema:validate`, `policy:validate`
- 75+ new tests covering Schema Builder and Policy Builder with zero regressions
- Harness renamed to `aep-2.75-agent-harness`

### Changed
- Package version bumped to 2.6.0
- `aep_version` updated to "2.75" in all policy files, registry, scene and theme
- `index.ts` exports all Schema Builder and Policy Builder types and classes
- Agent harness renamed from `aep-2.5-agent-harness` to `aep-2.75-agent-harness`
- Feature count: 77 (75 from v2.5 + Schema Builder + Policy Builder)

### Migration from v2.5
- v2.75 is backwards-compatible with v2.5
- Update version to "2.75" in policy files
- For Schema Builder: use `SchemaBuilder` class or `npx aep assist schema` commands
- For Policy Builder: use `PolicyBuilder` class or `npx aep assist policy` commands
- Existing schemas, policies, sessions, ledgers continue to work without modification

### Unchanged
- Three-layer architecture (Structure, Behaviour, Skin)
- Z-band hierarchy and prefix convention
- 15-step evaluation chain (Schema Builder operates BEFORE the chain)
- All existing scanners, policies and SDK files
- Licence (Apache 2.0)

## [2.5.4] - 2026-04-25

### Added (Domain Scanners)
- **Prediction Scanner** (Scanner 8) - validates prediction and forecast patterns against configurable bounds. Four rules: extreme percentage detection (default >100%), absolute-confidence language blocking, missing confidence qualifier flagging and excessive timeframe detection. Config: `max_percentage`, `max_horizon_days`, `require_confidence`, `block_certainty_language`. Disabled by default (opt-in via `scanners.prediction.enabled: true`).
- **Brand Scanner** (Scanner 9) - checks generated content against brand guidelines. Five rules: required phrase enforcement, forbidden phrase detection (hard severity), tone keyword verification, competitor mention flagging and reserved name suffix enforcement. Config: `required_phrases`, `forbidden_phrases`, `tone_keywords`, `competitors`, the reserved name list.
- **Regulatory Scanner** (Scanner 10) - ensures required regulatory disclosures are present. Five built-in checks: ad disclosure, financial disclaimer, medical disclaimer, affiliate disclosure and age restriction notices. Supports custom disclosure rules via `custom_disclosures` array. Default severity: hard.
- **Temporal Scanner** (Scanner 11) - enforces time-related constraints on agent output. Four rules: stale date reference detection (with "as of" qualifier support), excessive future horizon flagging, undated statistic detection and expired promotional content flagging. Supports ISO, Month DD YYYY, DD/MM/YYYY, quarter and month-year date formats. Config: `max_future_days`, `check_stale_references`, `check_undated_statistics`, `check_expired_content`, `reference_date`.
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
- **Fleet Manager** - aggregates governance across all active sessions. `FleetManager` provides `getStatus()` (agent summaries with trust, ring, drift, cost and action counts), `enforceFleetPolicy()` (detects violations: agent limit, cost exceeded, ring saturation, drift cluster), `registerAgent()`/`deregisterAgent()`, `pauseFleet()`/`resumeFleet()`/`killFleet()`. Configurable via `fleet` policy section with `max_agents`, `max_total_cost_per_hour`, `max_ring0_agents` and `drift_pause_threshold`.
- **Fleet API** - REST-style method handlers for fleet governance. `FleetAPI` wraps `FleetManager` with `getStatus()`, `getAgents()`, `getAgent(id)`, `getAlerts()`, `pauseFleet()`, `resumeFleet()` and `killFleet(rollback?)`.
- **Spawn Governor** - validates child agent spawning. `SpawnGovernor` ensures child agents inherit a subset of their parent covenant (child cannot permit parent-forbidden actions, child cannot skip parent requires), child ring is same or lower privilege (higher number), child trust starts at parent trust * 0.8. Fleet capacity check before spawn.
- **Message Scanner** - scans inter-agent messages through the scanner pipeline. `MessageScanner` prevents poisoned instructions, PII leaks and injection attempts between agents. Hard findings block, soft findings flag.
- **Fleet CLI** - `aep fleet status|agents|pause|resume|kill [--rollback]`.
- **Gateway integration** - fleet manager wired on first session with `fleet.enabled: true`. Fleet capacity check runs before system session limit. Message scanner wired from scanner pipeline. Fleet accessors: `getFleetManager()`, `getFleetAPI()`, `getSpawnGovernor()`, `getMessageScanner()`.
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

### Added (AI Engineer Coverage - Capabilities A-C)
- **Data Profiling Scanner** (Capability A) - 7th optional scanner performing five statistical checks on tabular and structured data: null rate, duplicate rate, outlier detection (z-score), schema consistency and class imbalance. `DataProfileScanner` implements the `Scanner` interface, parses CSV and JSON array inputs, configurable thresholds. Disabled by default (opt-in via `scanners.profiler.enabled: true`). Policy gains `profiler` config in `scanners` section with `null_rate_threshold`, `duplicate_rate_threshold`, `outlier_stddev` and `imbalance_ratio` fields. CLI: `aep profile <file>`.
- **ML Metrics Evaluator** (Capability B) - `MLMetrics` class with pure static methods computing four metric families: classification (accuracy, precision, recall, F1, confusion matrix), regression (MSE, RMSE, MAE, R2, MAPE), retrieval (precision@k, recall@k, MRR, NDCG) and generation (exact match, avg length, empty rate). `compositeScore()` averages available metric scores into a single 0-1 value. `ReliabilityIndex` gains optional `mlScore` field weighted into theta via `ML_RELIABILITY_WEIGHTS`. `EvalReport` gains optional `mlMetrics` field. CLI: `aep metrics <file>`.
- **Governed Fine-Tuning Workflow Template** (Capability C) - six-phase workflow definition wrapping fine-tuning processes with governance: DATA_PREPARATION, DATA_VALIDATION, TRAINING_CONFIG, TRAINING_EXECUTION, EVALUATION, DEPLOYMENT. `createFineTuningWorkflow()` factory with configurable `onFail` strategy. Each phase specifies role, ring, entry conditions, exit criteria and rework limits. CLI: `aep workflow init fine-tuning`, `aep workflow start fine-tuning`.
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
- **Commerce Subprotocol** - validates agentic commerce workflows: product discovery, cart management, checkout, payment negotiation, fulfillment tracking and post-purchase actions. `CommerceValidator` enforces configurable policies including merchant allow/blocklists, product category blocking, transaction amount limits, daily spend tracking, human gate thresholds and payment method restrictions. `SpendTracker` accumulates daily spend with JSONL persistence at `.aep/commerce/spend.jsonl`. `CommerceRegistry` manages merchant profiles with capabilities and payment handlers. Six new ledger entry types: `commerce:discover`, `commerce:cart_update`, `commerce:checkout`, `commerce:payment`, `commerce:fulfillment`, `commerce:return`. Policy gains `commerce` config section with `enabled`, `max_transaction_amount`, `allowed_currencies`, `allowed_merchants`, `blocked_merchants`, `blocked_product_categories`, `require_human_gate_above`, `allowed_payment_methods` and `max_daily_spend`. Commerce covenant rules follow existing DSL syntax (`permit commerce:discover; forbid commerce:checkout (total > 500) [hard]`). CLI: `aep commerce status|merchants|spend`.

### Changed
- `PolicySchema` extended with optional `commerce` config section via `CommercePolicySchema`.
- `LedgerEntryType` extended with six commerce-specific entry types.
- 19 new tests covering add-to-cart, checkout, payment negotiation, return validation, spend tracking, registry and covenant enforcement.

## [2.5.0] - 2026-04-25

### Added (Capabilities 10-11)
- **Lattice-Governed Knowledge Base** (Capability 10) - scanner-validated ingestion, covenant-scoped retrieval, anti-context-rot ordering and JSONL storage. `KnowledgeIngestor` splits content into chunks and runs each through the scanner pipeline: hard failures reject, soft failures flag, clean chunks validate. `GovernedRetriever` applies TF-IDF scoring, covenant scope filtering, double scanning and anti-context-rot ordering (most relevant chunks at positions 1 and N to counteract U-shaped LLM attention erosion). `KnowledgeBaseManager` provides create, ingestFile, ingestText, query, stats and list operations with `.aep/knowledge/<name>/chunks.jsonl` persistence. Four new ledger entry types: `knowledge:ingest`, `knowledge:reject`, `knowledge:flag`, `knowledge:retrieve`. Policy gains `knowledge` config section with `enabled`, `bases`, `chunk_size`, `max_retrieval_chunks`, `anti_context_rot` and `double_scan` fields.
- **Governed Model Gateway** (Capability 11) - multi-provider LLM gateway with per-request governance. `GovernedModelGateway` routes requests through the full evaluation chain including scanner pipeline and budget tracking. Four provider adapters: `AnthropicAdapter`, `OpenAIAdapter`, `OllamaAdapter`, `CustomAdapter`. `ProviderRegistry` manages adapter registration and selection. Streaming support with governed chunks. Policy gains `model_gateway` config section. CLI: `aep call <prompt> --model <model> --provider <provider> --policy <file>`.
- **Content Scanner Pipeline** - six scanners (PII, injection, secrets, jailbreak, toxicity, URLs) orchestrated by `ScannerPipeline`. Each scanner configurable with hard or soft severity. Hard findings reject immediately. Soft findings trigger the recovery engine for automatic retry. Policy gains `scanners` config section.
- **Recovery Engine** - automatic retry for soft violations with configurable max attempts and cooldown. Violations from covenant evaluation or scanner pipeline are retried through a callback before the last rejection.
- **Workflow Phases** - sequential workflow execution with typed verdicts (advance, rework, skip, fail). `WorkflowExecutor` enforces phase ordering and rework limits. Policy gains `workflow` config section with template definitions.
- **OpenTelemetry Exporter** - `AEPTelemetryExporter` converts session events to OTEL spans for observability integration. Policy gains `telemetry` config section.
- **Token and Cost Tracking** - per-session token counting and cost recording with `ActionResult.tokens` and `ActionResult.cost` fields. Session reports include totalTokens, totalCost and costSaved.
- **Two new built-in policies** - `full-governance` (all capabilities enabled, knowledge base, scanners, workflows, telemetry, tracking) and `content-safety` (all scanners at hard severity, knowledge base enabled, strict forbidden patterns).
- **New CLI commands** - `kb create|ingest|query|list|stats`, `scan <text>|--file <file>`, `call <prompt>`.
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
- **Proof Bundles** - portable, signed verification artifacts that package an entire session into a single `.aep-proof.json` file. Contains bundle ID, agent identity, covenant spec, session report, Merkle root, ledger hash, trust score, execution ring, drift score and Ed25519 signature. `ProofBundleBuilder` builds and serializes bundles; `ProofBundleVerifier` verifies signature, identity, covenant, expiry and optionally full ledger hash and Merkle root matching. New `bundle:created` ledger entry type. Policy gains `session.auto_bundle` and `session.bundle_on_terminate`. CLI: `aep bundle <session-id>`, `aep bundle verify <file> [--ledger <file>]`.
- **Governed Task Decomposition** - subtask trees as first-class governed structures. `TaskDecompositionManager` creates root tasks, decomposes into children with scope intersection (child can NEVER widen parent scope), validates actions against task scope, enforces action budgets, max depth and max children. Completion gates with six criterion types (`all_children_complete`, `tests_pass`, `no_violations`, `trust_above`, `drift_below`, `custom`). Subtree cancellation. Gateway gains Step 0 (task scope check) before the existing 12-step chain, making it 13 steps total. Intent drift is measured against current task description. Proof bundles include task tree. Policy gains `decomposition` config section. New `task:create`, `task:decompose`, `task:complete`, `task:fail`, `task:cancel` ledger entry types. CLI: `aep tasks <session-id> [--tree]`.

### Added
- **Trust Scoring with Decay** - continuous trust score (0-1000) with five tiers (untrusted, provisional, standard, trusted, privileged), time-based decay, configurable penalties and rewards.
- **Execution Rings** - four-ring privilege model (Ring 0 kernel through Ring 3 sandbox) with seven capability flags per ring (read, create, update, delete, network, spawn sub-agents, modify core). Automatic demotion on trust drop.
- **Behavioural Covenants** - agent-declared constraint DSL (`covenant Name { permit/forbid/require rules; }`) with parser, evaluator and compiler. Forbid overrides permit. Conditions support `in`, `matches` and comparison operators.
- **Agent Identity** - unified Ed25519/RSA identity system with `AgentIdentityManager` for creation, verification, expiry checks and compact serialisation.
- **Cross-Agent Verification** - `verifyCounterparty()` and `generateProof()` handshake protocol with `ProofBundle` exchange and configurable `CovenantRequirement` rules.
- **Merkle Proofs** - per-entry verification with `MerkleTree` class supporting `getRoot()`, `generateProof()` and static `verifyProof()`. L:/R: prefixed proof paths.
- **Post-Quantum Ledger Signatures** - ML-DSA-65 (FIPS 204) simulation via HMAC-SHA512 with `generateQuantumKeyPair()`, `quantumSign()` and `quantumVerify()`.
- **RFC 3161 Timestamps** - `TimestampQueue` with async/batched non-blocking `enqueue()`, `flush()`, auto-flush interval and `getToken()` for offline fallback.
- **Kill Switch** - `KillSwitch` class with `killAll()` and `killSession()` supporting optional rollback and trust reset to zero.
- **Intent Drift Detection** - `IntentDriftDetector` with four heuristics (tool category, target scope, frequency anomaly, repetition), configurable warmup period and drift threshold. Actions: warn, gate, deny or kill.
- **OWASP Agentic AI Top 10 Mapping** - every OWASP risk mapped to specific AEP 2.2 defence mechanisms. New `aep owasp` CLI command.
- **Offline Signing with Sync** - `OfflineLedger` for air-gapped environments with `append()`, `getQueue()`, `clear()` and `verifyLocalChain()`.
- **Optimistic Concurrency** - `_version` field on AEP elements with `validateAEPWithVersion()` for conflict-free multi-agent mutations.
- **Streaming Validation with Early Abort** - `AEPStreamValidator` intercepts agent output chunk by chunk, aborting on first violation. Five checks: covenant forbids, protected elements, z-band violations, structural violations and policy forbidden patterns. `StreamMiddleware` wraps any `ReadableStream<string>`. Aborts logged as `stream:abort` evidence entries. Model-agnostic.
- **System-wide Rate Limiting** - shared counter across all sessions with configurable `max_actions_per_minute` in system policy config.
- **Webhook Gate Type** - `approval: "webhook"` in gate definitions with `webhook_url` and `timeout_ms` fields.
- **Audit Report Formats** - `aep report --format json|csv|html` CLI command for evidence ledger export.
- **New CLI commands** - `kill`, `trust`, `ring`, `drift`, `identity create`, `identity verify`, `covenant parse`, `covenant verify`, `owasp`, `describe`, `report --format`.
- **Two new built-in policies** - `multi-agent` (cross-agent verification with Ring 0 access) and `covenant-only` (minimal policy with covenant enforcement).
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
- **Session Governance** - managed session lifecycle with state tracking, statistics, escalation rules and session reports.
- **Policy Engine** - YAML-based policy DSL controlling capabilities, scopes, limits, gates, forbidden patterns and rate limits per session.
- **AEP-aware policy capabilities** - element_prefixes, z_bands and exclude_ids scoping for fine-grained AEP element governance.
- **Evidence Ledger** - append-only JSONL audit trail with SHA-256 hash chaining and tamper detection.
- **Rollback and Compensation** - reversible mutations with pre-mutation state backup and AEP scene graph restoration.
- **Agent Gateway** - unified entry point combining policy evaluation, AEP structural validation and evidence recording.
- **MCP Proxy mode** - transparent governance proxy for Claude Code, Cursor, Codex and any MCP-compatible agent.
- **Shell Proxy mode** - policy-enforced command execution wrapper.
- **CLI commands** - `aep init`, `aep proxy`, `aep exec`, `aep validate`, `aep report`.
- **Agent init generators** for Claude Code (CLAUDE.md + settings.json), Cursor (mcp.json + rules) and Codex (AGENTS.md).
- **Built-in policies** - coding-agent, aep-builder, readonly-auditor, strict-production.
- **Ledger verification** - cryptographic chain integrity checking with exact break-point reporting.
- **Session escalation rules** - automatic pause or human check-in after configurable action counts, time intervals or denial thresholds.
- **Comprehensive test suite** - 71 tests covering session governance, policy engine, evidence ledger, rollback, gateway and MCP proxy.

### Changed
- `aep_version` bumped from `"2.0"` to `"2.1"` in all config files.
- Validation flow extended - policy evaluation runs BEFORE structural validation.
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
- **Lattice Memory** (`sdk/sdk-aep-memory.py`, `sdk/sdk-aep-memory.ts`) - append-only validation memory with vector similarity search, fast-path attractor matching, audit trail export and two storage backends (InMemoryFabric, SQLiteFabric).
- **Basic Resolver** (`sdk/sdk-aep-resolver.py`, `sdk/sdk-aep-resolver.ts`) - stateless, read-only proposal router that maps agent proposals to the correct validator pipeline (ui, workflow, api, event, iac), collects constraints and queries memory for fast-path hits.
- **Memory Rego policies** (`aep-memory-policy.rego`) - OPA/Rego rules for memory entry validation (result values, registered elements, zero-error accepted entries).
- **TLA+ specifications** (`docs/TLA+/AEP.tla`, `docs/TLA+/AEP_Memory.tla`) - standalone formal specs for core AEP invariants and memory-specific invariants including `MemoryDoesNotAffectDecision` and `MemoryAppendOnly`.
- **Documentation** - `docs/LATTICE-MEMORY.md` (architecture, API reference, storage backends), `docs/RESOLVER.md` (routing logic, registry integration, API reference), `docs/MIGRATION-v1-to-v2.md` (step-by-step migration guide).
- **Examples** - `examples/with-memory/demo.py` (memory recording, attractor search, fast-path), `examples/with-resolver/demo.py` (multi-domain routing, memory integration).
- **Test suite** - `tests/test_memory.py`, `tests/test_resolver.py`, `tests/test_protocols.py`, `tests/test_validator.py`.
- Optional `memory_key` field on scene elements for memory persistence association.
- Optional `memory_persistence` field on registry entries for validation history tracking.
- Four new reserved names: `AEP Lattice Memory`, `AEP Basic Resolver`, `AEP Hyper-Resolver`, `AEP Memory Fabric`.

### Changed
- `aep_version` bumped from `"1.1"` to `"2.0"` in `aep-scene.json`, `aep-registry.yaml`, `aep-theme.yaml`.

### Unchanged
- All existing SDK files (`sdk-aep-core.ts`, `sdk-aep-python.py`, `sdk-aep-protocols.py`, `sdk-aep-react.tsx`, `sdk-aep-vue.ts`) - fully preserved, no modifications.
- Existing Rego policies (`aep-policy.rego`) - unchanged and compatible.
- Three-layer architecture (Structure, Behaviour, Skin) - unchanged.
- Z-band hierarchy - unchanged.
- Element ID convention (`XX-NNNNN`) - unchanged.
- Apache 2.0 license - unchanged.

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

