---
name: aep
description: Use this skill whenever working with AEP (Agent Element Protocol), dynAEP, dynAEP-TA or dynAEP-TA-P. Triggers include 'AEP', 'dynAEP', 'dynAEP-TA', 'temporal authority', 'perception governance', 'perception registry', 'bridge clock', 'causal ordering', 'vector clock', 'TimesFM', 'adaptive perception', 'perception bounds', 'scene graph', 'aep-scene.json', 'aep-registry.yaml', 'aep-theme.yaml', 'zero-trust UI', 'topological matrix', 'z-band', 'skin binding', 'AEP-FCR', 'temporal annotations', 'speech pacing', 'haptic timing', 'notification cadence', or building validated UI for AI agents. Also use when implementing AEP three-layer architecture, writing AEP validators, creating MCP servers that validate agent UI output, working with AG-UI under AEP governance, or governing time-dependent outputs for human perception. If AEP MCP tools are available (list_aep_schemas, create_ui_element, get_scene_graph), always consult this skill first. Do NOT guess IDs, skin bindings, z-bands or element types. Do NOT use Date.now() or any local clock when dynAEP-TA is available -- call dynaep_temporal_query instead.
---

# Agent Element Protocol (AEP)

AEP is a **3-layer frontend governance architecture** that gives every UI element a unique numerical identity, exact spatial coordinates, defined behaviour rules and themed visual properties. It treats the frontend as a **topological coordinate system**, not a fluid DOM tree.

AI agents propose UI structures. AEP validates every proposal against a strict registry. Only valid elements render. Invalid proposals are rejected with actionable errors. The agent self-corrects. Zero hallucinations reach the UI.

## The Three Layers

AEP enforces strict separation into three independent layers. Each has its own config file. **Changing one layer NEVER requires changing another.**

```
LAYER 1: STRUCTURE  (aep-scene.json)    -- What exists and where it sits in space
LAYER 2: BEHAVIOUR  (aep-registry.yaml) -- What each element does and cannot do
LAYER 3: SKIN       (aep-theme.yaml)    -- What each element looks like
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

**Relational Anchors** -- position relative to parents or siblings:
```json
"layout": {
  "anchors": {
    "top": "PN-00001.bottom",
    "left": "SH-00001.left",
    "right": "SH-00001.right"
  }
}
```

**Viewport Matrix** -- responsive breakpoints per element:
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

### AOT (Ahead-of-Time) -- Build Time

Proves the static scene graph, registry and theme are 100% sound. Checks every element, parent reference, z-band, skin binding, forbidden pattern and Template Node.

### JIT (Just-in-Time) Delta -- Runtime

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

## dynAEP: Dynamic Agent Element Protocol

dynAEP fuses AEP with AG-UI (Agent-User Interaction Protocol). It extends AEP's build-time governance with real-time bidirectional event streaming.

**AEP** solves the build-time problem: validated UI scaffolding.
**dynAEP** solves the runtime problem: every live AG-UI event is validated against the AEP graph before touching the UI.

### The Protocol Stack

```
Agent-Tools     MCP       -- Agent connects to external data and tools
Agent-Agent     A2A       -- Agents coordinate across distributed systems
Agent-User      AG-UI     -- Real-time event streaming agent <-> frontend
Agent-UI-Gov    AEP       -- Deterministic UI structure, behaviour and skin
Agent-UI-Live   dynAEP    -- AEP governance applied to live AG-UI events
Agent-UI-Time   dynAEP-TA -- Temporal authority, causal ordering, forecasting
Agent-Percept   dynAEP-TA-P -- Perceptual temporal governance
```

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

Causal ordering uses Lamport vector clocks across all registered agents. Out-of-order events are buffered and reordered. Clock regressions are rejected.

TimesFM (optional 200 M-parameter time-series foundation model) provides predictive forecasting and anomaly detection on element coordinate streams.

### dynAEP-TA-P: Perceptual Temporal Governance

Every output modality with a time dimension (speech synthesis, haptic feedback, notification delivery, sensor polling, audio composition) passes through perception governance.

The Perception Registry contains quantitative human perception thresholds from psychoacoustics research:
- Speech: turn gaps 150-3000 ms, syllable rate 2.0-8.0 per second, pause placement, pitch range
- Haptic: tap duration 10-500 ms, vibration frequency 20-500 hz, pattern timing
- Notification: burst limits, habituation detection, recovery intervals
- Sensor: human response latency, display refresh alignment, clinical monitoring bounds
- Audio: tempo 20-300 bpm, beat alignment tolerance, fade and silence timing

Adaptive profiles learn per-user preferences from interaction signals (response latency, interruptions, replay requests, speed adjustments). Profiles shift within the comfortable range but NEVER exceed hard perception bounds.

### dynAEP Event Types

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

Supported queries: `children_of`, `parent_of`, `z_band_of`, `visible_at_breakpoint`, `full_element`, `next_available_id`.

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

**Rejection:**
```json
{ "type": "CUSTOM", "dynaep_type": "DYNAEP_REJECTION",
  "target_id": "CP-00099", "error": "Unregistered element: CP-00099 does not exist" }
```

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
[ ] Configure dynAEP-TA timekeeping (NTP/PTP/system)
[ ] Replace all Date.now() calls with dynaep_temporal_query
[ ] Configure perception registry overrides for deployment
[ ] Wire TTS/haptic/notification renderers to governed envelopes
[ ] Test: temporal rejection on drift-exceeded event
[ ] Test: perception clamping on out-of-bounds speech pacing
```

---

## Connecting to the AEP Demo Server

For Claude Code:
```bash
claude mcp add aep-demo --transport http https://aep.newlisbon.agency/demo/mcp
```

For other MCP clients: add the URL with HTTP transport.

## References

- AEP Whitepaper: https://github.com/thePM001/AEP-agent-element-protocol
- dynAEP: https://github.com/thePM001/dynAEP-dynamic-agent-element-protocol
- AG-UI Protocol: https://github.com/ag-ui-protocol/ag-ui
- Live Demo: https://aep.newlisbon.agency
- Google TimesFM: https://github.com/google-research/timesfm
