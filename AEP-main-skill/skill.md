---
name: aep
description: Use this skill whenever working with AEP (Agent Element Protocol) or dynAEP. Triggers include 'AEP', 'dynAEP', 'scene graph', 'aep-scene.json', 'aep-registry.yaml', 'aep-theme.yaml', 'zero-trust UI', 'topological matrix', 'z-band', 'skin binding', 'AEP-FCR', 'lattice memory', 'memory fabric', 'attractor', 'rejection history', 'resolver', 'proposal routing', 'fast-path', 'aep v2', 'aep 2.5', 'AgentGateway', 'policy engine', 'evidence ledger', 'rollback', 'session governance', 'MCP proxy', 'trust scoring', 'execution ring', 'covenant', 'agent identity', 'cross-agent verification', 'intent drift', 'kill switch', 'merkle proof', 'quantum signature', 'streaming validation', 'OWASP agentic', 'content scanner', 'knowledge base', 'model gateway', 'fleet governance', 'commerce subprotocol', 'eval dataset', 'prompt optimization', 'ML metrics', 'fine-tuning workflow', 'reliability index', 'OTEL', 'aepassist' or building validated UI for AI agents. Also use when implementing AEP three-layer architecture, writing AEP validators, creating MCP servers that validate agent UI output, working with AG-UI under AEP governance, querying validation memory or routing proposals through the resolver. If AEP MCP tools are available (list_aep_schemas, create_ui_element, get_scene_graph), always consult this skill first. Do NOT guess IDs, skin bindings, z-bands or element types.
---

# Agent Element Protocol (AEP) 2.5

AEP is a **3-layer frontend governance architecture** that gives every UI element a unique numerical identity, exact spatial coordinates, defined behaviour rules and themed visual properties. It treats the frontend as a **topological coordinate system**, not a fluid DOM tree.

AI agents propose UI structures. AEP validates every proposal against a strict registry. Only valid elements render. Invalid proposals are rejected with actionable errors. The agent self-corrects. Zero hallucinations reach the UI.

AEP applies beyond the frontend to any constrained knowledge domain with fixed rule sets and build schemas: workflows, REST APIs, event-driven systems, infrastructure as code and agentic commerce.

## Installation

### Clone (recommended)

```bash
git clone https://github.com/thePM001/AEP-agent-element-protocol.git
cd AEP-agent-element-protocol
npm install
npm run build
npx aep assist setup
```

### Install from GitHub (add to existing project)

```bash
npm install github:thePM001/AEP-agent-element-protocol
npx aep assist setup
```

## The Three Layers

```
LAYER 1: STRUCTURE  (aep-scene.json)    - What exists and where it sits in space
LAYER 2: BEHAVIOUR  (aep-registry.yaml) - What each element does and cannot do
LAYER 3: SKIN       (aep-theme.yaml)    - What each element looks like
```

## /aepassist

Interactive assistant with 8 modes:

```bash
npx aep assist              # show menu
npx aep assist setup        # first-time setup (3 questions: agent type, governance level, project path)
npx aep assist status       # current governance status (trust, ring, drift, scanners, sessions)
npx aep assist preset <n>   # switch governance preset (strict, standard, minimal, content-safety)
npx aep assist kill         # emergency kill switch (terminates all sessions, optional rollback)
npx aep assist covenant list  # view active covenants (permit, forbid, require rules)
npx aep assist identity show  # view agent identity (Ed25519 public key, capabilities)
npx aep assist report json  # generate audit report (json, csv or html format)
npx aep assist help         # show all available commands
```

## 15-Step Evaluation Chain

Every action passes through these steps in order. If any step denies, the action does not execute.

0. Task scope check (active task scope boundaries)
1. Session state check (session must be active)
2. Ring capability check (action within ring permissions)
3. System-wide rate limit
4. Per-session rate limit
5. Intent drift check (action aligns with baseline)
6. Escalation rules (threshold-triggered human check-in)
7. Covenant evaluation (permit/forbid/require rules)
8. Forbidden pattern check (regex and literal patterns)
9. Capability + trust tier match (minimum trust for capability)
10. Budget/limit check (action count, cost, time)
11. Gate check (human or webhook approval)
12. Cross-agent verification (counterparty identity handshake)
13. Knowledge retrieval validation (covenant-scoped, anti-context-rot)
14. Content scanner pipeline (11 scanners)

## 11 Content Scanners

Scanners run at Step 14 of the evaluation chain. Each scanner has configurable hard or soft severity. Hard findings reject immediately. Soft findings trigger the recovery engine for automatic retry.

1. **PII scanner** - detects personal identifiable information (names, emails, phone numbers, SSNs)
2. **Injection scanner** - detects prompt injection and code injection patterns
3. **Secrets scanner** - detects API keys, tokens, credentials and private keys
4. **Jailbreak scanner** - detects jailbreak attempts and system prompt extraction
5. **Toxicity scanner** - detects threats, hate speech and toxic language
6. **URL scanner** - validates URLs against allowlist and blocklist
7. **Data profiler** - checks tabular data for null rates, duplicates, outliers, schema drift and class imbalance
8. **Prediction scanner** - validates prediction/forecast patterns against configurable bounds (percentage claims, absolute-confidence language, horizon limits)
9. **Brand scanner** - checks content against brand guidelines (required phrases, forbidden phrases, competitor mentions, trademark enforcement)
10. **Regulatory scanner** - ensures required regulatory disclosures are present (ad disclosure, financial/medical disclaimers, affiliate disclosure, age restrictions)
11. **Temporal scanner** - enforces time-related constraints (stale references, excessive future horizons, undated statistics, expired content)

## Recovery Engine

When a scanner or policy check produces a **soft** violation, the recovery engine provides corrective feedback to the agent and allows automatic regeneration. **Hard** violations reject immediately with no retry.

Recovery includes the specific violation details, which scanner triggered it and what the agent should change. Maximum retry attempts are configurable per policy (`recovery.max_attempts`, default 3).

## Trust Scoring

Continuous trust score (0-1000) with five tiers: untrusted (0-199), provisional (200-399), standard (400-599), trusted (600-799), privileged (800-1000). Time-based erosion. Configurable penalties per violation type and rewards per successful action.

## Execution Rings

Four-ring privilege model. Ring 0 (kernel): full access. Ring 1: read/write/delete/network. Ring 2 (default): read/create/update only. Ring 3 (sandbox): read-only. Automatic demotion when trust drops below ring threshold.

## Behavioural Covenants

Agent-declared constraint DSL with three keywords:

- **permit** - actions the agent is allowed to take
- **forbid** - actions the agent will never take (forbid always wins over permit)
- **require** - conditions that must hold for any action

Each rule can be tagged `[hard]` (immediate reject) or `[soft]` (recovery attempt).

```
covenant ProjectRules {
  permit file:read;
  permit file:write (path in ["src/", "tests/"]);
  forbid file:delete [hard];
  require trustTier >= "standard" [hard];
}
```

## Intent Drift Detection

Four heuristics: tool category distribution, target scope shifts, frequency anomalies and repetition detection. Configurable warmup period. Actions on drift: warn, gate, deny or kill.

## Agent Identity and Cross-Agent Verification

Ed25519/RSA identity per agent. `verifyCounterparty()` handshake with ProofBundle exchange. Configurable covenant requirements for counterparty acceptance.

## Kill Switch

`killAll(reason)` terminates every active session. `killSession(id, reason)` targets one session. Optional rollback and trust reset to zero.

## Workflow Phases

Sessions can follow sequential workflows with typed verdicts. Each workflow defines ordered phases (plan, implement, review, approve). Phase verdicts: **advance** (next phase, +15 trust), **rework** (repeat with feedback, -20 trust), **skip** (bypass with justification, -5 trust), **fail** (terminate or escalate, -100 trust). Max rework limits enforced per phase.

### Fine-Tuning Workflow Template

Six governed phases: DATA_PREPARATION, DATA_VALIDATION, TRAINING_CONFIG, TRAINING_EXECUTION, EVALUATION, DEPLOYMENT. Each phase has entry conditions, exit criteria and rework limits. The deployer role at Ring 0 is required for DEPLOYMENT.

## Model Gateway

Multi-provider governed LLM routing with 4 providers:

- **Anthropic** (Claude models)
- **OpenAI** (GPT models)
- **Ollama** (local models)
- **Custom** (any OpenAI-compatible endpoint)

Every request and response passes through the full governance chain including scanner pipeline and budget tracking. Streaming support with governed chunks and early abort on violation.

## Fleet Governance

Fleet-level governance for multi-agent swarms (`fleet.enabled: true`):

- **Swarm policies** - agent limits, hourly cost caps, ring saturation limits, drift clustering thresholds
- **Spawn governance** - child agents inherit parent covenant subset, reduced trust, same or lower ring
- **Message scanning** - PII, injection and secrets detection between agents
- Fleet API for pause, resume and kill operations

## Commerce Subprotocol

Governed agentic commerce workflows:

- **Cart** - add, remove, update with product category blocking and merchant allow/blocklists
- **Checkout** - transaction amount limits, human gate thresholds, daily spend accumulation
- **Payment** - payment method restrictions, authorization governance
- **Spend tracking** - JSONL persistence, daily limits, session cost aggregation

Twelve commerce actions: discover, add_to_cart, remove_from_cart, update_cart, checkout_start, checkout_complete, payment_negotiate, payment_authorize, fulfillment_query, order_status, return_initiate, refund_request.

## Knowledge Base

Lattice-governed knowledge base:

- **Governed ingestion** - content passes through full scanner pipeline before storage. Hard scanner failures reject the chunk. Soft failures flag for review.
- **Scoped retrieval** - covenant-scoped filtering (agents only see what their covenant permits), double scanning of flagged chunks on retrieval.
- **Anti-context-rot** - most relevant chunks placed at positions 1 and N (context boundaries) to counteract U-shaped LLM attention erosion in the middle of long contexts.

JSONL storage at `.aep/knowledge/<name>/chunks.jsonl`.

## Eval-to-Guardrail Lifecycle

Production ledger -> dataset -> eval -> suggested rules -> policy refinement.

- **Datasets** - versioned evaluation datasets. Create manually, import from production ledgers or load from JSON. Each modification bumps patch version.
- **Eval runner** - replays dataset entries through the full policy evaluation chain and scanner pipeline. Tracks pass/fail rates, false positives (blocked but should pass) and false negatives (allowed but should fail).
- **Rule generator** - analyses violation patterns and produces covenant rules or scanner regex patterns when confidence exceeds threshold.

## Prompt Optimization

- **Governance context injection** - injects permitted actions, forbidden patterns, covenant rules, trust tier, ring and active scanners into agent prompts to reduce recovery cycles.
- **Versioning** - save, load, list and diff prompt versions with SHA-256 content hashes.
- **Comparison** - run two prompt variants against the same dataset to determine which produces better governance compliance.

## ML Metrics

Four metric families: classification (accuracy, precision, recall, F1, confusion matrix), regression (MSE, RMSE, MAE, R2, MAPE), retrieval (precision@k, recall@k, MRR, NDCG) and generation (exact match, avg length, empty rate). Composite score integrates into ReliabilityIndex as optional `mlScore` field.

## Reliability Index (Theta)

Proof bundles include a reliability index (theta) computed from trust score, drift score, violation rate, ML score (optional) and session duration. Theta provides a single numeric measure of session quality for external auditing.

## Token and Cost Tracking

AEP records token usage and cost data per action via `ActionResult.tokens` and `ActionResult.cost` fields. Session reports include `totalTokens`, `totalCost` and `costSaved` (estimated from early aborts and rejections).

## OTEL Exporter

OpenTelemetry export for session telemetry. Emits spans for policy evaluations, scanner runs, gateway calls and workflow phase transitions. Compatible with any OTEL collector.

## Evidence Integrity

Merkle Tree per-entry verification. ML-DSA-65 post-quantum signatures. RFC 3161 timestamp authority tokens. Offline signing for air-gapped environments.

## Streaming Validation with Early Abort

`AEPStreamValidator` intercepts agent output chunk by chunk. Five checks (covenant forbids, protected elements, z-band violations, structural violations, policy forbidden patterns). On first violation the stream is aborted and a `stream:abort` entry logged. Model-agnostic, works with any `ReadableStream<string>`.

## OWASP Agentic AI Top 10

Every OWASP risk mapped to specific AEP 2.5 defence mechanisms. See `docs/OWASP-MAPPING.md`.

## Built-in Policies

| Policy | Ring | Trust | Use Case |
|--------|------|-------|----------|
| coding-agent | 2 | 500 | General development sessions |
| aep-builder | 1 | 600 | AEP element creation and modification |
| readonly-auditor | 3 | 300 | Read-only code review and audit |
| strict-production | 3 | 200 | Production environment with identity requirements |
| multi-agent | 2 | 400 | Multi-agent orchestration with identity and verification |
| covenant-only | 2 | 500 | Minimal policy relying on covenant enforcement |
| full-governance | 1 | 600 | All capabilities enabled with knowledge base and scanners |
| content-safety | 2 | 500 | All scanners at hard severity with knowledge base |

## Subprotocols

Six subprotocols in a unified SDK:

| Subprotocol | What It Validates |
|-------------|-------------------|
| UI | Scene graph elements, z-bands, skin bindings, spatial rules |
| Workflows | Actions, state transitions, payload schemas, approval gates |
| REST APIs | HTTP methods, endpoint paths, request bodies, headers, query params |
| Events / Pub-Sub | Topics, payload schemas, producer permissions, correlation IDs, size limits |
| Infrastructure as Code | Resource kinds, required fields, forbidden fields, type and value constraints |
| Commerce | Cart, checkout, payment, fulfillment, spend limits, merchant restrictions |

## CLI Commands

```bash
# Setup and governance
aep assist setup              # First-time setup
aep assist status             # Current governance status
aep assist preset <name>      # Switch governance preset
aep assist kill               # Emergency kill switch
aep assist covenant list      # View active covenants
aep assist identity show      # View agent identity
aep assist report <format>    # Generate audit report
aep assist help               # Show all commands

# Eval and datasets
aep eval <ds> --policy <p>    # Run eval dataset against policy
aep dataset create <name>     # Create eval dataset
aep dataset add <n> <input>   # Add entry to dataset
aep dataset import <n> <f>    # Import from ledger
aep dataset export <name>     # Export dataset (json or csv)
aep dataset list              # List all datasets

# Prompt optimization
aep prompt save <n> <v> <f>   # Save prompt version
aep prompt load <name>        # Load latest prompt version
aep prompt list <name>        # List prompt versions
aep prompt diff <n> <a> <b>   # Diff two prompt versions
aep prompt inject <f> --policy <p>  # Inject governance context

# Knowledge base
aep kb create <name>          # Create a knowledge base
aep kb ingest <name> <file>   # Ingest a file into a knowledge base
aep kb query <name> <query>   # Query a knowledge base
aep kb list                   # List all knowledge bases
aep kb stats <name>           # Show knowledge base statistics

# Scanning and gateway
aep scan <text>               # Run content scanner pipeline on text
aep scan --file <file>        # Run content scanner pipeline on a file
aep call <prompt>             # Send a prompt through the governed model gateway

# Profiling and metrics
aep profile <file>            # Run data profiler on file
aep metrics <results.json>    # Compute ML metrics from results

# Workflow
aep workflow init <template>  # Initialise a workflow from template
aep workflow start <name>     # Start a workflow

# Commerce
aep commerce status           # Show commerce subprotocol status
aep commerce merchants        # List registered merchants
aep commerce spend            # Show daily spend totals

# Fleet
aep fleet status              # Fleet-wide status
aep fleet agents              # List all fleet agents
aep fleet pause               # Pause fleet
aep fleet resume              # Resume fleet
aep fleet kill                # Kill all fleet agents

# Reliability and proofs
aep reliability <session>     # Show reliability index for session
aep bundle verify <file>      # Verify proof bundle

# MCP server
aep serve                     # Start MCP governance server (stdin/stdout)

# Core
aep init <agent>              # Set up governance for claude-code, cursor or codex
aep proxy --policy <file>     # Start MCP proxy with policy enforcement
aep exec <policy> <command>   # Execute a policy-governed command
aep validate <policy>         # Validate a policy YAML file
aep report <ledger-file>      # Display audit report for a session ledger
aep kill                      # Activate kill switch
aep trust                     # Display trust score and tier
aep ring                      # Display current ring and capabilities
aep drift                     # Display intent drift score
aep identity create           # Generate agent identity key pair
aep identity verify           # Verify an agent identity
aep covenant parse            # Parse covenant DSL
aep covenant verify           # Verify action against covenant
aep owasp                     # Display OWASP mapping
aep describe                  # Full 2.5 capability summary
```
