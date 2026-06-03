---
name: aep
description: Use this skill whenever working with AEP (Agent Element Protocol), dynAEP, dynAEP-TA, dynAEP-TA-P or any AEP governance feature. Triggers include 'AEP', 'dynAEP', 'dynAEP-TA', 'dynAEP-TA-P', 'temporal authority', 'perception governance', 'perception registry', 'bridge clock', 'causal ordering', 'vector clock', 'TimesFM', 'adaptive perception', 'perception bounds', 'scene graph', 'aep-scene.json', 'aep-registry.yaml', 'aep-theme.yaml', 'zero-trust UI', 'topological matrix', 'z-band', 'skin binding', 'AEP-FCR', 'temporal annotations', 'speech pacing', 'haptic timing', 'notification cadence', 'Schema Builder', 'Policy Builder', 'Lattice Memory', 'evaluation chain', 'trust scoring', 'execution rings', 'behavioural covenants', 'content scanners', 'evidence ledger', or building validated UI for AI agents. Also use when implementing AEP three-layer architecture, writing AEP validators, creating MCP servers that validate agent UI output, working with AG-UI under AEP governance, or governing time-dependent outputs for human perception. If AEP MCP tools are available (list_aep_schemas, create_ui_element, get_scene_graph), always consult this skill first. Do NOT guess IDs, skin bindings, z-bands or element types. Do NOT use Date.now() or any local clock when dynAEP-TA is available - call dynaep_temporal_query instead.
---

# Agent Element Protocol (AEP) v2.75

AEP is a **3-layer frontend governance architecture** that gives every UI element a unique numerical identity, exact spatial coordinates, defined behaviour rules and themed visual properties. It treats the frontend as a **topological coordinate system**, not a fluid DOM tree.

AI agents propose UI structures. AEP validates every proposal against a strict registry. Only valid elements render. Invalid proposals are rejected with actionable errors. The agent self-corrects. Zero hallucinations reach the UI.

AEP applies beyond the frontend to any constrained knowledge domain with fixed rule sets and build schemas: workflows, REST APIs, event-driven systems, infrastructure as code and agentic commerce.

## The Protocol Stack

```
LAYER       PROTOCOL        FUNCTION
-------     -----------     ----------------------------------------
Agent-Tools MCP             Agent connects to external data and tools
Agent-Agent (any)           Agents coordinate across distributed systems
Agent-User  AG-UI           Real-time event streaming between agent and frontend
Agent-UI    AEP             Deterministic UI structure, behaviour and skin
Agent-Live  dynAEP          AEP governance applied to live AG-UI event streams
Agent-Time  dynAEP-TA       Temporal authority, causal ordering, predictive forecasting
Agent-Percept dynAEP-TA-P   Perceptual temporal governance for human-facing outputs
```

## The Three Layers

AEP enforces strict separation into three independent layers. Each has its own config file. **Changing one layer NEVER requires changing another.**

```
LAYER 1: STRUCTURE  (aep-scene.json)    - What exists and where it sits in space
LAYER 2: BEHAVIOUR  (aep-registry.yaml) - What each element does and cannot do
LAYER 3: SKIN       (aep-theme.yaml)    - What each element looks like
```

| Scenario | What changes | What stays |
|----------|-------------|------------|
| Add dark mode | Skin only | Structure + Behaviour |
| Move sidebar to the right | Structure only | Behaviour + Skin |
| Add keyboard shortcut | Behaviour only | Structure + Skin |
| AI agent repositions a panel | Structure only | Behaviour + Skin |
| Complete visual rebrand | Skin only | Structure + Behaviour |

If you find yourself editing two layers for one change, the separation is broken. Fix it.

## Schema Versioning

Every AEP config file MUST include `aep_version` and `schema_revision` in its header. The validator MUST reject any file missing `aep_version`.

```json
{ "aep_version": "1.1", "schema_revision": 1, "elements": { ... } }
```

```yaml
aep_version: "1.1"
schema_revision: 1
```

---

## AEP Prefix Convention

Every element ID follows the format `XX-NNNNN` (2-letter prefix + zero-padded number).

### Universal Prefixes

| Prefix | Type | Description | Z-Band |
|--------|------|-------------|--------|
| SH | Shell | Root application container | 0-9 |
| PN | Panel | Major layout sections | 10-19 |
| NV | Navigation | Sidebars, tabs, breadcrumbs | 10-19 |
| CP | Component | Interactive elements (buttons, inputs, toggles) | 20-29 |
| FM | Form | Form containers | 20-29 |
| IC | Icon | Standalone icon elements | 20-29 |
| CZ | Cell Zone | Repeating data display regions (grids, lists) | 30-39 |
| CN | Cell Node | Individual items within a Cell Zone (dynamic) | 30-39 |
| TB | Toolbar | Status bars, tool strips | 40-49 |
| WD | Widget | Self-contained visual units (charts, cards, meters) | 50-59 |
| OV | Overlay | Transparent layers over content | 60-69 |
| MD | Modal/Dialog | Popups, dialogs, toasts | 70-79 |
| DD | Dropdown | Flyout menus, select lists | 70-79 |
| TT | Tooltip | Hover information | 80-89 |

Add project-specific prefixes as needed. Define them in your README before writing any code.

## Z-Band Hierarchy

z-index values are grouped into bands. An element's z MUST fall within its type's band. The validator rejects violations.

```
z: 0-9     Shells (root containers, backgrounds)
z: 10-19   Panels, Navigation (major layout sections)
z: 20-29   Components, Forms, Icons (interactive elements)
z: 30-39   Cell Zones, Cell Nodes (data grids, lists)
z: 40-49   Toolbars (status bars, filter bars)
z: 50-59   Widgets (charts, cards, visualizations)
z: 60-69   Overlays (animations, selection highlights, debug)
z: 70-79   Modals, Dialogs, Dropdowns (interrupting content)
z: 80-89   Tooltips (highest non-system layer)
z: 90-99   System (loading screens, fatal errors, dev tools)
```

A Modal (z: 70-79) ALWAYS renders above a Data Grid (z: 30-39). A Tooltip (z: 80-89) ALWAYS renders above a Modal. This is mathematically enforced, not left to CSS cascade accidents.

---

## Layer 1: Structure (aep-scene.json)

The scene graph. A flat JSON object where every UI element has topological constraints (anchors/flex rules), dimensions, z-index, parent reference and visibility flag. The scene graph is the **single source of truth** for layout.

```json
{
  "aep_version": "1.1",
  "schema_revision": 1,
  "elements": {
    "SH-00001": {
      "id": "SH-00001",
      "type": "shell",
      "label": "App Shell",
      "z": 0,
      "visible": true,
      "parent": null,
      "spatial_rule": "flex",
      "direction": "column",
      "layout": { "width": "100vw", "height": "100vh" },
      "children": ["PN-00001", "PN-00002", "PN-00003"]
    },
    "PN-00001": {
      "id": "PN-00001",
      "type": "panel",
      "label": "Header Panel",
      "z": 10,
      "visible": true,
      "parent": "SH-00001",
      "spatial_rule": "flex",
      "direction": "row",
      "justify": "space-between",
      "layout": { "width": "100%", "height": "40px" },
      "children": ["CP-00001", "CP-00002"]
    }
  },
  "viewport_breakpoints": {
    "base": { "max_width": 639 },
    "vp-md": { "min_width": 640, "max_width": 1023 },
    "vp-lg": { "min_width": 1024 }
  }
}
```

### Topological Constraint System

Elements declare position through relational anchors, flex/grid spatial rules and viewport-aware breakpoint matrices.

**Relational Anchors** - position relative to parents or siblings:
```json
"layout": {
  "anchors": {
    "top": "PN-00001.bottom",
    "left": "SH-00001.left",
    "right": "SH-00001.right"
  }
}
```

**Viewport Matrix** - responsive breakpoints per element:
```json
"responsive_matrix": {
  "base": { "visible": false },
  "vp-md": { "visible": true, "width": 250 },
  "vp-lg": { "visible": true, "width": 300 }
}
```

An agent can query this and know not to place essential UI inside an element that is hidden on mobile.

### Structure Rules

1. Every element MUST have a unique ID following the prefix convention.
2. Every element MUST have a parent (except the root Shell).
3. Children MUST be topologically contained within their parent.
4. z-index values MUST follow the z-band hierarchy.
5. The scene graph is the single source of truth for layout. CSS derives from it.

---

## Layer 2: Behaviour (aep-registry.yaml)

The component registry (AEP-FCR). Every element that renders pixels has an entry defining what it does, its states, events, constraints and what it is forbidden from doing. Layer 2 contains **no visual properties**. All styling is delegated to Layer 3 through `skin_binding`.

```yaml
aep_version: "1.1"
schema_revision: 1

CP-00001:
  label: "Import Button"
  category: action
  function: "Opens file dialog to import CSV/XLSX files."
  component_file: "HeaderPanel.jsx"
  parent: "PN-00001"
  skin_binding: "button_primary"
  states:
    default: "Idle, clickable"
    hover: "Lighter accent background"
    loading: "Disabled, shows spinner"
    disabled: "Grayed out"
  actions:
    - "open_file_dialog"
    - "trigger_import"
  events:
    click: "invoke('import_file')"
  constraints:
    - "Must always be visible in header"
    - "Must be disabled during active import"
  keyboard_shortcut: "Ctrl+O"
```

### Registry Entry Requirements

Every entry MUST have: `label`, `category` (action | data-input | data-display | feedback | layout | system), `function`, `component_file`, `parent`, `skin_binding`, `states`, `constraints`.

### Template Nodes (Dynamic Elements)

Elements spawned dynamically (grid rows, list items) are governed by Template Nodes. The validator checks the Template at build time. Runtime instances inherit its proven safety and are exempt from per-instance validation.

```yaml
CN-TEMPLATE-01:
  label: "Result Row"
  category: data-display
  component_file: "ResultRow.jsx"
  parent: "CZ-00001"
  skin_binding: "cell_node"
  instance_prefix: "CN"
  instance_range: "CN-00001 to CN-99999"
```

Validate the mould, not every item poured from it.

### Forbidden Patterns (OPA/Rego)

The registry defines patterns that must NEVER occur, using Open Policy Agent (Rego):

```rego
package aep.forbidden

deny[msg] {
  some m; startswith(m, "MD")
  some g; startswith(g, "CZ")
  input.scene[m].z <= input.scene[g].z
  msg := sprintf("Modal %v must render above grid %v", [m, g])
}

deny[msg] {
  some id
  input.scene[id].parent != null
  not input.registry[input.scene[id].parent]
  msg := sprintf("Orphan: %v references unregistered parent %v", [id, input.scene[id].parent])
}
```

---

## Layer 3: Skin (aep-theme.yaml)

All colours, fonts, spacing, borders, shadows and animations. Components reference theme variables through `skin_binding`. No component ever contains hardcoded visual values.

```yaml
aep_version: "1.1"
schema_revision: 1
theme_name: "Project Dark"

colours:
  bg_primary: "#0D1117"
  accent: "#58A6FF"
  error: "#F85149"
  success: "#3FB950"

component_styles:
  button_primary:
    background: "{colours.accent}"
    colour: "#000000"
    padding: "4px 12px"
    border_radius: "4px"
  cell_node:
    background: "{colours.bg_cell}"
    colour: "{colours.text_primary}"
    border_bottom: "1px solid {colours.border}"
```

### Skin Binding Resolution

```
Registry: CP-00001.skin_binding = "button_primary"
Theme:    component_styles.button_primary -> { background, colour, padding, ... }
Result:   CP-00001 renders with resolved style properties
```

To add dark/light mode: create a new YAML with different values for the same keys. Structure and Behaviour untouched.

---

## Validation

### AOT (Ahead-of-Time) - Build Time

Proves the static scene graph, registry and theme are 100% sound. Checks every element, parent reference, z-band, skin binding, forbidden pattern and Template Node.

### JIT (Just-in-Time) Delta - Runtime

When an agent or user triggers a mutation, checks only the specific element against its immediate parents, constraints and z-band. Template Node instances are exempt (mould already proven by AOT).

### Validation Checks

1. Element ID exists in registry (or is a Template instance)
2. Parent exists in scene
3. z-index within correct band for prefix
4. No forbidden pattern triggered (Rego)
5. Prefix matches element type
6. skin_binding resolves to valid component_styles block

---

## ID Minting

**Agents NEVER generate AEP IDs.** The server/bridge mints all IDs using sequential counters per prefix. When an agent proposes a new element, it provides type, parent, z, skin_binding and label. The server returns the minted ID (e.g., `PN-00003`). This prevents ID collisions in multi-agent scenarios.

---

## 15-Step Evaluation Chain

Every action passes through these steps in order. If any step denies, the action does not execute.

| Step | Name | Mode | Description |
|------|------|------|-------------|
| 0 | Task scope check | hard | Active task scope boundaries |
| 1 | Session state check | hard | Session must be active |
| 2 | Ring capability check | hard | Action within ring permissions |
| 3 | System-wide rate limit | hard | Global rate limit enforcement |
| 4 | Per-session rate limit | hard | Session-specific rate limit |
| 5 | Intent drift check | configurable | Action aligns with baseline |
| 6 | Escalation rules | configurable | Threshold-triggered human check-in |
| 7 | Covenant evaluation | hard/soft | Permit/forbid/require rules |
| 8 | Forbidden pattern check | hard/soft | Regex and literal patterns |
| 9 | Capability + trust tier match | hard | Minimum trust for capability |
| 10 | Budget/limit check | hard | Action count, cost, time |
| 11 | Gate check | hard | Human or webhook approval |
| 12 | Cross-agent verification | hard | Counterparty identity handshake |
| 13 | Knowledge retrieval validation | soft | Covenant-scoped, anti-context-rot |
| 14 | Content scanner pipeline | hard/soft | 11 scanners |

## Lattice Memory

Append-only validation memory with vector similarity search. Records every accept/reject result. 95% similarity fast-path: when a new proposal matches a known attractor within 0.95 cosine similarity, the cached verdict is returned immediately without re-running the full evaluation chain.

TLA+ invariant: `LatticeInvariant == \A e \in Entries: e.hash = SHA256(e.payload) /\ e.seq = Prev.seq + 1`

The attractor set grows monotonically. Attractors are never deleted, only superseded by newer entries with the same structural signature.

## 11 Content Scanners

Scanners run at Step 14 of the evaluation chain. Each scanner has configurable hard or soft severity. Hard findings reject immediately. Soft findings trigger the recovery engine for automatic retry.

| # | Scanner | What It Checks | Default Severity |
|---|---------|---------------|-----------------|
| 1 | PII scanner | Names, emails, phone numbers, SSNs | hard |
| 2 | Injection scanner | Prompt injection and code injection patterns | hard |
| 3 | Secrets scanner | API keys, tokens, credentials, private keys | hard |
| 4 | Jailbreak scanner | Jailbreak attempts, system prompt extraction | hard |
| 5 | Toxicity scanner | Threats, hate speech, toxic language | hard |
| 6 | URL scanner | URLs against allowlist and blocklist | soft |
| 7 | Data profiler | Null rates, duplicates, outliers, schema drift, class imbalance | soft |
| 8 | Prediction scanner | Percentage claims, absolute-confidence language, horizon limits | soft |
| 9 | Brand scanner | Required phrases, forbidden phrases, competitor mentions, trademark | soft |
| 10 | Regulatory scanner | Ad disclosure, financial/medical disclaimers, affiliate, age restrictions | soft |
| 11 | Temporal scanner | Stale references, future horizons, undated statistics, expired content | soft |

## Recovery Engine

When a scanner or policy check produces a **soft** violation, the recovery engine provides corrective feedback to the agent and allows automatic regeneration. **Hard** violations reject immediately with no retry.

Recovery includes the specific violation details, which scanner triggered it and what the agent should change. Maximum retry attempts are configurable per policy (`recovery.max_attempts`, default 3).

## Trust Scoring

Continuous trust score (0-1000) with five tiers. Time-based erosion. Configurable penalties per violation type and rewards per successful action.

| Tier | Score Range | Description |
|------|------------|-------------|
| Untrusted | 0-199 | Restricted to Ring 3 (read-only) |
| Provisional | 200-399 | Ring 3 |
| Standard | 400-599 | Ring 2 (read, create, update) |
| Trusted | 600-799 | Ring 1 (read, write, delete, network) |
| Privileged | 800-1000 | Ring 0 (full access, requires operator approval) |

## Execution Rings

Four-ring privilege model. Automatic demotion when trust drops below ring threshold.

| Ring | Permissions | Description |
|------|------------|-------------|
| Ring 0 (kernel) | Full access | All operations, requires operator approval |
| Ring 1 | Read, write, delete, network | Broad access for trusted agents |
| Ring 2 (default) | Read, create, update | Standard agent operations |
| Ring 3 (sandbox) | Read-only | Minimal access for untrusted agents |

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

Five heuristics monitor agent behaviour for deviation from established baseline:

1. **Tool category distribution** - shift in which tool categories the agent uses
2. **Target scope shifts** - agent operating on files/resources outside its declared scope
3. **Frequency anomalies** - sudden spikes or drops in action rate
4. **Repetition detection** - same action repeated without progress
5. **Semantic drift** - action descriptions diverging from task intent

Configurable warmup period. Actions on drift: warn, gate, deny or kill.

## Hard/Soft Violation Model

- **Hard violations** reject immediately with no retry. The action is blocked and logged.
- **Soft violations** trigger the recovery engine. The agent receives corrective feedback and may retry up to `recovery.max_attempts` times.

The recovery engine provides: specific violation details, which scanner or policy step triggered it, what the agent should change, and the remaining retry count.


## Cost Economics (v2.75e)

**Subsystem**: src/economics/ (9 TypeScript modules) + config/embedded/ model-mapping.yaml and price-catalog.yaml

AEP 2.75e adds cost-aware routing, budgeting, and spend control.

### Modules
| Module | Purpose |
|--------|---------|
| types.ts | ProviderId, ModelId, CostEstimate, BudgetConfig, FallbackConfig, EconomicsConfig |
| balance.ts | BalanceEngine - 4 load-balance strategies (provider-weighted, balanced-latency, model-weighted, model-latency) |
| model-mapping.ts | Canonical-to-provider model ID resolution for cross-provider price comparison |
| pricing.ts | PriceCatalog - cost lookup, cheapest-finder, capability-based filtering |
| cost-estimator.ts | Pre-dispatch token count and micro-USD cost estimation |
| budget.ts | BudgetEnforcer - deny/warn/quota modes, monthly/daily period rotation |
| concurrency.ts | ConcurrencyLimiter - token-based acquire/release semaphore |
| fallback.ts | FallbackManager - health-monitored provider failover with error ratio thresholds |
| x402.ts | X402Gateway - HTTP 402 micropayment authorization gate |

### Config Files
| File | Purpose |
|------|---------|
| config/embedded/model-mapping.yaml | 10 canonical models mapped to provider-specific IDs |
| config/embedded/price-catalog.yaml | Per-million-token pricing for 10+ providers with capabilities |

### Harness
harness/aep-2.75-agent-harness/harness/aep-economics.js wires all economics modules for agent integration.

## Governance Presets

| Preset | Description |
|--------|-------------|
| strict | Maximum enforcement. Hard severity on all scanners. NTP with 25 ms drift threshold. Perception hard violations reject. |
| standard | Balanced enforcement. Default severities. NTP with 50 ms drift threshold. Perception hard violations clamp. |
| relaxed | Minimal enforcement. Soft severity on most scanners. System clock. 500 ms drift threshold. |
| audit | Full logging, no enforcement. All events recorded. OTEL export for all spans. |

## Fleet Governance

Fleet-level governance for multi-agent swarms (`fleet.enabled: true`):

- **Swarm policies** - agent limits, hourly cost caps, ring saturation limits, drift clustering thresholds
- **Spawn governance** - child agents inherit parent covenant subset, reduced trust, same or lower ring
- **Message scanning** - PII, injection and secrets detection between agents
- Fleet API for pause, resume and kill operations

## Evidence Ledger

Append-only SHA-256 hash chain. Every agent action is recorded with: timestamp, action type, target, policy result, outcome, and hash of the previous entry. The ledger is tamper-evident - any modification breaks the hash chain.

```json
{
  "sequence": 42,
  "timestamp": "2026-05-01T12:00:00.000Z",
  "hash": "sha256:abc123...",
  "previousHash": "sha256:def456...",
  "type": "action",
  "data": { "action": "file:write", "target": "src/app.tsx", "result": "pass" }
}
```

## Proof Bundles

Portable verification artifacts (`.aep-proof.json`). Contains agent identity, covenant, session report, Merkle root, ledger hash, trust score, ring level and drift score, all signed with Ed25519. Auditors can independently verify bundles without access to the original system.

## Reliability Index (Theta)

Single numeric measure of session quality computed from: trust score, drift score, violation rate, ML score (optional) and session duration. Theta is included in proof bundles for external auditing.


## Data Permission System

Every agent operation is checked against data permissions:
- `read` - agent can read files at path
- `write` - agent can write files at path
- `delete` - agent can delete files at path
- `network_connect` - agent can connect to host:port
- `env_read` - agent can read environment variable

Permissions escalate with trust ring (sandbox < user < system < enterprise).
Unknown actions are denied by default.

## Schema Builder (since v2.6)

Data-driven schema validation using four mathematical techniques:

- **MLE Estimation** - Maximum Likelihood field statistics using Welford's online algorithm. Detects numeric bounds, enum distributions and string patterns from historical data.
- **Spectral Analysis** - Graph Laplacian eigenvalue computation. Fiedler value (algebraic connectivity) measures constraint graph coupling.
- **Permissiveness Scoring** - Acceptance distribution entropy per field. Lower entropy means tighter constraints.
- **Modularity Detection** - Louvain community detection on the constraint graph. Higher modularity Q means better-separated modules.

Composite score: `C = w1*(1-D) + w2*spectralNorm + w3*(1-permNorm) + w4*Q`. Decision: pass >= 0.8, review 0.5-0.8, reject < 0.5.

## Policy Builder (since v2.6)

Data-driven Rego policy generation:

- **Invariant Detection** - Six types from data: equality, inequality, membership, exclusion, conditional, temporal.
- **Rego Generation** - Produces `deny[msg]` blocks from invariants, MLE outliers and spectral gaps.
- **Coverage Tracking** - Computes how many domain invariants are enforced by existing rules. Proposes missing rules.
- **Spectral Impact** - Projects Fiedler value before and after proposed additions.

## Commerce Subprotocol

Governed agentic commerce workflows with 12 governed actions:

1. discover
2. add_to_cart
3. remove_from_cart
4. update_cart
5. checkout_start
6. checkout_complete
7. payment_negotiate
8. payment_authorize
9. fulfillment_query
10. order_status
11. return_initiate
12. refund_request

Includes product category blocking, merchant allow/blocklists, transaction amount limits, human gate thresholds, daily spend accumulation and payment method restrictions.

## Model Gateway

Multi-provider governed LLM routing with 4 providers:

| Provider | Description |
|----------|-------------|
| Anthropic | Claude models |
| OpenAI | GPT models |
| Ollama | Local models |
| Custom | Any OpenAI-compatible endpoint |

Every request and response passes through the full governance chain including scanner pipeline and budget tracking. Streaming support with governed chunks and early abort on violation.

## Knowledge Base

Lattice-governed knowledge base:

- **Governed ingestion** - content passes through full scanner pipeline before storage. Hard scanner failures reject the chunk. Soft failures flag for review.
- **Scoped retrieval** - covenant-scoped filtering (agents only see what their covenant permits), double scanning of flagged chunks on retrieval.
- **Anti-context-rot** - most relevant chunks placed at positions 1 and N (context boundaries) to counteract U-shaped LLM attention erosion in the middle of long contexts.

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

---

## dynAEP: Dynamic Agent Element Protocol

dynAEP fuses AEP with AG-UI (Agent-User Interaction Protocol). It extends AEP's build-time governance with real-time bidirectional event streaming.

**AEP** solves the build-time problem: validated UI scaffolding.
**dynAEP** solves the runtime problem: every live AG-UI event is validated against the AEP graph before touching the UI.

### The dynAEP Bridge

Sits between the AG-UI event stream and the frontend. Every event passes through temporal, perceptual and structural validation before reaching the UI:

```
AGENT BACKEND (LangGraph / CrewAI / Google ADK / any AG-UI backend)
    |  AG-UI events (SSE / WebSocket)
    v
dynAEP Bridge
    |  1. Temporal: stamp, validate, causal order, forecast anomaly check
    |  2. Perception: validate temporal annotations against perception registry
    |  3. Structure: validate against scene + registry + z-bands + skin_bindings + Rego
    v
AEP Frontend Renderer (React / Vue / Svelte / Tauri)
```

### dynAEP-TA: Temporal Authority

**Agents NEVER own the clock.** The bridge is the sole authoritative time source for the entire protocol stack. Every component that needs a timestamp MUST call `dynaep_temporal_query` instead of using its own clock.

The bridge clock synchronizes to NTP (default), PTP (IEEE 1588 for microsecond precision) or system clock (fallback). Every event is stamped with bridge-authoritative time. Agent timestamps are preserved in metadata for audit but are never trusted for ordering or validation.

#### Timestamp Validation

Three checks on every event:

- **Drift check** - agent-provided timestamp must be within configurable threshold (default 50 ms) of bridge time
- **Staleness check** - event must not be older than max allowed age (default 5000 ms)
- **Future check** - event must not be stamped ahead of bridge time

#### Causal Ordering

Lamport vector clocks across all registered agents. Out-of-order events are buffered in a reorder buffer (configurable size, default 64) and reordered. Clock regressions are rejected.

#### TimesFM Predictive Forecasting

Optional 200 M-parameter time-series foundation model (async sidecar). Provides predictive forecasting and anomaly detection on element coordinate streams. Not required for compliance.

### dynAEP-TA-P: Perceptual Temporal Governance

Every output modality with a time dimension (speech synthesis, haptic feedback, notification delivery, sensor polling, audio composition) passes through perception governance.

The Perception Registry contains quantitative human perception thresholds from psychoacoustics research:

| Modality | Parameters | Hard Bounds |
|----------|-----------|-------------|
| Speech | Turn gap, syllable rate, pause placement, pitch range | 150-3000 ms gap, 2.0-8.0 syl/s |
| Haptic | Tap duration, vibration frequency, pattern timing | 10-500 ms tap, 20-500 Hz |
| Notification | Burst limits, habituation detection, recovery intervals | Max bursts per window |
| Sensor | Human response latency, display refresh alignment, clinical bounds | Response-aligned |
| Audio | Tempo, beat alignment tolerance, fade and silence timing | 20-300 bpm |

#### Adaptive Per-User Profiles

Profiles learn per-user preferences from interaction signals (response latency, interruptions, replay requests, speed adjustments). Profiles shift within the comfortable range using exponential moving average learning but NEVER exceed hard perception bounds.

#### Cross-Modality Constraint

Maximum 3 simultaneous modalities (configurable). Exceeding the ceiling triggers rejection.

### dynAEP Event Types

**Structural mutations:**
- `AEP_MUTATE_STRUCTURE` - move, add, remove, resize elements
- `AEP_MUTATE_BEHAVIOUR` - update states, actions, constraints
- `AEP_MUTATE_SKIN` - change skin bindings, theme overrides

**Queries:**
- `AEP_QUERY` - children_of, parent_of, z_band_of, visible_at_breakpoint, full_element, next_available_id
- `AEP_QUERY_RESULT` - response to query

**Rejections:**
- `DYNAEP_REJECTION` - structural validation failure

**Runtime coordinates:**
- `AEP_RUNTIME_COORDINATES` - live element position updates

**Temporal events:**
- `AEP_CLOCK_SYNC` - bridge clock synchronization
- `AEP_TEMPORAL_STAMP` - attached to every validated event
- `DYNAEP_TEMPORAL_REJECTION` - temporal validation failure
- `DYNAEP_CAUSAL_VIOLATION` - causal ordering violation
- `AEP_TEMPORAL_FORECAST` - TimesFM prediction result
- `AEP_TEMPORAL_ANOMALY` - forecast anomaly detected
- `AEP_TEMPORAL_RESET` - temporal state reset

**Perception events:**
- `AEP_PERCEPTION_GOVERNED` - perception governance applied to output
- `DYNAEP_PERCEPTION_REJECTION` - perception bounds exceeded
- `AEP_PERCEPTION_PROFILE_UPDATE` - adaptive profile learning update

**Schema/Policy events (v2.75):**
- `AEP_SCHEMA_VALIDATE` - Schema Builder validation result
- `AEP_POLICY_VALIDATE` - Policy Builder validation result
- `AEP_SCHEMA_TIGHTEN` - schema tightening proposal

### dynAEP Event Examples

**Structure mutation:**
```json
{ "type": "CUSTOM", "dynaep_type": "AEP_MUTATE_STRUCTURE",
  "target_id": "CP-00003", "mutation": { "op": "move", "parent": "PN-00002" } }
```

**Query:**
```json
{ "type": "CUSTOM", "dynaep_type": "AEP_QUERY",
  "query": "children_of", "target_id": "PN-00001" }
```

**Temporal stamp** (attached to every validated event):
```json
{ "type": "CUSTOM", "dynaep_type": "AEP_TEMPORAL_STAMP",
  "targetId": "CP-00003",
  "bridgeTimestamp": { "bridgeTimeMs": 1714300800000, "driftMs": 3, "source": "ntp" },
  "causalPosition": 42,
  "vectorClock": { "agent-alpha": 15, "agent-beta": 9 } }
```

**Perception governed** (attached to time-dependent outputs):
```json
{ "type": "CUSTOM", "dynaep_type": "AEP_PERCEPTION_GOVERNED",
  "targetId": "speech-001", "modality": "speech",
  "governedAnnotations": { "syllableRate": 4.8, "turnGapMs": 350 },
  "violations": [{ "parameter": "turnGapMs", "severity": "hard" }] }
```

**Schema validation (v2.75):**
```json
{ "type": "CUSTOM", "dynaep_type": "AEP_SCHEMA_VALIDATE",
  "schemaId": "order-schema-v3", "decision": "pass", "compositeScore": 0.91 }
```

**Policy validation (v2.75):**
```json
{ "type": "CUSTOM", "dynaep_type": "AEP_POLICY_VALIDATE",
  "schemaId": "order-schema-v3", "coverageRate": 0.92, "proposedRules": 2 }
```

**Schema tightening (v2.75):**
```json
{ "type": "CUSTOM", "dynaep_type": "AEP_SCHEMA_TIGHTEN",
  "schemaId": "order-schema-v3", "proposals": 3, "fields": ["amount", "status"] }
```

**Rejection:**
```json
{ "type": "CUSTOM", "dynaep_type": "DYNAEP_REJECTION",
  "target_id": "CP-00099", "error": "Unregistered element: CP-00099 does not exist" }
```

### dynAEP Tool Definitions

#### aep_add_element

Add a new element to the scene graph. The bridge mints the ID.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| type | string | yes | Element type (shell, panel, component, etc.) |
| parent | string | yes | Parent element ID |
| z | integer | yes | Z-index within type's band |
| skin_binding | string | yes | Skin binding key |
| label | string | no | Human-readable name |

#### aep_move_element

Move an existing element to a new parent or position.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| target_id | string | yes | Element to move |
| new_parent | string | yes | New parent element ID |
| z | integer | no | New z-index |

#### aep_query_graph

Query the scene graph.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| query | string | yes | Query type (children_of, parent_of, z_band_of, visible_at_breakpoint, full_element, next_available_id) |
| target_id | string | yes | Target element ID |

#### aep_swap_theme

Switch the active theme.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| theme_name | string | yes | Name of theme to activate |

#### dynaep_temporal_query

Query temporal authority. **Use this instead of Date.now() or any local clock.**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| query_type | string | yes | One of: authoritative_time, drift_status, causal_position, vector_clock, perception_bounds, staleness_check, forecast, anomaly_status, clock_sources |
| modality | string | for perception_bounds | Speech, haptic, notification, sensor, audio |
| target_id | string | for staleness_check | Element to check |
| max_age_ms | integer | for staleness_check | Maximum allowed age |

9 query types:
1. `authoritative_time` - returns bridge-authoritative timestamp
2. `drift_status` - returns current drift between bridge and agent clocks
3. `causal_position` - returns current causal sequence number
4. `vector_clock` - returns full vector clock state
5. `perception_bounds` - returns hard/soft bounds for a modality
6. `staleness_check` - checks if a target element's data is stale
7. `forecast` - returns TimesFM prediction for an element's coordinate stream
8. `anomaly_status` - returns current anomaly detection state
9. `clock_sources` - returns available clock sources and their sync status

### Generative Topology (NOT Generative UI)

Under dynAEP, agents generating raw JSX/HTML at runtime is **strictly forbidden**. Agents can only instantiate and arrange pre-compiled, verified AEP primitives. The agent is an architect placing pre-fabricated blocks. It does not mix the cement.

### Conflict Resolution

```yaml
conflict_resolution:
  mode: "last_write_wins"  # or optimistic_locking
```

For optimistic locking, mutations must include `expected_version`. If the element's version changed, the mutation is rejected. Causal ordering via vector clocks determines which write came first using bridge-authoritative timestamps.

### Human-in-the-Loop

```yaml
approval_policy:
  structure_mutations: "auto"
  behaviour_mutations: "auto"
  skin_mutations: "auto"
  new_element_creation: "require_approval"
  forbidden_pattern_changes: "require_approval"
  temporal_anomaly: "warn"
  perception_override: "auto"
```

### Validated Performance Results (dynAEP v0.3.1)

Reference implementation validated results:

| Metric | Result |
|--------|--------|
| Blended throughput | 53,033 events/s |
| Hot path p99 latency | 0.004 ms |
| Cold path p99 latency | 0.22 ms |
| Data-heavy grid (template instances) | 118,339 events/s |

#### 10 Performance Optimizations

| ID | Optimization |
|----|-------------|
| 1 | Template node validation fast-exit |
| 2 | Parallel 15-step chain execution |
| 3 | Unified Rego WASM bundle with decision cache |
| 4 | Unified content scanner automaton (Aho-Corasick) |
| 5 | Causal ordering subtree partitioning |
| 6 | LSH attractor indexing for Lattice Memory |
| 7 | Async NTP sync with clock slewing |
| 8 | Buffered evidence ledger with WAL option |
| 9 | Cross-modality state atomicity |
| 10 | Delta processor with transaction log |

---

## Using AEP Tools as an Agent

When you have AEP MCP tools available, follow this sequence:

```
1. list_aep_schemas        -> Learn what is valid in THIS environment
2. get_scene_graph         -> See what already exists
3. reset_environment       -> (optional) Start clean
4. create_ui_element       -> Build panels under SH-00001
5. create_ui_element       -> Add widgets/components inside panels
6. create_ui_element       -> Add controls inside widgets
7. get_scene_graph         -> Verify the result
```

For time-dependent outputs:
```
1. dynaep_temporal_query(authoritative_time)    -> Get bridge time (NEVER use local clock)
2. dynaep_temporal_query(perception_bounds)     -> Get modality bounds before constructing annotations
3. Construct temporal annotations within bounds
4. Submit output event with annotations
5. Receive governed envelope with any clamped values
```

### Common Mistakes

| Mistake | Example | Fix |
|---------|---------|-----|
| Invented ID | `parent: "panel-1"` | Use server-returned ID like `PN-00001` |
| Wrong skin binding | `skin_binding: "panel"` | Use `panel_main`, `panel_header`, etc. |
| Z outside band | `type: "panel", z: 5` | Panels are 10-19 |
| Unknown type | `type: "button"` | Use `component` with `button_primary` skin |
| Missing parent | `parent: "PN-00099"` | Check scene graph first |
| Guessing IDs | Assuming `PN-00002` exists | Always use the ID returned by create |
| Hardcoded visuals | Setting colours in registry | Use skin_binding, all visuals in theme |
| Two-layer edits | Editing structure + behaviour for one change | Separation is broken, fix it |
| Using Date.now() | Getting time from local clock | Call dynaep_temporal_query instead |
| Hardcoded speech pacing | Setting syllable rate without checking bounds | Query perception_bounds first |
| Ignoring governed envelope | Using original annotations after governance | Use governedAnnotations or adaptiveAnnotations |

### Handling Rejections

1. Read the error. It tells you exactly what is wrong and lists valid options.
2. Fix the specific parameter.
3. Retry with corrected values.
4. NEVER retry with the same values.

For temporal rejections: re-sync with bridge clock, resolve causal dependencies, then retry.
For perception rejections: use the `suggestion` field in the rejection event as a starting point for corrected annotations.

---

## Implementation Checklist

```
[ ] Define all UI elements with AEP IDs (prefix + number)
[ ] Define Template Nodes for dynamic/repeating elements
[ ] Create aep-scene.json with aep_version header
[ ] Create aep-registry.yaml with aep_version header
[ ] Create aep-theme.yaml with aep_version header
[ ] Add data-aep-id attribute to every rendered element
[ ] Wire component styles to skin_binding -> theme resolution
[ ] Add AOT validation to build pipeline
[ ] Add JIT delta validation for runtime mutations
[ ] Verify: changing theme changes visuals without touching components
[ ] Verify: every component traceable by its AEP ID
[ ] Verify: no visual properties in aep-registry.yaml
[ ] Implement 15-step evaluation chain
[ ] Configure trust scoring and execution rings
[ ] Define behavioural covenants
[ ] Configure content scanners
[ ] Set up evidence ledger with SHA-256 hash chain
[ ] Configure dynAEP-TA timekeeping (NTP/PTP/system)
[ ] Replace all Date.now() calls with dynaep_temporal_query
[ ] Configure perception registry overrides for deployment
[ ] Wire TTS/haptic/notification renderers to governed envelopes
[ ] Configure adaptive perception profiles
[ ] Set cross-modality constraint limit
[ ] Test: temporal rejection on drift-exceeded event
[ ] Test: perception clamping on out-of-bounds speech pacing
[ ] Test: Schema Builder validation on schema proposal
[ ] Test: Policy Builder coverage tracking
```

---

## Connecting to the AEP Demo Server

For Claude Code:
```bash
claude mcp add aep-demo --transport http https://aep.newlisbon.agency/demo/mcp
```

For other MCP clients: add the URL with HTTP transport.

## References

- AEP v2.75: https://github.com/thePM001/AEP-agent-element-protocol
- AEP v2.75 Agent Harness: https://github.com/thePM001/AEP-agent-element-protocol/tree/main/harness/aep-2.75-agent-harness
- dynAEP v0.3.1: https://github.com/thePM001/dynAEP-dynamic-agent-element-protocol
- AG-UI Protocol: https://github.com/ag-ui-protocol/ag-ui
- AEP Research Paper: https://github.com/thePM001/AEP-research-paper-001
- Live Demo: https://aep.newlisbon.agency
