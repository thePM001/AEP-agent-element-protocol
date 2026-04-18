---
name: aep
description: Use this skill whenever interacting with the Agent Element Protocol (AEP) v2.0 MCP server to build UI elements. Triggers include any mention of 'AEP', 'Agent Element Protocol', 'scene graph', 'AEP tools', 'zero-trust UI', 'create_ui_element', 'aep-demo', 'lattice memory', 'resolver', 'attractor', 'fast-path', 'aep v2', building UI through MCP validation or connecting to an AEP MCP endpoint. Also use when the user asks you to build interfaces, dashboards, forms or any UI via AEP tools. If you see AEP MCP tools available in your session (list_aep_schemas, create_ui_element, get_scene_graph, etc.), always consult this skill before making any tool calls. Do NOT guess IDs, skin bindings, z-bands or element types - this skill tells you exactly what is valid.
---

# Agent Element Protocol (AEP) - Agent Skill

AEP is a zero-trust UI framework. You propose elements, AEP validates them. Only valid elements render. Invalid proposals are rejected with specific errors. You self-correct and retry.

## Critical Rules

1. **NEVER invent element IDs.** The server mints all IDs. You only provide: type, parent, z, skin_binding, label.
2. **ALWAYS call `list_aep_schemas` first.** This returns the live registry of valid types, z-bandsand skin bindings. Do not rely on memory - the registry may change between sessions.
3. **ALWAYS call `get_scene_graph` before building.** Know what exists before adding to it.
4. **Start from root `SH-00001`.** Every element tree begins here.
5. **Use the server-returned ID** for any subsequent parent references. After `create_ui_element` returns `{"element_id": "PN-00001"}`, use `PN-00001` as the parent for children - never make up IDs.
6. **If rejected, read the error and fix it.** Don't retry the same call. The rejection tells you exactly what's wrong.

## Connection

Add the MCP server with HTTP transport:

```
claude mcp add aep-demo --transport http https://aep.newlisbon.agency/demo/mcp
```

## Available Tools

### list_aep_schemas
Call first. No arguments. Returns valid types, z-bands, skin bindings, workflow actionsand API methods.

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
| method | string | yes | GET, POST, PUT, PATCHandor DELETE |
| endpoint | string | yes | Must start with `/` |
| body | object | no | Required for POST, PUT, PATCH |

### get_scene_graph
Returns the full current scene graph. No arguments. Call this to see what exists.

### reset_environment
Wipes everything and restores root shell `SH-00001`. No arguments.

## Element Types and Z-Bands

These are the known types and their ID prefixes. Z-values must fall within the band for the prefix. Always verify against `list_aep_schemas` output, as the registry is authoritative.

| Type | Prefix | Z-Band |
|------|--------|--------|
| shell | SH | 0–9 |
| panel | PN | 10–19 |
| widget | WG | 20–29 |
| control | CT | 30–39 |
| overlay | OV | 40–49 |
| cell | CL | 50–59 |

## Skin Bindings

Use only registered skin bindings. Common ones include:

`shell`, `panel_header`, `panel_sidebar`, `panel_main`, `panel_footer`, `widget_card`, `toolbar`, `button_primary`, `button_secondary`, `icon_button`, `input`, `dropdown`, `form`, `nav_item`, `data_grid`, `cell_node`, `modal`, `overlay_backdrop`, `tooltip`, `logo`, `avatar`, `status_indicator`, `text_muted`

**Do NOT invent skin bindings.** If you use one that isn't registered, the call will be rejected.

## Standard Build Pattern

Follow this sequence every time:

```
1. list_aep_schemas          → learn what's valid
2. get_scene_graph            → see current state
3. reset_environment          → (optional) start clean
4. create_ui_element (panels) → build top-level structure under SH-00001
5. create_ui_element (widgets)→ add widgets inside panels
6. create_ui_element (controls)→ add controls inside widgets
7. get_scene_graph            → verify final state
```

## Example: Building a Dashboard

```
Step 1: list_aep_schemas
Step 2: get_scene_graph
Step 3: reset_environment
Step 4: create_ui_element(type="panel", parent="SH-00001", z=10, skin_binding="panel_header", label="Header")
        → returns element_id: "PN-00001"
Step 5: create_ui_element(type="panel", parent="SH-00001", z=11, skin_binding="panel_sidebar", label="Sidebar")
        → returns element_id: "PN-00002"
Step 6: create_ui_element(type="panel", parent="SH-00001", z=12, skin_binding="panel_main", label="Main Content")
        → returns element_id: "PN-00003"
Step 7: create_ui_element(type="widget", parent="PN-00003", z=20, skin_binding="widget_card", label="Tasks Widget")
        → returns element_id: "WG-00001"
Step 8: create_ui_element(type="control", parent="WG-00001", z=30, skin_binding="button_primary", label="Add Task")
        → returns element_id: "CT-00001"
Step 9: create_ui_element(type="control", parent="WG-00001", z=31, skin_binding="input", label="Task Input")
        → returns element_id: "CT-00002"
Step 10: get_scene_graph → verify everything
```

## Common Mistakes That Cause Rejections

| Mistake | Example | Fix |
|---------|---------|-----|
| Invented ID | `parent: "panel-1"` | Use server-returned ID like `PN-00001` |
| Wrong skin binding | `skin_binding: "panel"` | Use `panel_main`, `panel_header`, etc. |
| Z outside band | `type: "panel", z: 5` | Panels are 10–19, use `z: 10` |
| Unknown type | `type: "button"` | Use `control` with `button_primary` skin |
| Missing parent | `parent: "PN-00099"` | Check scene graph, use existing ID |

## Handling Rejections

When a call returns `{"valid": false, "errors": [...]}`:

1. Read each error message carefully
2. It tells you exactly what's wrong and what the valid options are
3. Fix the specific parameter(s)
4. Retry with corrected values
5. Never retry with the same values - that will fail again

## Live Demo Context

When building through the AEP demo server, your actions are broadcast live to a dashboard at `aep.newlisbon.agency`. Visitors can watch you build in real time. Passes show in green, rejections in red. Build deliberately and cleanly - this is a showcase.

## AEP v2.0

The AEP SDK is at version 2.0. This adds two features:

- **Lattice Memory** -- append-only validation memory with vector similarity search. Records every accept/reject result. Query for nearest attractors and rejection history.
- **Basic Resolver** -- stateless proposal routing to the correct validator pipeline (UI, Workflow, API, Event, IaC). Optionally queries memory for fast-path attractor hits.

The demo server at `aep.newlisbon.agency` will support Lattice Memory queries and Resolver routing once the server-side v2.0 update is deployed. The SDK files (`sdk/sdk-aep-memory.*` and `sdk/sdk-aep-resolver.*`) are available now.
