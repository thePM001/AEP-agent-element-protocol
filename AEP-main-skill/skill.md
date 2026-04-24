---
name: aep
description: Use this skill whenever working with AEP (Agent Element Protocol) or dynAEP. Triggers include 'AEP', 'dynAEP', 'scene graph', 'aep-scene.json', 'aep-registry.yaml', 'aep-theme.yaml', 'zero-trust UI', 'topological matrix', 'z-band', 'skin binding', 'AEP-FCR', 'lattice memory', 'memory fabric', 'attractor', 'rejection history', 'resolver', 'proposal routing', 'fast-path', 'aep v2', 'aep 2.1', 'AgentGateway', 'policy engine', 'evidence ledger', 'rollback', 'session governance', 'MCP proxy' or building validated UI for AI agents. Also use when implementing AEP three-layer architecture, writing AEP validators, creating MCP servers that validate agent UI output, working with AG-UI under AEP governance, querying validation memory or routing proposals through the resolver. If AEP MCP tools are available (list_aep_schemas, create_ui_element, get_scene_graph), always consult this skill first. Do NOT guess IDs, skin bindings, z-bands or element types.
---

# Agent Element Protocol (AEP)

AEP is a **3-layer frontend governance architecture** that gives every UI element a unique numerical identity, exact spatial coordinates, defined behaviour rules and themed visual properties. It treats the frontend as a **topological coordinate system**, not a fluid DOM tree.

AI agents propose UI structures. AEP validates every proposal against a strict registry. Only valid elements render. Invalid proposals are rejected with actionable errors. The agent self-corrects. Zero hallucinations reach the UI.

**AEP 2.1** adds session governance with four enforcement capabilities: **AgentGateway** (intercepts agent mutations before execution), **Policy Engine** (structured checks with pass/fail verdicts), **Evidence Ledger** (append-only audit trail of every agent action), and **Rollback** (revert changes when violations are detected post-execution). It also introduces **MCP proxy** support and **CLI commands** for preflight, validation and element registration.

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
{ "aep_version": "2.1", "schema_revision": 1, "elements": { ... } }
```

```yaml
aep_version: "2.1"
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
  "aep_version": "2.1",
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

An agent can query this and know not to place essential UI inside an element that's hidden on mobile.

### Structure Rules

1. Every element MUST have a unique ID following the prefix convention.
2. Every element MUST have a parent (except the root Shell).
3. Children MUST be topologically contained within their parent.
4. z-index values MUST follow the z-band hierarchy.
5. The scene graph is the single source of truth for layout. CSS derives from it.

---

## Layer 2: Behaviour (aep-registry.yaml)

The component registry (AEP-FCR). Every element that renders pixels has an entry defining what it does, its states, events, constraints and what it's forbidden from doing. Layer 2 contains **no visual properties**. All styling is delegated to Layer 3 through `skin_binding`.

```yaml
aep_version: "2.1"
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
aep_version: "2.1"
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

## AEP 2.1 Session Governance

AEP 2.1 introduces four enforcement capabilities that govern AI agent sessions end-to-end.

### AgentGateway

The AgentGateway intercepts every agent mutation before execution. No file edit, component creation or code generation reaches the codebase without passing through the gateway.

1. **Interception** -- Before the agent writes to any file, the AgentGateway receives the proposed change (target file, diff, affected elements).
2. **Policy Evaluation** -- The gateway evaluates the mutation against all active AEP policies: element registration, visual governance, structural governance, naming governance.
3. **Verdict** -- Each policy returns `pass` or `fail` with a reason. If any policy fails, the mutation is **BLOCKED**.
4. **Evidence Recording** -- The evaluation result (pass or fail) is appended to the evidence ledger.

```json
{
  "timestamp": "2025-01-15T14:30:00.000Z",
  "action": "file_edit",
  "target": "src/Button.tsx",
  "policies_evaluated": 4,
  "verdict": "BLOCKED",
  "failures": [
    { "policy": "ELEMENT_REGISTRATION", "reason": "data-aep-id='btn_new' not in registry" }
  ]
}
```

### Policy Engine

The policy engine evaluates structured checks against AEP rules. Policies are composable and extensible.

| Policy | What It Checks |
|--------|---------------|
| ELEMENT_REGISTRATION | `data-aep-id` exists in registry and scene graph |
| VISUAL_GOVERNANCE | Colours, fonts, spacing come from theme tokens |
| STRUCTURAL_GOVERNANCE | Parent-child relationships and z-band compliance |
| NAMING_GOVERNANCE | No internal architecture terms in user-facing text |
| SKIN_BINDING | Every `skin_binding` resolves in `aep-theme.yaml` |

Custom policies can be added by extending `harness/aep-validate.js`.

### Evidence Ledger

The evidence ledger at `.claude/aep-evidence.jsonl` is an append-only audit trail of every agent action during a session.

Each line is a JSON object:
```json
{"ts":"2025-01-15T14:30:00.000Z","action":"file_edit","target":"src/Button.tsx","verdict":"pass","policies":4,"failures":0}
{"ts":"2025-01-15T14:30:05.000Z","action":"file_edit","target":"src/Modal.tsx","verdict":"blocked","policies":4,"failures":1,"reason":"BORDER_RADIUS_VIOLATION"}
{"ts":"2025-01-15T14:31:00.000Z","action":"rollback","target":"src/Card.tsx","restored_to":"pre-mutation","reason":"HARDCODED_COLOR detected post-execution"}
```

**Rules:**
- The agent MUST NOT delete, truncate, or modify existing ledger entries.
- The safety guard validates ledger integrity (file size must never decrease).
- The ledger resets per session (the agent creates it at session start if absent).

### Rollback

When a violation is detected after a mutation has been applied, the agent can rollback the change.

1. The validator or safety guard detects a violation in a recently modified file.
2. The agent reads the evidence ledger to identify the mutation that introduced the violation.
3. The agent restores the file to its pre-mutation state (using git, undo, or cached snapshot).
4. A `rollback` entry is appended to the evidence ledger.

**When to rollback:**
- A CRITICAL or HIGH violation is found in a file the agent just modified.
- A policy evaluation passed at the AgentGateway but a deeper validator check reveals a violation.
- The user explicitly requests reverting a change.

### CLI Commands

AEP 2.1 provides three slash commands for Claude Code sessions:

| Command | When to Run | What It Does |
|---------|-------------|--------------|
| `/aep-preflight` | Before any edit session | Loads AEP configs, evaluates policies via AgentGateway, verifies constraints |
| `/aep-validate` | After completing edits | Checks all changes against AEP, reviews evidence ledger, reports violations |
| `/aep-register` | When creating a new element | Registers element in all three config files (scene, registry, theme) |

CLI validator:
```bash
node harness/aep-validate.js          # Scan source files for violations
node harness/aep-safety-guard.js      # Run safety guard (one-time or --watch)
```

### MCP Proxy

AEP 2.1 works with MCP (Model Context Protocol) servers. When AEP MCP tools are available (`list_aep_schemas`, `create_ui_element`, `get_scene_graph`, `execute_workflow_step`, `call_validated_api`), the agent routes all UI mutations through the MCP proxy instead of direct file edits. This enables:

- Server-side ID minting (no client-side ID collisions)
- Real-time policy evaluation before element creation
- Scene graph queries without parsing local files
- Schema-validated API calls and workflow steps

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

## dynAEP: Dynamic Agent Element Protocol

dynAEP fuses AEP with AG-UI (Agent-User Interaction Protocol). It extends AEP's build-time governance with real-time bidirectional event streaming.

**AEP** solves the build-time problem: validated UI scaffolding.
**dynAEP** solves the runtime problem: every live AG-UI event is validated against the AEP graph before touching the UI.

### The Protocol Stack

```
Agent-Tools     MCP       - Agent connects to external data and tools
Agent-Agent     A2A       - Agents coordinate across distributed systems
Agent-User      AG-UI     - Real-time event streaming agent <-> frontend
Agent-UI-Gov    AEP       - Deterministic UI structure, behaviour and skin
Agent-UI-Live   dynAEP    - AEP governance applied to live AG-UI events
```

### The dynAEP Bridge

Sits between the AG-UI event stream and the frontend. Every event passes through validation before reaching the UI:

```
AGENT BACKEND (LangGraph / CrewAI / Google ADK / any AG-UI backend)
    |  AG-UI events (SSE / WebSocket)
    v
dynAEP Bridge
    |  Validate against scene + registry + z-bands + skin_bindings + Rego
    v
AEP Frontend Renderer (React / Vue / Svelte / Tauri)
```

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

For optimistic locking, mutations must include `expected_version`. If the element's version changed, the mutation is rejected.

### Human-in-the-Loop

```yaml
approval_policy:
  structure_mutations: "auto"
  behaviour_mutations: "auto"
  skin_mutations: "auto"
  new_element_creation: "require_approval"
  forbidden_pattern_changes: "require_approval"
```

---

## Using AEP Tools as an Agent

When you have AEP MCP tools available, follow this sequence:

```
1. list_aep_schemas        -> Learn what's valid in THIS environment
2. get_scene_graph         -> See what already exists
3. reset_environment       -> (optional) Start clean
4. create_ui_element       -> Build panels under SH-00001
5. create_ui_element       -> Add widgets/components inside panels
6. create_ui_element       -> Add controls inside widgets
7. get_scene_graph         -> Verify final state
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
| Skipping the resolver | Calling a validator directly | Always route through BasicResolver before validating |
| Not recording validation results | Validating without calling memory.record() | Call memory.record() after every accept and reject |
| Ignoring rejection history | Retrying a failed element blindly | Query get_rejection_history() before retrying a failed element |
| Hardcoding validator selection | Manually picking WorkflowRegistry vs APIRegistry | Let the resolver determine the correct pipeline |

### Handling Rejections

1. Read the error. It tells you exactly what's wrong and lists valid options.
2. Fix the specific parameter.
3. Retry with corrected values.
4. NEVER retry with the same values.

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
```

---

## Connecting to the AEP Demo Server

For Claude Code:
```bash
claude mcp add aep-demo --transport http https://aep.newlisbon.agency/demo/mcp
```

For other MCP clients: add the URL with HTTP transport.

## Lattice Memory (v2.1)

Lattice Memory is a persistent append-only store of every validation result (accepted and rejected) that the adjudication lattice produces. Memory is **read-only to the validation decision**. Accept/reject stays deterministic. Memory serves two auxiliary purposes: surfacing historically successful patterns earlier and finding nearest accepted proposals for fast-path short-circuiting.

**When to use it:** After every AOT or JIT validation call, record the result in the memory fabric. Before proposing a new element, query the fabric for nearest attractors to improve proposal quality.

**Key API methods:**

| Method | Purpose |
|--------|---------|
| `record(entry)` | Store a validation result (accepted or rejected) |
| `find_nearest_attractor(embedding, limit)` | Search for similar accepted proposals by vector similarity |
| `get_fast_path_hit(embedding, threshold)` | Check if a near-identical proposal was already validated |
| `get_rejection_history(element_id)` | Learn from previous failures for a specific element |

**Import path:**

```python
from sdk_aep_memory import InMemoryFabric, create_memory_entry
```

**Usage pattern (record then query):**

```python
from sdk_aep_memory import InMemoryFabric, create_memory_entry

fabric = InMemoryFabric()

entry = create_memory_entry(
    element_id="CP-00001",
    domain="ui",
    proposal={"z": 20, "type": "component"},
    result="accepted",
    errors=[],
    traversal_path=["SH-00001", "PN-00001", "CP-00001"],
)
fabric.record(entry)

rejections = fabric.get_rejection_history("CP-00001")
if rejections:
    print(f"Element CP-00001 was rejected {len(rejections)} time(s) before")
```

SDK files: `sdk/sdk-aep-memory.py`, `sdk/sdk-aep-memory.ts`. Docs: `docs/LATTICE-MEMORY.md`.

## Basic Resolver (v2.1)

The Basic Resolver routes agent proposals to the correct validator pipeline (UI, Workflow, API, Event, IaC) based on element prefix, z-band, registry lookup and Rego policies. It optionally queries Lattice Memory for attractor fast-path hits.

**When to use it:** Before calling any validator directly, pass the proposal through the resolver to determine the correct route and collect applicable constraints. Agents should never manually select which registry to validate against.

**Key API methods:**

| Method | Purpose |
|--------|---------|
| `resolve(request)` | Route a proposal, returning route, constraints, policy status and optional attractor |
| `get_available_routes()` | List which domains have registries loaded |

**Import path:**

```python
from sdk_aep_resolver import BasicResolver, ResolveRequest
```

**Usage pattern (resolve then validate):**

```python
from sdk_aep_resolver import BasicResolver, ResolveRequest

resolver = BasicResolver(config=aep_config, memory=fabric)

result = resolver.resolve(ResolveRequest(
    proposal_type="ui_element",
    element_id="CP-00003",
    payload={"z": 22},
))

if result.fast_path:
    print("Fast-path hit: proposal matches a previously accepted pattern")
elif result.policy_pass:
    print(f"Route to {result.route} validator with {len(result.constraints)} constraint(s)")
else:
    print(f"Policy errors: {result.policy_errors}")
```

SDK files: `sdk/sdk-aep-resolver.py`, `sdk/sdk-aep-resolver.ts`. Docs: `docs/RESOLVER.md`.

---

## References

- AEP Whitepaper: https://github.com/thePM001/AEP-agent-element-protocol
- AEP 2.1 Agent Harness: https://github.com/thePM001/AEP-agent-element-protocol/tree/main/aep-2.1-agent-harness
- dynAEP: https://github.com/thePM001/dynAEP-dynamic-agent-element-protocol
- AG-UI Protocol: https://github.com/ag-ui-protocol/ag-ui
- Live Demo: https://aep.newlisbon.agency
