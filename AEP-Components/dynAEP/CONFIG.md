# dynAEP 1.0 - Complete Configuration Reference

> **Authoritative reference.** This document describes the *actual* `dynaep-config.yaml` schema
> as shipped with dynAEP 1.0. Do **not** rely on README config snippets - they may describe an
> earlier draft that does not match the running system.

---

## Table of Contents

1. [Top-Level Fields](#1-top-level-fields)
2. [transport](#2-transport)
3. [aep_sources](#3-aep_sources)
4. [lattice (NEW)](#4-lattice--new)
5. [validation](#5-validation)
6. [rego](#6-rego)
7. [chain_execution](#7-chain_execution)
8. [scanners](#8-scanners)
9. [runtime_reflection](#9-runtime_reflection)
10. [approval_policy](#10-approval_policy)
11. [conflict_resolution](#11-conflict_resolution)
12. [id_minting](#12-id_minting)
13. [themes](#13-themes)
14. [tools](#14-tools)
15. [logging](#15-logging)
16. [timekeeping](#16-timekeeping)
17. [causal_ordering](#17-causal_ordering)
18. [forecast](#18-forecast)
19. [perception](#19-perception)
20. [lattice_memory](#20-lattice_memory)
21. [temporal_authority](#21-temporal_authority)

---

## 1. Top-Level Fields

Three metadata keys sit at the root of every dynAEP config file.

### aep_version

| Attribute | Value |
|-----------|-------|
| **Path** | `aep_version` |
| **Type** | `string` (semver) |
| **Default** | `"1.2"` |
| **Description** | The AEP protocol version this config targets. Used for schema migration and backward-compatibility checks. |
| **Example** | `aep_version: "1.2"` |
| **NEW** | No (inherited from AEP 1.0) |

### dynaep_version

| Attribute | Value |
|-----------|-------|
| **Path** | `dynaep_version` |
| **Type** | `string` (semver) |
| **Default** | `"1.0"` |
| **Description** | The dynAEP engine version that wrote this config. The runtime uses this to warn if a config written by a newer engine is loaded into an older one. |
| **Example** | `dynaep_version: "1.0"` |
| **NEW** | Yes - first appeared in dynAEP 1.0 |

### schema_revision

| Attribute | Value |
|-----------|-------|
| **Path** | `schema_revision` |
| **Type** | `integer` |
| **Default** | `3` |
| **Description** | Monotonically increasing integer that tracks structural changes to the config schema itself. Bumped automatically when the engine migrates a config file. |
| **Example** | `schema_revision: 3` |
| **NEW** | Yes |

---

## 2. transport

Controls how the AEP bridge communicates with the agent process.

```yaml
transport:
 protocol: "sse"
 endpoint: "/api/agent"
 reconnect_interval_ms: 3000
 heartbeat_interval_ms: 15000
```

### transport.protocol

| Attribute | Value |
|-----------|-------|
| **Path** | `transport.protocol` |
| **Type** | `string` (enum) |
| **Valid Values** | `"sse"`, `"websocket"` |
| **Default** | `"sse"` |
| **Description** | Wire protocol for the bridge-to-agent connection. `sse` uses Server-Sent Events (unidirectional server→client, events via HTTP); `websocket` opens a full-duplex WebSocket. |
| **Example** | `protocol: "sse"` |
| **NEW** | No |

### transport.endpoint

| Attribute | Value |
|-----------|-------|
| **Path** | `transport.endpoint` |
| **Type** | `string` (URI path) |
| **Default** | `"/api/agent"` |
| **Description** | HTTP path or WebSocket route that the agent listens on. |
| **Example** | `endpoint: "/api/agent"` |
| **NEW** | No |

### transport.reconnect_interval_ms

| Attribute | Value |
|-----------|-------|
| **Path** | `transport.reconnect_interval_ms` |
| **Type** | `integer` (milliseconds) |
| **Default** | `3000` |
| **Description** | How long the bridge waits before attempting a reconnection after the connection drops. |
| **Example** | `reconnect_interval_ms: 3000` |
| **NEW** | No |

### transport.heartbeat_interval_ms

| Attribute | Value |
|-----------|-------|
| **Path** | `transport.heartbeat_interval_ms` |
| **Type** | `integer` (milliseconds) |
| **Default** | `15000` |
| **Description** | Interval at which keep-alive pings are sent over the transport. If no data is exchanged within this window, a heartbeat frame is sent to verify liveness. |
| **Example** | `heartbeat_interval_ms: 15000` |
| **NEW** | No |

---

## 3. aep_sources

Paths to the static AEP registry files that define the scene graph, element registry and theme data.

```yaml
aep_sources:
  scene: "./AEP-Subprotocols/ui/aep-scene.json"
  registry: "./AEP-Subprotocols/ui/aep-registry.yaml"
  theme: "./AEP-Subprotocols/ui/aep-theme.yaml"
```

### aep_sources.scene

| Attribute | Value |
|-----------|-------|
| **Path** | `aep_sources.scene` |
| **Type** | `string` (file path) |
| **Default** | `"./AEP-Subprotocols/ui/aep-scene.json"` |
| **Description** | Path to the scene-graph JSON file. Describes the UI element tree (containers, widgets, layout). |
| **Example** | `scene: "./AEP-Subprotocols/ui/aep-scene.json"` |
| **NEW** | No |

### aep_sources.registry

| Attribute | Value |
|-----------|-------|
| **Path** | `aep_sources.registry` |
| **Type** | `string` (file path) |
| **Default** | `"./AEP-Subprotocols/ui/aep-registry.yaml"` |
| **Description** | Path to the element registry YAML file. Defines every allowable element type, its properties, constraints and default values. |
| **Example** | `registry: "./AEP-Subprotocols/ui/aep-registry.yaml"` |
| **NEW** | No |

### aep_sources.theme

| Attribute | Value |
|-----------|-------|
| **Path** | `aep_sources.theme` |
| **Type** | `string` (file path) |
| **Default** | `"./AEP-Subprotocols/ui/aep-theme.yaml"` |
| **Description** | Path to the default theme definition (used as fallback when `themes.active` is invalid or missing). |
| **Example** | `theme: "./AEP-Subprotocols/ui/aep-theme.yaml"` |
| **NEW** | No |

---

## 4. lattice (NEW)

The **lattice** is dynAEP 1.0's new action-registry and event-governance layer. It validates every action and event against a lattice registry before allowing it to propagate through the system. This is the primary architectural change from v0.4.

> **Important:** Do NOT use `lattice.enabled` or `lattice.filter_mode` - those were draft field names
> from an early README and do **not** exist in the actual config. The real fields are below.

```yaml
lattice:
 registry: "./registries/aep-lattice.yaml"
 governance: "filter_all"
 agent_interest_enabled: true
 hook: "mle"
```

### lattice.registry

| Attribute | Value |
|-----------|-------|
| **Path** | `lattice.registry` |
| **Type** | `string` (file path) |
| **Default** | `"./registries/aep-lattice.yaml"` |
| **Description** | Path to the lattice YAML file that defines the complete action/event registry. The lattice declares every allowed action, its parameters, preconditions, side-effects and governance constraints. |
| **Example** | `registry: "./registries/aep-lattice.yaml"` |
| **NEW** | Yes |

### lattice.governance

| Attribute | Value |
|-----------|-------|
| **Path** | `lattice.governance` |
| **Type** | `string` (enum) |
| **Valid Values** | `"filter_all"`, `"events_only"`, `"ui_only"`, `"disabled"` |
| **Default** | `"filter_all"` |
| **Description** | Controls which actions/events are validated against the lattice registry: |

| Value | Behaviour (`governanceAppliesToCategory`) |
|-------|-----------|
| `filter_all` | **Default.** Lattice applies to all categories: `external_event`, `system_event`, `agent_action`, `output`. |
| `events_only` | Lattice applies to `external_event` and `system_event` only. `agent_action` and `output` nodes are skipped. |
| `ui_only` | Lattice skipped for all categories. Bridge uses AEP structural validation (v0.4-style); no lattice membership checks. |
| `disabled` | Lattice validation entirely skipped. Use only for development or migration. |

**Bridge note:** `DynAEPBridge.processEvent()` invokes the lattice only when the event has `action_path` and the path exists in `lattice.registry`. UI mutations (`AEP_MUTATE_*` without `action_path`) do not hit the lattice regardless of governance mode.

| **Example** | `governance: "filter_all"` |
| **NEW** | Yes |

### lattice.agent_interest_enabled

| Attribute | Value |
|-----------|-------|
| **Path** | `lattice.agent_interest_enabled` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | When `true`, the lattice engine tracks which action types agents have registered via `DynAEPBridge.registerAgentInterest()`. When `false`, interest tracking should be disabled. **Current SDK:** this flag is defined in config but not yet read by `DynAEPBridge`; interest matching is active whenever interests are registered. |
| **Example** | `agent_interest_enabled: true` |
| **NEW** | Yes |

### lattice.hook

| Attribute | Value |
|-----------|-------|
| **Path** | `lattice.hook` |
| **Type** | `string` |
| **Default** | `"mle"` |
| **Description** | The validation hook for `type: custom` lattice constraints. `"mle"` aliases to registry key `mle-validator` (see `bridge/hook-loader.ts`). `"noop"` is pass-through. Hooks run inside `LatticeFilter.filterAsync()`; `DynAEPBridge.processEvent()` awaits this path. Custom hooks register via `HookRegistry.register()` or `registerBuiltinHooks()`. |
| **Example** | `hook: "mle"` |
| **NEW** | Yes |

---

## 5. validation

Controls the runtime validator that checks every mutation against the registry schema.

```yaml
validation:
 mode: "strict"
 aot_on_startup: true
 jit_on_every_delta: true
```

### validation.mode

| Attribute | Value |
|-----------|-------|
| **Path** | `validation.mode` |
| **Type** | `string` (enum) |
| **Valid Values** | `"strict"`, `"permissive"`, `"log_only"` |
| **Default** | `"strict"` |
| **Description** | `strict` rejects any mutation that violates the registry schema. `permissive` accepts structural violations but reports them. `log_only` accepts everything and only writes warnings to the log without rejecting. |
| **Example** | `mode: "strict"` |
| **NEW** | No |

### validation.aot_on_startup

| Attribute | Value |
|-----------|-------|
| **Path** | `validation.aot_on_startup` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | Ahead-of-time (AOT) validation runs a full pass over all registries when the engine starts. Catches structural errors early before any agent interaction. |
| **Example** | `aot_on_startup: true` |
| **NEW** | No |

### validation.jit_on_every_delta

| Attribute | Value |
|-----------|-------|
| **Path** | `validation.jit_on_every_delta` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | Just-in-time (JIT) validation runs on every individual delta (mutation event). When `false`, only AOT validation is performed and mutations are not individually checked. |
| **Example** | `jit_on_every_delta: true` |
| **NEW** | No |

---

## 6. rego

Open Policy Agent (OPA) / Rego policy integration. Supports both unified bundles and separate policy files for different governance domains.

```yaml
rego:
 policy_path: "./policies/aep-policy.rego"
 evaluation: "wasm"
 bundle_mode: "unified"
 decision_cache_size: 5000
 cache_invalidate_on_reload: true
 unified_bundle_path: "./policies/aep-unified-bundle.tar.gz"
 separate_policy_paths:
 structural: "./policies/aep-policy.rego"
 temporal: "./policies/temporal-policy.rego"
 perception: "./policies/perception-policy.rego"
 lattice: "./policies/lattice-policy.rego"
```

### rego.policy_path

| Attribute | Value |
|-----------|-------|
| **Path** | `rego.policy_path` |
| **Type** | `string` (file path) |
| **Default** | `"./policies/aep-policy.rego"` |
| **Description** | Primary Rego policy file path. Used as the sole policy source when `bundle_mode` is not `"separate"`. |
| **Example** | `policy_path: "./policies/aep-policy.rego"` |
| **NEW** | No |

### rego.evaluation

| Attribute | Value |
|-----------|-------|
| **Path** | `rego.evaluation` |
| **Type** | `string` (enum) |
| **Valid Values** | `"wasm"`, `"cli"`, `"precompiled"` |
| **Default** | `"wasm"` |
| **Description** | Rego evaluation engine. `wasm` uses the OPA WebAssembly runtime (fastest, sandboxed). `cli` shells out to the `opa` binary. `precompiled` loads a pre-compiled WASM blob. |
| **Example** | `evaluation: "wasm"` |
| **NEW** | No |

### rego.bundle_mode

| Attribute | Value |
|-----------|-------|
| **Path** | `rego.bundle_mode` |
| **Type** | `string` (enum) |
| **Valid Values** | `"unified"`, `"separate"` |
| **Default** | `"unified"` |
| **Description** | `unified` loads a single OPA bundle (`.tar.gz`) containing all policies. `separate` loads individual policy files from `separate_policy_paths`. |
| **Example** | `bundle_mode: "unified"` |
| **NEW** | No |

### rego.decision_cache_size

| Attribute | Value |
|-----------|-------|
| **Path** | `rego.decision_cache_size` |
| **Type** | `integer` |
| **Default** | `5000` |
| **Description** | Maximum number of cached OPA decisions. LRU eviction. Reduces redundant policy evaluation for repeated inputs. |
| **Example** | `decision_cache_size: 5000` |
| **NEW** | No |

### rego.cache_invalidate_on_reload

| Attribute | Value |
|-----------|-------|
| **Path** | `rego.cache_invalidate_on_reload` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | When `true`, the entire decision cache is flushed every time a policy file is reloaded. Prevents stale decisions after policy changes. |
| **Example** | `cache_invalidate_on_reload: true` |
| **NEW** | No |

### rego.unified_bundle_path

| Attribute | Value |
|-----------|-------|
| **Path** | `rego.unified_bundle_path` |
| **Type** | `string` (file path) |
| **Default** | `"./policies/aep-unified-bundle.tar.gz"` |
| **Description** | Path to the single OPA bundle archive (only used when `bundle_mode: "unified"`). |
| **Example** | `unified_bundle_path: "./policies/aep-unified-bundle.tar.gz"` |
| **NEW** | No |

### rego.separate_policy_paths

| Attribute | Value |
|-----------|-------|
| **Path** | `rego.separate_policy_paths` |
| **Type** | `map[string]string` |
| **Default** | see below |
| **Description** | Per-domain policy file paths. Only used when `bundle_mode: "separate"`. Each key names a governance domain; each value is a path to a `.rego` file. |

| Key | Default Path | Purpose |
|-----|--------------|---------|
| `structural` | `"./policies/aep-policy.rego"` | Element structure and mutation policies |
| `temporal` | `"./policies/temporal-policy.rego"` | Time-based ordering and staleness policies |
| `perception` | `"./policies/perception-policy.rego"` | Perceptual envelope policies |
| `lattice` | `"./policies/lattice-policy.rego"` | Lattice action/event governance policies |

**NEW:** The `lattice` sub-key is new in dynAEP 1.0.

---

## 7. chain_execution

Controls how the multi-stage validation pipeline is executed.

```yaml
chain_execution:
 mode: "parallel"
```

### chain_execution.mode

| Attribute | Value |
|-----------|-------|
| **Path** | `chain_execution.mode` |
| **Type** | `string` (enum) |
| **Valid Values** | `"parallel"`, `"serial"` |
| **Default** | `"parallel"` |
| **Description** | Execution strategy for the 5-stage validation chain: **Stage A** (steps 0-4: temporal + lattice), **Stage B** (steps 5-9: scene + registry), **Stage C** (steps 10-12: rego policies), **Stage D** (step 13: covenant), **Stage E** (step 14: content scanners). `parallel` runs independent stages concurrently. `serial` runs every stage sequentially. |
| **Example** | `mode: "parallel"` |
| **NEW** | No |

---

## 8. scanners

Content-scanner engine configuration.

```yaml
scanners:
 engine: "unified"
```

### scanners.engine

| Attribute | Value |
|-----------|-------|
| **Path** | `scanners.engine` |
| **Type** | `string` |
| **Default** | `"unified"` |
| **Description** | The content-scanning backend. `"unified"` uses the single-pass scanner that runs all rule-sets (security, profanity, PII, etc.) in one pass. Custom scanner engine names can be registered via plugins. |
| **Example** | `engine: "unified"` |
| **NEW** | No |

---

## 9. runtime_reflection

Controls the observer pattern that allows the agent to introspect its own state and actions.

```yaml
runtime_reflection:
 enabled: true
 method: "observer"
 debounce_ms: 250
 broadcast_to_agent: true
 include_invisible: false
```

### runtime_reflection.enabled

| Attribute | Value |
|-----------|-------|
| **Path** | `runtime_reflection.enabled` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | Master switch for runtime reflection. When `false`, no introspection data is collected or broadcast. |
| **Example** | `enabled: true` |
| **NEW** | No |

### runtime_reflection.method

| Attribute | Value |
|-----------|-------|
| **Path** | `runtime_reflection.method` |
| **Type** | `string` (enum) |
| **Valid Values** | `"observer"`, `"poll"` |
| **Default** | `"observer"` |
| **Description** | `observer` uses a push-based observer pattern (delta events are broadcast as they happen). `poll` requires the agent to pull reflection data explicitly. |
| **Example** | `method: "observer"` |
| **NEW** | No |

### runtime_reflection.debounce_ms

| Attribute | Value |
|-----------|-------|
| **Path** | `runtime_reflection.debounce_ms` |
| **Type** | `integer` (milliseconds) |
| **Default** | `250` |
| **Description** | Minimum interval between consecutive reflection broadcasts. Prevents flooding the agent during rapid mutation bursts. |
| **Example** | `debounce_ms: 250` |
| **NEW** | No |

### runtime_reflection.broadcast_to_agent

| Attribute | Value |
|-----------|-------|
| **Path** | `runtime_reflection.broadcast_to_agent` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | When `true`, reflection events are sent to the agent over the transport channel. When `false`, reflection data is logged internally but not forwarded. |
| **Example** | `broadcast_to_agent: true` |
| **NEW** | No |

### runtime_reflection.include_invisible

| Attribute | Value |
|-----------|-------|
| **Path** | `runtime_reflection.include_invisible` |
| **Type** | `boolean` |
| **Default** | `false` |
| **Description** | When `true`, reflection events include elements marked as invisible/private in the registry. When `false`, these elements are excluded from reflection broadcasts. |
| **Example** | `include_invisible: false` |
| **NEW** | No |

---

## 10. approval_policy

Controls which mutation types require explicit human approval before being applied.

```yaml
approval_policy:
 structure_mutations: "auto"
 behaviour_mutations: "auto"
 skin_mutations: "auto"
 new_element_creation: "require_approval"
 forbidden_pattern_changes: "require_approval"
```

Each field follows the same schema:

| Attribute | Value |
|-----------|-------|
| **Type** | `string` (enum) |
| **Valid Values** | `"auto"`, `"require_approval"`, `"deny"` |
| **Description** | `"auto"` - apply the mutation immediately without asking. `"require_approval"` - queue the mutation and notify a human reviewer. `"deny"` - reject the mutation outright. |

### approval_policy.structure_mutations

| Attribute | Value |
|-----------|-------|
| **Path** | `approval_policy.structure_mutations` |
| **Default** | `"auto"` |
| **Description** | Mutations that change the layout or containment hierarchy (add/remove containers, reparent elements). |
| **Example** | `structure_mutations: "auto"` |
| **NEW** | No |

### approval_policy.behaviour_mutations

| Attribute | Value |
|-----------|-------|
| **Path** | `approval_policy.behaviour_mutations` |
| **Default** | `"auto"` |
| **Description** | Mutations that change element behaviour (event handlers, transitions, animations). |
| **Example** | `behaviour_mutations: "auto"` |
| **NEW** | No |

### approval_policy.skin_mutations

| Attribute | Value |
|-----------|-------|
| **Path** | `approval_policy.skin_mutations` |
| **Default** | `"auto"` |
| **Description** | Mutations that change element appearance (colours, fonts, sizes, borders). |
| **Example** | `skin_mutations: "auto"` |
| **NEW** | No |

### approval_policy.new_element_creation

| Attribute | Value |
|-----------|-------|
| **Path** | `approval_policy.new_element_creation` |
| **Default** | `"require_approval"` |
| **Description** | Creating entirely new elements not present in the original scene graph. Requires approval by default to prevent uncontrolled UI growth. |
| **Example** | `new_element_creation: "require_approval"` |
| **NEW** | No |

### approval_policy.forbidden_pattern_changes

| Attribute | Value |
|-----------|-------|
| **Path** | `approval_policy.forbidden_pattern_changes` |
| **Default** | `"require_approval"` |
| **Description** | Changes that match patterns explicitly marked as forbidden in the registry (e.g., removing a required attribute, setting a protected property to a disallowed value). |
| **Example** | `forbidden_pattern_changes: "require_approval"` |
| **NEW** | No |

---

## 11. conflict_resolution

Strategy for resolving write conflicts when two mutations target the same element concurrently.

```yaml
conflict_resolution:
 mode: "last_write_wins"
```

### conflict_resolution.mode

| Attribute | Value |
|-----------|-------|
| **Path** | `conflict_resolution.mode` |
| **Type** | `string` (enum) |
| **Valid Values** | `"last_write_wins"`, `"first_write_wins"`, `"merge"`, `"error"` |
| **Default** | `"last_write_wins"` |
| **Description** | `last_write_wins` - the mutation with the most recent timestamp takes effect. `first_write_wins` - the first one wins, subsequent writes are dropped. `merge` - attempts to merge conflicts structurally (requires merge strategies per element type). `error` - raises a conflict error that the caller must handle. |
| **Example** | `mode: "last_write_wins"` |
| **NEW** | No |

---

## 12. id_minting

Controls the generation of unique element identifiers.

```yaml
id_minting:
 enabled: true
 counters_persist: true
```

### id_minting.enabled

| Attribute | Value |
|-----------|-------|
| **Path** | `id_minting.enabled` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | Master switch for automatic ID generation. When `true`, new elements receive auto-minted IDs. When `false`, the caller must supply IDs explicitly. |
| **Example** | `enabled: true` |
| **NEW** | No |

### id_minting.counters_persist

| Attribute | Value |
|-----------|-------|
| **Path** | `id_minting.counters_persist` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | When `true`, ID counters are saved to disk between restarts, ensuring monotonically increasing IDs survive process restarts. When `false`, counters reset on every launch. |
| **Example** | `counters_persist: true` |
| **NEW** | No |

---

## 13. themes

Registry of available UI themes and the active theme selection.

```yaml
themes:
 available:
 - name: "dark"
 path: "./registries/aep-theme.yaml"
 - name: "light"
 path: "./registries/aep-theme-light.yaml"
 active: "dark"
```

### themes.available

| Attribute | Value |
|-----------|-------|
| **Path** | `themes.available` |
| **Type** | `array` of `{name: string, path: string}` |
| **Default** | see above |
| **Description** | List of theme definitions. Each entry has a `name` (identifier used by `themes.active`) and a `path` (file path to the theme YAML). |
| **Example** | See full block above. |
| **NEW** | No |

### themes.active

| Attribute | Value |
|-----------|-------|
| **Path** | `themes.active` |
| **Type** | `string` |
| **Default** | `"dark"` |
| **Description** | The currently active theme name. Must match one of the `name` values in `themes.available`. If it does not match, the engine falls back to `aep_sources.theme`. |
| **Example** | `active: "dark"` |
| **NEW** | No |

---

## 14. tools

Boolean flags that enable or disable specific AG-UI frontend tool commands the agent can invoke.

```yaml
tools:
 aep_add_element: true
 aep_move_element: true
 aep_query_graph: true
 aep_swap_theme: true
```

Each tool field has the same structure:

| Attribute | Value |
|-----------|-------|
| **Type** | `boolean` |
| **Description** | When `true`, the tool is registered and available for agent invocation. When `false`, the tool is disabled and returns an error if called. |

### tools.aep_add_element

| Attribute | Value |
|-----------|-------|
| **Path** | `tools.aep_add_element` |
| **Default** | `true` |
| **Description** | Allow the agent to add new elements to the scene graph. |
| **NEW** | No |

### tools.aep_move_element

| Attribute | Value |
|-----------|-------|
| **Path** | `tools.aep_move_element` |
| **Default** | `true` |
| **Description** | Allow the agent to move/reparent elements within the scene hierarchy. |
| **NEW** | No |

### tools.aep_query_graph

| Attribute | Value |
|-----------|-------|
| **Path** | `tools.aep_query_graph` |
| **Default** | `true` |
| **Description** | Allow the agent to query the current scene graph structure and element properties. |
| **NEW** | No |

### tools.aep_swap_theme

| Attribute | Value |
|-----------|-------|
| **Path** | `tools.aep_swap_theme` |
| **Default** | `true` |
| **Description** | Allow the agent to switch the active theme by name. |
| **NEW** | No |

---

## 15. logging

Controls verbosity and event-type filtering for the dynAEP logger.

```yaml
logging:
 level: "info"
 log_rejections: true
 log_accepted_mutations: false
 log_tool_calls: true
 log_lattice_events: true
```

### logging.level

| Attribute | Value |
|-----------|-------|
| **Path** | `logging.level` |
| **Type** | `string` (enum) |
| **Valid Values** | `"debug"`, `"info"`, `"warn"`, `"error"`, `"critical"`, `"off"` |
| **Default** | `"info"` |
| **Description** | Minimum log level. `"debug"` is most verbose. `"off"` disables all logging. |
| **Example** | `level: "info"` |
| **NEW** | No |

### logging.log_rejections

| Attribute | Value |
|-----------|-------|
| **Path** | `logging.log_rejections` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | When `true`, every rejected mutation (validation failure, policy deny, etc.) is logged with full detail. |
| **Example** | `log_rejections: true` |
| **NEW** | No |

### logging.log_accepted_mutations

| Attribute | Value |
|-----------|-------|
| **Path** | `logging.log_accepted_mutations` |
| **Type** | `boolean` |
| **Default** | `false` |
| **Description** | When `true`, every accepted mutation is logged. Disabled by default to avoid log noise in high-throughput scenarios. |
| **Example** | `log_accepted_mutations: false` |
| **NEW** | No |

### logging.log_tool_calls

| Attribute | Value |
|-----------|-------|
| **Path** | `logging.log_tool_calls` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | When `true`, every tool invocation by the agent is logged. |
| **Example** | `log_tool_calls: true` |
| **NEW** | No |

### logging.log_lattice_events

| Attribute | Value |
|-----------|-------|
| **Path** | `logging.log_lattice_events` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | When `true`, lattice governance decisions (allow/deny actions and events) are logged. |
| **Example** | `log_lattice_events: true` |
| **NEW** | Yes |

---

## 16. timekeeping

NTP-based wall-clock synchronisation with drift detection and TIM (Temporal Integrity Monitor) holdover.

```yaml
timekeeping:
 protocol: "ntp"
 source: "pool.ntp.org"
 sync_interval_ms: 30000
 max_drift_ms: 50
 max_future_ms: 500
 max_staleness_ms: 5000
 bridge_is_authority: true
 log_drift_warnings: true
 tim:
 enabled: true
 holdover_threshold: 3
 freewheel_threshold: 5
 uncertainty_estimation: "variance"
 fixed_uncertainty_ns: 10000000
```

### timekeeping.protocol

| Attribute | Value |
|-----------|-------|
| **Path** | `timekeeping.protocol` |
| **Type** | `string` (enum) |
| **Valid Values** | `"ntp"`, `"ptp"`, `"custom"` |
| **Default** | `"ntp"` |
| **Description** | Time synchronisation protocol. `ntp` uses NTP (UDP/123). `ptp` uses Precision Time Protocol. `custom` expects a user-provided time source plugin. |
| **Example** | `protocol: "ntp"` |
| **NEW** | No |

### timekeeping.source

| Attribute | Value |
|-----------|-------|
| **Path** | `timekeeping.source` |
| **Type** | `string` (hostname or IP) |
| **Default** | `"pool.ntp.org"` |
| **Description** | NTP server hostname or IP address. Can be a pool address or a specific time server. |
| **Example** | `source: "pool.ntp.org"` |
| **NEW** | No |

### timekeeping.sync_interval_ms

| Attribute | Value |
|-----------|-------|
| **Path** | `timekeeping.sync_interval_ms` |
| **Type** | `integer` (milliseconds) |
| **Default** | `30000` |
| **Description** | How often the engine queries the NTP source. |
| **Example** | `sync_interval_ms: 30000` |
| **NEW** | No |

### timekeeping.max_drift_ms

| Attribute | Value |
|-----------|-------|
| **Path** | `timekeeping.max_drift_ms` |
| **Type** | `integer` (milliseconds) |
| **Default** | `50` |
| **Description** | Maximum allowed clock drift between the local clock and the NTP source before a warning or correction is issued. |
| **Example** | `max_drift_ms: 50` |
| **NEW** | No |

### timekeeping.max_future_ms

| Attribute | Value |
|-----------|-------|
| **Path** | `timekeeping.max_future_ms` |
| **Type** | `integer` (milliseconds) |
| **Default** | `500` |
| **Description** | Maximum allowed tolerance for a timestamp that appears to be in the future. Timestamps beyond this threshold are rejected as invalid. |
| **Example** | `max_future_ms: 500` |
| **NEW** | No |

### timekeeping.max_staleness_ms

| Attribute | Value |
|-----------|-------|
| **Path** | `timekeeping.max_staleness_ms` |
| **Type** | `integer` (milliseconds) |
| **Default** | `5000` |
| **Description** | Maximum age of an event before it is considered stale and may be dropped or flagged. |
| **Example** | `max_staleness_ms: 5000` |
| **NEW** | No |

### timekeeping.bridge_is_authority

| Attribute | Value |
|-----------|-------|
| **Path** | `timekeeping.bridge_is_authority` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | When `true`, the bridge acts as the temporal authority - it timestamps all events and the agent must accept those timestamps. When `false`, the agent may supply its own timestamps (subject to drift validation). |
| **Example** | `bridge_is_authority: true` |
| **NEW** | No |

### timekeeping.log_drift_warnings

| Attribute | Value |
|-----------|-------|
| **Path** | `timekeeping.log_drift_warnings` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | When `true`, clock drift events that exceed `max_drift_ms` are written to the log. |
| **Example** | `log_drift_warnings: true` |
| **NEW** | No |

### timekeeping.tim.enabled

| Attribute | Value |
|-----------|-------|
| **Path** | `timekeeping.tim.enabled` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | Master switch for the Temporal Integrity Monitor (TIM). TIM provides holdover and freewheel modes when NTP synchronisation is lost. |
| **Example** | `enabled: true` |
| **NEW** | No |

### timekeeping.tim.holdover_threshold

| Attribute | Value |
|-----------|-------|
| **Path** | `timekeeping.tim.holdover_threshold` |
| **Type** | `integer` (sync cycles) |
| **Default** | `3` |
| **Description** | Number of missed NTP syncs before entering holdover mode. In holdover, TIM uses its last-known-good drift estimate to correct timestamps. |
| **Example** | `holdover_threshold: 3` |
| **NEW** | No |

### timekeeping.tim.freewheel_threshold

| Attribute | Value |
|-----------|-------|
| **Path** | `timekeeping.tim.freewheel_threshold` |
| **Type** | `integer` (sync cycles) |
| **Default** | `5` |
| **Description** | Number of missed NTP syncs (beyond holdover) before entering freewheel mode. In freewheel, TIM stamps events with an uncertainty-annotated time and the system may halt or restrict write operations. |
| **Example** | `freewheel_threshold: 5` |
| **NEW** | No |

### timekeeping.tim.uncertainty_estimation

| Attribute | Value |
|-----------|-------|
| **Path** | `timekeeping.tim.uncertainty_estimation` |
| **Type** | `string` (enum) |
| **Valid Values** | `"variance"`, `"fixed"` |
| **Default** | `"variance"` |
| **Description** | Method for computing timestamp uncertainty. `variance` estimates uncertainty from the observed drift variance. `fixed` uses `fixed_uncertainty_ns` as a constant. |
| **Example** | `uncertainty_estimation: "variance"` |
| **NEW** | No |

### timekeeping.tim.fixed_uncertainty_ns

| Attribute | Value |
|-----------|-------|
| **Path** | `timekeeping.tim.fixed_uncertainty_ns` |
| **Type** | `integer` (nanoseconds) |
| **Default** | `10000000` (10 ms) |
| **Description** | Fixed uncertainty value in nanoseconds. Used only when `uncertainty_estimation: "fixed"`. |
| **Example** | `fixed_uncertainty_ns: 10000000` |
| **NEW** | No |

---

## 17. causal_ordering

Vector-clock-based causal ordering with persistent event history and conflict resolution.

```yaml
causal_ordering:
 enabled: true
 max_reorder_buffer_size: 64
 max_reorder_wait_ms: 200
 conflict_resolution: "last_write_wins"
 enable_vector_clocks: true
 enable_element_history: true
 history_depth: 100
 persistence:
 enabled: true
 backend: "file"
 path: "./.dynaep-causal-state"
 flush_interval_ms: 100
 flush_batch_size: 100
 compact_interval_ms: 3600000
 recovery_on_startup: true
 max_recovery_gap_ms: 60000
```

### causal_ordering.enabled

| Attribute | Value |
|-----------|-------|
| **Path** | `causal_ordering.enabled` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | Master switch for causal ordering of events. When `true`, all events are tracked with vector clocks and reordered into a causal sequence. |
| **Example** | `enabled: true` |
| **NEW** | No |

### causal_ordering.max_reorder_buffer_size

| Attribute | Value |
|-----------|-------|
| **Path** | `causal_ordering.max_reorder_buffer_size` |
| **Type** | `integer` |
| **Default** | `64` |
| **Description** | Maximum number of out-of-order events the reorder buffer can hold. When exceeded, the oldest buffered event is emitted (possibly out of causal order). |
| **Example** | `max_reorder_buffer_size: 64` |
| **NEW** | No |

### causal_ordering.max_reorder_wait_ms

| Attribute | Value |
|-----------|-------|
| **Path** | `causal_ordering.max_reorder_wait_ms` |
| **Type** | `integer` (milliseconds) |
| **Default** | `200` |
| **Description** | Maximum time an event waits in the reorder buffer for its causal dependencies to arrive. After this timeout, the event is emitted even if dependencies are missing. |
| **Example** | `max_reorder_wait_ms: 200` |
| **NEW** | No |

### causal_ordering.conflict_resolution

| Attribute | Value |
|-----------|-------|
| **Path** | `causal_ordering.conflict_resolution` |
| **Type** | `string` (enum) |
| **Valid Values** | `"last_write_wins"`, `"first_write_wins"`, `"merge"`, `"error"` |
| **Default** | `"last_write_wins"` |
| **Description** | Conflict resolution strategy for causally concurrent writes to the same element. Mirrors `conflict_resolution.mode` at the top level. |
| **Example** | `conflict_resolution: "last_write_wins"` |
| **NEW** | No |

### causal_ordering.enable_vector_clocks

| Attribute | Value |
|-----------|-------|
| **Path** | `causal_ordering.enable_vector_clocks` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | When `true`, every event carries a vector clock for causal ordering. When `false`, only wall-clock timestamps are used and causal ordering is best-effort. |
| **Example** | `enable_vector_clocks: true` |
| **NEW** | No |

### causal_ordering.enable_element_history

| Attribute | Value |
|-----------|-------|
| **Path** | `causal_ordering.enable_element_history` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | When `true`, every element maintains a full history of mutations. Used for rollback, audit and replay. |
| **Example** | `enable_element_history: true` |
| **NEW** | No |

### causal_ordering.history_depth

| Attribute | Value |
|-----------|-------|
| **Path** | `causal_ordering.history_depth` |
| **Type** | `integer` |
| **Default** | `100` |
| **Description** | Maximum number of historical entries retained per element. Older entries are pruned. |
| **Example** | `history_depth: 100` |
| **NEW** | No |

### causal_ordering.persistence.enabled

| Attribute | Value |
|-----------|-------|
| **Path** | `causal_ordering.persistence.enabled` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | When `true`, causal state (vector clocks, reorder buffers, element history) is persisted to disk. |
| **Example** | `enabled: true` |
| **NEW** | No |

### causal_ordering.persistence.backend

| Attribute | Value |
|-----------|-------|
| **Path** | `causal_ordering.persistence.backend` |
| **Type** | `string` (enum) |
| **Valid Values** | `"file"`, `"sqlite"`, `"redis"` |
| **Default** | `"file"` |
| **Description** | Storage backend for persistent causal state. `file` writes to a local directory. `sqlite` uses a SQLite database. `redis` uses a remote Redis instance (requires connection config). |
| **Example** | `backend: "file"` |
| **NEW** | No |

### causal_ordering.persistence.path

| Attribute | Value |
|-----------|-------|
| **Path** | `causal_ordering.persistence.path` |
| **Type** | `string` (directory path) |
| **Default** | `"./.dynaep-causal-state"` |
| **Description** | Path to the persistence storage directory or file. Used by `file` and `sqlite` backends. |
| **Example** | `path: "./.dynaep-causal-state"` |
| **NEW** | No |

### causal_ordering.persistence.flush_interval_ms

| Attribute | Value |
|-----------|-------|
| **Path** | `causal_ordering.persistence.flush_interval_ms` |
| **Type** | `integer` (milliseconds) |
| **Default** | `100` |
| **Description** | Interval at which buffered state is flushed to the persistence backend. |
| **Example** | `flush_interval_ms: 100` |
| **NEW** | No |

### causal_ordering.persistence.flush_batch_size

| Attribute | Value |
|-----------|-------|
| **Path** | `causal_ordering.persistence.flush_batch_size` |
| **Type** | `integer` |
| **Default** | `100` |
| **Description** | Maximum number of entries per batch flush operation. |
| **Example** | `flush_batch_size: 100` |
| **NEW** | No |

### causal_ordering.persistence.compact_interval_ms

| Attribute | Value |
|-----------|-------|
| **Path** | `causal_ordering.persistence.compact_interval_ms` |
| **Type** | `integer` (milliseconds) |
| **Default** | `3600000` (1 hour) |
| **Description** | Interval at which the persistence store is compacted (pruning stale entries, defragmenting). |
| **Example** | `compact_interval_ms: 3600000` |
| **NEW** | No |

### causal_ordering.persistence.recovery_on_startup

| Attribute | Value |
|-----------|-------|
| **Path** | `causal_ordering.persistence.recovery_on_startup` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | When `true`, the engine attempts to recover causal state from disk on startup. |
| **Example** | `recovery_on_startup: true` |
| **NEW** | No |

### causal_ordering.persistence.max_recovery_gap_ms

| Attribute | Value |
|-----------|-------|
| **Path** | `causal_ordering.persistence.max_recovery_gap_ms` |
| **Type** | `integer` (milliseconds) |
| **Default** | `60000` |
| **Description** | Maximum acceptable gap between the last recovered event timestamp and the current wall clock. Events older than this gap are considered unrecoverable and the causal state is reset. |
| **Example** | `max_recovery_gap_ms: 60000` |
| **NEW** | No |

---

## 18. forecast

Optional TimesFM-based anomaly forecasting. Disabled by default.

```yaml
forecast:
 enabled: false
 timesfm_mode: "local"
 timesfm_endpoint: null
 context_window: 64
 forecast_horizon: 12
 anomaly_threshold: 3.0
 debounce_ms: 250
 adaptive_debounce: true
 max_tracked_elements: 500
 anomaly_action: "warn"
```

### forecast.enabled

| Attribute | Value |
|-----------|-------|
| **Path** | `forecast.enabled` |
| **Type** | `boolean` |
| **Default** | `false` |
| **Description** | Master switch for TimesFM-based forecasting. When `true`, the engine collects timing metrics and runs anomaly detection. Requires TimesFM dependencies. |
| **Example** | `enabled: false` |
| **NEW** | No |

### forecast.timesfm_mode

| Attribute | Value |
|-----------|-------|
| **Path** | `forecast.timesfm_mode` |
| **Type** | `string` (enum) |
| **Valid Values** | `"local"`, `"remote"` |
| **Default** | `"local"` |
| **Description** | `local` runs TimesFM inference in-process (requires the TimesFM Python package). `remote` sends forecasting requests to a remote endpoint specified by `timesfm_endpoint`. |
| **Example** | `timesfm_mode: "local"` |
| **NEW** | No |

### forecast.timesfm_endpoint

| Attribute | Value |
|-----------|-------|
| **Path** | `forecast.timesfm_endpoint` |
| **Type** | `string` (URL) or `null` |
| **Default** | `null` |
| **Description** | Remote TimesFM inference endpoint URL. Only used when `timesfm_mode: "remote"`. If `null` in remote mode, an error is raised. |
| **Example** | `timesfm_endpoint: null` |
| **NEW** | No |

### forecast.context_window

| Attribute | Value |
|-----------|-------|
| **Path** | `forecast.context_window` |
| **Type** | `integer` |
| **Default** | `64` |
| **Description** | Number of historical data points to feed into the TimesFM model as context. |
| **Example** | `context_window: 64` |
| **NEW** | No |

### forecast.forecast_horizon

| Attribute | Value |
|-----------|-------|
| **Path** | `forecast.forecast_horizon` |
| **Type** | `integer` |
| **Default** | `12` |
| **Description** | Number of steps to forecast into the future. |
| **Example** | `forecast_horizon: 12` |
| **NEW** | No |

### forecast.anomaly_threshold

| Attribute | Value |
|-----------|-------|
| **Path** | `forecast.anomaly_threshold` |
| **Type** | `float` (standard deviations) |
| **Default** | `3.0` |
| **Description** | Z-score threshold for anomaly detection. If an observed metric deviates from the forecast by more than this many standard deviations, an anomaly is triggered. |
| **Example** | `anomaly_threshold: 3.0` |
| **NEW** | No |

### forecast.debounce_ms

| Attribute | Value |
|-----------|-------|
| **Path** | `forecast.debounce_ms` |
| **Type** | `integer` (milliseconds) |
| **Default** | `250` |
| **Description** | Minimum interval between forecast evaluations. Prevents excessive compute during rapid event bursts. |
| **Example** | `debounce_ms: 250` |
| **NEW** | No |

### forecast.adaptive_debounce

| Attribute | Value |
|-----------|-------|
| **Path** | `forecast.adaptive_debounce` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | When `true`, the debounce interval is dynamically adjusted based on event throughput (higher volume = longer debounce). When `false`, uses the fixed `debounce_ms`. |
| **Example** | `adaptive_debounce: true` |
| **NEW** | No |

### forecast.max_tracked_elements

| Attribute | Value |
|-----------|-------|
| **Path** | `forecast.max_tracked_elements` |
| **Type** | `integer` |
| **Default** | `500` |
| **Description** | Maximum number of distinct elements tracked in the forecast system. Older/less-frequently-updated elements are evicted when the limit is reached. |
| **Example** | `max_tracked_elements: 500` |
| **NEW** | No |

### forecast.anomaly_action

| Attribute | Value |
|-----------|-------|
| **Path** | `forecast.anomaly_action` |
| **Type** | `string` (enum) |
| **Valid Values** | `"warn"`, `"deny"`, `"pause"`, `"log_only"` |
| **Default** | `"warn"` |
| **Description** | Action to take when an anomaly is detected. `warn` logs a warning and continues. `deny` rejects the anomalous mutation. `pause` temporarily halts the mutation pipeline. `log_only` logs the anomaly without any further action. |
| **Example** | `anomaly_action: "warn"` |
| **NEW** | No |

---

## 19. perception

Perceptual temporal governance - adaptive user-interaction profiles that constrain agent behaviour based on observed user patterns.

```yaml
perception:
 enabled: true
 enable_adaptive_profiles: true
 profile_learning_rate: 0.15
 profile_erosion_half_life_ms: 604800000
 min_interactions_for_profile: 5
 hard_violation_action: "clamp"
 soft_violation_action: "clamp"
 governed_envelope_mode: "overwrite"
 modality_overrides: {}
 rego_policy_path: "./policies/perception-policy.rego"
```

### perception.enabled

| Attribute | Value |
|-----------|-------|
| **Path** | `perception.enabled` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | Master switch for perceptual temporal governance. When `true`, user interaction profiles are built and enforced. |
| **Example** | `enabled: true` |
| **NEW** | No |

### perception.enable_adaptive_profiles

| Attribute | Value |
|-----------|-------|
| **Path** | `perception.enable_adaptive_profiles` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | When `true`, user profiles are continuously adapted based on new interactions. When `false`, profiles are static once built. |
| **Example** | `enable_adaptive_profiles: true` |
| **NEW** | No |

### perception.profile_learning_rate

| Attribute | Value |
|-----------|-------|
| **Path** | `perception.profile_learning_rate` |
| **Type** | `float` (0.0 - 1.0) |
| **Default** | `0.15` |
| **Description** | Weight given to new interactions when updating a profile. Higher values make profiles more responsive to recent behaviour. |
| **Example** | `profile_learning_rate: 0.15` |
| **NEW** | No |

### perception.profile_erosion_half_life_ms

| Attribute | Value |
|-----------|-------|
| **Path** | `perception.profile_erosion_half_life_ms` |
| **Type** | `integer` (milliseconds) |
| **Default** | `604800000` (7 days) |
| **Description** | Half-life for profile decay. Profile entries lose half their weight after this period of inactivity, allowing the profile to "forget" outdated patterns. |
| **Example** | `profile_erosion_half_life_ms: 604800000` |
| **NEW** | No |

### perception.min_interactions_for_profile

| Attribute | Value |
|-----------|-------|
| **Path** | `perception.min_interactions_for_profile` |
| **Type** | `integer` |
| **Default** | `5` |
| **Description** | Minimum number of user interactions required before a profile is considered mature enough for enforcement. Below this threshold, perception governance is not applied. |
| **Example** | `min_interactions_for_profile: 5` |
| **NEW** | No |

### perception.hard_violation_action

| Attribute | Value |
|-----------|-------|
| **Path** | `perception.hard_violation_action` |
| **Type** | `string` (enum) |
| **Valid Values** | `"clamp"`, `"deny"`, `"warn"`, `"log_only"` |
| **Default** | `"clamp"` |
| **Description** | Action for hard violations (mutation values that far exceed the user's envelope). `clamp` caps the value to the envelope boundary. `deny` rejects the mutation. |
| **Example** | `hard_violation_action: "clamp"` |
| **NEW** | No |

### perception.soft_violation_action

| Attribute | Value |
|-----------|-------|
| **Path** | `perception.soft_violation_action` |
| **Type** | `string` (enum) |
| **Valid Values** | `"clamp"`, `"deny"`, `"warn"`, `"log_only"` |
| **Default** | `"clamp"` |
| **Description** | Action for soft violations (mutation values that modestly exceed the user's envelope). |
| **Example** | `soft_violation_action: "clamp"` |
| **NEW** | No |

### perception.governed_envelope_mode

| Attribute | Value |
|-----------|-------|
| **Path** | `perception.governed_envelope_mode` |
| **Type** | `string` (enum) |
| **Valid Values** | `"overwrite"`, `"accumulate"`, `"replace"` |
| **Default** | `"overwrite"` |
| **Description** | How the perceived envelope is applied. `overwrite` replaces the existing envelope with the new one. `accumulate` merges new observations into the existing envelope. `replace` requires a full rebuild. |
| **Example** | `governed_envelope_mode: "overwrite"` |
| **NEW** | No |

### perception.modality_overrides

| Attribute | Value |
|-----------|-------|
| **Path** | `perception.modality_overrides` |
| **Type** | `map[string]any` |
| **Default** | `{}` |
| **Description** | Per-modality overrides for perception envelope parameters. Keys are modality names (e.g., `"position"`, `"size"`, `"color"`). Values are partial envelope configs. Empty means no overrides. |
| **Example** | `modality_overrides: {}` |
| **NEW** | No |

### perception.rego_policy_path

| Attribute | Value |
|-----------|-------|
| **Path** | `perception.rego_policy_path` |
| **Type** | `string` (file path) |
| **Default** | `"./policies/perception-policy.rego"` |
| **Description** | Path to the Rego policy file for perception-domain evaluation. May be the same as `rego.policy_path` or a separate file. |
| **Example** | `rego_policy_path: "./policies/perception-policy.rego"` |
| **NEW** | No |

---

## 20. lattice_memory

Attractor-based similarity memory that stores and retrieves past action/event patterns using LSH (Locality-Sensitive Hashing).

```yaml
lattice_memory:
 enabled: true
 max_attractors: 2000
 similarity_threshold: 0.95
 index_type: "lsh"
 lsh_tables: 8
 lsh_hash_dimension: 4
```

### lattice_memory.enabled

| Attribute | Value |
|-----------|-------|
| **Path** | `lattice_memory.enabled` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | Master switch for lattice memory (pattern storage and retrieval). When `true`, past actions/events are stored as attractors for similarity matching. |
| **Example** | `enabled: true` |
| **NEW** | No |

### lattice_memory.max_attractors

| Attribute | Value |
|-----------|-------|
| **Path** | `lattice_memory.max_attractors` |
| **Type** | `integer` |
| **Default** | `2000` |
| **Description** | Maximum number of attractors retained in the memory store. When exceeded, the oldest/least-frequently-accessed attractors are evicted. |
| **Example** | `max_attractors: 2000` |
| **NEW** | No |

### lattice_memory.similarity_threshold

| Attribute | Value |
|-----------|-------|
| **Path** | `lattice_memory.similarity_threshold` |
| **Type** | `float` (0.0 - 1.0) |
| **Default** | `0.95` |
| **Description** | Cosine-similarity threshold for considering two patterns a match. Higher values require closer matches. |
| **Example** | `similarity_threshold: 0.95` |
| **NEW** | No |

### lattice_memory.index_type

| Attribute | Value |
|-----------|-------|
| **Path** | `lattice_memory.index_type` |
| **Type** | `string` (enum) |
| **Valid Values** | `"lsh"`, `"flat"`, `"hnsw"` |
| **Default** | `"lsh"` |
| **Description** | Index data structure for similarity search. `lsh` uses Locality-Sensitive Hashing (fast, approximate). `flat` does brute-force search (exact, slower). `hnsw` uses Hierarchical Navigable Small World graphs. |
| **Example** | `index_type: "lsh"` |
| **NEW** | No |

### lattice_memory.lsh_tables

| Attribute | Value |
|-----------|-------|
| **Path** | `lattice_memory.lsh_tables` |
| **Type** | `integer` |
| **Default** | `8` |
| **Description** | Number of LSH hash tables. More tables increase recall at the cost of memory. Only used when `index_type: "lsh"`. |
| **Example** | `lsh_tables: 8` |
| **NEW** | No |

### lattice_memory.lsh_hash_dimension

| Attribute | Value |
|-----------|-------|
| **Path** | `lattice_memory.lsh_hash_dimension` |
| **Type** | `integer` |
| **Default** | `4` |
| **Description** | Number of hash functions per LSH table (hash key length). Higher values increase selectivity. Only used when `index_type: "lsh"`. |
| **Example** | `lsh_hash_dimension: 4` |
| **NEW** | No |

---

## 21. temporal_authority

Audit-trail depth and mutation tracking for the temporal authority subsystem.

```yaml
temporal_authority:
 audit_trail_depth: 500
 mutation_tracking_enabled: true
 staleness_broadcast_interval_ms: 10000
```

### temporal_authority.audit_trail_depth

| Attribute | Value |
|-----------|-------|
| **Path** | `temporal_authority.audit_trail_depth` |
| **Type** | `integer` |
| **Default** | `500` |
| **Description** | Maximum number of audit-trail entries retained. Older entries are pruned when this limit is exceeded. |
| **Example** | `audit_trail_depth: 500` |
| **NEW** | No |

### temporal_authority.mutation_tracking_enabled

| Attribute | Value |
|-----------|-------|
| **Path** | `temporal_authority.mutation_tracking_enabled` |
| **Type** | `boolean` |
| **Default** | `true` |
| **Description** | When `true`, every mutation is recorded in the temporal audit trail with a timestamp, causal metadata and the mutation payload. |
| **Example** | `mutation_tracking_enabled: true` |
| **NEW** | No |

### temporal_authority.staleness_broadcast_interval_ms

| Attribute | Value |
|-----------|-------|
| **Path** | `temporal_authority.staleness_broadcast_interval_ms` |
| **Type** | `integer` (milliseconds) |
| **Default** | `10000` |
| **Description** | Interval at which the temporal authority broadcasts the current staleness summary to connected agents. |
| **Example** | `staleness_broadcast_interval_ms: 10000` |
| **NEW** | No |

---

## Schema Validation

The config file is validated on startup against the internal schema revision (`schema_revision: 3`).
If a field is missing, has the wrong type or an enum value is invalid, the engine logs a
descriptive error and, depending on `validation.mode`, either halts or falls back to defaults.

### Migration Notes (v0.4 → v1.0)

| Change | Details |
|--------|---------|
| **New section: `lattice`** | Entirely new. The old v0.4 configs did not have this. Default governance is `"filter_all"`. |
| **New top-level fields** | `dynaep_version`, `schema_revision`. |
| **New sub-fields** | `rego.separate_policy_paths.lattice`, `logging.log_lattice_events`. |
| **Removed fields** | `lattice.enabled` and `lattice.filter_mode` do NOT exist. Do not use them. |
| **`themes`** | Previously optional; now recommended. The engine falls back to `aep_sources.theme` if `themes.active` is invalid. |

---

*Documentation generated from the canonical config schema. Source template:*
`AEP-Components/dynAEP/dynaep-config.yaml`
