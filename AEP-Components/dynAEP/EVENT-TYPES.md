# dynAEP 1.0 Event Type Reference

**Document Version 1.0.0**
**Status: Authoritative**
**Supersedes: SPEC.md section 5 for event type definitions**

This document is the complete event type reference for dynAEP 1.0.
Every event type in the protocol is documented with its schema, fields,
example payload, emission conditions and producing/consuming layer.

---

## Event Namespace Convention

All dynAEP 1.0 events use the AG-UI type discriminator pattern.
The outer `type` field is always `"CUSTOM"`. The `dynaep_type` field
carries the specific protocol type identifier that selects the event
handler and schema validation rules.

All events conform to this envelope:

```json
{
 "type": "CUSTOM",
 "dynaep_type": "<EVENT_TYPE_IDENTIFIER>",
 "bridge_timestamp": <epoch_ms>,
 "...": "<event-specific fields>"
}
```

The `bridge_timestamp` is set by the bridge clock at ingest time.
Agents never set this field. The bridge overwrites any agent-provided
value. All timestamps are milliseconds since Unix epoch (UTC).

---

## Category 1: Lattice Events (NEW v1.0)

Introduced in dynAEP 1.0. These events are specific to Action Lattice
governance. They flow through the bridge pipeline with lattice validation
as the first stage.

---

### 1.1 LATTICE_EVENT

**dynaep_type:** LATTICE_EVENT
**Version introduced:** v1.0

The canonical event shape that flows through the bridge pipeline.
Every observer adapter normalises its native event into this shape.
Every agent action is encoded as a LATTICE_EVENT before entering the
pipeline. The bridge validates this event against the Action Lattice
at arrival time.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "LATTICE_EVENT",
 "source": "<adapter or agent name>",
 "action_path": "<dot-delimited lattice path>",
 "payload": { "<event-specific data>" },
 "bridge_timestamp": <epoch_ms>,
 "agent_id": "<agent id or null>",
 "trust_tier": <1-5>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|--------------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "LATTICE_EVENT" |
| source | string | yes | Identifies the origin adapter or agent that produced the event. Examples: "webhook:stripe", "eth:0xabc...", "agent:trader-alpha" |
| action_path | string | yes | Selects the LatticeNode that this event targets. Must match a path declared in the lattice registry |
| payload | object | yes | Carries the event data. Structure is action-specific |
| bridge_timestamp | number | yes | Authoritative time of arrival set by the bridge at ingest time |
| agent_id | string | no | Identifies the originating agent. Null for external events and system events |
| trust_tier | number | no | Conveys the agent current authorization level. Set by the bridge. Range 1-5 |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "LATTICE_EVENT",
 "source": "webhook:stripe",
 "action_path": "webhook:incoming",
 "payload": {
 "signature": "0xabc123def456",
 "event_type": "payment_intent.succeeded",
 "data": { "id": "pi_123", "amount": 2999 }
 },
 "bridge_timestamp": 1714300800000,
 "agent_id": null,
 "trust_tier": 1
}
```

**When Emitted:** Emitted by observer adapters when they receive an
external event. Emitted by agents when they propose an action. Emitted
by the system for lifecycle signals.

**Layer:** Produced by Observer Adapters and Agent SDKs. Consumed by
the Bridge (Lattice Filter stage).

---

### 1.2 LATTICE_FILTER_RESULT

**dynaep_type:** LATTICE_FILTER_RESULT
**Version introduced:** v1.0

The structured verdict produced by the lattice filter for every
LATTICE_EVENT that passes through it. This is the only event type
that carries the complete validation outcome including constraint
results, partial-order status, trust evaluation and agent interest
matches.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "LATTICE_FILTER_RESULT",
 "action_path": "<matched path>",
 "passed": <true|false>,
 "matched_node": "<exact node path>",
 "constraints_passed": ["<constraint name>"],
 "constraints_failed": ["<reason string>"],
 "partial_order_satisfied": <true|false>,
 "missing_parents": ["<parent path>"],
 "trust_sufficient": <true|false>,
 "matched_interests": [
 {
 "agent_id": "<agent id>",
 "watch_paths": ["<glob pattern>"],
 "notify": "wake|queue|log"
 }
 ],
 "next_actions": ["<child path>"],
 "duration_us": <microseconds>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|------------------------|---------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "LATTICE_FILTER_RESULT" |
| action_path | string | yes | The action path that was matched |
| passed | boolean | yes | True if the event passed all validation checks |
| matched_node | string | yes | The exact lattice node path that was matched |
| constraints_passed | array | yes | Names of constraints that passed validation |
| constraints_failed | array | yes | Human-readable reason strings for failed constraints |
| partial_order_satisfied| boolean | yes | True if all parent actions have occurred |
| missing_parents | array | yes | Paths of parent actions that have not been satisfied |
| trust_sufficient | boolean | yes | True if the agent trust tier meets the node trust floor |
| matched_interests | array | yes | List of AgentInterest records matching this event path |
| next_actions | array | yes | Paths of child nodes that may follow this event |
| duration_us | number | yes | Wall-clock time spent in filter execution in microseconds |

**Example Payload (pass):**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "LATTICE_FILTER_RESULT",
 "action_path": "webhook:incoming",
 "passed": true,
 "matched_node": "webhook:incoming",
 "constraints_passed": ["signature"],
 "constraints_failed": [],
 "partial_order_satisfied": true,
 "missing_parents": [],
 "trust_sufficient": true,
 "matched_interests": [
 {
 "agent_id": "payment-agent",
 "watch_paths": ["webhook:*"],
 "notify": "wake"
 }
 ],
 "next_actions": ["webhook:validate"],
 "duration_us": 42
}
```

**Example Payload (fail):**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "LATTICE_FILTER_RESULT",
 "action_path": "agent:trade:execute",
 "passed": false,
 "matched_node": "agent:trade:execute",
 "constraints_passed": ["amount"],
 "constraints_failed": ["authorization: trust_tier >= 5 required, agent has tier 3"],
 "partial_order_satisfied": true,
 "missing_parents": [],
 "trust_sufficient": false,
 "matched_interests": [],
 "next_actions": [],
 "duration_us": 23
}
```

**When Emitted:** Produced for every lattice-addressed event that
enters `LatticeFilter.filterAsync()` (awaited by `DynAEPBridge.processEvent()`).
The result is returned to the caller for routing decisions. A failed result
causes immediate rejection before any downstream pipeline stage runs.
Custom constraints require `filterAsync()`; synchronous `filter()` fails closed
on custom constraints.

**Layer:** Produced by the Bridge (Lattice Filter stage). Consumed by
the Bridge pipeline dispatcher and the event caller.

---

### 1.3 LATTICE_REGISTER

**dynaep_type:** LATTICE_REGISTER
**Version introduced:** v1.0

Used by agents to declare interest in lattice paths (wire-level spec).
**Shipped runtime API:** `DynAEPBridge.registerAgentInterest()` /
`deregisterAgentInterest()`. The bridge maintains interests in the lattice
filter and uses glob matching on `action_path` events (`matched_interests`
in `LATTICE_FILTER_RESULT`).

**Forward-compatible event dispatch:** when implemented, registration would
pass through the lattice as `agent:interest:register` (parent: `agent:ready`).
The TypeScript bridge does not yet handle `dynaep_type: LATTICE_REGISTER` in
`processEvent()`; use the programmatic API.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "LATTICE_REGISTER",
 "agent_id": "<agent id>",
 "watch_paths": ["<glob pattern>"],
 "notify": "wake|queue|log",
 "max_rate": "<rate limit string>",
 "constraints": { "<additional filters>" }
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|-------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "LATTICE_REGISTER" |
| agent_id | string | yes | The agent unique identifier. Must match a registered agent |
| watch_paths | array | yes | Glob patterns matching action paths. Supports exact match, single-segment wildcard (*) and multi-segment wildcard (**) |
| notify | string | yes | Notification mode. One of "wake", "queue", "log" |
| max_rate | string | no | Rate limit string such as "10/min" or "1/sec" |
| constraints | object | no | Additional match filters beyond the action path glob. Example: { "min_confidence": 0.7 } |

**Notify Modes:**

| Mode | Description |
|---------|-------------|
| wake | Immediately trigger the agent with the event payload. Used for real-time responses |
| queue | Store the event in a per-agent queue for later retrieval. Agent polls on its own schedule |
| log | Record the event in the agent activity log without delivery. Used for audit trails and analytics |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "LATTICE_REGISTER",
 "agent_id": "trader-alpha",
 "watch_paths": ["market:*", "agent:trade:*"],
 "notify": "wake",
 "max_rate": "10/min",
 "constraints": { "min_confidence": 0.7 }
}
```

**When Emitted:** Emitted by agents after they have been registered
and are ready (agent:ready parent must be satisfied). The bridge
processes the registration and adds the agent to the interest registry.

**Layer:** Produced by Agent SDKs. Consumed by the Bridge (Agent
Interest Registry).

---

## Category 2: Mutation Events (Existing from v0.4)

Introduced in dynAEP v0.4. These events carry structural, behavioural,
and skin mutations against the AEP scene graph. They remain fully
supported in v1.0 and now pass through the lattice filter before
reaching structural validation. The lattice filter checks that the
agent is registered and the partial order is satisfied before the
mutation reaches the scene graph.

---

### 2.1 AEP_MUTATE_STRUCTURE

**dynaep_type:** AEP_MUTATE_STRUCTURE
**Version introduced:** v0.4

A structure mutation against the AEP scene graph. Adds, removes, or
modifies element nodes in the topological matrix. Each mutation carries
the target element ID, the mutation type and a mutation delta that
describes the structural change.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_MUTATE_STRUCTURE",
 "element_id": "<aep element id>",
 "mutation_type": "add|remove|modify",
 "mutation": { "<structural delta>" },
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|----------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "AEP_MUTATE_STRUCTURE" |
| element_id | string | yes | The target AEP element ID. Must exist in the live scene graph for remove and modify operations |
| mutation_type | string | yes | One of "add", "remove", "modify" |
| mutation | object | yes | The structural delta. For "add" operations carries the full element definition. For "modify" carries the fields to change. For "remove" may be empty |
| bridge_timestamp| number| yes | Authoritative bridge timestamp |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_MUTATE_STRUCTURE",
 "element_id": "CP00042",
 "mutation_type": "modify",
 "mutation": {
 "position": { "x": 120, "y": 340 },
 "size": { "width": 300, "height": 200 }
 },
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted by agents or UI renderers when a structural
change to the UI scene graph is required. The mutation is validated
against the lattice filter and then against the AEP scene graph.

**Layer:** Produced by Agent SDKs and UI middleware. Consumed by the
Bridge (Structural Validation / AEP Scene Graph stage).

---

### 2.2 AEP_MUTATE_BEHAVIOUR

**dynaep_type:** AEP_MUTATE_BEHAVIOUR
**Version introduced:** v0.4

A behaviour mutation against the AEP scene graph. Changes the
interactive behaviour of a UI element including click handlers,
hover states, keyboard shortcuts and animation triggers.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_MUTATE_BEHAVIOUR",
 "element_id": "<aep element id>",
 "behaviour_name": "<behaviour identifier>",
 "behaviour_config": { "<behaviour parameters>" },
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|-----------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "AEP_MUTATE_BEHAVIOUR" |
| element_id | string | yes | The target AEP element ID |
| behaviour_name | string | yes | The behaviour identifier. Examples: "on_click", "on_hover", "on_keydown", "animation" |
| behaviour_config| object | yes | The behaviour configuration parameters |
| bridge_timestamp| number | yes | Authoritative bridge timestamp |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_MUTATE_BEHAVIOUR",
 "element_id": "BT00123",
 "behaviour_name": "on_click",
 "behaviour_config": {
 "action": "toggle_menu",
 "debounce_ms": 300
 },
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted by agents when the interactive behaviour of
a UI element needs to change. The mutation is validated against the
lattice and the AEP behaviour schema.

**Layer:** Produced by Agent SDKs. Consumed by the Bridge (Structural
Validation / AEP Scene Graph stage).

---

### 2.3 AEP_MUTATE_SKIN

**dynaep_type:** AEP_MUTATE_SKIN
**Version introduced:** v0.4

A skin mutation against the AEP scene graph. Changes the visual
appearance of a UI element including colour, typography, spacing,
and theme properties.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_MUTATE_SKIN",
 "element_id": "<aep element id>",
 "skin_property": "<property path>",
 "value": "<new value>",
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|----------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "AEP_MUTATE_SKIN" |
| element_id | string | yes | The target AEP element ID |
| skin_property | string | yes | The skin property path using dot notation. Examples: "colors.background", "typography.fontSize", "spacing.padding" |
| value | any | yes | The new value for the skin property |
| bridge_timestamp| number| yes | Authoritative bridge timestamp |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_MUTATE_SKIN",
 "element_id": "CP00042",
 "skin_property": "colors.background",
 "value": "#1a1a2e",
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted by agents or theme middleware when the
visual appearance of a UI element needs to change. The mutation is
validated against the lattice and the AEP skin schema.

**Layer:** Produced by Agent SDKs and theme middleware. Consumed by
the Bridge (Structural Validation / AEP Scene Graph stage).

---

## Category 3: Query Events (Existing from v0.4)

Introduced in dynAEP v0.4. These events query the AEP scene graph at
runtime and return structured results. They pass through the lattice
filter before reaching the scene graph.

---

### 3.1 AEP_QUERY

**dynaep_type:** AEP_QUERY
**Version introduced:** v0.4

A runtime query against the AEP scene graph. Queries may request
element data by ID, registry snapshots, element visibility, rendered
dimensions or the next available element ID prefix.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_QUERY",
 "target_id": "<element id or prefix>",
 "query_type": "exists|is_visible|rendered_matrix|full_element|next_available_id",
 "params": { "<query parameters>" },
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|----------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "AEP_QUERY" |
| target_id | string | yes | The element ID to query or the prefix for next_available_id queries |
| query_type | string | yes | One of "exists", "is_visible", "rendered_matrix", "full_element", "next_available_id" |
| params | object | no | Additional query parameters |
| bridge_timestamp| number| yes | Authoritative bridge timestamp |

**Query Types:**

| Type | Description |
|-------------------|-------------|
| exists | Returns whether the element ID exists in the live scene graph |
| is_visible | Returns whether the element is currently visible |
| rendered_matrix | Returns the responsive visibility matrix for the element |
| full_element | Returns the full element definition from the scene and registry |
| next_available_id | Returns the next available element ID for the given prefix |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_QUERY",
 "target_id": "CP00042",
 "query_type": "full_element",
 "params": {},
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted by agents or UI middleware when runtime
information about the scene graph is needed. The query is validated
against the lattice and then executed against the live scene graph.

**Layer:** Produced by Agent SDKs and UI middleware. Consumed by the
Bridge (AEP Scene Graph Query handler).

---

### 3.2 AEP_QUERY_RESULT

**dynaep_type:** AEP_QUERY_RESULT
**Version introduced:** v0.4

The structured response to an AEP_QUERY. Carries the query result
data matching the requested query type.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_QUERY_RESULT",
 "target_id": "<element id or prefix>",
 "result": { "<query result data>" },
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|----------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "AEP_QUERY_RESULT" |
| target_id | string | yes | The element ID or prefix that was queried |
| result | object | yes | The query result data. Structure depends on the query type |
| bridge_timestamp| number| yes | Authoritative bridge timestamp |

**Example Payload (full_element query):**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_QUERY_RESULT",
 "target_id": "CP00042",
 "result": {
 "scene": {
 "id": "CP00042",
 "type": "container",
 "position": { "x": 120, "y": 340 },
 "size": { "width": 300, "height": 200 }
 },
 "registry": {
 "element_type": "container",
 "default_behaviours": [],
 "skin_defaults": {}
 },
 "version": 3
 },
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted synchronously by the bridge in response to
an AEP_QUERY. The result is returned to the caller.

**Layer:** Produced by the Bridge (AEP Scene Graph). Consumed by Agent
SDKs and UI middleware.

---

## Category 4: Rejection Events (Existing from v0.4)

Introduced in dynAEP v0.4. These events carry validation failure
information from the bridge pipeline.

---

### 4.1 DYNAEP_REJECTION

**dynaep_type:** DYNAEP_REJECTION
**Version introduced:** v0.4

Emitted when the bridge rejects an event at any pipeline stage.
Carries the stage identifier, a human-readable error message and an
array of detailed violation strings.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "DYNAEP_REJECTION",
 "target_id": "<event target id>",
 "error": "<human-readable reason>",
 "original_event_timestamp": <epoch_ms>,
 "stage": "lattice|temporal|causal|structural|rego|scanner|perception",
 "violations": ["<detailed violation string>"]
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|------------------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "DYNAEP_REJECTION" |
| target_id | string | yes | The target element ID or event identifier that was rejected |
| error | string | yes | Human-readable reason for the rejection |
| original_event_timestamp| number| yes | The original event timestamp (may be agent-provided) |
| stage | string | yes | The pipeline stage that rejected the event. One of "lattice", "temporal", "causal", "structural", "rego", "scanner", "perception" |
| violations | array | yes | Detailed violation strings for multi-check stages |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "DYNAEP_REJECTION",
 "target_id": "CP00042",
 "error": "Element CP00042 not found in live scene graph",
 "original_event_timestamp": 1714300799500,
 "stage": "structural",
 "violations": [
 "Element ID CP00042 does not exist in scene graph",
 "No matching element found for mutation type 'modify'"
 ]
}
```

**When Emitted:** Emitted by any pipeline stage when validation fails.
The stage field identifies the exact rejection point. The violations
array provides actionable detail for debugging and retry logic.

**Layer:** Produced by any Bridge pipeline stage. Consumed by Agent
SDKs, UI middleware and the Evidence Ledger.

---

### 4.2 DYNAEP_SCHEMA_RELOAD

**dynaep_type:** DYNAEP_SCHEMA_RELOAD
**Version introduced:** v0.4

Emitted when the AEP configuration schema is reloaded at runtime.
Carries the old and new schema revision numbers and the AEP version.
Agents receiving this event should re-query scene graph state if they
cache it locally.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "DYNAEP_SCHEMA_RELOAD",
 "old_revision": <number>,
 "new_revision": <number>,
 "aep_version": "<version string>",
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|----------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "DYNAEP_SCHEMA_RELOAD" |
| old_revision | number | yes | The previous registry schema revision number |
| new_revision | number | yes | The new registry schema revision number |
| aep_version | string | yes | The AEP version string (e.g. "1.2") |
| bridge_timestamp| number| yes | Authoritative bridge timestamp |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "DYNAEP_SCHEMA_RELOAD",
 "old_revision": 2,
 "new_revision": 3,
 "aep_version": "1.2",
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted by the bridge when the AEP configuration is
reloaded at runtime via the management interface or configuration file
change. Causal ordering state partitions are reset on receipt.

**Layer:** Produced by the Bridge (Configuration Manager). Consumed by
Agent SDKs and the Causal Ordering Engine.

---

## Category 5: Runtime Reflection Events (Existing from v0.4)

Introduced in dynAEP v0.4. These events carry rendered coordinate data
from the browser runtime environment.

---

### 5.1 AEP_RUNTIME_COORDINATES

**dynaep_type:** AEP_RUNTIME_COORDINATES
**Version introduced:** v0.4

Carries the rendered coordinates of an AEP element as measured by the
browser ResizeObserver and MutationObserver. This is a runtime-only
event emitted from browser environments. It is not available in SSR
or Node.js contexts.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_RUNTIME_COORDINATES",
 "target_id": "<element id>",
 "coordinates": {
 "x": <number>,
 "y": <number>,
 "width": <number>,
 "height": <number>,
 "rendered_at": "<breakpoint name>",
 "visible": <true|false>
 },
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|----------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "AEP_RUNTIME_COORDINATES" |
| target_id | string | yes | The element ID of the observed element |
| coordinates | object | yes | The rendered coordinate data |
| coordinates.x | number | yes | The x position in pixels (rounded from getBoundingClientRect) |
| coordinates.y | number | yes | The y position in pixels (rounded from getBoundingClientRect) |
| coordinates.width | number | yes | The rendered width in pixels |
| coordinates.height| number | yes | The rendered height in pixels |
| coordinates.rendered_at | string | yes | The responsive breakpoint name. One of "base", "vp-md", "vp-lg" |
| coordinates.visible | boolean | yes | True if the element has non-zero width and height |
| bridge_timestamp| number| yes | Authoritative bridge timestamp |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_RUNTIME_COORDINATES",
 "target_id": "CP00042",
 "coordinates": {
 "x": 120,
 "y": 340,
 "width": 300,
 "height": 200,
 "rendered_at": "vp-lg",
 "visible": true
 },
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted by the browser-side reflection module when
a ResizeObserver detects a size or position change on a tracked AEP
element. Emissions are debounced per element (configurable, default
100 ms).

**Layer:** Produced by the Browser Runtime (Reflection Module). Consumed
by the Bridge and Agent SDKs.

---

## Category 6: Temporal Authority Events (Existing from v0.4)

Introduced in dynAEP v0.4. These events govern temporal properties
including clock synchronization, timestamping, temporal validation,
causal ordering, forecasting, anomaly detection and bridge recovery.

---

### 6.1 AEP_CLOCK_SYNC

**dynaep_type:** AEP_CLOCK_SYNC
**Version introduced:** v0.4

A clock synchronization notification. Carries the sync source, the
measured offset from the reference clock and the round-trip latency
of the sync operation.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_CLOCK_SYNC",
 "source": "ntp|ptp|system",
 "offset_ms": <number>,
 "latency_ms": <number>,
 "confidence_class": "A|B|C|D|E|F",
 "sync_state": "LOCKED|HOLDOVER|FREEWHEEL",
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|------------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "AEP_CLOCK_SYNC" |
| source | string | yes | The time source protocol. One of "ntp", "ptp", "system" |
| offset_ms | number | yes | The measured offset from the reference clock in milliseconds |
| latency_ms | number | yes | The round-trip latency of the sync operation in milliseconds |
| confidence_class | string | yes | The TIM confidence class. One of "A", "B", "C", "D", "E", "F" |
| sync_state | string | yes | The TIM sync state. One of "LOCKED", "HOLDOVER", "FREEWHEEL" |
| bridge_timestamp | number | yes | Authoritative bridge timestamp |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_CLOCK_SYNC",
 "source": "ntp",
 "offset_ms": 2.3,
 "latency_ms": 12,
 "confidence_class": "C",
 "sync_state": "LOCKED",
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted by the BridgeClock after each successful
clock synchronization cycle (default every 30 seconds). Also emitted
on source changes and state transitions.

**Layer:** Produced by the Bridge (Temporal Authority / BridgeClock).
Consumed by Agents, Monitoring Systems and the Evidence Ledger.

---

### 6.2 AEP_TEMPORAL_STAMP

**dynaep_type:** AEP_TEMPORAL_STAMP
**Version introduced:** v0.4

A temporal stamp annotation attached to every accepted event by the
temporal validator. Carries the authoritative bridge timestamp, the
original agent timestamp (if any), the measured drift, the time source,
and the last successful sync timestamp.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_TEMPORAL_STAMP",
 "bridge_time_ms": <number>,
 "agent_time_ms": <number|null>,
 "drift_ms": <number>,
 "source": "ntp|ptp|system",
 "synced_at": <epoch_ms>,
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|----------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "AEP_TEMPORAL_STAMP" |
| bridge_time_ms | number | yes | The authoritative time in milliseconds since Unix epoch |
| agent_time_ms | number | no | The original timestamp provided by the agent. Null if the agent did not provide a timestamp |
| drift_ms | number | yes | The difference between agent time and bridge time when both are available. Zero when agent time is null |
| source | string | yes | The time source protocol. One of "ntp", "ptp", "system" |
| synced_at | number | yes | The Unix timestamp of the last successful clock sync |
| bridge_timestamp| number| yes | Authoritative bridge timestamp (duplicate of bridge_time_ms for envelope consistency) |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_TEMPORAL_STAMP",
 "bridge_time_ms": 1714300800000,
 "agent_time_ms": 1714300799970,
 "drift_ms": 30,
 "source": "ntp",
 "synced_at": 1714300799900,
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Attached to every event that passes temporal
validation. The stamp is synthesized into the event as temporal
metadata before the event proceeds to the next pipeline stage.

**Layer:** Produced by the Bridge (Temporal Authority / Temporal
Validator). Attached to all downstream events.

---

### 6.3 DYNAEP_TEMPORAL_REJECTION

**dynaep_type:** DYNAEP_TEMPORAL_REJECTION
**Version introduced:** v0.4

Emitted when an event fails temporal validation. Carries the violation
type and the threshold details that were exceeded.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "DYNAEP_TEMPORAL_REJECTION",
 "violation_type": "drift|future|staleness",
 "agent_time_ms": <number>,
 "bridge_time_ms": <number>,
 "threshold_ms": <number>,
 "actual_ms": <number>,
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|----------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "DYNAEP_TEMPORAL_REJECTION" |
| violation_type | string | yes | One of "drift", "future", "staleness" |
| agent_time_ms | number | yes | The agent-provided timestamp |
| bridge_time_ms | number | yes | The authoritative bridge time |
| threshold_ms | number | yes | The configured threshold that was exceeded |
| actual_ms | number | yes | The measured difference that caused the violation |
| bridge_timestamp| number| yes | Authoritative bridge timestamp |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "DYNAEP_TEMPORAL_REJECTION",
 "violation_type": "drift",
 "agent_time_ms": 1714300799500,
 "bridge_time_ms": 1714300800000,
 "threshold_ms": 50,
 "actual_ms": 500,
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted by the temporal validator when an event
fails drift, future or staleness checks in strict enforcement mode.
In permissive mode, violations are converted to warnings and the event
is accepted.

**Layer:** Produced by the Bridge (Temporal Authority / Temporal
Validator). Consumed by the event caller and the Evidence Ledger.

---

### 6.4 DYNAEP_CAUSAL_VIOLATION

**dynaep_type:** DYNAEP_CAUSAL_VIOLATION
**Version introduced:** v0.4

Emitted when a causal ordering violation is detected. Violations
include clock regression (sequence number lower than expected),
concurrent mutation conflicts and out-of-order events that cannot
be resolved by the reorder buffer.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "DYNAEP_CAUSAL_VIOLATION",
 "violation_type": "clock_regression|concurrent_mutation|reorder_timeout",
 "agent_id": "<agent id>",
 "expected_seq": <number>,
 "received_seq": <number>,
 "element_id": "<element id if applicable>",
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|----------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "DYNAEP_CAUSAL_VIOLATION" |
| violation_type | string | yes | One of "clock_regression", "concurrent_mutation", "reorder_timeout" |
| agent_id | string | yes | The agent that produced the violating event |
| expected_seq | number | yes | The expected sequence number |
| received_seq | number | yes | The actual sequence number received |
| element_id | string | no | The target element ID for concurrent mutation violations |
| bridge_timestamp| number| yes | Authoritative bridge timestamp |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "DYNAEP_CAUSAL_VIOLATION",
 "violation_type": "clock_regression",
 "agent_id": "trader-alpha",
 "expected_seq": 7,
 "received_seq": 4,
 "element_id": null,
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted by the Causal Ordering Engine when an event
violates the happens-before contract. Clock regression events are
rejected immediately. Concurrent mutation events trigger conflict
resolution (last-write-wins or optimistic locking). Reorder timeout
events are delivered after the buffer wait period expires.

**Layer:** Produced by the Bridge (Causal Ordering Engine). Consumed
by Agent SDKs and the Evidence Ledger.

---

### 6.5 AEP_TEMPORAL_FORECAST

**dynaep_type:** AEP_TEMPORAL_FORECAST
**Version introduced:** v0.4

A TimesFM forecast result for a temporal metric. Carries the element
or metric identifier, the forecast values and confidence intervals
for each forecast point.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_TEMPORAL_FORECAST",
 "element_id": "<element or metric id>",
 "forecast_values": [<number>],
 "confidence_intervals": [
 { "lower": <number>, "upper": <number> }
 ],
 "horizon": <number>,
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|--------------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "AEP_TEMPORAL_FORECAST" |
| element_id | string | yes | The element or metric identifier being forecast |
| forecast_values | array | yes | Array of forecast values at each step in the horizon |
| confidence_intervals| array | yes | Array of confidence interval objects, one per forecast step |
| confidence_intervals[].lower | number | yes | The lower bound of the confidence interval |
| confidence_intervals[].upper | number | yes | The upper bound of the confidence interval |
| horizon | number | yes | The number of forecast steps |
| bridge_timestamp | number | yes | Authoritative bridge timestamp |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_TEMPORAL_FORECAST",
 "element_id": "sensor:temperature:zone-3",
 "forecast_values": [22.4, 22.7, 23.1, 23.5, 23.8],
 "confidence_intervals": [
 { "lower": 21.8, "upper": 23.0 },
 { "lower": 22.0, "upper": 23.4 },
 { "lower": 22.3, "upper": 23.9 },
 { "lower": 22.5, "upper": 24.5 },
 { "lower": 22.6, "upper": 25.0 }
 ],
 "horizon": 5,
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted by the TimesFM forecasting sidecar when a
forecast is generated for a tracked temporal metric. The forecast
is used by anomaly detection to compare observed values against
expected ranges.

**Layer:** Produced by the Bridge (Temporal Authority / TimesFM
Forecasting). Consumed by the Anomaly Detection Engine and Agent SDKs.

---

### 6.6 AEP_TEMPORAL_ANOMALY

**dynaep_type:** AEP_TEMPORAL_ANOMALY
**Version introduced:** v0.4

An anomaly detection result. Carries the element or metric identifier,
an anomaly score and a recommendation for handling the anomaly.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_TEMPORAL_ANOMALY",
 "element_id": "<element or metric id>",
 "anomaly_score": <number>,
 "observed_value": <number>,
 "expected_range": { "lower": <number>, "upper": <number> },
 "recommendation": "<action recommendation>",
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|----------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "AEP_TEMPORAL_ANOMALY" |
| element_id | string | yes | The element or metric identifier with the anomaly |
| anomaly_score | number | yes | The anomaly score. Higher scores indicate more severe anomalies. Range 0.0 to 1.0 |
| observed_value | number | yes | The observed value that triggered the anomaly |
| expected_range | object | yes | The expected value range from the forecast |
| expected_range.lower | number | yes | The lower bound of the expected range |
| expected_range.upper | number | yes | The upper bound of the expected range |
| recommendation | string | yes | A recommended action. Examples: "investigate", "alert", "reject_event", "adjust_bounds" |
| bridge_timestamp| number| yes | Authoritative bridge timestamp |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_TEMPORAL_ANOMALY",
 "element_id": "sensor:temperature:zone-3",
 "anomaly_score": 0.87,
 "observed_value": 45.2,
 "expected_range": { "lower": 20.0, "upper": 28.0 },
 "recommendation": "investigate",
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted by the anomaly detection engine when an
observed value falls outside the expected range from the TimesFM
forecast. Anomaly scores above the configured threshold trigger the
recommendation action.

**Layer:** Produced by the Bridge (Temporal Authority / Anomaly
Detection). Consumed by Agent SDKs and the Evidence Ledger.

---

### 6.7 AEP_TEMPORAL_RESET

**dynaep_type:** AEP_TEMPORAL_RESET
**Version introduced:** v0.4

Emitted when temporal state is reset. Carries the reset scope and the
reason for the reset. This event precedes a recovery sequence.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_TEMPORAL_RESET",
 "scope": "causal|reorder_buffer|full",
 "reason": "<reset reason>",
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|----------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "AEP_TEMPORAL_RESET" |
| scope | string | yes | The scope of the reset. One of "causal", "reorder_buffer", "full" |
| reason | string | yes | Human-readable reason for the reset |
| bridge_timestamp| number| yes | Authoritative bridge timestamp |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_TEMPORAL_RESET",
 "scope": "full",
 "reason": "Bridge restart: unscheduled shutdown detected",
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted by the bridge when temporal state needs to
be reset. This occurs during bridge startup, configuration reload that
affects temporal settings and as phase 0 of the three-phase recovery
protocol.

**Layer:** Produced by the Bridge (Temporal Authority). Consumed by
Agent SDKs and the Causal Ordering Engine.

---

### 6.8 AEP_TEMPORAL_RECOVERY

**dynaep_type:** AEP_TEMPORAL_RECOVERY
**Version introduced:** v0.4

A recovery phase event in the three-phase bridge recovery protocol.
Carries the phase number and the current status of the recovery
operation.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_TEMPORAL_RECOVERY",
 "phase": 1|2|3,
 "status": "announce|re-register|resume",
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|----------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "AEP_TEMPORAL_RECOVERY" |
| phase | number | yes | The recovery phase number. 1 = Announce, 2 = Re-register, 3 = Resume |
| status | string | yes | The recovery status. One of "announce", "re-register", "resume" |
| bridge_timestamp| number| yes | Authoritative bridge timestamp |

**Recovery Phases:**

| Phase | Status | Description |
|-------|--------------|-------------|
| 1 | announce | Bridge emits recovery announcement. All agents detect the recovery and prepare to re-register their sequence counters |
| 2 | re-register | Each agent emits an AEP_AGENT_REREGISTER event. Bridge replays the persisted reorder buffer |
| 3 | resume | Bridge emits phase 3. Normal event processing resumes |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_TEMPORAL_RECOVERY",
 "phase": 1,
 "status": "announce",
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted by the bridge during the three-phase recovery
protocol. Phase 1 is emitted first to announce the recovery. Phase 2
is emitted after all agents have re-registered. Phase 3 signals the
resumption of normal operations.

**Layer:** Produced by the Bridge (Temporal Authority / Recovery
Protocol). Consumed by Agent SDKs.

---

### 6.9 AEP_AGENT_REREGISTER

**dynaep_type:** AEP_AGENT_REREGISTER
**Version introduced:** v0.4

An agent re-registration event during the bridge recovery protocol.
Each agent emits this event with its agent ID and last known sequence
counter so the bridge can restore causal ordering state.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_AGENT_REREGISTER",
 "agent_id": "<agent id>",
 "last_sequence": <number>,
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|----------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "AEP_AGENT_REREGISTER" |
| agent_id | string | yes | The agent unique identifier |
| last_sequence | number | yes | The last sequence number the agent produced before the bridge restart |
| bridge_timestamp| number| yes | Authoritative bridge timestamp |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_AGENT_REREGISTER",
 "agent_id": "trader-alpha",
 "last_sequence": 42,
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted by each agent during recovery phase 2 after
receiving AEP_TEMPORAL_RECOVERY with phase=1. The bridge uses the
last_sequence value to re-establish the agent vector clock entry.

**Layer:** Produced by Agent SDKs. Consumed by the Bridge (Temporal
Authority / Causal Ordering Engine).

---

### 6.10 AEP_REREGISTER_RESULT

**dynaep_type:** AEP_REREGISTER_RESULT
**Version introduced:** v0.4

The bridge response to an AEP_AGENT_REREGISTER event. Carries the
agent ID and the status of the re-registration attempt.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_REREGISTER_RESULT",
 "agent_id": "<agent id>",
 "status": "accepted|rejected|conflict",
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|----------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "AEP_REREGISTER_RESULT" |
| agent_id | string | yes | The agent unique identifier |
| status | string | yes | One of "accepted", "rejected", "conflict" |
| bridge_timestamp| number| yes | Authoritative bridge timestamp |

**Status Values:**

| Status | Description |
|----------|-------------|
| accepted | The agent re-registration was successful. Sequence counter restored |
| rejected | The agent re-registration was rejected. Agent must re-register from scratch |
| conflict | A sequence counter conflict was detected. Manual resolution required |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_REREGISTER_RESULT",
 "agent_id": "trader-alpha",
 "status": "accepted",
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted by the bridge in response to each
AEP_AGENT_REREGISTER event during recovery phase 2. The agent checks
the status to determine if re-registration was successful.

**Layer:** Produced by the Bridge (Temporal Authority / Causal
Ordering Engine). Consumed by Agent SDKs.

---

## Category 7: Perception Events (Existing from v0.4)

Introduced in dynAEP v0.4. These events govern perceptual timing for
human-facing outputs including speech pacing, haptic duration,
notification cadence and audio composition. The perception engine
validates temporal properties against published perceptual bounds
stored in the perception registry.

---

### 7.1 AEP_PERCEPTION_GOVERNED

**dynaep_type:** AEP_PERCEPTION_GOVERNED
**Version introduced:** v0.4

A governed envelope produced by the perception engine after processing
an output event. Carries the modality, the original temporal annotations
proposed by the agent, the governed annotations after perception bounds
enforcement, the adaptive annotations from the user profile and the
determination of which set was applied. The SDK type alias
AEP_GOVERNED_ENVELOPE is also accepted.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_PERCEPTION_GOVERNED",
 "target_id": "<element or output id>",
 "modality": "speech|haptic|notification|audio",
 "original_annotations": { "<temporal annotation fields>" },
 "governed_annotations": { "<temporal annotation fields>" },
 "adaptive_annotations": { "<temporal annotation fields>" },
 "applied": "original|governed|adaptive",
 "violation_count": <number>,
 "profile_used": "<profile name or null>",
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|--------------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "AEP_PERCEPTION_GOVERNED" |
| target_id | string | yes | The element or output target identifier |
| modality | string | yes | The output modality. One of "speech", "haptic", "notification", "audio" |
| original_annotations| object| yes | The temporal annotations proposed by the agent before governance |
| governed_annotations| object| yes | The annotations after perception bounds enforcement |
| adaptive_annotations| object| yes | The annotations adjusted by the adaptive user profile |
| applied | string | yes | Which annotation set was actually applied. One of "original", "governed", "adaptive" |
| violation_count | number | yes | The number of perception bounds violations detected |
| profile_used | string | no | The name of the adaptive profile used. Null if no profile matched |
| bridge_timestamp | number | yes | Authoritative bridge timestamp |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_PERCEPTION_GOVERNED",
 "target_id": "speech:agent-response-42",
 "modality": "speech",
 "original_annotations": {
 "duration_ms": 15000,
 "pacing_wpm": 220,
 "pauses": []
 },
 "governed_annotations": {
 "duration_ms": 8000,
 "pacing_wpm": 180,
 "pauses": [{ "position_ms": 4000, "duration_ms": 500 }]
 },
 "adaptive_annotations": {
 "duration_ms": 9000,
 "pacing_wpm": 170,
 "pauses": [{ "position_ms": 4500, "duration_ms": 800 }]
 },
 "applied": "governed",
 "violation_count": 2,
 "profile_used": "user-sarah-standard",
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted by the perception engine after every output
event that passes through perception governance (pipeline stage 7).
The envelope carries the full governance decision including which
annotation set was applied.

**Layer:** Produced by the Bridge (Perception Governance / dynAEP-TA-P).
Consumed by Output Renderers and the Evidence Ledger.

---

### 7.2 DYNAEP_PERCEPTION_REJECTION

**dynaep_type:** DYNAEP_PERCEPTION_REJECTION
**Version introduced:** v0.4

Emitted when an output event fails perception validation. Carries the
modality, the violation type and the threshold details. The SDK type
alias AEP_PERCEPTION_VIOLATION is also accepted.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "DYNAEP_PERCEPTION_REJECTION",
 "target_id": "<element or output id>",
 "modality": "speech|haptic|notification|audio",
 "violations": [
 {
 "type": "<violation type>",
 "field": "<field name>",
 "expected": "<expected value or range>",
 "actual": "<actual value>"
 }
 ],
 "original_annotations": { "<temporal annotation fields>" },
 "clamped_annotations": { "<temporal annotation fields>" },
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|--------------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "DYNAEP_PERCEPTION_REJECTION" |
| target_id | string | yes | The element or output target identifier |
| modality | string | yes | The output modality. One of "speech", "haptic", "notification", "audio" |
| violations | array | yes | Array of individual violation details |
| violations[].type | string | yes | The violation type. Examples: "duration_exceeded", "min_duration_not_met", "cadence_too_fast", "pacing_out_of_range" |
| violations[].field | string | yes | The annotation field that caused the violation |
| violations[].expected | string | yes | The expected value or range from the perception registry |
| violations[].actual | string | yes | The actual value that was provided |
| original_annotations | object | yes | The original temporal annotations proposed by the agent |
| clamped_annotations | object | yes | The clamped values that would have been applied if the event had been accepted |
| bridge_timestamp | number | yes | Authoritative bridge timestamp |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "DYNAEP_PERCEPTION_REJECTION",
 "target_id": "speech:agent-response-42",
 "modality": "speech",
 "violations": [
 {
 "type": "duration_exceeded",
 "field": "duration_ms",
 "expected": "1000-8000",
 "actual": "15000"
 }
 ],
 "original_annotations": { "duration_ms": 15000, "pacing_wpm": 220 },
 "clamped_annotations": { "duration_ms": 8000, "pacing_wpm": 180 },
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted by the perception engine when an output
event violates one or more perception bounds and the violation severity
causes rejection. Individual violations are listed with expected and
actual values for diagnostic clarity.

**Layer:** Produced by the Bridge (Perception Governance / dynAEP-TA-P).
Consumed by Agent SDKs and the Evidence Ledger.

---

### 7.3 AEP_PERCEPTION_PROFILE_UPDATE

**dynaep_type:** AEP_PERCEPTION_PROFILE_UPDATE
**Version introduced:** v0.4

Emitted when an adaptive perception profile is updated due to the
ingestion of a new user interaction. Carries the user ID, the modality
that was affected, the interaction type, the cumulative interaction
count and the updated confidence score.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_PERCEPTION_PROFILE_UPDATE",
 "user_id": "<user identifier>",
 "modality": "speech|haptic|notification|audio",
 "interaction_type": "<interaction type>",
 "interaction_count": <number>,
 "confidence_score": <number>,
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|------------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "AEP_PERCEPTION_PROFILE_UPDATE" |
| user_id | string | yes | The user identifier for whom the profile was updated |
| modality | string | yes | The affected output modality. One of "speech", "haptic", "notification", "audio" |
| interaction_type | string | yes | The type of interaction that triggered the update. Examples: "skip", "slow_down", "speed_up", "repeat", "cancel" |
| interaction_count| number | yes | The cumulative number of interactions recorded for this user and modality |
| confidence_score | number | yes | The updated confidence score for the profile. Range 0.0 to 1.0. Higher scores indicate stronger user preference signal |
| bridge_timestamp | number | yes | Authoritative bridge timestamp |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_PERCEPTION_PROFILE_UPDATE",
 "user_id": "user-7a9b3c",
 "modality": "speech",
 "interaction_type": "slow_down",
 "interaction_count": 15,
 "confidence_score": 0.82,
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted by the adaptive profile engine when a user
interaction signal is processed and the profile parameters are updated.
The confidence score reflects how reliably the profile represents user
preference based on accumulated interaction history.

**Layer:** Produced by the Bridge (Perception Governance / Adaptive
Profile Engine). Consumed by Agent SDKs and the Perception Governance
Engine.

---

### 7.4 AEP_PERCEPTION_CONFIG_CHANGE

**dynaep_type:** AEP_PERCEPTION_CONFIG_CHANGE
**Version introduced:** v0.4

Broadcast when the perception governance configuration changes at
runtime. Includes modality override loading, engine configuration
updates and profile resets or pruning. Agents receiving this event
should re-query perception bounds if they cache them locally.

**JSON Schema:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_PERCEPTION_CONFIG_CHANGE",
 "change_type": "modality_override|engine_config|profile_reset|profile_prune",
 "affected_modalities": ["<modality name>"],
 "affected_user_ids": ["<user id>"],
 "description": "<change description>",
 "bridge_timestamp": <epoch_ms>
}
```

**Field Descriptions:**

| Field | Type | Required | Description |
|--------------------|--------|----------|-------------|
| type | string | yes | Always "CUSTOM" |
| dynaep_type | string | yes | Always "AEP_PERCEPTION_CONFIG_CHANGE" |
| change_type | string | yes | One of "modality_override", "engine_config", "profile_reset", "profile_prune" |
| affected_modalities| array | yes | Array of modality names affected by the change |
| affected_user_ids | array | yes | Array of user IDs affected by the change. May be empty for engine-level changes |
| description | string | yes | Human-readable description of the configuration change |
| bridge_timestamp | number | yes | Authoritative bridge timestamp |

**Change Types:**

| Change Type | Description |
|-------------------|-------------|
| modality_override | A modality perception override was loaded or updated |
| engine_config | The perception engine configuration was updated |
| profile_reset | One or more user profiles were reset to defaults |
| profile_prune | Stale or low-confidence profiles were pruned |

**Example Payload:**

```json
{
 "type": "CUSTOM",
 "dynaep_type": "AEP_PERCEPTION_CONFIG_CHANGE",
 "change_type": "modality_override",
 "affected_modalities": ["speech", "notification"],
 "affected_user_ids": [],
 "description": "Speech max duration override loaded from config: 12000 ms",
 "bridge_timestamp": 1714300800000
}
```

**When Emitted:** Emitted by the perception governance engine when
configuration is updated at runtime via the management interface,
configuration reload or dynamic profile management.

**Layer:** Produced by the Bridge (Perception Governance / Configuration
Manager). Consumed by Agent SDKs and the Perception Governance Engine.

---

## Appendix A: Event Type Index

| dynaep_type | Category | Version | Pipeline Stage |
|--------------------------------|----------------------|---------|-----------------------|
| LATTICE_EVENT | Lattice | v1.0 | Stage 1 (Lattice) |
| LATTICE_FILTER_RESULT | Lattice | v1.0 | Stage 1 (Lattice) |
| LATTICE_REGISTER | Lattice | v1.0 | Stage 1 (Lattice) |
| AEP_MUTATE_STRUCTURE | Mutation | v0.4 | Stage 4 (AEP) |
| AEP_MUTATE_BEHAVIOUR | Mutation | v0.4 | Stage 4 (AEP) |
| AEP_MUTATE_SKIN | Mutation | v0.4 | Stage 4 (AEP) |
| AEP_QUERY | Query | v0.4 | Stage 4 (AEP) |
| AEP_QUERY_RESULT | Query | v0.4 | Stage 4 (AEP) |
| DYNAEP_REJECTION | Rejection | v0.4 | Any stage |
| DYNAEP_SCHEMA_RELOAD | Rejection | v0.4 | Configuration |
| AEP_RUNTIME_COORDINATES | Runtime Reflection | v0.4 | Browser Runtime |
| AEP_CLOCK_SYNC | Temporal Authority | v0.4 | Stage 2 (Temporal) |
| AEP_TEMPORAL_STAMP | Temporal Authority | v0.4 | Stage 2 (Temporal) |
| DYNAEP_TEMPORAL_REJECTION | Temporal Authority | v0.4 | Stage 2 (Temporal) |
| DYNAEP_CAUSAL_VIOLATION | Temporal Authority | v0.4 | Stage 3 (Causal) |
| AEP_TEMPORAL_FORECAST | Temporal Authority | v0.4 | Stage 2 (Temporal) |
| AEP_TEMPORAL_ANOMALY | Temporal Authority | v0.4 | Stage 2 (Temporal) |
| AEP_TEMPORAL_RESET | Temporal Authority | v0.4 | Stage 2 (Temporal) |
| AEP_TEMPORAL_RECOVERY | Temporal Authority | v0.4 | Stage 2 (Temporal) |
| AEP_AGENT_REREGISTER | Temporal Authority | v0.4 | Stage 3 (Causal) |
| AEP_REREGISTER_RESULT | Temporal Authority | v0.4 | Stage 3 (Causal) |
| AEP_PERCEPTION_GOVERNED | Perception | v0.4 | Stage 7 (Perception) |
| DYNAEP_PERCEPTION_REJECTION | Perception | v0.4 | Stage 7 (Perception) |
| AEP_PERCEPTION_PROFILE_UPDATE | Perception | v0.4 | Stage 7 (Perception) |
| AEP_PERCEPTION_CONFIG_CHANGE | Perception | v0.4 | Stage 7 (Perception) |

---

## Appendix B: SDK Type Aliases

The TypeScript SDK defines the following type aliases for perception
events. These are accepted as equivalent to the specification type
names.

| Specification Type | SDK Alias | SDK Source File |
|-------------------------------|------------------------|-------------------------------------------------|
| AEP_PERCEPTION_GOVERNED | AEP_GOVERNED_ENVELOPE | sdk/typescript/src/temporal/perception-events.ts |
| DYNAEP_PERCEPTION_REJECTION | AEP_PERCEPTION_VIOLATION| sdk/typescript/src/temporal/perception-events.ts |

---

## Appendix C: Revision History

| Version | Date | Description |
|---------|------------|-------------|
| 1.0.0 | 2026-06-01 | Initial event type reference for dynAEP 1.0. Covers all 25 event types across 7 categories |
