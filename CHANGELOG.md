# Changelog

## [2.8.0] - 2026-09-04 - Every opened message meets the kernel checks

The AEP 2.8 library now treats Base Node as the kernel: after a sealed lattice frame (the encrypted capsule on the wire) is opened, the kernel freezes the clock at seal, waits 1000 ms, then runs the check that every opened message is supposed to meet. Putting a frame on the dock is not that check. After the wait the client asks for the result by the capsule hash so a deny names the closed walls and an allow returns an event id. A missing scene, dock, timestamp or sequence fails those checks. Stored past allows stay forensic and do not skip the check. TypeScript dynAEP stays a standalone component. Universal Connect Bridge stays an optional attach for foreign stacks.

## [2.8.5] - 2026-09-04 - Kernel pulse documented on Base Node and dynAEP

The main README now has a first-class Kernel pulse section: the 1000 ms wait after freeze-at-seal is a compiled Base Node constant, not a dynAEP yaml key. The 1000 ms NTP LARGE_STEP cap in dynAEP timekeeping is clock-sync, not the kernel wait. In theory a builder changes the wait by rebuilding Base Node with a different compiled pulse length while freeze-at-seal stays, drift is not set to the wait length and age stays longer than the wait.

## [2.8.x] - 2026-09-04 - dock client collects post-beat Admit so DenyReport.closed and allow event_id return on the wire

### Changed
After enqueue the client collects the applied DockFrameResponse by digest on the same unix dock. Enqueue still has no event_id. Deny carries deny.closed. Allow carries event_id. UCB send_frame does not treat enqueue as Admit. The 1000 ms pulse is unchanged. Attractors stay forensic. TypeScript dynAEP remains.

### Added
Crate aep-dock-post-beat-collect. cargo test -p aep-base-node --lib covers collect-by-digest. CI gate scripts/gate-aep28-env-071.sh fails if enqueue is still treated as Admit.


## [2.8.x] - 2026-09-04 - dock Deny returns closed-wall ids and mechanical repair

### Changed
Dock Deny now returns a structured report on DockFrameResponse.deny: closed wall ids, reasons, closed_set_key and prescribed repairs for unbound scene, dock, time, sequence and writing.gap. Grant lists stay off repair.fix. A retry must seal a new capsule because digest replay is keyed at enqueue. UCB ingest JSON forwards the same deny field. Attractors stay forensic. Native Path A owns the report. Conjunction stays Boolean meet.

### Added
Crate aep-wall-set-backpressure. Rejection.closed on live-entry. admit_sealed_payload_report on Base Node. cargo test -p aep-wall-set-backpressure --lib covers bind and reseal repairs.



## [2.8.x] - 2026-09-04 - README attach path names 1000 ms pulse, unbound field close and wrap bind

### Changed
README now describes the landed Base Node attach path: freeze-at-seal, 1000 ms pulse, then collect-all Admit then Apply, with missing scene, dock, timestamp or sequence closing Admit. Policy-system GAP walls bind to a lattice wrap or action_path prefix except writing and security which stay always-on, while attractors do not skip Admit and GraphEngine execute requires admitGate default deny.


## [2.8.x] - 2026-09-04 - GraphEngine execute requires admitGate default deny

### Changed
GraphEngine.execute no longer runs nodeExecutor until admitGate allows. A missing admitGate is deny. The local vector clock ticks only after allow and is not kernel Admit. policyEvaluator on a decision node is not Admit. Kernel Admit is drift, age, future, sequence and digest replay. README, AEP-main-skill and GraphEngine README no longer teach Lamport vector clocks as live Admit. TypeScript dynAEP remains. GraphEngine is not a second kernel.

### Added
Crate aep-graph-engine-admit-gate fails if engine.ts invokes nodeExecutor without admitGate.


## [2.8.x] - 2026-09-04 - Admit does not reuse a cosine-near attractor or a cached forecast score

### Changed
Admit wall_forecast uses only the live anomaly_score. A stored snapshot.forecast_cached_score cannot close or open the forecast wall. README and AEP-main-skill no longer teach attractor skip of Admit. Cosine-near a past allow is not membership proof. lattice-memory still records and searches for forensic and health telemetry. ENV-025 

### Added
cargo test -p aep-envelope --lib covers cached-score stays open and live score closes.



## [2.8.x] - 2026-09-04 - policy-system GAP walls bind wrap or prefix

### Changed
Policy-system GAP walls bind to LatticeNode.wrap or an action_path prefix. writing and security stems still evaluate on every action_path. A finance wrap GAP item does not close an inventory wrap ping. A non-always-on GAP with empty wrap does not fold onto every event. YAML GAP parse reads guard and wrap. 

### Added
LatticeNode.wrap on aep-envelope. wrap and prefix fields on policy-system GAP load. cargo test -p aep-policy-system-admit --lib and cargo test -p aep-envelope --lib cover those cases.


## [2.8.x] - 2026-09-04 - Base Node 1000 ms tic tac pulse

### Changed
Base Node now freezes the sealed capsule temporal snapshot after seal verify, writing scan and digest replay, then waits for a 1000 ms bridge-clock beat before Admit collect-all walls then Apply. Same-agent order is sequence_number. Queue overflow is Deny. Drift stays 50 ms against freeze. Age stays 5000 ms. Extra Admit walls bind bridge time to the frozen seal snapshot. aep-dynaep is not a second pulse owner.

### Added
Crate aep-base-node-pulse and CI gate scripts/gate-aep28-env-065.sh fail if docking.rs still Admits immediately or max_drift_ms is set to the pulse length.



## [2.8.x] - 2026-09-04 - unbound scene, channel, time and sequence close

### Changed
Unbound scene, channel, time and sequence now close Admit so a payload that drops those fields cannot walk through. dest_dock may bind from the opened frame docking port, while a missing scene_id, timestamp or sequence_number is Deny. aep-dynaep wall_time and compile_temporal_walls close the same way when time is unbound. and 

### Added
Crate aep-unbound-field-close and CI gate scripts/gate-aep28-env-066.sh fail if those walls still allow when the field is missing.



## [2.8.x] - 2026-09-04 - CAW CVE demo trees out of the attachable component set

### Changed
CAW CVE demo trees are not in the attachable component set.

### Added
Crate aep-caw-cve-demo-trees and CI gate scripts/gate-aep28-env-064.sh fail if a demo-cve tree remains under AEP-Components.



## [2.8.x] - 2026-09-04 - EPSCOM trust bundle does not claim ML-DSA on sha256-structure

### Changed
EPSCOM trust bundle mode is sha256-structure. ML-DSA is not claimed. The signatures loader denies ML-DSA claim on sha256-structure.

### Added
Crate aep-epscom-trust-bundle-mode and CI gate scripts/gate-aep28-env-063.sh fail if the shipped bundle still claims ML-DSA.


## [2.8.x] - 2026-09-04 - AgentMesh docs say local issuance

### Changed
AgentMesh docs say local issuance. A local cert is not mesh attestation.

### Added
Crate aep-agentmesh-local-issuance and CI gate scripts/gate-aep28-env-062.sh fail if docs still sell zero-trust identity for a local cert.


## [2.8.x] - 2026-09-03 - lattice-gated-fetch after dock allow

### Changed
After dock allow the kernel executes bound HTTP and returns http on DockFrameResponse. lattice-gated-fetch clients consume dock http and do not ordinary-fetch the original URL.

### Added
Crate aep-lattice-gated-fetch and CI gate scripts/gate-aep28-env-061.sh fail if docking.rs or a twin still falls through after allow.


## [2.8.x] - 2026-09-03 - advertised SDK path ships a client

### Changed
Advertised AEP-SDKs/python now ships aep-protocol and dynaep clients. The lattice client refuses AEP_LATTICE_STRICT=0 unless AEP_LATTICE_STRICT_DEV=1 and does not self-assert score 750.

### Added
Crate aep-python-sdk-path and CI gate scripts/gate-aep28-env-060.sh fail if the advertised tree or lattice client is missing.

## [2.8.x] - 2026-09-03 - library count is the layer table

### Changed
- README counts the library by the Architecture layer table
- Folder count is not the library count

### Added
- crate aep-library-layer-count
- CI fails if README uses 120-plus as the library count

## [2.8.x] - 2026-09-03 - named surfaces execute

### Changed
- CodeSandbox executes python, javascript, typescript and bash under AEP_DATA/sandbox
- Cedar and Rego transpilers emit GAP and reverse GAP exports emit Cedar and Rego
- MCP proxy forwards policy-allowed tool calls through stdio JSON-RPC and SSE HTTP

### Added
- crate aep-named-surfaces
- CI fails if a named surface still refuses to run or the README does not name it live

## [2.8.x] - 2026-09-03 - load AEP-Policy-System GAP as live Admit

### Changed
- AEP-Policy-System GAP files load as live Admit walls on the kernel collect-all pass
- README and SETUP copy say Live Admit GAP files

### Added
- crate aep-policy-system-admit
- CI fails if live dock does not compile GAP files into Admit walls

## [2.8.x] - 2026-09-03 - Slack and Jira real clients through UCB

### Changed
- Slack posts chat.postMessage through UCB egress
- Jira creates issues through UCB egress
- Connector probes use UCB rather than vendor hosts

### Added
- crate aep-connector-ucb-clients
- kit helpers ucbFetch slackPostMessage jiraCreateIssue

## [2.8.x] - 2026-09-03 - dock line reader is not one byte per await

### Changed
- Dock line reader uses fill_buf and consume with a 64KiB BufReader
- serve_connection no longer awaits one byte up to the 4MiB cap

### Added
- crate aep-dock-line-reader
- CI fails if production dock line reader still awaits one byte



## [2.8.x] - 2026-09-02 - isolate numeric trust_score

### Changed
- Numeric trust_score is isolation telemetry. It never admits
- AgentMesh cert state has no trust_tier and does not rotate on score
- validate_agent ignores numeric trust_score
- Envelope Snapshot.trust_score is unused by walls

### Added
- crate aep-trust-score-isolation
- CI fails if live Admit still denies on score or cert state still stores score


## [2.8.x] - 2026-09-02 - one Admit function and one id vocabulary

### Changed
- extra_walls keeps AdmitWall id
- Envelope WallVerdict identity is id
- attach_live_walls assigns compile_live_walls with no conversion from a second admit_collect_all

### Added
- crate aep-one-admit-id
- CI fails if extra_walls conversion or WallVerdict name identity remains



## [2.8.x] - 2026-09-02 - dock request returns ok false on poisoned locks

### Changed
- Dock request path returns ok false when a mutex is poisoned
- process_request does not abort the process on a poisoned lock

### Added
- crate aep-dock-request-poison
- CI fails if production dock request path still uses lock expect or lock unwrap


## [2.8.x] - 2026-09-02 - mint agent sign keys only via operator provision

### Changed
- Agent sign keys mint only through the operator provision command
- First-mint get_or_create is not the identity issuer
- lattice log and self-test look up a provisioned key

### Added
- crate aep-agent-sign-key-provision
- aep-base-node --provision-agent-sign-key --agent-id
- CI fails if get_or_create still mints or provision is missing
- self-test record_lattice_event binds eight INSERT columns




## [2.8.x] - 2026-09-02 - empty lattice closes membership and agent_may

### Changed
- Empty node map closes dag.membership and gap.agent_may
- A non-empty action_path cannot pass membership on an empty lattice
- Missing or unreadable lattice YAML stays Deny at load
- 

### Added
- crate aep-empty-lattice-close
- CI fails if wall_dag or wall_agent_may still opens on an empty node map


## [2.8.x] - 2026-09-02 - standalone Rust dynAEP crate

### Added
- crate aep-dynaep at AEP-Components/dynAEP/crate
- Action Lattice membership, parent closure and agent_may with the same rules as kernel envelope Admit
- Temporal authority stamps bridge time on allowed events
- A builder can depend on only that crate. Base Node is unchanged. TypeScript dynAEP remains.




## [2.8.x] - 2026-09-02 - remove envelope-journals from product workspace

### Removed
- AEP-Components/envelope-journals from workspace members
- crate aep-envelope-journals as a product workspace package

### Added
- crate aep-envelope-journals-drop
- CI fails if aep-envelope-journals is a workspace package



## [2.8.x] - 2026-09-02 - park run_meet off product SDK

### Changed
- Product Rust SDK does not export run_meet as live evaluation
- Live evaluation stays collect-all Admit
- Derived 15-row ledger lives under evaluation-chain as non-live

### Added
- crate aep-sdk-run-meet-park
- CI fails if AEP-SDKs/rust/src/lib.rs pub-uses run_meet or chain_meet_keeps_all_rows stays as a product evaluation test


## [2.8.x] - 2026-09-01 - live Admit has no rank field

### Removed
- EnvelopeAction rank field on the live Admit event
- Live tests sending a rank field
- TypeScript processEvent stamping a rank field

### Added
- crate aep-admit-no-trust-tier
- CI fails if EnvelopeAction still has a rank field
- Who-may stays GAP dimension agent_may


## [2.8.x] - 2026-09-01 - one live evaluation

### Changed
- Live dock compiles wall crates onto extra walls then one Admit then Apply
- live_collect_all is not a second combinator beside aep_envelope admit

### Added
- crate aep-one-live-evaluation
- CI fails if envelope_admit.rs calls both live_collect_all and process_event Admit on the same plaintext



## [2.8.x] - 2026-09-01 - live dock collect-all

### Changed
- Product Admit wall crates fold into envelope_admit collect-all
- admit-trust-floor is not a workspace product member

### Added
- crate aep-admit-live-dock
- CI unused product wall crate gate


## [2.8.x] - 2026-09-01 - one live entry language

### Changed
- Product live path is Rust only
- TypeScript processEvent is not a second product Admit
- DynAEPBridge constructor does not load ActionLattice YAML as product Admit
- CLI serve does not run LatticeFilter as product Admit

### Added
- crate aep-one-live-entry-language
- tree-wide leftover scan: spawnSync aep-envelope, loadFromFile and processEvent as product live code
- tests: constructor YAML load fails the leftover scan; processEvent createRejection fails the leftover scan


## [2.8.x] - 2026-09-01 - one evaluation story

### Changed
- Admit collect-all then Apply is the sole live evaluation
- Fifteen named rows are a derived ledger, not a second combinator
- LatticeFilter leftover is not evaluation
- README mermaid no longer forks BN to ADMIT and BN to MEET

### Added
- crate aep-one-evaluation-story
- tests: unmapped closed Admit wall still Denies when fifteen bools are open


## [2.8.x] - 2026-09-01 - client trust_tier ignore

### Changed
- TypeScript lattice ignores client trust_tier when agent_id is set
- Authorization field trust_tier is not a floor. Who-may is agent_may

### Added
- crate aep-client-trust-tier-ignore
- tests: bound agent_id plus inflated trust_tier Deny


## [2.8.x] - 2026-09-01 - Trust Rings removal

### Removed
- Trust Rings four-stage rank is not a product member
- ring_capability evaluation-chain step (replaced by gap_capability)
- client trust_tier versus node trust_floor rank compare on live Admit
- trust.penalize during Admit and workflow evaluation

### Added
- GAP capability dimensions: Agent A may X, Agent B may Y, Conjunction on the same collect-all Admit
- crate aep-gap-capability-dimensions
- lattice node agent_may grants. Empty grants fail closed for agent actions
- CAW isolation stays. Isolation is not a trust rank

All notable changes to the Agent Element Protocol (AEP) will be documented in this file.

## [2.8.x] - 2026-07-21 (21.07.2026) - intermittent / August patch track

> **Patch track note:** Standard policy enhancement for the AEP **2.8** line.
> Added **2026-07-21** (display **21.07.2026**) as part of intermittent 2.8 updates
> leading into the **August 2026** patch package, before **AEP 2.9** (planned September).

### Added (security / network egress)
- **`AEP-Policy-System/reference/network-egress-no-smtp.gap`** - reference lattice policy forbidding SMTP and message-submission TCP ports **25, 465, 587**, plus common mail transport libraries and `smtp://` schemes
- **`AEP-Policy-System/network-egress-no-smtp.policy.yaml`** - operator-facing policy bundle (hard severity, `control_family: network_egress`)
- Lattice mandatory rules: `no-smtp-outbound-ports`, `no-smtp-mail-transport-libraries` in `lattice-channel-mandatory.gap`
- Operator note: host OUTPUT drop for 25/465/587 recommended on multi-tenant agent hosts
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
- `.gitea/` CI stubs (Gitea remote used directly)
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
- **Brand Scanner** (Scanner 9) - checks generated content against brand guidelines. Five rules: required phrase enforcement, forbidden phrase detection (hard severity), tone keyword verification, competitor mention flagging and trademark suffix enforcement. Config: `required_phrases`, `forbidden_phrases`, `tone_keywords`, `competitors`, `trademarks`.
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
- **Recovery Engine** - automatic retry for soft violations with configurable max attempts and cooldown. Violations from covenant evaluation or scanner pipeline are retried through a callback before final rejection.
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
