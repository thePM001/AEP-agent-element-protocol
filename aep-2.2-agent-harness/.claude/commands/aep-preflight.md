# /aep-preflight

## AEP 2.2 Preflight Check

Before making ANY code changes, you MUST complete this preflight:

### Step 1: Load the AEP Configuration

Read the following files completely. Do not summarize. Do not skip. Read every line.

1. `aep-scene.json` -- The element hierarchy (parent-child, z-index, visibility)
2. `aep-registry.yaml` -- Element definitions (xid, label, category, skin_binding, states)
3. `aep-theme.yaml` -- Visual rules (palette, typography, design_rules, component_styles)

### Step 2: Identify Constraints

From the loaded configuration, identify:
- Which elements exist and their xid assignments
- Which skin bindings are defined and their visual properties
- Which design rules are declared (border-radius, shadows, borders, inputs, buttons)
- Which typography tokens exist and their font/size/weight/color values
- Which color tokens exist in the palette

### Step 3: Evaluate Policies via AgentGateway

Before writing any code, the AgentGateway intercepts your planned actions:
- List which elements you will modify
- Verify each element has an aep-registry entry
- Verify your planned colors exist in the theme palette
- Verify your planned typography matches a defined token
- Verify your planned layout respects parent-child hierarchy in the scene graph
- Verify no design rule will be violated
- Confirm the AgentGateway policy evaluation passes for all planned mutations

### Step 4: Declare

State explicitly: "AEP preflight complete. {N} elements in scope. {N} design rules loaded. AgentGateway policy evaluation passed. No violations anticipated." Or state which potential conflicts exist and how you will resolve them.

Only then proceed with code changes.
