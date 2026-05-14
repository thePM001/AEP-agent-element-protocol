---
name: aep
description: Use this skill whenever working with AEP (Agent Element Protocol), dynAEP, dynAEP-TA, dynAEP-TA-P or any AEP governance feature. Triggers include 'AEP', 'dynAEP', 'dynAEP-TA', 'dynAEP-TA-P', 'temporal authority', 'perception governance', 'perception registry', 'bridge clock', 'causal ordering', 'vector clock', 'TimesFM', 'adaptive perception', 'perception bounds', 'scene graph', 'aep-scene.json', 'aep-registry.yaml', 'aep-theme.yaml', 'zero-trust UI', 'topological matrix', 'z-band', 'skin binding', 'AEP-FCR', 'temporal annotations', 'speech pacing', 'haptic timing', 'notification cadence', 'Schema Builder', 'Policy Builder', 'Lattice Memory', 'evaluation chain', 'trust scoring', 'execution rings', 'behavioural covenants', 'content scanners', 'evidence ledger', or building validated UI for AI agents. Also use when implementing AEP three-layer architecture, writing AEP validators, creating MCP servers that validate agent UI output, working with AG-UI under AEP governance, or governing time-dependent outputs for human perception. If AEP MCP tools are available (list_aep_schemas, create_ui_element, get_scene_graph), always consult this skill first. Do NOT guess IDs, skin bindings, z-bands or element types. Do NOT use Date.now() or any local clock when dynAEP-TA is available - call dynaep_temporal_query instead.
---

# Agent Element Protocol (AEP) v2.6 - MCP Demo Skill

AEP is a zero-trust UI framework. You propose elements, AEP validates them. Only valid elements render. Invalid proposals are rejected with specific errors. You self-correct and retry.

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

## Critical Rules

1. **NEVER invent element IDs.** The server mints all IDs. You only provide: type, parent, z, skin_binding, label.
2. **ALWAYS call `list_aep_schemas` first.** This returns the live registry of valid types, z-bands and skin bindings. Do not rely on memory - the registry may change between sessions.
3. **ALWAYS call `get_scene_graph` before building.** Know what exists before adding to it.
4. **Start from root `SH-00001`.** Every element tree begins here.
5. **Use the server-returned ID** for any subsequent parent references. After `create_ui_element` returns `{"element_id": "PN-00001"}`, use `PN-00001` as the parent for children - never make up IDs.
6. **If rejected, read the error and fix it.** Don't retry the same call. The rejection tells you exactly what's wrong.
7. **NEVER use Date.now()** or any local clock when dynAEP-TA is available. Call `dynaep_temporal_query` instead.

## Connection

Add the MCP server with HTTP transport:

```
claude mcp add aep-demo --transport http https://aep.newlisbon.agency/demo/mcp
```

## Available Tools

### list_aep_schemas
Call first. No arguments. Returns valid types, z-bands, skin bindings, workflow actions and API methods.

### create_ui_element
Creates a validated UI element.

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| type | string | yes | Must be from the allowed types list |
| parent | string | yes | An existing element ID (start with `SH-00001`) |
| z | integer | yes | Must fall within the z-band for the element's type prefix |
| skin_binding | string | yes | Must be from the registered skin bindings |
| label | string | no | Human-readable name |

### execute_workflow_step
Executes a validated workflow action.

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| action | string | yes | Must be from allowed workflow actions |
| payload | object | yes | Any valid JSON object |

### call_validated_api
Makes a schema-validated API call.

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| method | string | yes | GET, POST, PUT, PATCH or DELETE |
| endpoint | string | yes | Must start with `/` |
| body | object | no | Required for POST, PUT, PATCH |

### get_scene_graph
Returns the full current scene graph. No arguments. Call this to see what exists.

### reset_environment
Wipes everything and restores root shell `SH-00001`. No arguments.

### dynaep_temporal_query
Query temporal authority. **Use this instead of Date.now() or any local clock.**

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| query_type | string | yes | One of: authoritative_time, drift_status, causal_position, vector_clock, perception_bounds, staleness_check, forecast, anomaly_status, clock_sources |
| modality | string | for perception_bounds | speech, haptic, notification, sensor, audio |
| target_id | string | for staleness_check | Element to check |
| max_age_ms | integer | for staleness_check | Maximum allowed age |

## Element Types and Z-Bands

These are the known types and their ID prefixes. Z-values must fall within the band for the prefix. Always verify against `list_aep_schemas` output, as the registry is authoritative.

| Type | Prefix | Z-Band |
|------|--------|--------|
| shell | SH | 0-9 |
| panel | PN | 10-19 |
| widget | WG | 20-29 |
| control | CT | 30-39 |
| overlay | OV | 40-49 |
| cell | CL | 50-59 |

## Skin Bindings

Use only registered skin bindings. Common ones include:

`shell`, `panel_header`, `panel_sidebar`, `panel_main`, `panel_footer`, `widget_card`, `toolbar`, `button_primary`, `button_secondary`, `icon_button`, `input`, `dropdown`, `form`, `nav_item`, `data_grid`, `cell_node`, `modal`, `overlay_backdrop`, `tooltip`, `logo`, `avatar`, `status_indicator`, `text_muted`

**Do NOT invent skin bindings.** If you use one that isn't registered, the call will be rejected.

## Standard Build Pattern

Follow this sequence every time:

```
1. list_aep_schemas          -> learn what's valid
2. get_scene_graph            -> see current state
3. reset_environment          -> (optional) start clean
4. create_ui_element (panels) -> build top-level structure under SH-00001
5. create_ui_element (widgets)-> add widgets inside panels
6. create_ui_element (controls)-> add controls inside widgets
7. get_scene_graph            -> verify final state
```

For time-dependent outputs:
```
1. dynaep_temporal_query(authoritative_time)    -> Get bridge time (NEVER use local clock)
2. dynaep_temporal_query(perception_bounds)     -> Get modality bounds before constructing annotations
3. Construct temporal annotations within bounds
4. Submit output event with annotations
5. Receive governed envelope with any clamped values
```

## Example: Building a Dashboard

```
Step 1: list_aep_schemas
Step 2: get_scene_graph
Step 3: reset_environment
Step 4: create_ui_element(type="panel", parent="SH-00001", z=10, skin_binding="panel_header", label="Header")
        -> returns element_id: "PN-00001"
Step 5: create_ui_element(type="panel", parent="SH-00001", z=11, skin_binding="panel_sidebar", label="Sidebar")
        -> returns element_id: "PN-00002"
Step 6: create_ui_element(type="panel", parent="SH-00001", z=12, skin_binding="panel_main", label="Main Content")
        -> returns element_id: "PN-00003"
Step 7: create_ui_element(type="widget", parent="PN-00003", z=20, skin_binding="widget_card", label="Tasks Widget")
        -> returns element_id: "WG-00001"
Step 8: create_ui_element(type="control", parent="WG-00001", z=30, skin_binding="button_primary", label="Add Task")
        -> returns element_id: "CT-00001"
Step 9: create_ui_element(type="control", parent="WG-00001", z=31, skin_binding="input", label="Task Input")
        -> returns element_id: "CT-00002"
Step 10: get_scene_graph -> verify everything
```

## AEP v2.6 Governance

### 15-Step Evaluation Chain

Every action passes through these steps in order. If any step denies, the action does not execute.

| Step | Name | Description |
|------|------|-------------|
| 0 | Task scope check | Active task scope boundaries |
| 1 | Session state check | Session must be active |
| 2 | Ring capability check | Action within ring permissions |
| 3 | System-wide rate limit | Global rate limit enforcement |
| 4 | Per-session rate limit | Session-specific rate limit |
| 5 | Intent drift check | Action aligns with baseline |
| 6 | Escalation rules | Threshold-triggered human check-in |
| 7 | Covenant evaluation | Permit/forbid/require rules |
| 8 | Forbidden pattern check | Regex and literal patterns |
| 9 | Capability + trust tier match | Minimum trust for capability |
| 10 | Budget/limit check | Action count, cost, time |
| 11 | Gate check | Human or webhook approval |
| 12 | Cross-agent verification | Counterparty identity handshake |
| 13 | Knowledge retrieval validation | Covenant-scoped, anti-context-rot |
| 14 | Content scanner pipeline | 11 scanners |

### Lattice Memory

Append-only validation memory with vector similarity search. 95% similarity fast-path: when a new proposal matches a known attractor within 0.95 cosine similarity, the cached verdict is returned immediately without re-running the full evaluation chain.

TLA+ invariant: `LatticeInvariant == \A e \in Entries: e.hash = SHA256(e.payload) /\ e.seq = Prev.seq + 1`

### 11 Content Scanners

| # | Scanner | What It Checks | Default Severity |
|---|---------|---------------|-----------------|
| 1 | PII scanner | Names, emails, phone numbers, SSNs | hard |
| 2 | Injection scanner | Prompt injection and code injection patterns | hard |
| 3 | Secrets scanner | API keys, tokens, credentials, private keys | hard |
| 4 | Jailbreak scanner | Jailbreak attempts, system prompt extraction | hard |
| 5 | Toxicity scanner | Threats, hate speech, toxic language | hard |
| 6 | URL scanner | URLs against allowlist and blocklist | soft |
| 7 | Data profiler | Null rates, duplicates, outliers, schema drift | soft |
| 8 | Prediction scanner | Percentage claims, absolute-confidence language | soft |
| 9 | Brand scanner | Required phrases, forbidden phrases, competitor mentions | soft |
| 10 | Regulatory scanner | Ad disclosure, financial/medical disclaimers | soft |
| 11 | Temporal scanner | Stale references, future horizons, undated statistics | soft |

### Trust Scoring

Continuous trust score (0-1000) with five tiers: untrusted (0-199), provisional (200-399), standard (400-599), trusted (600-799), privileged (800-1000). Time-based erosion. Configurable penalties per violation type.

### Execution Rings

Ring 0 (kernel): full access. Ring 1: read/write/delete/network. Ring 2 (default): read/create/update only. Ring 3 (sandbox): read-only. Automatic demotion when trust drops below ring threshold.

### Behavioural Covenants

Three keywords: permit (allowed actions), forbid (never take, overrides permit), require (must hold for any action). Each rule tagged `[hard]` (immediate reject) or `[soft]` (recovery attempt).

### Intent Drift Detection

Five heuristics: tool category distribution, target scope shifts, frequency anomalies, repetition detection and semantic drift. Configurable warmup period. Actions on drift: warn, gate, deny or kill.

### Schema Builder (v2.6)

MLE estimation, spectral analysis, permissiveness scoring and modularity detection for data-driven schema validation.

### Policy Builder (v2.6)

Invariant detection, Rego generation, coverage tracking and spectral impact projection for data-driven policy generation.

### Evidence Ledger

Append-only SHA-256 hash chain of all agent actions. Tamper-evident. Supports proof bundles (`.aep-proof.json`) for external audit.

### Reliability Index (Theta)

Single numeric measure of session quality from trust score, drift score, violation rate, ML score and session duration.

## dynAEP-TA: Temporal Authority

**Agents NEVER own the clock.** The bridge is the sole authoritative time source. Bridge clock syncs to NTP (default), PTP (microsecond) or system clock (fallback). Agent timestamps preserved in metadata for audit only.

Causal ordering via Lamport vector clocks. Reorder buffer (default 64). Clock regressions rejected.

TimesFM (optional 200M-parameter time-series model) provides predictive forecasting and anomaly detection.

## dynAEP-TA-P: Perceptual Temporal Governance

Five modality profiles: speech, haptic, notification, sensor, audio. Each has hard bounds (absolute limits from research) and soft bounds (comfortable range). Adaptive per-user profiles learn from interaction signals using exponential moving average. Cross-modality constraint: max 3 simultaneous modalities.

## dynAEP Event Types

Structural: `AEP_MUTATE_STRUCTURE`, `AEP_MUTATE_BEHAVIOUR`, `AEP_MUTATE_SKIN`. Queries: `AEP_QUERY`, `AEP_QUERY_RESULT`. Rejections: `DYNAEP_REJECTION`. Coordinates: `AEP_RUNTIME_COORDINATES`. Temporal: `AEP_CLOCK_SYNC`, `AEP_TEMPORAL_STAMP`, `DYNAEP_TEMPORAL_REJECTION`, `DYNAEP_CAUSAL_VIOLATION`, `AEP_TEMPORAL_FORECAST`, `AEP_TEMPORAL_ANOMALY`, `AEP_TEMPORAL_RESET`. Perception: `AEP_PERCEPTION_GOVERNED`, `DYNAEP_PERCEPTION_REJECTION`, `AEP_PERCEPTION_PROFILE_UPDATE`. Schema/Policy (v2.6): `AEP_SCHEMA_VALIDATE`, `AEP_POLICY_VALIDATE`, `AEP_SCHEMA_TIGHTEN`.

## Validated Performance Results (dynAEP v0.3.1)

| Metric | Result |
|--------|--------|
| Blended throughput | 53,033 events/s |
| Hot path p99 latency | 0.004 ms |
| Cold path p99 latency | 0.22 ms |
| Data-heavy grid (template instances) | 118,339 events/s |

10 optimizations: template node fast-exit, parallel 15-step chain, unified Rego WASM bundle with decision cache, Aho-Corasick scanner automaton, causal ordering subtree partitioning, LSH attractor indexing, async NTP sync with clock slewing, buffered evidence ledger with WAL, cross-modality state atomicity, delta processor with transaction log.

## Subprotocols

| Subprotocol | What It Validates |
|-------------|-------------------|
| UI | Scene graph elements, z-bands, skin bindings, spatial rules |
| Workflows | Actions, state transitions, payload schemas, approval gates |
| REST APIs | HTTP methods, endpoint paths, request bodies, headers, query params |
| Events / Pub-Sub | Topics, payload schemas, producer permissions, correlation IDs, size limits |
| Infrastructure as Code | Resource kinds, required fields, forbidden fields, type and value constraints |
| Commerce | Cart, checkout, payment, fulfillment, spend limits, merchant restrictions |

## Common Mistakes That Cause Rejections

| Mistake | Example | Fix |
|---------|---------|-----|
| Invented ID | `parent: "panel-1"` | Use server-returned ID like `PN-00001` |
| Wrong skin binding | `skin_binding: "panel"` | Use `panel_main`, `panel_header`, etc. |
| Z outside band | `type: "panel", z: 5` | Panels are 10-19, use `z: 10` |
| Unknown type | `type: "button"` | Use `control` with `button_primary` skin |
| Missing parent | `parent: "PN-00099"` | Check scene graph, use existing ID |
| Using Date.now() | Getting time from local clock | Call dynaep_temporal_query instead |
| Hardcoded speech pacing | Setting syllable rate without checking bounds | Query perception_bounds first |
| Ignoring governed envelope | Using original annotations after governance | Use governedAnnotations or adaptiveAnnotations |

## Handling Rejections

When a call returns `{"valid": false, "errors": [...]}`:

1. Read each error message carefully
2. It tells you exactly what's wrong and what the valid options are
3. Fix the specific parameter(s)
4. Retry with corrected values
5. Never retry with the same values - that will fail again

For temporal rejections: re-sync with bridge clock, resolve causal dependencies, then retry.
For perception rejections: use the `suggestion` field in the rejection event as a starting point for corrected annotations.

## Live Demo Context

When building through the AEP demo server, your actions are broadcast live to a dashboard at `aep.newlisbon.agency`. Visitors can watch you build in real time. Passes show in green, rejections in red. Build deliberately and cleanly - this is a showcase.

## References

- AEP v2.6: https://github.com/thePM001/AEP-agent-element-protocol
- AEP v2.6 Agent Harness: https://github.com/thePM001/AEP-agent-element-protocol/tree/main/harness/aep-2.6-agent-harness
- dynAEP v0.3.1: https://github.com/thePM001/dynAEP-dynamic-agent-element-protocol
- AG-UI Protocol: https://github.com/ag-ui-protocol/ag-ui
- AEP Research Paper: https://github.com/thePM001/AEP-research-paper-001
- Live Demo: https://aep.newlisbon.agency
