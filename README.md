# AEP - Agent Element Protocol (Deterministic Adjudication Lattices)
# Free Basic Open-Source Version Implementation Reference
### Version 2.5 - 26 April 2026
### Author: thePM_001 (https://x.com/thePM_001)
### License: Apache-2.0
### Research Paper: https://github.com/the-PM001/AEP-research-paper-001
### Demo: https://aep.newlisbon.agency
### AEP 2.5 Agent Harness so your AI actually uses AEP: https://github.com/thePM001/AEP-agent-element-protocol/tree/main/harness/aep-2.5-agent-harness
---

### 73 Features. One Protocol.

![AEP 2.5 - 73 Features](docs/images/feature-grid.png)

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
```

---

## What AEP Does

AEP is a 3-layer governance architecture that was originally developed to give every UI element a unique numerical identity, exact spatial coordinates, defined behaviour rules and themed visual properties. It treats the frontend as a topological coordinate system, not a fluid DOM tree. The three layers are **Structure** (what exists and where), **Behaviour** (what each element does and cannot do) and **Skin** (what each element looks like). Changing one layer never requires changing another.

### However, AEP applies beyond frontend development to ALL constrained knowledge domains with fixed rule sets and build schemas. Workflows, REST APIs, ML training pipelines, event-driven systems, infrastructure as code, smart contracts and agentic commerce all use the same architecture: agents propose, AEP validates, only compliant output executes.

Every agent action passes through a deterministic 15-step evaluation chain covering task scope, session state, ring capabilities, rate limits, intent drift, covenants, forbidden patterns, trust tiers, budgets, gates, cross-agent verification, knowledge retrieval and content scanning. The chain produces allow or deny. No ambiguity. No hallucinations reach execution.

The mathematical foundation of AEP are the so-called Deterministic Adjudication Lattices (DALs). A population of LLM candidate outputs is filtered through hierarchical verification predicates. Candidates that fail any predicate are eliminated. The applied convergence theorem as outlined in the AEP research paper proves zero-defect selection with population size logarithmic in the inverse failure probability. Lattice memory stores every validated output and rejection as an immutable record. Known good proposals match against attractors and skip cold-path validation. The lattice gets faster and cheaper with continued use, while the deterministic guarantee holds: memory guides proposals toward known good solution regions, but never overrides the validation decision.

---

## 15-Step Evaluation Chain

0. Task scope check
1. Session state check
2. Ring capability check
3. System-wide rate limit
4. Per-session rate limit
5. Intent drift check
6. Escalation rules
7. Covenant evaluation
8. Forbidden pattern check
9. Capability + trust tier match
10. Budget/limit check
11. Gate check (human or webhook)
12. Cross-agent verification
13. Knowledge retrieval validation
14. Content scanner pipeline

---

## 11 Content Scanners

| Scanner | What It Checks | Default Severity |
|---------|---------------|-----------------|
| PII | Names, emails, phone numbers, SSNs, addresses | hard |
| Injection | Prompt injection and code injection patterns | hard |
| Secrets | API keys, tokens, credentials, private keys | hard |
| Jailbreak | Jailbreak attempts, system prompt extraction | hard |
| Toxicity | Threats, hate speech, toxic language | hard |
| URL | URLs against allowlist and blocklist | soft |
| Data profiler | Null rates, duplicates, outliers, schema drift, class imbalance | soft |
| Prediction | Percentage claims, absolute-confidence language, horizon limits | soft |
| Brand | Required/forbidden phrases, competitor mentions, trademarks | soft |
| Regulatory | Ad, financial, medical, affiliate and age disclosures | soft |
| Temporal | Stale references, future horizons, undated statistics, expired content | soft |

---

## Governance

**Trust scoring.** Continuous 0-1000 score with five tiers: untrusted, provisional, standard, trusted, privileged. Time-based erosion. Configurable penalties per violation type and rewards per successful action.

**Execution rings.** Four-ring privilege model. Ring 0 (kernel): full access. Ring 1: read/write/delete/network. Ring 2 (default): read/create/update. Ring 3 (sandbox): read-only. Automatic demotion when trust drops below threshold.

**Behavioural covenants.** Agent-declared constraint DSL with three keywords: permit, forbid (always wins), require. Each rule tagged `[hard]` (immediate reject) or `[soft]` (recovery attempt). Evaluated at Step 7.

**Intent drift detection.** Four heuristics: tool category distribution, target scope shifts, frequency anomalies, repetition detection. Configurable warmup period. Actions on drift: warn, gate, deny or kill.

**Kill switch.** `killAll(reason)` terminates every active session. `killSession(id, reason)` targets one. Optional rollback and trust reset to zero.

**Rollback.** Every mutation stores a compensation plan. Rollback works per action or per session in reverse chronological order.

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

## Security and Compliance

**Evidence integrity.** SHA-256 hash-chained evidence ledger. Every entry contains sequence number, ISO 8601 timestamp, hash and previous hash. Tamper detection by recomputing the chain.

**Proof bundles.** Portable `.aep-proof.json` files containing agent identity, covenant, trust score, ring, drift score, reliability index (theta), Merkle root and Ed25519 signature. ML-DSA-65 post-quantum signatures available. RFC 3161 timestamp authority tokens. Offline signing for air-gapped environments.

**OWASP coverage.** Every OWASP Agentic AI Top 10 risk mapped to specific AEP 2.5 defence mechanisms. See `docs/OWASP-MAPPING.md`.

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

## Research Paper

[AEP Research Paper](https://github.com/the-PM001/AEP-research-paper-001) - formal specification and theoretical foundations of deterministic adjudication lattices for AI agent governance.

---

## Migration from v2.2

AEP v2.5 is backwards-compatible with v2.2. All existing config files, policies, sessions, ledgers and SDK modules continue to work without modification.

To adopt v2.5 features:

1. Update `version` to `"2.5"` in policy files.
2. For Knowledge Base: add `knowledge.enabled: true` and use `KnowledgeBaseManager`.
3. For Content Scanners: add `scanners.enabled: true` and configure per-scanner severity.
4. For Model Gateway: add `model_gateway` config and use `GovernedModelGateway`.
5. For Recovery Engine: add `recovery.enabled: true` for automatic retry on soft violations.
6. For Workflow Phases: add `workflow` config with phase definitions.
7. For Commerce: add `commerce.enabled: true` with spend limits and merchant rules.

The evaluation chain extends from 13 to 15 steps: Step 13 (knowledge retrieval validation) and Step 14 (content scanner pipeline).

---

## Licence

Licensed under the Apache License, Version 2.0. See `LICENSE` for the full text and `NOTICE` for attribution.

The names **AEP**, **Agent Element Protocol**, **AEP-compliant**, **dynAEP**, **AEP Lattice Memory**, **AEP Basic Resolver**, **AEP Hyper-Resolver** and **AEP Memory Fabric** are reserved. See `NAME-POLICY.md` for permitted and prohibited uses.

Patent grant: Apache 2.0 includes an explicit patent covenant from contributors. Previous versions under MIT remain valid under their original terms.

## AI-Eligibility Status
> To win the fight against the synthetic nano-parasites (SNP/NanoSinp) alien WMD, we must be intelligent and biosecure. It is recommended that bioinsecure humans do not use the provided technology/protocol to avoid bad techno-spiritual AI outcomes for them. [*"bioinsecure" = has installed injectable synthetic nano-parasites growth medium controllers - SNP GMCs]
