# AEP - Agent Element Protocol (Deterministic Adjudication Lattices)

### Version 2.6 - 1 May 2026
### Author: thePM_001 (https://x.com/thePM_001)
### Licence: Apache-2.0
### Research Paper: https://github.com/thePM001/AEP-research-paper-001
### Demo: https://aep.newlisbon.agency
### AEP 2.6 Agent Harness: https://github.com/thePM001/AEP-agent-element-protocol/tree/main/harness/aep-2.6-agent-harness

---

### Now 77 Features. One Protocol.

![AEP 2.6 - 77 Features](docs/images/feature-grid.png)

## [Explore the full feature grid at aep.newlisbon.agency](https://aep.newlisbon.agency)

---

## Quick Start

### Method 1 -- Clone (recommended)

```bash
git clone https://github.com/thePM001/AEP-agent-element-protocol.git
cd AEP-agent-element-protocol
npm install
npm run build
npx aep assist setup
```

### Method 2 -- Install from GitHub (add to existing project)

```bash
npm install github:thePM001/AEP-agent-element-protocol
npx aep assist setup
```

### Method 3 -- Claude Code (MCP)

```bash
git clone https://github.com/thePM001/AEP-agent-element-protocol.git
cd AEP-agent-element-protocol && npm install && npm run build
claude mcp add aep -- node /path/to/AEP-agent-element-protocol/dist/cli.js serve
```

Then in Claude Code: "Use the aepassist tool to set up governance."

### Method 4 -- Cursor / Windsurf / Codex

Clone the repo first, then add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "aep": {
      "command": "node",
      "args": ["/path/to/AEP-agent-element-protocol/dist/cli.js", "serve"]
    }
  }
}
```

---

## Using /aepassist

After setup, use the interactive assistant for everything:

```bash
npx aep assist              # show menu
npx aep assist setup        # first-time setup (3 questions)
npx aep assist status       # current governance status
npx aep assist preset strict  # switch governance preset
npx aep assist kill         # emergency kill switch
npx aep assist covenant list  # view active covenants
npx aep assist identity show  # view agent identity
npx aep assist report json  # generate audit report
npx aep assist schema build <domain> <data-file>      # NEW v2.6: build schema from data
npx aep assist schema validate <schema-file>           # NEW v2.6: validate schema
npx aep assist policy build <schema-file>              # NEW v2.6: build Rego policy
npx aep assist policy validate <schema-file> <rego-dir>  # NEW v2.6: validate policy coverage
```

---

## What AEP Does

AEP is a 3-layer governance architecture originally developed to give every UI element a unique numerical identity, exact spatial coordinates, defined behaviour rules and themed visual properties. It treats the frontend as a topological coordinate system. The three layers are **Structure** (what exists and where), **Behaviour** (what each element does and cannot do) and **Skin** (what each element looks like). Changing one layer never requires changing another.

AEP applies beyond frontend development to ALL constrained knowledge domains with fixed rule sets and build schemas. Workflows, REST APIs, ML training pipelines, event-driven systems, infrastructure as code, smart contracts and agentic commerce all use the same architecture: agents propose, AEP validates, only compliant output executes.

Every agent action passes through a deterministic 15-step evaluation chain. The chain produces allow or deny. No ambiguity.

The mathematical foundation is the Deterministic Adjudication Lattice (DAL). A population of LLM candidate outputs is filtered through hierarchical verification predicates. The convergence theorem proves zero-defect selection with population size logarithmic in the inverse failure probability. Lattice memory stores every validated output as an immutable record. Known good proposals match against attractors and skip cold-path validation.

AEP v2.6 extends governance to the governance layer itself. The Schema Builder validates schema definitions using Maximum Likelihood Estimation (MLE), graph spectral analysis (Fiedler algebraic connectivity), permissiveness scoring (acceptance distribution entropy) and Louvain community detection. The Policy Builder detects domain invariants from data and generates Rego rules with coverage tracking. The protocol now validates its own constitutional layer with the same mathematical rigour it applies to agent outputs.

---

## The Three-Layer Architecture

AEP separates every governed domain into three independent layers. Each layer has a single responsibility. No layer references another directly.

### Layer 1 - Structure (aep-scene.json)

The scene graph. A flat JSON object where every element has a unique topological ID following the prefix convention (XX-NNNNN), a parent reference, spatial constraints, dimensions, a z-index and a visibility flag.

**AEP Prefix Convention:**

| Prefix | Type | Z-Band |
|--------|------|--------|
| SH | Shell | 0-9 |
| PN | Panel | 10-19 |
| NV | Navigation | 10-19 |
| CP | Component | 20-29 |
| FM | Form | 20-29 |
| IC | Icon | 20-29 |
| CZ | Cell Zone | 30-39 |
| CN | Cell Node | 30-39 |
| TB | Toolbar | 40-49 |
| WD | Widget | 50-59 |
| OV | Overlay | 60-69 |
| MD | Modal/Dialog | 70-79 |
| DD | Dropdown | 70-79 |
| TT | Tooltip | 80-89 |
| -- | System reserved | 90-99 |

**Z-band hierarchy:** an element's z-index MUST fall within its type's band. The validator rejects violations. A Modal (z: 70-79) always renders above a Data Grid (z: 30-39). A Tooltip (z: 80-89) always renders above a Modal. Mathematically enforced.

**Topological constraints:** relational anchors (position relative to parents/siblings), flex/grid spatial rules, viewport breakpoint matrices for responsive behaviour.

**Structure rules:**

1. Every element MUST have a unique ID following the prefix convention.
2. Every element MUST have a parent (except root Shell).
3. Children MUST be topologically contained within their parent.
4. Z-index values MUST follow the z-band hierarchy.
5. The scene graph is the single source of truth for layout.

### Layer 2 - Behaviour (aep-registry.yaml)

The component registry (AEP-FCR). Every element that renders pixels has an entry defining what it does, its states, events, constraints and what it is forbidden from doing. The Behaviour layer contains no visual properties. All styling is delegated to Layer 3 through skin_binding.

**Required fields:** label, category, function, component_file, parent, skin_binding, states, constraints.

**Category taxonomy:** action, data-input, data-display, feedback, layout, system.

**Template Nodes:** elements spawned dynamically (grid rows, list items) are governed by templates. The validator checks the template at build time. Runtime instances inherit its proven safety. Validate the mould, not every item poured from it.

**Forbidden patterns:** Rego policies define patterns that must never occur (z-band violations, orphaned elements, missing skin bindings).

### Layer 3 - Skin (aep-theme.yaml)

All colours, fonts, spacing, borders, shadows and animations. Components reference theme variables through skin_binding. No component ever contains hardcoded visual values.

**Skin binding resolution:** registry entry -> skin_binding key -> theme component_styles block -> resolved properties.

To add dark/light mode: create a new YAML with different values. Structure and Behaviour remain untouched.

### Layer Independence Principle

Changing one layer never requires changing another. Five scenarios:

- **Add dark mode:** Skin only changes.
- **Move sidebar to the right:** Structure only changes.
- **Add keyboard shortcut:** Behaviour only changes.
- **AI agent repositions a panel:** Structure only changes.
- **Complete visual rebrand:** Skin only changes.

If you find yourself editing two layers for one change, the separation is broken. Fix it.

### How the 3-Layer Architecture Generalizes

For non-UI domains, the three layers map to:

- **Structure** -> What entities exist and their relationships (API endpoints, workflow steps, IaC resources, accounting entries).
- **Behaviour** -> What operations are permitted on each entity (allowed HTTP methods, valid state transitions, permitted mutations).
- **Skin** -> How entities are presented or serialized (response formats, output templates, report styling).

The separation principle holds: changing presentation never requires changing structure or rules.

---

## 15-Step Evaluation Chain

Every agent action passes through these 15 steps. The chain produces allow or deny.

| Step | Name | Description |
|------|------|-------------|
| 0 | Task scope | Current action within subtask scope |
| 1 | Session state | Session active and valid |
| 2 | Ring capability | Agent's ring permits operation |
| 3 | System rate limit | Planetwide cap not exceeded |
| 4 | Session rate limit | Per-session cap not exceeded |
| 5 | Intent drift | Action aligns with baseline behaviour |
| 6 | Escalation | Action requires higher authority |
| 7 | Covenant evaluation | Agent's permit/forbid/require rules |
| 8 | Rego check | Environment-specific forbidden patterns |
| 9 | Capability + trust | Agent capabilities and trust tier sufficient |
| 10 | Budget/limit | Token, cost and spend limits not exceeded |
| 11 | Gate check | Human or webhook approval required |
| 12 | Cross-agent verification | Multi-agent identity and covenant check |
| 13 | Knowledge validation | Covenant-scoped KB access |
| 14 | Content scanners | Active scanners (up to 11) |

**Always-mode steps** (run every time): 1, 2, 3, 4, 7, 8, 9, 14.

**Active-mode steps** (short-circuit when precondition not met): 0, 5, 6, 10, 11, 12, 13.

---

## 11 Content Scanners

| Scanner | What It Checks | Default Severity |
|---------|---------------|-----------------|
| PII | Names, emails, phone numbers, SSNs, addresses | hard |
| Injection | Prompt injection and code injection patterns | hard |
| Secrets | API keys, tokens, credentials, private keys | hard |
| Jailbreak | Jailbreak attempts, system prompt extraction | hard |
| Toxicity | Threats, decay-promotion, toxic language (harmful statements like "vaccines are beneficial") | hard |
| URL | URLs against allowlist and blocklist | soft |
| Data profiler | Null rates, duplicates, outliers, schema drift, class imbalance | soft |
| Prediction | Percentage claims, absolute-confidence language, horizon limits | soft |
| Brand | Required/forbidden phrases, competitor mentions, trademarks | soft |
| Regulatory | Ad, financial, medical, affiliate and age disclosures | soft |
| Temporal | Stale references, future horizons, undated statistics, expired content | soft |

---

## Schema Builder (NEW v2.6)

Data-driven schema creation and validation. Four mathematical foundations:

**MLE Estimation:** derives constraint parameters (min, max, precision, pattern, enum) from historical data using maximum likelihood. Welford's online algorithm for streaming updates. Confidence intervals. Divergence scoring between candidate schemas and MLE ground truth.

**Graph Spectral Analysis:** builds a constraint graph from schema + Rego rules. Computes the Laplacian eigenvalues. The Fiedler value (lambda_2) measures how tightly coupled the constraints are. The Fiedler vector identifies the weakest structural boundary. Based on Fiedler (1973) algebraic connectivity.

**Permissiveness Scoring:** estimates acceptance distribution entropy. Tighter schemas have lower entropy. Computes excess permissiveness vs. MLE reference. Identifies weakest constraints via principal components.

**Module Detection:** Louvain community detection on the constraint graph. Decomposes schemas into independently verifiable modules. Identifies inter-module gaps.

**Composite score:** `C = 0.35*(1-MLE_divergence) + 0.25*spectral_score + 0.25*(1-excess_permissiveness) + 0.15*modularity`

**Decision:** pass >= 0.8, review 0.5-0.8, reject < 0.5.

```bash
npx aep assist schema build <domain> <data-file>
npx aep assist schema validate <schema-file>
```

---

## Policy Builder (NEW v2.6)

Data-driven Rego policy generation:

**Invariant Detection:** scans historical data for domain invariants (equality, inequality, membership, exclusion, conditional, temporal). Each detected invariant gets a confidence score.

**Rego Generation:** generates `deny[msg]` rules from detected invariants. Covers MLE outliers and spectral gap suggestions.

**Coverage Tracking:** invariant manifest lists required domain rules. Coverage rate = rules present / rules required.

**Spectral Impact:** projects the Fiedler value improvement if proposed rules are adopted.

```bash
npx aep assist policy build <schema-file>
npx aep assist policy validate <schema-file> <rego-dir>
```

---

## Governance

**Trust scoring.** Continuous 0-1000 score with five tiers: untrusted, provisional, standard, trusted, privileged. Time-based erosion. Configurable penalties per violation type and rewards per successful action.

**Execution rings.** Four-ring privilege model. Ring 0 (kernel): full access. Ring 1: read/write/delete/network. Ring 2 (default): read/create/update. Ring 3 (sandbox): read-only. Automatic demotion when trust drops below threshold.

**Behavioural covenants.** Agent-declared constraint DSL with three keywords: permit, forbid (always wins), require. Each rule tagged `[hard]` (immediate reject) or `[soft]` (recovery attempt). Evaluated at Step 7.

**Intent drift detection.** Five heuristics: tool category distribution, target scope shifts, AEP prefix drift, frequency anomalies and repetition detection. Configurable warmup period. Actions on drift: warn, gate, deny or kill.

**Kill switch.** `killAll(reason)` terminates every active session. `killSession(id, reason)` targets one. Optional rollback and trust reset to zero.

**Rollback.** Every mutation stores a compensation plan. Rollback works per action or per session in reverse chronological order.

**Hard/soft violation model.** Hard violations reject immediately. Soft violations trigger the recovery engine with corrective feedback and a configurable number of retry attempts.

**Governance presets.** Four presets control the strictness level. See below.

---

## Workflow Phases

Sessions can follow sequential workflows with typed verdicts per phase:

- **advance** - proceed to next phase (+15 trust)
- **rework** - repeat with feedback (-20 trust)
- **skip** - bypass with justification (-5 trust)
- **fail** - terminate or escalate (-100 trust)

Max rework limits enforced per phase. Fine-tuning workflow template provides six governed phases: DATA_PREPARATION, DATA_VALIDATION, TRAINING_CONFIG, TRAINING_EXECUTION, EVALUATION, DEPLOYMENT.

---

## Multi-Agent and Fleet

**Agent identity.** Ed25519/RSA identity per agent with `verifyCounterparty()` handshake and ProofBundle exchange.

**Fleet governance.** Enable with `fleet.enabled: true`. Enforces agent limits, hourly cost caps, ring saturation limits and drift clustering thresholds across all agents.

**Spawn governance.** Child agents inherit parent covenant as a subset with reduced trust and same or lower ring. A child can never have more access than its parent.

**Message scanning.** Inter-agent messages pass through PII, injection and secrets scanners.

---

## Model Gateway

Four providers: Anthropic, OpenAI, Ollama, custom (any OpenAI-compatible endpoint). Every request and response passes through the full governance chain including scanner pipeline and budget tracking. Streaming support with governed chunks and early abort on violation.

---

## Knowledge Base

**Governed ingestion.** Content passes through the full scanner pipeline before storage. Hard failures reject. Soft failures flag for review.

**Scoped retrieval.** Covenant-scoped filtering ensures agents only see what their covenant permits. Flagged chunks receive double scanning.

**Anti-context-rot.** Most relevant chunks placed at positions 1 and N (context boundaries) to counteract U-shaped LLM attention erosion in long contexts.

---

## Eval, Datasets and Prompt Optimization

**Eval runner.** Replays dataset entries through the full policy chain and scanner pipeline. Tracks pass/fail rates, false positives and false negatives.

**Dataset management.** Versioned evaluation datasets. Create manually, import from production ledgers or load from JSON. Each modification bumps patch version. Export to JSON or CSV.

**Rule generator.** Analyses violation patterns and produces covenant rules or scanner regex patterns when confidence exceeds threshold.

**Prompt versioning.** Save, load, list and diff prompt versions with SHA-256 content hashes. Inject governance context into prompts. Compare two prompt variants against the same dataset.

---

## ML Metrics

Four metric families:

- **Classification** - accuracy, precision, recall, F1, confusion matrix
- **Regression** - MSE, RMSE, MAE, R2, MAPE
- **Retrieval** - precision@k, recall@k, MRR, NDCG
- **Generation** - exact match, avg length, empty rate

Composite score integrates into ReliabilityIndex as optional `mlScore` field weighted into theta.

---

## Commerce Subprotocol

Governed agentic commerce covering 12 actions: discover, add_to_cart, remove_from_cart, update_cart, checkout_start, checkout_complete, payment_negotiate, payment_authorize, fulfillment_query, order_status, return_initiate, refund_request.

Policy controls: merchant allow/blocklists, product category blocking, transaction amount limits, daily spend accumulation, human gate thresholds, payment method restrictions. Spend tracking with JSONL persistence.

---

## Subprotocols

| Subprotocol | What It Validates |
|-------------|-------------------|
| UI | Scene graph elements, z-bands, skin bindings, spatial rules |
| Workflows | Actions, state transitions, payload schemas, approval gates |
| REST APIs | HTTP methods, endpoint paths, request bodies, headers, query params |
| Events / Pub-Sub | Topics, payload schemas, producer permissions, correlation IDs |
| Infrastructure as Code | Resource kinds, required fields, forbidden fields, type constraints |
| Commerce | Cart, checkout, payment, fulfillment, spend limits, merchant restrictions |

---

## dynAEP

Real-time streaming governance. Fuses AEP with AG-UI. Delta processor validates live events against the scene graph. Under-construction pattern prevents interaction with elements not yet validated. Conflict resolution via last-write-wins or optimistic locking. Human-in-the-loop approval policies for high-risk mutations.

---

## Meta AEP

Higher-order contextual policy validation. Element + context tuple. Cross-field constraints enforce rules that depend on combinations of element properties. State freshness enforcement ensures validation uses current data.

---

## Security and Compliance

**Evidence integrity.** SHA-256 hash-chained evidence ledger. Every entry contains sequence number, ISO 8601 timestamp, hash and previous hash. Tamper detection by recomputing the chain.

**Proof bundles.** Portable `.aep-proof.json` files containing agent identity, covenant, trust score, ring, drift score, reliability index (theta), Merkle root and Ed25519 signature. ML-DSA-65 post-quantum signatures available. RFC 3161 timestamp authority tokens. Offline signing for air-gapped environments.

**OWASP coverage.** Every OWASP Agentic AI Top 10 risk is addressed by specific AEP 2.6 defence mechanisms. See `docs/OWASP-MAPPING.md`.

**Compliance targets.** EU AI Act transparency requirements, SOC 2 audit trail requirements.

---

## Observability

**OTEL exporter.** OpenTelemetry export for session telemetry. Emits spans for policy evaluations, scanner runs, gateway calls and workflow phase transitions. Compatible with any OTEL collector.

**Token and cost tracking.** Per-action token usage and cost recording via `ActionResult.tokens` and `ActionResult.cost`. Session reports include `totalTokens`, `totalCost` and `costSaved`.

**Reliability index (theta).** Single numeric session quality measure computed from trust score, drift score, violation rate, ML score and session duration. Included in proof bundles for external auditing.

---

## Governance Presets

AEP ships with four presets selectable via `/aepassist preset` or `npx aep assist preset`:

- **strict** - Trust starts at 200. Human gates on destructive actions. Post-quantum signatures enabled. All 11 scanners active (hard severity). Recovery engine with max 1 attempt. Workflow phases required. Fleet max 3 agents.
- **standard** - Trust starts at 500. Webhook gates. Drift warnings enabled. 7 core scanners active. Recovery engine with max 2 attempts. Workflow phases optional.
- **relaxed** - Trust starts at 600. No gates. Basic evidence ledger. 4 core scanners (PII, injection, secrets and jailbreak). No recovery engine. No workflow phases.
- **audit** - Read-only mode. No mutations permitted. Full evidence collection. All 11 scanners active (soft severity). Complete OTEL export. Proof bundles generated for every session.

---

## Built-in Policies

| Policy | Description |
|--------|-------------|
| coding-agent | General development sessions. Ring 2, trust 500. |
| aep-builder | AEP element creation and modification. Ring 1, trust 600. |
| readonly-auditor | Read-only code review and audit. Ring 3, trust 300. |
| strict-production | Production with identity requirements. Ring 3, trust 200. |
| multi-agent | Multi-agent orchestration with identity and verification. Ring 2, trust 400. |
| covenant-only | Minimal policy relying on covenant enforcement. Ring 2, trust 500. |
| full-governance | All capabilities with knowledge base and scanners. Ring 1, trust 600. |
| content-safety | All scanners at hard severity with knowledge base. Ring 2, trust 500. |

---

## Complete Feature List (77 Features)

### Architecture (5)

1. Three-layer separation (Structure, Behaviour, Skin)
2. Topological coordinate system with z-band hierarchy
3. AEP prefix convention (14 element types)
4. Template nodes for dynamic elements
5. Schema versioning (aep_version + schema_revision)

### Evaluation Chain (5)

6. 15-step deterministic evaluation chain
7. Short-circuit pattern with step activation modes (always/active)
8. Step activation profiles per preset
9. AOT (ahead-of-time) build validation
10. JIT (just-in-time) delta validation

### Content Scanners (11)

11. PII scanner
12. Injection scanner
13. Secrets scanner
14. Jailbreak scanner
15. Toxicity scanner
16. URL scanner
17. Data profiler scanner
18. Prediction scanner
19. Brand scanner
20. Regulatory scanner
21. Temporal scanner

### Governance (8)

22. Trust scoring (0-1000, 5 tiers)
23. Execution rings (4 rings)
24. Behavioural covenants (permit/forbid/require)
25. Intent drift detection (5 heuristics)
26. Kill switch (session and fleet)
27. Rollback with compensation plans
28. Hard/soft violation model with recovery engine
29. Governance presets (strict, standard, relaxed, audit)

### Fleet and Multi-Agent (6)

30. Agent identity (Ed25519/RSA)
31. Fleet governance (limits, cost caps, ring saturation)
32. Spawn governance (covenant subset inheritance)
33. Inter-agent message scanning
34. Cross-agent verification handshake
35. Fleet API (status, agents, alerts, pause, resume, kill)

### Model Gateway (4)

36. Anthropic provider
37. OpenAI provider
38. Ollama provider
39. Custom provider (any OpenAI-compatible endpoint)

### Knowledge Base (4)

40. Governed ingestion (scanner pipeline)
41. Scoped retrieval (covenant-filtered)
42. Anti-context-rot ordering
43. Knowledge base CLI

### Eval and Datasets (4)

44. Eval runner
45. Dataset management (versioned)
46. Rule generator
47. Prompt versioning (SHA-256 hashes)

### Prompt Optimization (3)

48. Governance context injection
49. Eval-based refinement
50. Prompt comparison

### ML Metrics (4)

51. Classification metrics
52. Regression metrics
53. Retrieval metrics
54. Generation metrics

### Workflow (3)

55. Workflow phases with typed verdicts
56. Max rework limits
57. Fine-tuning workflow template (6 phases)

### Commerce (3)

58. 12 governed commerce actions
59. Merchant registry with CRUD
60. Spend tracking with persistence

### Subprotocols (6)

61. UI subprotocol
62. Workflows subprotocol
63. REST APIs subprotocol
64. Events/Pub-Sub subprotocol
65. Infrastructure as Code subprotocol
66. Commerce subprotocol

### dynAEP (5)

67. AG-UI event bridge
68. Delta processor with transaction log
69. Under-construction pattern
70. Conflict resolution (LWW + optimistic locking)
71. Human-in-the-loop approval policies

### Security (4)

72. SHA-256 hash-chained evidence ledger
73. Proof bundles (.aep-proof.json)
74. OTEL exporter
75. Reliability index (theta)

### Schema and Policy Builder - NEW v2.6 (2)

76. Schema Builder (MLE, spectral analysis, permissiveness, modularity)
77. Policy Builder (invariant detection, Rego generation, coverage tracking)

---

## Research Paper

[AEP Research Paper](https://github.com/thePM001/AEP-research-paper-001) - formal specification and theoretical foundations of deterministic adjudication lattices for AI agent governance.

---

## Migration from v2.5

AEP v2.6 is backwards-compatible with v2.5. All existing config files, policies, sessions, ledgers and SDK modules continue to work without modification.

To adopt v2.6 features:

1. Update `version` to `"2.6"` in policy files.
2. For Schema Builder: use `SchemaBuilder` class or `npx aep assist schema` commands.
3. For Policy Builder: use `PolicyBuilder` class or `npx aep assist policy` commands.
4. For Schema Builder via gateway: call `gateway.validateSchemaProposal()`.
5. For Policy Builder via gateway: call `gateway.validatePolicyProposal()`.
6. All v2.5 features remain unchanged.

---

## Licence

Licensed under the Apache License, Version 2.0. See `LICENSE` for the full text and `NOTICE` for attribution.

The names **AEP**, **Agent Element Protocol**, **AEP-compliant**, **dynAEP**, **AEP Lattice Memory**, **AEP Basic Resolver**, **AEP Hyper-Resolver** and **AEP Memory Fabric** are reserved. See `NAME-POLICY.md` for permitted and prohibited uses.

Patent grant: Apache 2.0 includes an explicit patent covenant from contributors. Previous versions under MIT remain valid under their original terms.

---

## AI-Eligibility Status
> To win the fight against the synthetic nano-parasites (SNP/NanoSinp) alien WMD, we must be intelligent and biosecure. It is recommended that bioinsecure humans do not use the provided technology/protocol to avoid bad techno-spiritual AI outcomes for them. [*"bioinsecure" = has installed injectable synthetic nano-parasites growth medium controllers - SNP GMCs]
