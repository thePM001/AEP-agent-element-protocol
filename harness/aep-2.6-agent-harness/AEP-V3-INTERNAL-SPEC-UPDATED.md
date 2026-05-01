# AEP v3.0 INTERNAL PROPRIETARY ENGINEERING SPECIFICATION

Hypergraph-Lattice Architecture with Memory, Mirror Twin and Company Lattice

CONFIDENTIAL // INTERNAL USE ONLY // NEVER PUBLIC

New Lisbon Agency // thePM001

April 2026 (Updated for v2.5 baseline)

---

## 0. Scope and Hardware Constraint

AEP v3.0 bundles every upgrade that is feasible on current standard datacenter hardware. No computational storage devices (CSDs), no photonic processors, no exotic substrates. Everything described in this document runs on commodity NVMe SSDs, standard x86/ARM CPUs and standard GPUs (NVIDIA A100/H100 class or consumer equivalents).

This maps to Horizons H0 through H2 plus H1.5 from the internal roadmap:

| Component | Roadmap Origin | Hardware Requirement |
|---|---|---|
| Hypergraph-Lattice | Grok research + H0 extension | CPU only |
| Hyper-Resolver | Grok research | CPU only |
| Memory-Augmented Lattice (DAL v2) | H1 | CPU + NVMe + PostgreSQL/pgvector |
| Self-Evolution Hook | H1.5 | CPU only |
| SOMTAL Mirror Twin | H2 | CPU only (pure software) |
| Company Lattice | Grok research | CPU + network |
| Gate Layer (SLM/LLM routing) | Grok research | CPU + GPU (for SLM inference) |
| Radia DB Disk Docking | Grok research | CPU + NVMe |
| CAMARA Verification Stack | H0 (proprietary) | CPU only |

Everything excluded (H3 through H6) requires hardware that does not exist in standard deployments today. Those remain in the roadmap as future horizons.

### 0.1 AEP v2.5 Baseline (NEW)

AEP v3.0 builds on v2.5 as the baseline. The following v2.5 capabilities are inherited unchanged and serve as foundation for v3.0 components:

| v2.5 Capability | v3.0 Component It Feeds |
|---|---|
| Model Gateway (4 providers) | Gate Layer absorbs and extends it |
| Fleet Governance (swarm policies, spawn governance) | Company Lattice absorbs and extends it |
| Knowledge Base (governed RAG, anti-context-rot) | Memory-Augmented Lattice absorbs and extends it |
| Eval-to-Guardrail Lifecycle | Self-Evolution Hook absorbs and extends it |
| 11 Content Scanners | CAMARA Level 5 absorbs scanner results |
| Recovery Engine (hard/soft distinction) | Hyper-Resolver uses recovery for warm-path proposals |
| Workflow Phases (typed verdicts) | Hyper-edge workflow constraints extend this |
| Commerce Subprotocol | Company Lattice sub-lattice for finance/commerce |
| ML Metrics Evaluator | CAMARA Level 5 (RGSV) uses ML metrics |
| Prompt Optimization | Gate Layer uses governance context injection |
| /aepassist | Supervision Center absorbs as primary interface |
| 15-step Evaluation Chain | Preserved intact. Hyper-Resolver adds pre-chain routing |
| Trust Scoring with Erosion | Preserved. Company Lattice adds cross-department trust |
| Execution Rings | Preserved. Gate Layer adds confidence-gated ring selection |
| Behavioural Covenants | Preserved. Hyper-edges extend covenants to multi-node constraints |
| OTEL Exporter | Preserved. SOMTAL adds differential comparison spans |
| Token/Cost Tracking | Preserved. Gate Layer adds SLM vs LLM cost routing |
| Data Profiling Scanner | Preserved. Bio-KDS extends with molecular profiling |

---

## 1. Architecture Overview

AEP v3.0 transforms the v2.5 evaluation chain and governance system into a Hypergraph-Lattice with persistent memory, a mirror twin for differential validation, a gate for intelligent model routing and a docking system for entire codebases.

```
+---------------------------+
|     COMPANY LATTICE       |
|  (firm-wide hypergraph)   |
+-----------+---------------+
            |
  +---------+---------+
  |         |         |
+-v------+ +v-------+ +v--------+
| DEPT-A | | DEPT-B | | DEPT-C  |
| Sub-   | | Sub-   | | Sub-    |
| Lattice| | Lattice| | Lattice |
+---+----+ +---+----+ +---+----+
    |          |          |
    +----------+----------+
               |
       +-------v--------+
       |   GATE LAYER   |
       |   SLM / LLM    |
       |   routing       |
       +-------+--------+
               |
  +------------+------------+
  |            |            |
+-v--------+ +v----------+ +v--------+
| HYPER-   | | MEMORY    | | SOMTAL  |
| RESOLVER | | FABRIC    | | MIRROR  |
|          | | (DAL v2)  | | TWIN    |
+----+-----+ +-----+-----+ +---+----+
     |              |            |
     +--------------+------------+
                    |
            +-------v--------+
            |  HYPERGRAPH-   |
            |  LATTICE       |
            | (adjudication) |
            +-------+--------+
                    |
            +-------v--------+
            | RADIA DB DISKS |
            | (docked        |
            |  codebases)    |
            +-------+--------+
                    |
            +-------v--------+
            |    CAMARA      |
            |  VERIFICATION  |
            |    STACK       |
            +----------------+
```

The validation flow from v2.5 is preserved intact. The 15-step evaluation chain runs unchanged within the Hypergraph-Lattice. Every component in v3.0 is additive. Nothing in v2.5 breaks.

---

## 2. Hypergraph-Lattice

### 2.1 What Changes From v2.5

The v2.5 evaluation chain operates on individual agent actions with binary relationships (parent-child elements, covenant rules, scanner findings). This is sufficient for single-agent governance but insufficient for representing complex organizational relationships where multiple nodes participate in a single constraint simultaneously.

The v3.0 Hypergraph-Lattice replaces binary edges with hyper-edges. A hyper-edge connects two or more nodes simultaneously. This allows:

- A single Rego policy that constrains a Rule + a Tool + a Norm + a Tribal-Knowledge entry simultaneously
- Cross-department constraints that span multiple sub-lattices (extending v2.5 fleet governance)
- Memory attractors that encode multi-node validated configurations as single retrievable units (extending v2.5 knowledge base)
- Workflow transitions that depend on the state of multiple concurrent elements (extending v2.5 workflow phases)

### 2.2 Formal Definition

A hypergraph H = (V, E) where:

- V is the set of nodes (AEP elements, resources, agents, norms, tools)
- E is a set of hyper-edges, where each e in E is a non-empty subset of V with |e| >= 2

The adjudication lattice from the research paper operates identically on the hypergraph. Verification predicates evaluate over hyper-edges instead of binary edges. The convergence theorem (Theorem 3.3) holds unchanged because the population dynamics are independent of edge arity.

### 2.3 Node Types

| Node Type | Prefix | Description |
|---|---|---|
| Element | XX-NNNNN | Existing AEP UI/API/IaC/Workflow/Commerce elements |
| Norm | NM-NNNNN | Tribal knowledge, cultural rules, undocumented procedures |
| Tool | TL-NNNNN | External tools, APIs, services the organization uses |
| Agent | AG-NNNNN | AI agents operating within the lattice (v2.5 fleet agents) |
| Rule | RL-NNNNN | Formal Rego policies, TLA+ invariants, v2.5 covenants |
| Memory | ME-NNNNN | Attractor states, rejection episodes (v2.5 knowledge chunks) |
| Scanner | SC-NNNNN | v2.5 scanner instances and their finding patterns |
| Workflow | WF-NNNNN | v2.5 workflow phases and verdict history |

### 2.4 Hyper-Edge Types

| Hyper-Edge Type | Connects | Example |
|---|---|---|
| Constraint | Rule + multiple Elements | "These three elements must never be in state X simultaneously" |
| Workflow | Agent + Tool + Element + Norm | "Agent AG-00001 uses Tool TL-00003 to modify Element CP-00005 subject to Norm NM-00002" |
| Approval | Norm + Agent + Rule | "This norm requires this agent role to approve before this rule can be modified" |
| Dependency | Multiple Elements | "These five elements form a cohesive unit that must be validated atomically" |
| Memory Trace | Element + Memory + Agent | "This attractor was created by this agent for this element" |
| Fleet | Agent + Agent + Policy | "These agents share a fleet constraint (v2.5 fleet governance hyper-edge)" |
| Commerce | Cart + Merchant + Payment + Agent | "This commerce transaction spans these governed entities" |
| Scanner | Scanner + Finding + Element + Recovery | "This scanner found this issue in this element, recovery attempted" |

### 2.5 Implementation

Stack:
- Kuzu or cuGraph for in-memory hypergraph operations
- PostgreSQL + pgvector for persistent storage
- Custom serialization for hyper-edges (JSON arrays of node IDs with metadata)

The hypergraph is the foundational data structure. Every other v3.0 component (Hyper-Resolver, Memory Fabric, SOMTAL, Company Lattice) operates on this hypergraph.

### 2.6 Backward Compatibility

Every v2.5 binary relationship (parent-child elements, covenant rules, scanner findings, fleet agent links, commerce transactions) is a hyper-edge with exactly two nodes. Existing scene graphs, registries, theme files, policies, covenants, knowledge bases and fleet configurations load without modification. The hypergraph is a strict superset of the v2.5 graph.

---

## 3. Hyper-Resolver

### 3.1 What Changes From v2.5 Basic Resolver

The v2.5 Basic Resolver routes by element prefix and z-band with Rego enforcement and attractor fast-path. It is stateless and rule-based. The v2.5 Model Gateway adds provider-agnostic model calls with output validation. The v3.0 Hyper-Resolver combines and extends both:

- Norm-based routing: routes are influenced by organizational norms (tribal knowledge encoded as hyper-edges)
- Confidence-gated model selection: the resolver decides whether an internal SLM or an external LLM handles the request (absorbs v2.5 Model Gateway routing logic)
- Traversal optimization: the resolver uses the hypergraph topology to find the shortest validation path through the lattice strata
- Recovery-aware routing: proposals that previously triggered v2.5 soft violations are routed through warm-path with pre-loaded corrective context

### 3.2 Routing Logic

```
INPUT: Agent request + current context (hypergraph state)

1. Parse request domain (UI, Workflow, API, Event, IaC, Commerce, custom KDS)

2. Query Memory Fabric for nearest attractor
   - If match > 0.98 similarity: FAST PATH, return cached traversal
   - If match > 0.90 similarity: WARM PATH, validate only changed nodes
   - If no match: COLD PATH, full lattice traversal

3. Query applicable Norms via hyper-edge traversal
   - Find all NM-nodes connected to the request domain
   - Evaluate norm conditions (human feedback scores, approval thresholds)

4. Route to Gate Layer for model selection
   - If lattice confidence >= 0.98: route to internal SLM
   - If lattice confidence < 0.98: route to external LLM
   - If norm requires human approval: route to Supervision Center

5. Run v2.5 15-step evaluation chain on the output
   (chain is unchanged, runs inside the hypergraph context)

6. Return: route, constraints, norms, model assignment, traversal path
```

### 3.3 Rego Policy for Hyper-Resolution

```rego
allow_hyper_resolve {
    input.request.domain == "finance_renewal"
    some norm
    norm := lattice.norms[input.context.tribal_knowledge_hash]
    norm.approval_threshold <= input.human_feedback_score
}

deny_hyper_resolve[msg] {
    input.request.domain == "compliance"
    input.gate.model_type == "external"
    msg := "Compliance domain requests must use internal SLM only"
}
```

### 3.4 Norm Integration

Norms are first-class hyper-edges in the lattice. They represent organizational knowledge that lives in people's heads and has never been formalized. The Hyper-Resolver reads norms the same way it reads Rego policies and v2.5 behavioural covenants. The differences:

- Rego policies are deterministic binary rules (allow/deny)
- v2.5 behavioural covenants are agent-declared (permit/forbid/require with hard/soft severity)
- Norms carry a confidence weight derived from human feedback
- Norms can be overridden by an authorized agent with logged justification
- Norms evolve over time via the Self-Evolution Hook (Section 6)

A norm example:

```yaml
NM-00001:
  type: norm
  domain: finance
  description: "Renewal contracts over 50K EUR require VP approval even if the automated confidence score is high"
  confidence: 0.92
  source: "SME feedback, 47 instances observed"
  connected_nodes: ["AG-00003", "RL-00012", "TL-00005"]
  last_updated: "2026-04-15T10:00:00Z"
```

---

## 4. Memory-Augmented Lattice (DAL v2)

### 4.1 Architecture

This is the full version of the Memory Fabric. v2.5 shipped a basic subset: governed knowledge base with scanner-validated ingestion, covenant-scoped retrieval and anti-context-rot ordering. The v3.0 Memory Fabric extends this with:

- Multi-node sharding by Knowledge Domain Schema (KDS)
- Evolutionary loop: small population of mutations around attractors
- Full lattice traversal path storage with predicate evaluation results
- Temporal history per KDS, per domain, per agent lineage
- Semantic embeddings via configurable embedding model (v2.5 uses TF-IDF + hash fingerprint, v3.0 adds full vector embeddings via the Model Gateway)

### 4.2 Storage Architecture

```
+------------------------------------------+
|            MEMORY FABRIC                 |
|                                          |
| +--------------+ +-----------------+     |
| | PostgreSQL   | | Vector Index    |     |
| | + pgvector   | | (FAISS/pgvector)|     |
| |              | |                 |     |
| | Structured   | | Embedding       |     |
| | entries,     | | similarity      |     |
| | traversal    | | search          |     |
| | paths,       | |                 |     |
| | metadata     | |                 |     |
| +--------------+ +-----------------+     |
|                                          |
| +--------------+ +-----------------+     |
| | Kuzu/cuGraph | | RocksDB         |     |
| |              | |                 |     |
| | In-memory    | | Append-only     |     |
| | graph ops,   | | rejection log   |     |
| | hyper-edge   | | (immutable)     |     |
| | traversal    | |                 |     |
| +--------------+ +-----------------+     |
+------------------------------------------+
```

### 4.3 Memory-Augmented Adjudication

The adjudication engine from the research paper gains memory integration:

1. Incoming proposal is embedded via the configured embedding model (v2.5 Model Gateway provides the embedding call)
2. Memory Fabric retrieves nearest validated attractor via vector similarity + graph traversal
3. Optional evolutionary loop: generate a small population of mutations around the attractor
4. Full lattice check (Adjudication Lattice + Mirror Twin if active) runs on survivors
5. v2.5 15-step evaluation chain runs on the winning candidate
6. v2.5 content scanners (all 11) run on the output
7. Accept: apply, store success path with full traversal data
8. Reject: store rejection episode with exact stratum, predicate and error payload
9. v2.5 recovery engine fires on soft violations (re-prompt, re-adjudicate)

The accept/reject decision remains 100% deterministic. Memory only guides the proposal step and ranking phase. The TLA+ invariant MemoryDoesNotAffectDecision from v2.0/v2.5 is preserved.

### 4.4 Attractor Dynamics

An attractor is a validated configuration that the lattice has seen and accepted multiple times. As the Memory Fabric accumulates accepted proposals, attractor regions form naturally. New proposals in the neighborhood of an attractor converge faster because:

- The Hyper-Resolver provides the cached traversal path
- The evolutionary loop seeds from nearby known-good states instead of random sampling
- The population size required drops (warm-start vs cold-start)
- v2.5 knowledge base chunks that match an attractor skip cold-path retrieval

The research paper's Theorem 3.2 (Monotone Stratum Rejection) predicts this: conditioning on prior accepted outputs shifts the generative distribution toward the feasible region. Memory makes this conditioning explicit and persistent across sessions.

### 4.5 Sharding

Each Knowledge Domain Schema (KDS) gets its own shard in the Memory Fabric. Shards are independent. A UI-domain shard does not interfere with a Workflow-domain shard. Cross-domain queries use the hypergraph to traverse between shards.

Sharding is by domain first, then by sub-domain if volume requires it:

```
memory/
  ui/         -- UI element validations
  workflow/   -- Workflow step validations
  api/        -- API call validations
  event/      -- Event validations
  iac/        -- IaC resource validations
  commerce/   -- Commerce transaction validations (NEW from v2.5)
  fleet/      -- Fleet governance decisions (NEW from v2.5)
  bio/        -- Bio-KDS (when active)
  custom/     -- User-defined KDS
```

### 4.6 What This Buys

- Faster convergence: warm-start from nearest attractor beats cold probabilistic sampling
- Smaller effective compute: the 85-95% fast-path hit rate reduces expensive Convergent Validation populations
- Institutional memory: new agents inherit lessons of every prior agent in the same KDS
- Predictable storage I/O: append-only writes and locality-rich reads
- v2.5 eval-to-guardrail data feeds directly into attractor seeding (production violations become training data for the Memory Fabric)

---

## 5. SOMTAL (Software-Optimized Mirror Twin Adjudication Lattice)

### 5.1 What It Is

SOMTAL is a second, independent copy of the adjudication lattice running in parallel. Every proposal is validated by BOTH the primary lattice and the mirror twin. The results are compared. Any disagreement triggers investigation.

This is pure software. No special hardware. Two lattice instances on the same machine or on two machines in the same datacenter.

### 5.2 Why It Exists

The research paper identifies the soundness gap (Section 9.1): if a predicate has a false-accept rate of epsilon, the residual defect probability is at most epsilon per stratum. SOMTAL addresses this by running a structurally different validator configuration against the same proposals. A defect that slips through Lattice A is likely caught by Lattice B if B uses different predicate implementations or evaluation order.

v2.5 already has 11 content scanners that catch different categories of issues. SOMTAL extends this principle to the entire validation pipeline, not just content scanning.

### 5.3 Architecture

```
         PROPOSAL
            |
  +---------+----------+
  |                    |
  v                    v
+----------+    +----------+
| PRIMARY  |    | MIRROR   |
| LATTICE  |    | TWIN     |
|          |    | (SOMTAL) |
| 15-step  |    | 15-step  |
| chain    |    | chain    |
| order    |    | DIFF     |
| A,B,C,D  |    | order    |
|          |    | D,C,B,A  |
+----+-----+    +----+-----+
     |               |
     +-------+-------+
             |
     +-------v-------+
     | DIFFERENTIAL  |
     | COMPARATOR    |
     |               |
     | Both accept ? |
     | Both reject ? |
     | Disagree ?    |
     +-------+-------+
             |
     +-------v-------+
     | RESULT        |
     |               |
     | Agree: apply  |
     | Disagree:     |
     |   escalate    |
     +---------------+
```

### 5.4 Differential Fingerprinting

SOMTAL does not re-run every predicate from scratch. It uses differential fingerprinting to identify which predicates are likely to produce different results on a given proposal:

1. Hash the proposal
2. Compare against the fingerprint table (which tracks historical predicate-specific acceptance patterns per proposal hash neighborhood)
3. If the fingerprint predicts identical results for a predicate on both lattices: skip it on the mirror (fast-path)
4. If the fingerprint predicts potential divergence: run it on both (full check)

This reduces the computational cost of SOMTAL from 2x to approximately 1.15x in mature lattices where most predicates agree on most proposals.

### 5.5 Hierarchical Stages

SOMTAL operates in stages of increasing strictness:

Stage 1: Shadow mode. Mirror twin runs but results are logged, not enforced. The comparator records disagreement rates to calibrate the system.

Stage 2: Advisory mode. Disagreements trigger warnings in the Supervision Center but do not block execution.

Stage 3: Enforcement mode. Both lattices must agree for a proposal to be accepted. Disagreements escalate to human review.

Deployment sequence: start at Stage 1, observe for a calibration period, promote to Stage 2 when disagreement rate stabilizes, promote to Stage 3 when false-positive rate of disagreements drops below threshold.

### 5.6 Integration with v2.5 (NEW)

- SOMTAL disagreements are logged as OTEL spans (v2.5 telemetry exporter)
- SOMTAL cost is tracked via v2.5 token/cost tracking (mirror twin calls count separately)
- SOMTAL stage transitions are governed by v2.5 workflow phases (advance from Shadow to Advisory requires typed verdict)
- SOMTAL results feed into v2.5 reliability index (theta gains a somtal_agreement component)

---

## 6. Self-Evolution Hook (H1.5)

### 6.1 What It Does

The lattice observes its own rejection patterns and proposes new Rego rules or TLA+ invariants that would prevent recurring defect classes. An operator (or a trusted governance agent with signed authority) must approve before promotion. Once promoted, new rules become permanent constraints.

v2.5 already has the eval-to-guardrail lifecycle (eval runner analyses violation patterns, rule generator produces suggested covenant rules). The Self-Evolution Hook extends this from manual "run eval, review suggestions" to continuous automated observation with human-gated promotion.

### 6.2 How It Works

1. The Memory Fabric accumulates rejection episodes (v2.5 evidence ledger provides the raw data)
2. A pattern detector (running periodically or on-demand) clusters rejections by error type, element type, domain and agent (v2.5 eval runner provides the clustering logic)
3. If a cluster exceeds a threshold (e.g. 10+ identical rejections from 3+ different agents), the hook generates a candidate rule
4. The candidate rule is expressed in Rego syntax (extending v2.5 rule generator output)
5. The candidate is submitted to the Supervision Center for review
6. If approved: the rule is promoted to the active policy set, versioned, logged with the approver identity and OpenTimestamps-proof
7. If rejected: the candidate is archived with the rejection reason

### 6.3 Approval Gate

The approval gate lives in the Supervision Center. It enforces:

- Differential trust: different approvers have different authority levels
- Bayesian-with-erosion trust scores: trust in an approver erodes if their approved rules are later revoked
- Calibrated confidence: the system tracks how often self-proposed rules actually prevent future defects
- Probed trust: periodic synthetic rule proposals test whether the approval process catches bad rules

### 6.4 What It Does NOT Do

The Self-Evolution Hook does NOT:

- Automatically promote rules without human approval
- Modify existing rules (only proposes new ones)
- Override the Adjudication Lattice (proposed rules are additional predicates, not replacements)
- Move inference inside the lattice (the generative model stays outside)

---

## 7. Company Lattice

### 7.1 What It Is

A single AEP Hypergraph-Lattice representing an entire organization. Departments are sub-lattices. Cross-department processes are hyper-edges connecting nodes across sub-lattices.

v2.5 fleet governance provides the foundation: swarm-level policies, spawn governance (child covenant must be subset of parent), inter-agent message scanning, fleet-wide kill switch. The Company Lattice extends this from "fleet of agents" to "fleet of departments, each with their own agents, norms and policies."

### 7.2 Structure

```
COMPANY LATTICE
+-- Engineering Sub-Lattice
|   +-- Frontend elements (UI AEP)
|   +-- Backend workflows
|   +-- IaC resources
|   +-- Engineering norms
+-- Finance Sub-Lattice
|   +-- Approval workflows
|   +-- Contract validation (v2.5 commerce subprotocol)
|   +-- Finance norms
+-- Operations Sub-Lattice
|   +-- Deployment pipelines
|   +-- Monitoring rules
|   +-- Operations norms
+-- Cross-Department Hyper-Edges
    +-- "Code release requires both Engineering approval and Operations sign-off"
    +-- "Contract over 50K EUR requires Finance VP and Legal review"
    +-- "Customer data access requires Engineering auth + Compliance audit"
```

### 7.3 Department Onboarding

To add a department to the Company Lattice:

1. Define the department's KDS (what schemas, rules and norms apply)
2. Register the department as a sub-lattice with its own node prefix
3. Define cross-department hyper-edges for processes that span boundaries
4. Seed the Memory Fabric with the department's existing validated configurations
5. Deploy agents with appropriate Gate Layer permissions
6. Configure v2.5 fleet governance policies for the department's agent pool
7. Import existing v2.5 evidence ledger data as initial attractor seeds

### 7.4 Cross-Department Validation

When a proposal touches nodes in multiple sub-lattices (e.g. a code deployment that affects Engineering and Operations), the Hyper-Resolver:

1. Identifies all affected sub-lattices via hyper-edge traversal
2. Validates the proposal against each sub-lattice independently
3. Validates cross-department hyper-edges (the constraints that span boundaries)
4. Runs v2.5 content scanners on any output (all 11 scanners, each sub-lattice can add domain-specific scanner config)
5. All must pass. Any single failure rejects the entire proposal.

---

## 8. Gate Layer

### 8.1 Purpose

The Gate Layer decides whether a request is handled by an internal SLM (small language model, lattice-optimized, running on-premises) or routed to an external LLM (Claude, GPT, etc.).

v2.5 Model Gateway provides the provider-agnostic call infrastructure (Anthropic, OpenAI, Ollama, custom). The Gate Layer adds confidence-based routing and data-leak protection on top.

### 8.2 Routing Logic

```
IF lattice_confidence >= 0.98:
    route to INTERNAL SLM (via v2.5 Model Gateway, ollama provider)
    reason: "Proposal is within known attractor region, SLM sufficient"

ELSE IF lattice_confidence >= 0.80:
    route to INTERNAL SLM with SOMTAL mirror validation
    reason: "Proposal is near attractor boundary, SLM with double-check"

ELSE IF lattice_confidence < 0.80:
    route to EXTERNAL LLM (via v2.5 Model Gateway, anthropic/openai provider)
    reason: "Proposal is in unknown territory, frontier model needed"
    apply DATA LEAK PROTECTION (see 8.3)

IF norm_requires_human_approval:
    route to SUPERVISION CENTER (via /aepassist emergency)
    reason: "Organizational norm requires human sign-off"
```

### 8.3 Data-Leak Protection

When routing to an external LLM, the Gate Layer NEVER sends the full lattice state or raw codebase content. It sends:

- An anonymized lattice subgraph containing only the nodes relevant to the request
- Node IDs are replaced with opaque tokens
- Proprietary values are masked
- v2.5 content scanners (PII, secrets) run on the outbound payload as an additional check

The response from the external LLM is de-anonymized by the Gate Layer before entering the validation pipeline.

### 8.4 SLM Requirements

The internal SLM must be:

- Small enough to run on standard GPU hardware (7B to 13B parameters typical)
- Fine-tuned on the organization's validated outputs from the Memory Fabric (v2.5 governed fine-tuning workflow template provides the 6-phase process)
- Lattice-optimized: trained to produce outputs that conform to the organization's KDS
- Quantized to 4-bit or 8-bit for inference efficiency

The SLM does not need to be a frontier model. The lattice compensates for model weakness by filtering outputs through deterministic predicates. A weak model + strong lattice = strong validated output.

### 8.5 Cost Optimization (NEW)

The Gate Layer uses v2.5 token/cost tracking to measure the cost difference between SLM and LLM routing per domain. Over time, the Gate Layer learns which domains are cost-effective on the SLM and which require frontier models. This data feeds into v2.5 eval reports and the Supervision Center dashboard.

---

## 9. Radia DB Disk Docking Gate

### 9.1 What It Is

A Radia DB Disk is an immutable, versioned, cryptographically signed storage unit containing an entire codebase (repository, monorepo, microservice, IaC stack, legacy code).

### 9.2 Disk Structure

Each Radia DB Disk has:

- A unique Hypergraph Node ID (e.g. RD-00001)
- A Merkle-DAG of the entire file structure
- Embedded Lattice Memory (all prior agent traces, human feedbacks, norm updates for this codebase)
- OpenTimestamps proof of each version
- Cryptographic signature chain (every version signed by the dock authority)
- v2.5 knowledge base chunks pre-extracted from the codebase (scanner-validated, covenant-scoped)

### 9.3 Docking Protocol

```
DOCK REQUEST
    |
    v
+--------------------+
| DOCKING GATE       |
|                    |
| 1. Verify signature|
| 2. Check version   |
|    >= min_version   |
| 3. Evaluate Rego   |
|    dock policy      |
| 4. Validate against |
|    lattice schema   |
| 5. Run v2.5 content |
|    scanners (secrets |
|    PII, injection)  |
| 6. Mount disk into  |
|    hypergraph       |
+--------------------+
```

Rego dock policy:

```rego
allow_dock {
    input.disk.signature_valid
    input.disk.version >= lattice.min_version[input.domain]
    input.human_approval_score >= 0.95
}

deny_dock[msg] {
    input.disk.contains_secrets == true
    msg := "Disk contains unmasked secrets, dock denied"
}
```

### 9.4 Live Sync

When a docked disk's source codebase changes:

1. New version of the disk is created (immutable, the old version stays)
2. Docking Gate validates the new version (including v2.5 content scanners)
3. A new hyper-edge is created in the lattice connecting the new version to all relevant domains
4. All agents see the updated, validated codebase immediately
5. Old version is archived but never deleted (full audit trail via v2.5 evidence ledger)

### 9.5 Agent Navigation

With Radia DB Disks docked, an agent does not ask "how does the auth logic work" and hallucinate an answer. It navigates the hypergraph of the docked disk deterministically:

- Every file, module and function is a node
- Dependencies, calls and tribal norms are hyper-edges
- Memory sits on the edges ("this function was used 47 times by agents, corrected 3 times by SME feedback")

The agent traverses. It does not guess. Zero hallucinations because the entire codebase lives in the lattice.

---

## 10. CAMARA Verification Stack

### 10.1 Overview

CAMARA is the proprietary formal verification pipeline that makes AEP provably correct. It provides 9+ levels of proof.

### 10.2 Levels

| Level | Technology | What It Proves |
|---|---|---|
| 1 | Z3 (SMT Solver) | Constraint satisfiability. No configuration bypasses a policy. |
| 2 | TLA+ (Temporal Logic) | Safety (nothing bad ever happens), liveness (every request eventually resolves), fairness (no agent permanently starved) |
| 3 | Rust (Memory Safety) | Validator pipeline has no buffer overflows, no use-after-free, no data races |
| 4 | Cedar (Authorization) | Fine-grained deterministic permit/deny based on principal, action, resource and context |
| 5 | RGSV (Randomized Groundtruth Sampling Verification) | Statistical verification of predicates against known-good/known-bad test vectors. v2.5 ML metrics feed accuracy data. v2.5 eval datasets provide test vectors. |
| 6 | Adversarial Fuzzing | Automated generation of adversarial inputs targeting predicate boundaries. v2.5 content scanners provide the input patterns. |
| 7 | Differential Testing | Primary lattice vs SOMTAL twin comparison on large proposal corpora. v2.5 OTEL exporter provides span data for analysis. |
| 8 | Cryptographic Verification | OpenTimestamps proof chains on every schema version, every rule promotion, every disk version. v2.5 proof bundles provide the baseline. |
| 9 | Audit Trail Integrity | Append-only logs with Merkle proof that no entry has been modified or deleted. v2.5 SHA-256 chain and ML-DSA-65 provide the cryptographic foundation. |

### 10.3 Z3 Integration

```python
from z3 import *

# Element z-band constraint
element_z = Int('element_z')
prefix = String('prefix')

# CP elements must be in z-band 20-29
s = Solver()
s.add(prefix == StringVal("CP"))
s.add(Or(element_z < 20, element_z > 29))

# If satisfiable, there exists a violating configuration
if s.check() == sat:
    print("VULNERABILITY: CP element can escape z-band 20-29")
    print(s.model())
else:
    print("PROVEN SAFE: No CP element can escape z-band 20-29")
```

### 10.4 Cedar Integration

```cedar
permit(
    principal == Agent::"AG-00001",
    action == Action::"modify_element",
    resource == Element::"CP-00003"
) when {
    context.environment == "development" &&
    context.agent_trust_score >= 0.8
};

forbid(
    principal,
    action == Action::"delete_element",
    resource
) when {
    context.environment == "production"
};
```

### 10.5 Rust Validator Core

The production validator pipeline is implemented in Rust. The entire validation boundary is memory-safe. No managed runtime. No garbage collection pauses. Deterministic latency.

The Rust core exposes:
- C FFI for integration with Python/Node.js runtimes (v2.5 TypeScript calls via FFI)
- WebAssembly build for browser-side validation (dynAEP)
- gRPC server for network-based validation

---

## 11. Bio-KDS Application

### 11.1 Scope

Bio-KDS applies the AEP v3.0 architecture to molecular and protein structure validation. This is engineering-ready once the Memory-Augmented Lattice (Section 4) is deployed.

### 11.2 Architecture

Structure Layer (molecular aep-scene.json equivalent):
- Backbone topology: residues with unique IDs, sequence connectivity, disulfide bonds
- Atomic coordinates: x/y/z per atom with parent reference to residue, chain, assembly
- Topological invariants: chain membership, domain boundaries, multimer interface geometry

Behaviour Layer (molecular aep-registry.yaml with Rego and TLA+):
- Steric clash deny rules
- Ramachandran region membership (allowed phi/psi dihedral regions per residue type)
- Hydrogen-bond geometry constraints
- Hydrophobic packing scores above threshold
- Energy proxies below threshold (coarse-grained, not full ab initio)
- Pocket complementarity for ligand-binding validation
- TLA+ invariants for multimer assembly

Skin Layer:
- Solvent exposure, post-translational modifications, visualization overlays

### 11.3 Data-Burden Collapse

This is the direct answer to the 3.88 x 10^15 record problem from the roadmap. The local rules of chemistry (steric clashes, Ramachandran limits, hydrogen-bond geometry) are encoded as deterministic invariants in the lattice. The Memory Fabric stores validated conformations as reusable attractors. 85-95% of proposals in a mature Bio-KDS land on existing attractors. The data-collection frontier shrinks to targeted experimental validation that calibrates the invariants, not exhaustive sampling that memorizes the space.

### 11.4 Engineering Plan

- Prototype on a single fold family (kinase catalytic domain)
- Rego policy set covering clashes, Ramachandran and basic energy proxies
- Distilled ternary proposer (OmegaFold-class) for candidate conformations
- FAISS for conformation embeddings on commodity NVMe
- v2.5 data profiling scanner extended with molecular quality checks
- v2.5 ML metrics extended with structural biology metrics (RMSD, GDT-TS, lDDT)
- Validate against PDB ground truth
- Measure fast-path hit rate, rejection precision and bootstrap time

---

## 12. Implementation Priority Order

| # | Item | Depends On | Estimated Effort |
|---|---|---|---|
| 1 | Hypergraph data structure (Kuzu + PostgreSQL) | v2.5 complete | 3 weeks |
| 2 | Hyper-edge CRUD API | #1 | 1 week |
| 3 | Migrate v2.5 binary relationships to hyper-edges | #1, #2 | 1 week |
| 4 | Memory Fabric multi-node (PostgreSQL + pgvector + RocksDB) | #1 | 4 weeks |
| 5 | Evolutionary loop (population mutations around attractors) | #4 | 2 weeks |
| 6 | Hyper-Resolver with norm-based routing | #1, #4 | 3 weeks |
| 7 | Gate Layer (SLM/LLM routing + data-leak protection) | #6, v2.5 Model Gateway | 2 weeks |
| 8 | SOMTAL differential fingerprinting and shadow mode | #4 | 3 weeks |
| 9 | SOMTAL advisory and enforcement modes | #8 | 2 weeks |
| 10 | Self-Evolution Hook with Supervision Center approval gate | #4, #6, v2.5 eval-to-guardrail | 2 weeks |
| 11 | Company Lattice (sub-lattices + cross-department hyper-edges) | #1, #6, v2.5 fleet governance | 3 weeks |
| 12 | Radia DB Disk Docking Gate | #1, #6 | 3 weeks |
| 13 | CAMARA Level 1-4 (Z3, TLA+, Rust core, Cedar) | #1 | 6 weeks |
| 14 | CAMARA Level 5-9 (RGSV, fuzzing, differential, crypto, audit) | #8, #13, v2.5 ML metrics | 4 weeks |
| 15 | Bio-KDS prototype (kinase catalytic domain) | #4, v2.5 data profiler | 6 weeks |

Total: approximately 45 weeks for a small team (2-3 engineers). Reduced from 48 weeks because v2.5 provides the Model Gateway (#7 drops from 3 to 2 weeks), fleet governance foundation (#11 drops from 4 to 3 weeks) and eval-to-guardrail foundation (#10 drops from 3 to 2 weeks).

Items 1-6 can be parallelized. Items 13-14 can run in parallel with 7-12.

---

## 13. What Does Not Change From v2.5

The following are invariant across all versions:

**Preserved from v1.1/v2.0:**
- Three-layer separation (Structure, Behaviour, Skin) with independent configs
- ID minting authority stays with the server/bridge. Agents never mint.
- Two-phase Convergent Validation: Phase 1 hard-filter sound, Phase 2 ranking best-effort
- Multi-lineage consensus for Phase 2 ranking
- 128-bit ElementId with explicit region, HMAC prefix, generation counter
- KDS versioning with deprecation windows, conflict detection, liability chaining
- The architectural response to the soundness-gap: RGSV plus differential testing plus sound-by-construction predicates
- Every AEP config file requires aep_version and schema_revision
- The Centroid Absorber for sequential coherence
- The Freshness Predicate for temporal epistemic consistency

**Preserved from v2.5 (NEW):**
- 15-step evaluation chain (runs inside the hypergraph context)
- 11 content scanners (PII, injection, secrets, jailbreak, toxicity, URLs, data profiler, prediction, brand, regulatory, temporal)
- Recovery engine with hard/soft violation distinction
- Trust scoring with erosion (0-1000 across five tiers)
- Execution rings (0-3 with auto-demotion)
- Behavioural covenants (permit, forbid, require with hard/soft severity)
- Intent drift detection (5 heuristics with warmup period)
- Kill switch with optional rollback
- Evidence ledger with SHA-256 chain, ML-DSA-65, RFC 3161, Merkle proofs
- Proof bundles with reliability index (theta)
- Streaming validation with mid-stream abort
- Governed task decomposition with scope inheritance
- Workflow phases with typed verdicts (advance, rework, skip, fail)
- Commerce subprotocol (cart, checkout, payment, fulfillment)
- Fleet governance (swarm policies, spawn governance, message scanning)
- /aepassist interactive assistant (8 modes via CLI and MCP)
- Token and cost tracking per action
- OTEL exporter for observability
- Prompt optimization with governance context injection
- Dataset management with ledger import
- ML metrics evaluator (classification, regression, retrieval, generation)
- Governed fine-tuning workflow template (6 phases)
- All 8 built-in policies
- 6 subprotocols (UI, workflow, API, event, infrastructure, commerce)
- OWASP Agentic Top 10 compliance
- Apache 2.0 licence on open-source components

Every v3.0 component inherits these guarantees unchanged. The upgrade is additive, not revisionary.

---

## 14. What Is Excluded (Future Horizons, Exotic Hardware)

| Horizon | What | Why Excluded |
|---|---|---|
| H3 | CSD-backed Memory Fabric | Requires computational storage devices not yet in standard datacenters |
| H4 | MTAL on dual-CSD substrate | Same |
| H5 | Photonic MTAL/RTMTAL | Requires photonic processing hardware (lab prototypes only) |
| H6 | Lattice-Native Generation | Speculative endgame, requires years of fabric accumulation |

These remain in the roadmap. When the hardware becomes available, v3.0's architecture is designed to accept these upgrades as substrate swaps without protocol changes.

---

## 15. Security Classification

This document is CONFIDENTIAL and INTERNAL USE ONLY.

It must NEVER be:

- Uploaded to any public repository
- Shared outside New Lisbon Agency without explicit written authorization from thePM001
- Referenced in public documentation, blog posts, social media or conference presentations
- Included in any open-source release
- Shared with any AI model training pipeline

The open-source v2.5 release contains the basic subset (knowledge base, model gateway, fleet governance, eval-to-guardrail, content scanners, recovery engine, workflow phases, commerce subprotocol, ML metrics, /aepassist). Everything in this document beyond v2.5 is proprietary.

---

End of Specification // AEP v3.0 Internal Proprietary // CONFIDENTIAL // thePM001
