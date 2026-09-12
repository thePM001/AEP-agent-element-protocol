# Custom sub-lattices inside the AEP hyperlattice

A custom sub-lattice is the domain you attach onto one AEP hyperlattice wrap so Base Node can judge what an agent may propose in your field of work. Total AI output control stays the product and Base Node stays the local kernel, which means a domain folder is not a second kernel and is not a shipped UI product, commerce engine, workflow runner, REST server, events bus, IaC product or MCP product. You write the domain because the kernel already exists so this section is the instruction to follow in order and a missing piece is a broken wrap rather than a style choice.

### One wrap per governed system

One governed system gets one hyperlattice wrap. That wrap is the scene, the action paths, the written policy and the dock channels taken together. If any of those four is missing the wrap is broken and Admit has nothing complete to judge. The operator rule in the diagram above is the same sentence: scene plus action paths plus written policy plus dock channels.

Do not declare a second wrap for the same system in order to sneak around a closed wall. A finance wrap GAP item does not close an inventory wrap ping. A non-always-on GAP with an empty wrap does not fold onto every event.

### What you write and where it lives

You own the domain files. Put them in a folder you control, for example `records/` and point dynAEP `aep_sources` at that folder so the public library does not have to ship your domain.

| File you write | Role | Authority |
|----------------|------|-----------|
| Scene graph (`scene.json`) | Structure: what exists, where it sits and how deep it may go | Topology only |
| Registry (`registry.yaml`) | Behaviour: operations, types, fields, states and constraints | Names what may be proposed |
| Theme (`theme.yaml`) | Skin: colours, fonts and spacing bound only through `skin_binding` | Look only. No operations |
| Action lattice (`lattice.yaml`) | Event nodes: `action_path`, parents, constraints and `agent_may` | Partial order of moves |
| GAP instruction (`records.gap`) | Written policy: who may do what, bound to a wrap or an action-path prefix | Live Admit walls |
| Dock bind | Transport: sealed encrypted capsules into Base Node docks | No unsealed work |

Structure is the scene graph. Behaviour is the registry. Skin is look only and must not carry authority. Each move an agent is allowed to propose is an `action_path` node on the hyperlattice. GAP policy writes who may do what. Dock channels accept sealed capsules only.

Point the runtime at your files:

```yaml
aep_sources:
  scene: "./records/scene.json"
  registry: "./records/registry.yaml"
  theme: "./records/theme.yaml"
```

Changing look must not require changing operations. Changing an operation must not require changing colours. If one change forces you to edit scene and registry and theme together, the split is broken and you should fix the split before you attach.

### Structure: the scene graph

The scene graph is a flat object keyed by element id. Every element has a type, a parent (except the root shell), a depth band, a visibility flag and a layout rule. The scene is the source of truth for what exists. CSS, if you render a canvas, derives from it.

Element ids use a two-letter prefix and a zero-padded number (`SH-00001`, `PN-00001`, `CZ-00001`). Agents do not mint ids because the bridge mints ids so two agents cannot collide. A typical depth split is shell `0-9`, panel `10-19`, component `20-29`, cell zone `30-39`, overlay `60-69`, modal `70-79` and tooltip `80-89`. A tooltip must not sit in the shell band. A panel must not sit in the tooltip band. The validator rejects a stolen band.

Every element except the root shell must name a parent that already exists in the same scene. Children stay inside their parent. A missing parent, a cycle or an unknown prefix is a structural reject before any action runs.

```json
{
  "aep_version": "2.8.6",
  "schema_revision": 1,
  "elements": {
    "SH-00001": {
      "id": "SH-00001",
      "type": "shell",
      "label": "Records shell",
      "z": 0,
      "visible": true,
      "parent": null,
      "layout": { "width": "100vw", "height": "100vh" },
      "children": ["PN-00001"]
    },
    "PN-00001": {
      "id": "PN-00001",
      "type": "panel",
      "label": "Records list",
      "z": 10,
      "visible": true,
      "parent": "SH-00001",
      "children": ["CZ-00001"]
    },
    "CZ-00001": {
      "id": "CZ-00001",
      "type": "cell_zone",
      "label": "Record rows",
      "z": 30,
      "visible": true,
      "parent": "PN-00001",
      "children": []
    }
  }
}
```

If your domain is not a screen, you still write a scene. The scene is the map of what exists in the governed system: records, queues, endpoints, machines and ledgers. Depth bands then name isolation instead of pixels. A missing scene is a missing wrap piece.

### Behaviour: the registry

The registry names every valid operation, type, field and constraint. It contains no visual properties. Styling is delegated through `skin_binding`. An agent may only propose an operation that exists in this registry. Unknown operations deny.

Each entry needs a label, a category, a function, a parent when it is a scene element, a `skin_binding` when it renders, the states it may occupy, the actions it may emit and the constraints it must keep. Template entries cover repeating rows so you prove the mould once rather than every instance.

```yaml
aep_version: "2.8.6"
schema_revision: 1

create_record:
  label: "Create record"
  category: action
  function: "Insert a new record with a title and an owner."
  actions: ["records:create"]
  constraints:
    - "title is required and non-empty"
    - "owner must be a registered agent_id"
    - "Must not set archived on create"

archive_record:
  label: "Archive record"
  category: action
  function: "Archive an existing record after it has been created."
  actions: ["records:archive"]
  constraints:
    - "record_id is required"
    - "record must already exist"
    - "Must not archive twice"
```

When a proposal fails, return a specific error so the agent can correct that field. Do not return a generic fail and do not retry the same payload.

### Skin: look only

The theme file holds colours, fonts, spacing, borders and motion. Components reference it through `skin_binding`. The theme must not name operations, who may act, parents or docks. If a colour file can allow or deny an action, authority has leaked into skin and the wrap is broken.

```yaml
aep_version: "2.8.6"
schema_revision: 1
theme_name: "Records quiet"

colours:
  bg_primary: "#0D1117"
  accent: "#58A6FF"
  error: "#F85149"

component_styles:
  panel_main:
    background: "{colours.bg_primary}"
  button_primary:
    background: "{colours.accent}"
```

To rebrand, swap the theme and leave scene and registry untouched.

### Action paths

Every move an agent may propose is an `action_path` node. The lattice says which actions exist, what must happen before each action (parents), which constraints apply at arrival and which agents may perform the action. An action cannot proceed until every parent has been satisfied. That partial order is how you stop archive-before-create, pay-before-risk or apply-before-Admit.

```yaml
aep_version: "2.8.6"
lattice_revision: 1

actions:
  records:create:
    label: "Create a record"
    category: agent_action
    parents: []
    children: ["records:archive"]
    constraints:
      - type: required_field
        field: title
        description: "A record must carry a title"
      - type: required_field
        field: owner
        description: "A record must name an owner agent_id"
    agent_may: ["clerk"]

  records:archive:
    label: "Archive a record"
    category: agent_action
    parents: ["records:create"]
    children: []
    constraints:
      - type: required_field
        field: record_id
        description: "Archive needs the id minted on create"
    agent_may: ["archivist"]
```

`agent_may` on the lattice node is the same who-may idea as GAP. Empty grants close the action. Rank rings are not the Admit floor. Agent A may create and agent B may archive with no rank between them.

### Written policy (GAP)

GAP is the written instruction that becomes a live Admit wall after a sealed capsule. Keep `.gap` as UTF-8 source with one instruction per document. Writing and security are always-on stems and they evaluate on every action path. Other walls bind to a wrap or to an `action_path_prefix` so a records wall does not close a payments ping.

Who-may is `agent_may` so an empty grant list closes that agent's action. `trust_ring` is a documentary label and rank use warns then denies while who-may stays `agent_may`.

```yaml
address:
  domain: app.records
  id: records-wrap.v1

pattern: |
  Clerk may create and update records. Archivist may archive. No other agent may.

action:
  type: structured
  schema: RecordProposal
  structured_generation: true
  content: |
    Propose records:create or records:archive against the records registry.
    Do not execute until Base Node Admit allows the output.

metadata:
  version: "1.0.0"
  agent_may:
    - agent_id: clerk
      action: records:create
    - agent_id: archivist
      action: records:archive
  wrap: records
  action_path_prefix: records

types:
  RecordProposal:
    format: json
    fields:
      action_path: string
      title: string
      owner: string
      record_id: string
```

Load the GAP file with the policy lattice (`AEP-Policy-System/SETUP.md` and `AEP-Components/gap/README.md`). Live evaluation still waits for freeze-at-seal, the 1000 ms kernel pulse and collect-all walls. Attractors in Lattice Memory are forensic records so they do not skip Admit.

### Dock channels

Every crossing of the wrap is a sealed encrypted lattice-channel capsule. Native AEP clients seal the frame and hand it to Base Node docks. Foreign stacks may use the optional UCB airlock with a task manifest. They must not open raw dock sockets and they must not send unsealed work. A missing dock, timestamp or sequence fails automatically.

See [`AEP-Docks/README.md`](AEP-Docks/README.md) and [`AEP-Components/lattice-channels/`](AEP-Components/lattice-channels/) for the wire. This how-to does not replace those specs and only states the wrap rule: no dock channel, no wrap.

### The attach pattern

Write the domain as four jobs that stay in this order.

First, name the valid operations, types, fields and constraints in the registry and on the action lattice. Second, check every agent-proposed action against that registry and against parent closure. Third, when the proposal fails, return a specific error so the agent can correct the field, the parent or the grant. Fourth, execute only after Base Node Admit allows the output.

Keep the registry stateless. The caller passes execution state in (the current record, the current cart, the current graph). Your checker does not hold the live store.

Your domain check may reject a payload before it is sealed. That is useful because an unknown `action_path` should never waste a capsule. The domain check may not skip Admit so execution happens only after Base Node allows the output. TypeScript `processEvent` is not product Admit and CodeSandbox executes agent code as a named live surface rather than a second kernel.

Rejection bodies should be specific:

| Failure | Error the agent should see |
|---------|----------------------------|
| Unknown operation | `unknown_action: records:delete is not in the records registry` |
| Missing field | `missing_field: title is required on records:create` |
| Parent not satisfied | `parent_unsatisfied: records:archive requires records:create` |
| Empty or wrong grant | `agent_may: clerk may not records:archive` |
| Skin tried to deny | `skin_has_authority: theme must not name operations` |
| Admit closed | `admit_denied: collect-all closed this capsule; execution must not run` |

The agent reads the error, fixes that parameter and retries. It must not retry the same payload.

### Kernel sequence you cannot skip

The kernel sequence is seal, freeze, wait, collect-all Admit then Apply. After the capsule is opened, Base Node freezes the clock at seal time, waits 1000 ms (compiled `PULSE_MS`, not a dynAEP yaml key), then runs every bound check together and only then carries out the allowed action. live-entry is the worked scene and a derived ledger of fifteen named rows records that evaluation so the ledger is not a second pass which can skip the wait.

See [Kernel pulse](#kernel-pulse) for how the wait can be changed in theory (rebuild Base Node). TypeScript dynAEP remains a standalone component and does not own this wait.

### Worked example: a records domain

Suppose you govern a records inbox. Clerk may create a record. Archivist may archive a record that already exists. No one else may. You create `records/` with the scene, registry, theme, lattice and GAP files above. You point `aep_sources` at that folder. You load `records.gap` so wrap `records` and prefix `records` are bound. You run Base Node so docks accept sealed capsules.

Walk a clerk proposal `{ "action_path": "records:create", "owner": "clerk" }` with no title. The registry check returns `missing_field: title is required on records:create` before a capsule is sealed. The clerk retries with a title. The lattice parent list is empty so create may proceed. GAP `agent_may` lists clerk on `records:create` so the wall does not close. The client seals a lattice-channel capsule. Base Node freezes, waits 1000 ms, runs collect-all Admit and Apply. Only then does your executor insert the row and the bridge mints `record_id`.

Walk an archive before create. The lattice parent `records:create` has not been satisfied so the checker returns `parent_unsatisfied` and nothing is sealed.

Walk a clerk who proposes `records:archive`. GAP `agent_may` does not grant clerk that action so Admit closes even if the registry shape is valid. Execution must not run.

Walk a theme file that lists `actions: ["records:create"]`. That is skin carrying authority so reject the theme and fix the split.

That is the whole attach: files you own, checks you write, kernel you do not replace.

### What not to do

Do not stand up a parallel runtime that opens unsealed work and do not treat extra domain folders as extra layers of the library, because the library count is the four-row table of kernel, protocol, execution companion and clients. Do not skip Admit because a domain checker already liked the payload and do not let TypeScript `processEvent` pose as product Admit. Do not put who-may rules in the theme, do not mint element ids in the agent, do not bind a payments GAP wall to an empty wrap and expect it to police records and do not point `aep_sources` at a folder you do not own and then call that your domain.

### Attach checklist

- [ ] One wrap declared for this governed system
- [ ] Scene graph present, rooted, parents closed and depth bands kept
- [ ] Registry names every operation, type, field and constraint
- [ ] Theme has look only and no operations
- [ ] Action lattice names `action_path` nodes, parents, constraints and `agent_may`
- [ ] GAP instruction binds `wrap` or `action_path_prefix` and lists `agent_may`
- [ ] Writing and security stems stay on
- [ ] Dock channels take sealed capsules only
- [ ] Domain checker returns specific errors
- [ ] Registry stays stateless
- [ ] Execution runs only after Base Node Admit
- [ ] `aep_sources` points at your folder
- [ ] A missing title, a skipped parent, a wrong agent and a skipped Admit each fail in test
