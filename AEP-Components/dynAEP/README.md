# dynAEP 1.0: Open-Source Real-Time Event Governance Protocol for AI

**Version 1.0** - June 2026
**Author:** thePM_001
**License:** Apache-2.0

**Canonical source (AEP 2.8):** `AEP-Components/dynAEP/` in [NLA-AEP-v2.8-open-source](https://github.com/thePM001/NLA-AEP-v2.8-open-source) (Gitea mirror of the open-source bundle). Standalone mirror: https://github.com/thePM001/dynAEP

dynAEP 1.0 is an open-source protocol for governing real-time events in multi-agent AI systems. Events that carry an `action_path` and match an active lattice governance mode pass through the Action Lattice before downstream pipeline stages. The lattice validates partial-order dependencies, enforces constraints and routes matching events to interested agents. UI mutations, external events (webhooks, blockchain, email, sensors), agent actions and human-facing outputs share the same bridge architecture; lattice gating applies per `lattice.governance` and event shape (see §11).

---

## 1. What Is dynAEP 1.0

dynAEP (Dynamic Agent Element Protocol) is the fusion of deterministic event governance and real-time multi-agent coordination. It extends the original AEP (Agent Element Protocol) frontend governance model to cover ALL agent-system interactions, not just UI mutations.

**AEP** solves build-time structural governance: every UI element has a unique ID, exact spatial coordinates, defined behaviour and themed visuals. The AEP scene graph is a mathematically verified topological matrix that agents cannot hallucinate past.

**dynAEP 1.0** solves runtime event governance: lattice-addressed events (those with an `action_path` registered in `registries/aep-lattice.yaml`) are validated against the Action Lattice at arrival time when governance is enabled. The lattice defines which actions exist, what must happen before each action (partial order), what constraints each action carries (required fields, thresholds, authorization levels, custom validators) and which trust tiers are required. Lattice violations are rejected before temporal, structural or perception stages run. Typical AEP UI mutations (`AEP_MUTATE_*` without `action_path`) use structural validation instead.

**dynAEP-TA** provides temporal authority: the bridge owns the clock. Agents never generate timestamps. The bridge stamps every event with authoritative time, orders events causally via vector clocks, detects anomalies via TimesFM forecasting and persists all ordering state across restarts.

**dynAEP-TA-P** governs perceptual timing for human-facing outputs: speech pacing, haptic durations, notification cadence, sensor polling intervals and audio composition. Every time-dependent output passes through a perception registry with bounds derived from published research.

**Relationship to GAP:** dynAEP is related to GAP (Governed Agentic Programming), an open-source specification for agent instructions. GAP defines instruction-level governance for what agents are told to do. dynAEP provides real-time event governance for what agents actually do at runtime. They are complementary open protocols: GAP governs the instruction contract, dynAEP governs the execution contract. A GAP document specifies the agent's permitted instruction set; dynAEP's Action Lattice specifies the agent's permitted event set. Together they form a complete governance stack for agentic systems.

### What dynAEP 1.0 Proves

AEP proves you can build UIs deterministically.
dynAEP proves you can govern ALL agent events deterministically.
dynAEP-TA proves you can govern time deterministically.
dynAEP-TA-P proves you can govern human temporal perception deterministically.
The Action Lattice proves you can govern event ordering deterministically.

The existence of this protocol stack proves that AI hallucination is an engineering problem in any domain where ground truth can be precompiled into a deterministic registry. Structure, behaviour, time, perception and event ordering are all governable by architecture.

---

## 2. The Protocol Stack

dynAEP 1.0 introduces the Action Lattice as the core governance layer. The stack has been reorganized to reflect the lattice's role as the central filter for lattice-addressed events under active governance modes.

```
LAYER PROTOCOL FUNCTION
------------------- ----------- --------------------------------------------
Agent-Tools MCP Agent connects to external data and tools
Agent-Agent (various) Agents coordinate across distributed systems
Agent-Event-Gov dynAEP v1.0 Action Lattice: partial-order event governance
 |-- Lattice Filter Validates action_path events at arrival time
 |-- Validation Hooks Pluggable validators (MLE, custom, etc.)
 |-- Observer Adapters Normalise external events into lattice events
 |-- Agent Interest Registry Agents declare what they watch
Agent-UI-Gov AEP Deterministic UI structure, behaviour and skin
Agent-UI-Live dynAEP AEP governance applied to live event streams
Agent-Time dynAEP-TA Temporal authority, causal ordering, durable state
Agent-Percept dynAEP-TA-P Perceptual temporal governance for outputs
```

The Action Lattice layer is new in dynAEP 1.0. It sits below the UI governance layers and above the transport layer. External webhooks, blockchain pollers, sensors and agent/system events that normalise to a `LatticeEvent` with `action_path` enter the lattice filter first (when `lattice.governance` is not `disabled` or `ui_only`). UI scene-graph mutations without `action_path` skip the lattice and proceed to temporal and AEP structural validation.

---

## 3. Architecture Overview

The dynAEP bridge sits between all event sources and all event consumers. Lattice-addressed events pass through the Action Lattice, which validates partial-order closure, evaluates constraints and records agent interest matches. The bridge uses a deterministic pipeline: lattice (when applicable), then temporal authority, then AEP structural validation, then perception governance.

```
 +---------------------+ +-------------------+ +----------------------+
 | EXTERNAL EVENTS | | AGENT BACKENDS | | SYSTEM EVENTS |
 | | | (LangGraph/ | | |
 | Webhook servers | | CrewAI/ADK/ | | Scheduled tasks |
 | Blockchain nodes | | OpenAI SDK/ | | Health checks |
 | Email (IMAP/SMTP) | | any AG-UI) | | Startup/shutdown |
 | IoT sensors | | | | Timer ticks |
 | SSE streams | | Agent actions | | |
 +----------+----------+ +--------+----------+ +----------+-----------+
 | | |
 | ObserverAdapter | AG-UI events | System events
 | (normalise to | (STATE_DELTA, |
 | LatticeEvent) | TOOL_CALL, CUSTOM) |
 v v v
 +=======================================================================+
 | dynAEP BRIDGE v1.0 |
 | |
 | +----------------------------------+ |
 | | ObserverAdapters (pluggable) | |
 | | - WebhookAdapter | |
 | | - SSEAdapter | |
 | | - PollAdapter | |
 | | - BlockchainAdapter | |
 | | - EmailAdapter | |
 | +------------+---------------------+ |
 | | LatticeEvent[] |
 | v |
 | +=================================================================+ |
 | | ACTION LATTICE FILTER | |
 | | | |
 | | 1. Lattice membership - does the action path exist? | |
 | | 2. Trust floor check - does the agent have sufficient trust? | |
 | | 3. Partial order - have all parent actions occurred? | |
 | | 4. Constraint eval - required fields, thresholds, auth? | |
 | | 5. Custom hooks - pluggable validators (MLE, etc.) | |
 | | 6. Agent interest - which agents watch this path? | |
 | | 7. Next actions - which children may follow? | |
 | +=================================================================+ |
 | | |
 | | LatticeFilterResult |
 | v |
 | +----------------------------------+ |
 | | TEMPORAL AUTHORITY (dynAEP-TA) | |
 | | - BridgeClock stamp | |
 | | - Drift/staleness check | |
 | | - Causal ordering (vector | |
 | | clocks, reorder buffer) | |
 | | - Forecast (TimesFM) | |
 | | - Durable state persistence | |
 | +------------+---------------------+ |
 | | |
 | v |
 | +----------------------------------+ |
 | | STRUCTURAL VALIDATION (AEP) | |
 | | - Scene graph match | |
 | | - z-band check | |
 | | - Skin binding resolution | |
 | | - Rego policy evaluation | |
 | | - ID minting | |
 | +------------+---------------------+ |
 | | |
 | v |
 | +----------------------------------+ |
 | | PERCEPTION GOV (dynAEP-TA-P) | |
 | | - Temporal annotation validate | |
 | | - Perception bounds check | |
 | | - Adaptive user profile apply | |
 | | - Governed envelope produce | |
 | +------------+---------------------+ |
 | | |
 | | Validated + governed events |
 +===============+=======================================================+
 |
 v
 +------------------------------------------------------+
 | OUTPUT RENDERERS / EVENT CONSUMERS |
 | |
 | React/Vue/Svelte/Tauri frontends |
 | TTS engines (speech output) |
 | Haptic controllers |
 | Notification services |
 | Email senders |
 | Blockchain transaction broadcasters |
 | Sensor actuator controllers |
 +------------------------------------------------------+
```

The pipeline is strictly ordered for each event type. When an event has `action_path` and lattice governance applies, lattice validation runs first; lattice failures reject before temporal authority. Events without `action_path` (typical `AEP_MUTATE_*` UI deltas) begin at temporal validation. After temporal checks, structural AEP validation runs; after structural checks, perception governance runs. Template-instance fast-exit can skip the runtime pipeline for AOT-validated instances. Downstream renderers only see events that passed every applicable stage.

---

## 4. Action Lattice

The Action Lattice is the central governance mechanism in dynAEP 1.0. It is a partial-order DAG (directed acyclic graph) of every action that the system can perform. Each action is a node in the lattice with a unique path, a category, parent dependencies, child continuations, validation constraints and a trust floor.

### Lattice Node Anatomy

Every action in the lattice has these properties:

- **path**: dot-delimited identifier (e.g. `market:trade:execute`)
- **category**: one of `external_event`, `system_event`, `agent_action`, `output`
- **parents**: list of action paths that must be satisfied before this action can fire
- **children**: list of action paths that may follow after this action
- **constraints**: validation gates applied at event arrival time
- **trust_floor**: minimum agent trust tier (1-5) required to propose this action

### Partial-Order Governance

The lattice enforces a happens-before relationship across all actions. An action cannot fire until ALL its parent actions have been satisfied. This prevents actions from executing out of sequence. For example, a trade cannot execute until risk assessment has passed. An email cannot send until review has approved it. A notification cannot fire until routing has determined recipients.

The bridge tracks satisfied actions in a set that grows as events pass through the filter. When an event arrives, the bridge computes the lower set (all ancestors) of the event's action path and checks every parent against the satisfied set. If any parent is missing, the event is rejected with a list of missing dependencies.

### Upper and Lower Sets

The lattice provides two traversal methods:

- **Upper set (forward closure)**: all nodes reachable by following children from a given node. Used to determine what can happen next and which agents are interested in downstream events.

- **Lower set (backward closure)**: all nodes reachable by following parents backward from a given node. Used to determine what must have already happened and what action chain led to this event.

### Example: aep-lattice.yaml

The lattice is defined in `registries/aep-lattice.yaml`. Here is a representative subset showing the key patterns:

```yaml
aep_version: "1.2"
dynaep_version: "1.0"
lattice_revision: 1

actions:
 # External events have no parents - they arrive from outside
 webhook:incoming:
 label: "Webhook received from external service"
 category: external_event
 parents: []
 children: [webhook:validate]
 constraints:
 - type: required_field
 field: signature
 description: "Webhook must carry a cryptographic signature"
 trust_floor: 1

 blockchain:event:
 label: "Blockchain event detected (log, transfer, mint)"
 category: external_event
 parents: []
 children: [blockchain:event:verify]
 constraints:
 - type: required_field
 field: tx_hash
 trust_floor: 1

 email:incoming:
 label: "Email received"
 category: external_event
 parents: []
 children: [email:classify]
 constraints:
 - type: required_field
 field: from
 trust_floor: 1

 sensor:reading:
 label: "Sensor reading from IoT device"
 category: external_event
 parents: []
 children: [sensor:analyze]
 constraints:
 - type: threshold
 field: value
 condition: "within_range"
 description: "Reading must be within min/max supplied in payload"
 trust_floor: 1
 # Payload at runtime must include bounds, e.g.:
 # { "value": 42.5, "min": 0, "max": 100 }
 # or { "value": 42.5, "range": { "min": 0, "max": 100 } }

 # System events form internal chains
 system:startup:
 label: "System boot or restart"
 category: system_event
 parents: []
 children: [system:health:check]
 constraints: []
 trust_floor: 1

 system:health:check:
 label: "Run system health verification"
 category: system_event
 parents: [system:startup]
 children: [system:ready]
 constraints:
 - type: required_field
 field: services
 trust_floor: 2

 system:ready:
 label: "System is ready for agent operations"
 category: system_event
 parents: [system:health:check]
 children: [agent:register]
 constraints: []
 trust_floor: 2

 # Agent actions require higher trust
 agent:register:
 label: "Register an agent with the system"
 category: agent_action
 parents: [system:ready]
 children: [agent:ready]
 constraints:
 - type: required_field
 field: capabilities
 - type: required_field
 field: agent_type
 trust_floor: 2

 agent:trade:propose:
 label: "Agent proposes a trade"
 category: agent_action
 parents: [market:price:analyze]
 children: [market:trade:validate]
 constraints:
 - type: threshold
 field: amount
 condition: "> 0"
 trust_floor: 5

 # Validation and routing
 action:route:
 label: "Route event to matched agents"
 category: system_event
 parents:
 - webhook:validate
 - blockchain:event:verify
 - email:classify
 - sensor:analyze
 - action:validate
 children: [output:notify]
 constraints:
 - type: required_field
 field: matched_agents
 trust_floor: 1

 # Output actions terminate the chain
 output:notify:
 label: "Send notification to user"
 category: output
 parents: [action:route, market:trade:execute]
 children: []
 constraints:
 - type: threshold
 field: urgency
 condition: "defined"
 trust_floor: 1

 output:ui_mutation:
 label: "Mutate a UI element via scene graph"
 category: output
 parents: [action:route]
 children: []
 constraints:
 - type: required_field
 field: element_id
 - type: required_field
 field: mutation
 trust_floor: 2
```

### Trust Tiers

Trust tiers (1-5) govern which agents can propose which actions. The mapping is:

- **Tier 1**: any agent or external system. Root-level external events (webhooks, blockchain, email, sensors) are tier 1.
- **Tier 2**: registered agents with verified capabilities. Agent registration, UI mutations and speech output require tier 2.
- **Tier 3**: trusted agents. Email classification, proposal actions and market analysis require tier 3.
- **Tier 4**: high-trust agents. Email review, sending, shutdown requests and market price analysis require tier 4.
- **Tier 5**: maximum trust. Trade proposals, trade validation and trade execution require tier 5.

The trust floor is checked at event arrival time. If the agent's trust tier is below the action's trust_floor, the event is rejected before any other validation occurs.

---

## 5. Event Types

dynAEP 1.0 introduces three new event types specific to lattice-based governance. These join the existing AEP mutation, query, reflection, temporal and perception event families.

### 5.1 LATTICE_EVENT

The canonical event shape that flows through the bridge. Every observer adapter normalises its native event into this shape.

```json
{
 "type": "CUSTOM",
 "dynaep_type": "LATTICE_EVENT",
 "source": "webhook:stripe",
 "action_path": "webhook:incoming",
 "payload": {
 "signature": "0x...",
 "event_type": "payment_intent.succeeded",
 "data": { "id": "pi_123", "amount": 2999 }
 },
 "bridge_timestamp": 1714300800000,
 "agent_id": null,
 "trust_tier": 1
}
```

Fields: `source` identifies the origin adapter, `action_path` selects the lattice node, `payload` carries the event data, `bridge_timestamp` is set by the bridge at ingest time, `agent_id` identifies the originating agent (if any), `trust_tier` conveys the agent's current authorization level.

### 5.2 LATTICE_FILTER_RESULT

The bridge emits a filter result for every LATTICE_EVENT. This is the structured verdict from the lattice filter.

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

If the filter fails at any step, `passed` is false and `constraints_failed` contains the reasons. `DynAEPBridge.processEvent()` awaits `LatticeFilter.filterAsync()` and uses the result to accept or reject the event. Custom constraints (`type: custom`) require `filterAsync()`; the synchronous `filter()` method fails closed on custom constraints and directs callers to use `filterAsync()`.

### 5.3 LATTICE_REGISTER

Agents declare interest in lattice paths via `DynAEPBridge.registerAgentInterest()` (shipped). The wire-level `LATTICE_REGISTER` event shape below is spec-defined for forward compatibility.

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

The `notify` field supports three modes: `wake` (immediately trigger the agent), `queue` (store for later retrieval), `log` (just record, no delivery). The `max_rate` field sets a rate limit per agent. The `constraints` field adds additional match filters beyond the action path glob.

**Runtime registration (shipped):** call `DynAEPBridge.registerAgentInterest(interest)` (or `deregisterAgentInterest(agentId)`). The bridge stores interests in the lattice filter for glob matching on subsequent `action_path` events.

**Event shape (spec / forward-compatible):** a `LATTICE_REGISTER` AG-UI event is defined in [EVENT-TYPES.md](EVENT-TYPES.md). When wired, it would pass through the lattice as `agent:interest:register` (parent: `agent:ready`). The TypeScript bridge does not yet dispatch `dynaep_type: LATTICE_REGISTER` in `processEvent()`; use the programmatic API above.

### 5.4 Existing Event Families

All existing event types from dynAEP v0.4 remain fully supported:

- **AEP_MUTATE_STRUCTURE / AEP_MUTATE_BEHAVIOUR / AEP_MUTATE_SKIN**: structure, behaviour and skin mutations against the AEP scene graph.
- **AEP_QUERY / AEP_QUERY_RESULT**: runtime queries against the scene graph.
- **DYNAEP_REJECTION**: structural validation failures.
- **AEP_RUNTIME_COORDINATES**: rendered coordinates from ResizeObserver/MutationObserver.
- **AEP_CLOCK_SYNC / AEP_TEMPORAL_STAMP / DYNAEP_TEMPORAL_REJECTION / DYNAEP_CAUSAL_VIOLATION**: temporal authority events.
- **AEP_TEMPORAL_FORECAST / AEP_TEMPORAL_ANOMALY**: TimesFM forecasting events.
- **AEP_TEMPORAL_RESET / AEP_TEMPORAL_RECOVERY / AEP_AGENT_REREGISTER / AEP_REREGISTER_RESULT**: durable state and recovery events.
- **AEP_PERCEPTION_GOVERNED / DYNAEP_PERCEPTION_REJECTION / AEP_PERCEPTION_PROFILE_UPDATE**: perception governance events.

Lattice gating applies only to events with `action_path` when governance is active (see §11). Standard UI mutations (`AEP_MUTATE_STRUCTURE`, `AEP_MUTATE_BEHAVIOUR`, `AEP_MUTATE_SKIN`) do not set `action_path` and are validated by the AEP structural pipeline (scene graph, z-band, Rego, scanners). To lattice-govern a UI output explicitly, route it through a lattice node such as `output:ui_mutation` with the appropriate `action_path` on the event.

---

## 6. Temporal Authority

dynAEP-TA temporal authority is unchanged from v0.4. The bridge clock remains the sole authoritative time source for the entire protocol stack.

### Bridge Clock

The BridgeClock synchronizes to an external reference and provides monotonically increasing timestamps. Sync hierarchy with automatic fallback:

1. **PTP** (IEEE 1588): microsecond precision for mission-critical industrial deployments.
2. **NTP** (default): millisecond precision via SNTP. Sufficient for most deployments.
3. **System clock**: fallback when network sync is unavailable. Logs a warning.

The bridge re-syncs at configurable intervals (default: every 30 seconds). Clock health is available via the `dynaep_temporal_query` tool.

### Timestamp Validation

Every incoming event passes through temporal validation:

1. Bridge reads the agent-provided timestamp (may be null).
2. Bridge stamps the event with authoritative time.
3. If `bridge_is_authority` is true (default), the event timestamp is overwritten. The original is preserved in metadata for audit.
4. Drift check: if the difference between agent time and bridge time exceeds `max_drift_ms` (default: 50 ms), the event is rejected.
5. Future check: if the agent timestamp is more than `max_future_ms` (default: 500 ms) ahead of bridge time, the event is rejected.
6. Staleness check: if the event is older than `max_staleness_ms` (default: 5000 ms), the event is rejected.

Three enforcement modes: `strict`, `permissive`, `log_only`.

### TIM Clock Quality Tracking (v0.4)

The ClockQualityTracker provides IETF TIM-compatible clock quality metadata with sync state machine (LOCKED, HOLDOVER, FREEWHEEL), confidence classes A through F and Welford's streaming variance for uncertainty estimation.

### Workflow Temporal Primitives (v0.4)

Four primitives use bridge-authoritative time instead of system clocks: TemporalDeadline, TemporalSchedule, TemporalSleepResume and TemporalTimeout. All primitives accept a `getNow` function for dependency injection.

### Bridge Recovery Protocol (v0.4)

Three-phase recovery for graceful bridge restarts: Phase 1 announces recovery, Phase 2 agents re-register their sequence counters, Phase 3 replays the persisted reorder buffer. The protocol detects the storage backend automatically.

---

## 7. Causal Ordering

The CausalOrderingEngine enforces happens-before relationships across multi-agent event streams using Lamport vector clocks. This is unchanged from v0.4.

Every agent registered with the bridge receives a vector clock entry. Each event carries a per-agent sequence number (monotonically increasing). The engine:

1. Compares incoming sequence numbers against expected values.
2. Delivers in-order events immediately, advancing the vector clock.
3. Buffers out-of-order events in a reorder buffer (configurable size, default: 64) and waits up to `max_reorder_wait_ms` (default: 200 ms) for missing predecessors.
4. Rejects events with clock regression (sequence number lower than expected).
5. Verifies declared causal dependencies have been delivered.
6. Detects concurrent mutations on the same element from different agents and applies conflict resolution (last-write-wins or optimistic locking).

The LatticeFilter and CausalOrderingEngine work together. The lattice filter validates the action-level partial order (what type of event can happen next). The causal engine validates the agent-level sequence order (what event from this agent can happen next). Both must pass for an event to be accepted.

### Durable Causal State (v0.4)

All causal ordering state persists across bridge restarts via configurable storage backends:

- **FileBasedCausalStore**: JSONL append log with periodic compaction.
- **SqliteCausalStore**: SQLite backend with WAL mode and transactions.
- **ExternalCausalStore**: adapter for external key-value stores (Redis, DynamoDB, Cloudflare KV).

---

## 8. Validation Hooks

Validation hooks are pluggable modules that inspect a LatticeEvent against a specific LatticeNode and produce a pass/fail verdict with a score and confidence. They are the extension point for custom validation logic beyond the built-in constraint types.

### Hook Interface

Every validation hook implements the `ValidationHook` interface defined in `hooks/interface.ts`:

```typescript
interface ValidationHook {
 name: string; // unique identifier (e.g. "mle-validator")
 version: string; // semver recommended

 validate(
 event: LatticeEvent,
 lattice: ActionLattice,
 node: LatticeNode,
 ): Promise<HookResult>;
}

interface HookResult {
 passed: boolean;
 score: number; // 0.0 (invalid) to 1.0 (perfect)
 confidence: number; // 0.0 (uncertain) to 1.0 (fully confident)
 adjustments?: Record<string, unknown>; // optional payload modifications
 details?: string; // human-readable explanation
}
```

### Hook Registry and Loader

The `HookRegistry` manages registered hooks keyed by name. Built-in hooks are registered at bridge init via `registerBuiltinHooks()` in `bridge/hook-loader.ts` (synced to `AEP-SDKs/typescript/dynaep/src/lattice/hook-loader.ts`).

Config alias resolution (`lattice.hook` in YAML):

| Config value | Registry key |
|--------------|--------------|
| `mle` | `mle-validator` |
| `mle-validator` | `mle-validator` |
| `noop` | `noop` |

Custom constraints (`constraint.type === "custom"`) dispatch to the hook named by `lattice.hook` during **`filterAsync()`** only. The bridge calls `await latticeFilter.filterAsync()` inside `processEvent()`.

### MLE Validation Hook

The MLE (Machine Learning Evaluation) hook is a reference implementation that uses attractor indexing to evaluate events against learned patterns. It computes a similarity score between the event's feature vector and stored attractors from the Lattice Memory (OPT-007). Events that score below the similarity threshold are flagged for additional review. The hook registers as `mle-validator` version `1.0.0`. It runs for lattice nodes that declare `type: custom` constraints when `lattice.hook` resolves to `mle` / `mle-validator`.

### Custom Hook Development

To create a custom hook:

1. Import `ValidationHook` and `HookResult` from `hooks/interface.ts`.
2. Import `LatticeEvent`, `ActionLattice`, `LatticeNode` from the bridge lattice module.
3. Export an object conforming to `ValidationHook`.
4. Register via `HookRegistry.register()` before bridge init, or extend `registerBuiltinHooks()`.

Hooks may be synchronous or async. The bridge awaits each hook's `validate()` method inside `filterAsync()` and records results in `constraints_passed` / `constraints_failed` (e.g. `hook:mle-validator:0.92`).

---

## 9. Observer Adapters

Observer adapters normalize external event sources into the canonical LatticeEvent format. Every adapter implements the `ObserverAdapter` interface defined in `observers/interface.ts`:

```typescript
interface ObserverAdapter {
 name: string;
 start(): Promise<void>;
 stop(): Promise<void>;
 onEvent(callback: (event: LatticeEvent) => void): void;
}
```

### Built-in Adapters

**WebhookAdapter** (`observers/webhook/`): HTTP POST receiver with optional HMAC-SHA256 verification. Defaults: `host: 127.0.0.1`, `port: 9000`, `endpoint: /events`, header `x-signature-256`. When HMAC is enabled and the lattice requires `required_field: signature`, the adapter injects the verified hex digest into `payload.signature` so lattice `required_field` checks pass.

**SSEAdapter** (`observers/sse/`): Server-Sent Events consumer with auto-reconnect.

**PollAdapter** (`observers/poll/`): REST poller with diff-based change detection.

**BlockchainAdapter** (`observers/examples/blockchain/`): reference Ethereum log poller only.

**EmailAdapter**: not implemented; interface documented in `MIGRATION-v0.4-to-v1.0.md` for custom adapters.

### Adapter Lifecycle

1. Construct the adapter with its configuration.
2. Call `onEvent` to register the callback that receives normalized events.
3. Call `start()` to begin consuming events. Implementations must be idempotent.
4. Call `stop()` to tear down resources (server sockets, timers, connections). Implementations must be idempotent and safe to call even if not started.

All adapters normalize their native event shape into a LatticeEvent with `source`, `action_path`, `payload`, `bridge_timestamp` and optional `agent_id`. The bridge then routes each event through the lattice filter.

---

## 10. Agent Interest Registration

Agents declare interest in lattice paths using glob patterns. When an event's action path matches a registered interest, the bridge routes the event to that agent.

### Registration Schema

```yaml
agent_id:
 type: string
 required: true
watch_paths:
 type: array
 items: string
 required: true
 description: "Glob patterns matching action paths, e.g. 'market:*', 'email:incoming'"
notify:
 type: string
 enum: [wake, queue, log]
 required: true
 description: "wake=trigger agent, queue=store for later, log=just record"
max_rate:
 type: string
 required: false
 description: "Rate limit, e.g. '10/min', '1/sec'"
constraints:
 type: object
 required: false
 description: "Additional match filters (e.g. threshold values)"
```

### Glob Matching

The bridge supports three glob pattern levels:

- **Exact match**: `email:incoming` matches only that exact path.
- **Single-segment wildcard**: `market:*` matches any single-level path under market (e.g. `market:price:update` does NOT match, `market:price` matches).
- **Multi-segment wildcard**: `email:**` matches any path under email at any depth (e.g. `email:incoming`, `email:classify`, `email:draft_reply`).

### Notification Modes

- **wake**: the agent is immediately invoked with the event payload. Used for real-time responses (e.g. a trading agent waking on a price update).
- **queue**: the event is stored in a per-agent queue for later retrieval. Used for agents that poll on their own schedule.
- **log**: the event is recorded in the agent's activity log without delivery. Used for audit trails and analytics.

### Registration Flow

**Shipped API:** `DynAEPBridge.registerAgentInterest({ agent_id, watch_paths, notify, max_rate?, constraints? })`. Interests are stored in the lattice filter and evaluated on each passing `action_path` event (`matched_interests` in `LATTICE_FILTER_RESULT`).

**Spec event:** [EVENT-TYPES.md](EVENT-TYPES.md) defines `dynaep_type: LATTICE_REGISTER` for wire-level registration. The lattice node `agent:interest:register` requires parent `agent:ready`. The TypeScript bridge does not yet route `LATTICE_REGISTER` events through `processEvent()`; use the programmatic API until event dispatch is implemented.

**Note:** `lattice.agent_interest_enabled` is documented in [CONFIG.md](CONFIG.md) but is not yet read by `DynAEPBridge`; interest matching is always active once interests are registered.

---

## 11. Configuration

The complete configuration reference is at [CONFIG.md](CONFIG.md). This section covers only the lattice-specific additions in dynAEP 1.0.

The `dynaep-config.yaml` file governs all bridge behaviour. dynAEP 1.0 adds a `lattice` section:

```yaml
# ---------------------------------------------------------------------------
# LATTICE (New in dynAEP 1.0)
# ---------------------------------------------------------------------------

lattice:
 registry: "./registries/aep-lattice.yaml"
 governance: "filter_all" # filter_all | events_only | ui_only | disabled
 agent_interest_enabled: true
 hook: "mle" # validation hook: "mle" | "noop" | custom
```

The `governance` field controls which **lattice node categories** are filtered when an event has `action_path` (implemented by `governanceAppliesToCategory()` in `bridge/lattice/`):

| Mode | Lattice applies to | Typical use |
|------|-------------------|-------------|
| **filter_all** | `external_event`, `system_event`, `agent_action`, `output` | Production default |
| **events_only** | `external_event`, `system_event` only | Gradual rollout; agent/output lattice nodes skipped |
| **ui_only** | None (lattice skipped for all categories) | v0.4-style bridge; AEP structural validation only |
| **disabled** | None | Development / migration only |

**Important:** The bridge only invokes the lattice when `event.action_path` is set and the path exists in the registry. UI mutations without `action_path` never hit the lattice regardless of mode.

The `hook` field selects the validation hook (`mle` aliases to `mle-validator`). Custom hooks implement the [ValidationHook interface](hooks/interface.ts).

For the full configuration reference including temporal authority, causal ordering, perception, Rego policy and lattice memory, see [CONFIG.md](CONFIG.md). Also see [SPEC.md](SPEC.md), [EVENT-TYPES.md](EVENT-TYPES.md) and [MIGRATION-v0.4-to-v1.0.md](MIGRATION-v0.4-to-v1.0.md). Do not copy config YAML from the README into production; use the canonical CONFIG.md.

---

## 12. Related Protocols

- **AEP: Agent Element Protocol** - build-time structural governance for agent-created UIs. AEP provides the scene graph, registry and z-band topology that dynAEP validates against at runtime.

- **GAP: Governed Agentic Programming** - open-source specification for agent instructions. GAP defines instruction-level governance (what the agent is told to do). dynAEP provides event-level governance (what the agent actually does). GAP specifies the permitted instruction set; dynAEP's Action Lattice specifies the permitted event set. They are complementary open protocols that together form a complete governance stack.

- **AG-UI: Agent-User Interaction Protocol** - real-time event streaming between agent backends and frontend renderers. dynAEP extends AG-UI events with validated lattice events, temporal authority and perception governance.

- **MCP: Model Context Protocol** - agent-to-tool connectivity. dynAEP does not replace MCP. MCP handles tool discovery and invocation; dynAEP governs the events those tools produce and consume.

---

## 13. SDK Packages (AEP 2.8 layout)

**SDKs do not live under `AEP-Components/dynAEP/`.** Protocol source of truth is `AEP-Components/dynAEP/`; SDKs are produced into `AEP-SDKs/` at the repository root. NPM registry distribution is forbidden; use `produce-aep-sdks.mjs` and lattice-gated artifacts.

| SDK | Path | Contents |
|-----|------|----------|
| TypeScript dynAEP | `AEP-SDKs/typescript/dynaep/` | `DynAEPBridge`, `processEvent()` (**async**), Action Lattice (`filterAsync`), `hook-loader`, temporal authority, Rego, scanners |
| TypeScript AEP core | `AEP-SDKs/typescript/aep-protocol/` | Scene graph, validation, memory fabric |
| Python dynAEP | `AEP-SDKs/python/dynaep/` | Python bridge and temporal pipeline |
| React (AEP + dynAEP) | `AEP-SDKs/react/` | `aep-react.tsx`, `dynaep-react.tsx` (`await bridge.processEvent()`), `dynaep-copilotkit.tsx` |
| Vue (AEP) | `AEP-SDKs/vue/` | `aep-vue.ts` composables |
| CLI | `AEP-SDKs/typescript/dynaep/cli/dynaep-cli.ts` | `validate`, `serve`, lattice diagnostics |

**Breaking change (v1.0 / CCA integration):** `DynAEPBridge.processEvent()` returns `Promise<AGUIEvent | DynAEPRejection>`. All callers must `await` it.

**Tests:** `AEP-SDKs/typescript/dynaep/tests/lattice/action-lattice.test.ts` (governance modes, hook aliases, `within_range`, `filterAsync`).

Build all SDKs:

```bash
node AEP-User-Experience/scripts/produce-aep-sdks.mjs
```

Registry component IDs: `aep-dynaep-typescript`, `aep-dynaep-python`, `dynaep-core` (protocol only), `dynAEP-hook-loader`, `dynAEP-cca-bridge-config`.

### 13.1 CCA and Base Node integration

CCA `plan-executor` persists full `policy_overrides.dynaep` (governance, observers, `validation_hook`, lattice registry path, SDK paths) into Base Node `config.dynaep`.

Runtime bridge bootstrap:

```javascript
import { buildBridgeConfigFromDynaep, listDynaepObserverSpecs } from
  "AEP-Components/cca/lib/dynaep-bridge-config.mjs";

const bridgeCfg = buildBridgeConfigFromDynaep(config.dynaep, repoRoot);
const observers = listDynaepObserverSpecs(config.dynaep);
// Pass bridgeCfg to DynAEPBridge constructor; start enabled ObserverAdapters.
```

See `AEP-Components/cca/lib/dynaep-context.mjs` and the public conformance runner at `AEP-Components/conformance/runner/run.sh`.

---

## 14. License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the full text and [NOTICE](NOTICE) for attribution.

The names **AEP**, **Agent Element Protocol**, **AEP-compliant** and **dynAEP** are reserved. See [NAME-POLICY.md](NAME-POLICY.md) for permitted and prohibited uses. Apache 2.0 covers the code; the reserved-name policy covers the identifiers.

**Patent grant**: Apache 2.0 includes an explicit patent covenant from contributors.

---

## Summary

dynAEP 1.0 introduces the Action Lattice as the central governance mechanism for lattice-addressed events in multi-agent systems. The lattice defines every registered action, partial-order dependencies, per-action constraints and trust tiers. Combined with AEP structural validation for UI mutations, this extends governance from scene-graph-only (v0.4) to external events, agent actions and outputs that carry `action_path`.

dynAEP 1.0 governs the event lifecycle through a single bridge pipeline: pluggable observer adapters, optional lattice validation (`filterAsync` + hooks), temporal authority and causal ordering, AEP structural validation, perception governance for human-facing outputs and programmatic agent interest registration for selective routing.

The agent provides the semantic intelligence. The Action Lattice provides the event order. The bridge clock provides the temporal law. The perception registry provides the perceptual law. The durable store provides the persistence law. dynAEP 1.0 is the enforcement layer that connects them all through a single deterministic pipeline.
