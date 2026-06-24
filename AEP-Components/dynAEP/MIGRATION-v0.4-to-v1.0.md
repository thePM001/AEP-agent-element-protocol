# Migration Guide: dynAEP v0.4 to v1.0

**Date:** June 2026
**Target Version:** dynAEP 1.0 (lattice-based event governance)
**Source Version:** dynAEP v0.4 (TA-3 Durable Temporal Authority)

This guide covers the upgrade from dynAEP v0.4 (Durable Temporal Authority,
164-test release) to dynAEP v1.0 (Action Lattice universal event governance).
Read the entire guide before starting your migration. Estimated total effort
for a standard deployment: 2-4 hours.

---

## Table of Contents

1. What Changed Between v0.4 and v1.0
2. Breaking Changes
3. New Features
4. Upgrade Steps (Step by Step)
5. Verification
6. Rollback

---

## 1. What Changed Between v0.4 and v1.0

### Summary

dynAEP v0.4 shipped as "TA-3 Durable Temporal Authority" - the last release
before the 1.0 milestone. It gave you temporal authority (BridgeClock, drift
checking, TIM clock quality), perceptual temporal governance (TA-2), causal
ordering with durable state and a suite of performance optimisations (parallel
chain execution, unified Rego evaluator, Aho-Corasick scanners, buffered
ledgers, TimesFM sidecar decoupling).

dynAEP v1.0 introduces the **Action Lattice** - a partial-order DAG that
governs every event that enters or leaves the agent system. The lattice sits
at the top of the validation pipeline, before temporal authority, before
structural validation, before perception governance. Every event that fails
lattice checks never reaches the downstream pipeline. This extends governance
from "UI mutations only" to "every event: webhooks, blockchain, email, sensors,
agent actions, system events, outputs."

### What Stayed the Same

- Temporal Authority (TA-1: BridgeClock, drift/staleness, sync hierarchy)
- Perceptual Temporal Governance (TA-2: perception registry, adaptive profiles)
- Causal Ordering (vector clocks, reorder buffer, conflict resolution, durable
 state)
- Bridge Recovery Protocol (three-phase restart)
- AEP scene graph validation (structure, behaviour, skin mutations)
- Rego/OPA policy evaluation
- Content scanners (Aho-Corasick, unified scanner)
- Chain execution modes (parallel/sequential)
- Python SDK (`dynaep` package) - unchanged API surface
- Approximate policy, ID minting, theme system, conflict resolution

### What Changed

| Area | v0.4 | v1.0 |
|-----------------------|-------------------------------------|------------------------------------------|
| Core governance | UI-only (AEP scene graph) | All events (Action Lattice) |
| Config format | No `lattice:` section | New `lattice:` section required |
| New required file | None | `registries/aep-lattice.yaml` |
| New required file | None | `aep-registration.yaml` |
| New required file | None | `policies/lattice-policy.rego` |
| Event types | AEP_MUTATE_*, AEP_QUERY, temporal | + LATTICE_EVENT, LATTICE_FILTER_RESULT, |
| | | LATTICE_REGISTER |
| Observer adapters | None (events injected directly) | Pluggable Webhook/SSE/Poll/Blockchain |
| Validation hooks | Hard-coded constraint checks | Pluggable ValidationHook interface |
| SDK (TypeScript) | Not published | `@dynaep/core` with LatticeFilter |
| Registration manifest | None | `aep-registration.yaml` (7 components) |
| File count | ~30 files | ~55 files (+22 new, -5 removed) |
| Lines of code | ~7,500 | ~12,000 |

### Git Delta

```
22 files changed, 6105 insertions(+), 1338 deletions(-)
```

Key commits:
- `4ced79d` - Action Lattice universal event governance
- `54eade5` - AEP registration for all 7 components

---

## 2. Breaking Changes

### 2.1 Config Format: New `lattice:` Section

**v0.4** `dynaep-config.yaml` had no lattice section. The top-level keys were:

```yaml
aep_version: "1.1"
dynaep_version: "0.4"
transport:
aep_sources:
validation:
rego:
chain_execution:
runtime_reflection:
approval_policy:
conflict_resolution:
id_minting:
themes:
tools:
logging:
timekeeping:
causal_ordering:
forecast:
perception:
lattice_memory:
temporal_authority:
```

**v1.0** requires:

```yaml
aep_version: "1.2" # bumped from 1.1
dynaep_version: "1.0" # bumped from 0.4
schema_revision: 3 # bumped from 2

lattice: # NEW - required section
 registry: "./registries/aep-lattice.yaml"
 governance: "filter_all" # filter_all | events_only | ui_only | disabled
 agent_interest_enabled: true
 hook: "mle"
```

**Action required:** Add the `lattice:` key. Set `governance` to `ui_only`
during migration (matches v0.4 behaviour), then switch to `filter_all` after
you have verified your lattice definitions.

### 2.2 New Required Files

These files did not exist in v0.4 and the bridge WILL NOT START without them:

1. **`registries/aep-lattice.yaml`** - The Action Lattice definition.
 Contains all system actions, partial-order parents/children, constraints,
 and trust floors. See section 2.3 for the minimum viable lattice.

2. **`aep-registration.yaml`** - Component registration manifest.
 Declares all dynAEP 1.0 components (lattice, hooks, observers, SDK, etc.)
 with trust floors, locations and interface signatures.

3. **`policies/lattice-policy.rego`** - OPA/Rego rules for trust tier
 enforcement, forbidden sequences, rate limiting and cross-modality
 ceilings. If you use Rego bundles, add this to your bundle build.

### 2.3 Minimum Viable Lattice for v0.4 Compatibility

If you want the v1.0 bridge to behave exactly like v0.4 (UI-only governance
with no lattice filtering), create this minimal lattice file:

```yaml
aep_version: "1.2"
dynaep_version: "1.0"
lattice_revision: 1

actions: {}
```

AND set `governance: "ui_only"` in your config. This skips lattice filtering
entirely and routes all events through the existing AEP scene graph pipeline
just like v0.4. You can expand the lattice incrementally (see section 4 steps
6-8).

### 2.4 Observer Adapters Replace Direct Event Injection

**v0.4** pattern: Events were injected directly into the bridge via
`bridge.process_event()` or the AG-UI middleware.

**v1.0** pattern: External events MUST go through an `ObserverAdapter` that
normalises them into `LatticeEvent` format. The adapters handle signature
verification, rate limiting and reconnection. The Python SDK's
`process_event()` still works for events that arrive through the SDK, but
external sources (webhooks, blockchain, email, sensors) must use adapters.

**Migration path:** The Python SDK bridge still accepts `dict` events for
backward compatibility. You can migrate adapters incrementally. The Python
SDK's `process_event()` will transparently handle lattice validation once
the config points to a valid lattice file.

### 2.5 Event Type Changes

The event `type` field now carries an additional `dynaep_type` envelope:

```json
{
 "type": "CUSTOM",
 "dynaep_type": "LATTICE_EVENT", // NEW
 "source": "webhook:stripe",
 "action_path": "webhook:incoming",
 "payload": {}
}
```

All existing v0.4 event types still work (`AEP_MUTATE_STRUCTURE`,
`AEP_MUTATE_BEHAVIOUR`, `AEP_MUTATE_SKIN`, `AEP_QUERY`, `AEP_CLOCK_SYNC`,
`AEP_TEMPORAL_STAMP`, `DYNAEP_TEMPORAL_REJECTION`, `DYNAEP_CAUSAL_VIOLATION`,
etc.). The bridge routes them through the lattice filter first, then passes
them to the existing v0.4 handlers.

### 2.6 Trust Tiers Are Now Enforced

v0.4 had no trust tier system. v1.0 introduces trust tiers (1-5) that are
enforced on every event:

- Tier 1: external events (webhooks, blockchain, email, sensors)
- Tier 2: registered agents (agent actions, UI mutations)
- Tier 3: trusted agents (classification, analysis)
- Tier 4: high-trust agents (email review, shutdown)
- Tier 5: maximum trust (trade proposal, execution)

Every lattice node has a `trust_floor`. Events from agents below the floor
are rejected. Review your agent trust assignments before upgrading.

### 2.7 Python SDK: No Breaking API Changes

The Python SDK (`AEP-SDKs/python/dynaep/`) has NO API
changes. The `DynAEPBridge`, `DynAEPBridgeConfig`, `process_event()`,
`handle_tool_call()` and `create_ag_ui_middleware()` APIs are identical.
The bridge validates against the lattice transparently based on the config.

Your existing Python agent code will work without modification. The lattice
validation runs inside the bridge before the existing v0.4 pipeline.

---

## 3. New Features

### 3.1 Action Lattice (Core Innovation)

The Action Lattice is a partial-order DAG of every action the system can
perform. Each action has:

- **path** - dot-delimited identifier (e.g. `market:trade:execute`)
- **category** - `external_event`, `system_event`, `agent_action`, `output`
- **parents** - list of action paths that must be satisfied first
- **children** - list of action paths that may follow
- **constraints** - validation gates (required_field, threshold, authorization,
 custom)
- **trust_floor** - minimum agent trust tier (1-5)

The bridge validates every incoming event against the lattice:

1. Lattice membership - does the action path exist?
2. Trust floor check - does the agent have sufficient trust?
3. Partial order - have all parent actions occurred?
4. Constraint evaluation - required fields, thresholds, authorization
5. Custom hooks - pluggable validators
6. Agent interest - which agents watch this path?
7. Next actions - which children may follow?

### 3.2 Observer Adapters

Five built-in adapters for external event ingestion:

- **WebhookAdapter** - HTTP POST receiver with HMAC/RSA/Ed25519 verification
- **SSEAdapter** - Server-Sent Events consumer with auto-reconnect
- **PollAdapter** - REST API poller with diff-based change detection
- **BlockchainAdapter** - Ethereum/Solana event log poller (example)
- **EmailAdapter** - IMAP/SMTP email monitor (interface only)

All adapters normalise native events into `LatticeEvent` format. The adapter
interface is pluggable - implement `ObserverAdapter` to add custom sources.

### 3.3 Validation Hooks

Pluggable validation modules that inspect a `LatticeEvent` against a
`LatticeNode` and return a pass/fail verdict with score and confidence.

- **Hook Registry** - manages registered hooks by name
- **MLE Hook** (reference implementation) - hypervector similarity checking
 using attractor indexing
- **Noop Hook** - pass-through for testing

Custom hooks can be async (supporting network I/O, WASM, external services)
and can modify the event payload via `adjustments`.

### 3.4 Agent Interest Registry

Agents declare interest in lattice paths using glob patterns. Three
notification modes:

- **wake** - immediately trigger the agent
- **queue** - store for later retrieval
- **log** - just record, no delivery

Rate limiting per agent is supported. Registrations go through the lattice
filter themselves (must match `agent:interest:register`).

### 3.5 Lattice Event Types

Three new event types for lattice governance:

- **LATTICE_EVENT** - canonical event shape flowing through the bridge
- **LATTICE_FILTER_RESULT** - structured verdict from the lattice filter
- **LATTICE_REGISTER** - agent interest registration

### 3.6 TypeScript SDK (`@dynaep/core`)

New TypeScript SDK with full lattice integration:

- `LatticeFilter` - core validation engine
- `ActionLattice` - lattice data structure with upper/lower set traversal
- `PathMatcher` - glob matching (exact, single-segment, multi-segment)
- `AgentInterestRegistry` - interest management
- `HookRegistry` - hook management
- `LatticeEvent`, `LatticeFilterResult`, `LatticeRegister` type definitions

### 3.7 Component Registration Manifest

`aep-registration.yaml` declares all 7 dynAEP 1.0 components with their
trust floors, locations and interface signatures. This provides a
machine-readable inventory of the protocol stack for tooling and auditing.

---

## 4. Upgrade Steps (Step by Step)

### Phase 1: Preparation (Read-Only)

**Step 1: Audit your current v0.4 deployment**

```bash
# Check your current config
cd /root/dynAEP
cat dynaep-config.yaml | head -5
# Expected: dynaep_version: "0.4"

# List your existing files
find . -name "*.yaml" -o -name "*.rego" | sort

# Count current version stats
git log --oneline v0.4...HEAD 2>/dev/null || git log --oneline | head -5
```

**Step 2: Read the diff**

```bash
git diff 46da843..54eade5 --stat
```

This shows exactly which files changed. Note any custom files you maintain
that appear in the diff.

**Step 3: Backup your config**

```bash
cp dynaep-config.yaml dynaep-config.yaml.v0.4-backup
cp -r registries registries.v0.4-backup
cp -r policies policies.v0.4-backup
```

### Phase 2: Config Migration

**Step 4: Update `dynaep-config.yaml`**

Make these changes to your config:

a) Bump version fields:
 - `aep_version: "1.1"` -> `aep_version: "1.2"`
 - `dynaep_version: "0.4"` -> `dynaep_version: "1.0"`
 - `schema_revision: 2` -> `schema_revision: 3`

b) Add the `lattice:` section (required):

```yaml
lattice:
 registry: "./registries/aep-lattice.yaml"
 governance: "ui_only" # start with ui_only, switch later
 agent_interest_enabled: false # start disabled, enable later
 hook: "noop" # use noop during migration
```

c) Add logging for lattice events if desired:

```yaml
logging:
 log_lattice_events: true # NEW - recommended during migration
```

d) Add the `rego.lattice` policy path:

```yaml
rego:
 separate_policy_paths:
 lattice: "./policies/lattice-policy.rego" # NEW
```

**Step 5: Verify the config**

```bash
python3 -c "
import yaml
with open('dynaep-config.yaml') as f:
 cfg = yaml.safe_load(f)
assert cfg['dynaep_version'] == '1.0', 'Wrong version'
assert 'lattice' in cfg, 'Missing lattice section'
assert 'registry' in cfg['lattice'], 'Missing lattice.registry'
print('Config looks valid')
"
```

### Phase 3: Create Required Files

**Step 6: Create the minimum viable lattice**

```bash
cat > registries/aep-lattice.yaml << 'EOF'
aep_version: "1.2"
dynaep_version: "1.0"
lattice_revision: 1

actions: {}
EOF
```

With `governance: "ui_only"`, the empty lattice is valid and the bridge
will behave like v0.4.

**Step 7: Create the registration manifest**

```bash
cat > aep-registration.yaml << 'REGEOF'
aep_version: "1.2"
schema_revision: 1

dynAEP-lattice:
 label: "Action Lattice Filter"
 category: governance
 description: "Partial-order DAG event validation"
 trust_floor: 2
 version: "1.0.0"
 location: "bridge/lattice/index.ts"
 dependencies: []
 interfaces:
 - "LatticeFilter.filter(event) -> LatticeFilterResult"

dynAEP-hooks:
 label: "Validation Hook Interface"
 category: governance
 trust_floor: 1
 version: "1.0.0"
 location: "hooks/interface.ts"
 dependencies: ["dynAEP-lattice"]
 interfaces:
 - "ValidationHook.validate(event, lattice, node) -> HookResult"

dynAEP-observers:
 label: "Observer Adapter Layer"
 category: integration
 trust_floor: 1
 version: "1.0.0"
 location: "observers/"
 dependencies: []
 interfaces:
 - "ObserverAdapter.start() -> Promise<void>"
 - "ObserverAdapter.onEvent(callback) -> void"
 - "ObserverAdapter.stop() -> Promise<void>"

dynAEP-lattice-registry:
 label: "Action Lattice Registry"
 category: configuration
 trust_floor: 1
 version: "1.0.0"
 location: "registries/aep-lattice.yaml"
 dependencies: ["dynAEP-lattice"]

dynAEP-mle-hook:
 label: "MLE Validation Hook (Reference)"
 category: validation
 trust_floor: 2
 version: "1.0.0"
 location: "hooks/examples/mle-hook/index.ts"
 dependencies: ["dynAEP-hooks"]

dynAEP-lattice-policy:
 label: "Lattice Rego Policy"
 category: policy
 trust_floor: 1
 version: "1.0.0"
 location: "policies/lattice-policy.rego"
 dependencies: ["dynAEP-lattice"]

dynAEP-sdk:
 label: "TypeScript SDK (Lattice Integration)"
 category: sdk
 trust_floor: 1
 version: "1.0.0"
 location: "AEP-SDKs/typescript/dynaep/src/bridge.ts"
 dependencies: ["dynAEP-lattice"]
REGEOF
```

**Step 8: Create the lattice policy (empty with ui_only mode)**

```bash
cat > policies/lattice-policy.rego << 'REGOEOF'
package dynaep.lattice

default allow = true
REGOEOF
```

### Phase 4: Migrate Your Custom Lattice

**Step 9: Define your event actions (if using filter_all mode)**

If you want to use full lattice governance, populate the lattice based on
your system's actions. Start with external events and system events, then
add agent actions:

```bash
# Example: Start with external event actions
cat > registries/aep-lattice.yaml << 'LATTICEEOF'
aep_version: "1.2"
dynaep_version: "1.0"
lattice_revision: 1

actions:
 webhook:incoming:
 label: "Webhook received"
 category: external_event
 parents: []
 children: [webhook:validate]
 constraints:
 - type: required_field
 field: signature
 trust_floor: 1

 webhook:validate:
 label: "Validate webhook payload"
 category: system_event
 parents: [webhook:incoming]
 children: [action:route]
 constraints: []
 trust_floor: 2

 action:route:
 label: "Route event to agents"
 category: system_event
 parents: [webhook:validate]
 children: [output:notify]
 constraints:
 - type: required_field
 field: matched_agents
 trust_floor: 1

 output:notify:
 label: "Send notification"
 category: output
 parents: [action:route]
 children: []
 constraints: []
 trust_floor: 1

 output:ui_mutation:
 label: "UI scene graph mutation"
 category: output
 parents: [action:route]
 children: []
 constraints:
 - type: required_field
 field: element_id
 - type: required_field
 field: mutation
 trust_floor: 2
LATTICEEOF
```

See `registries/aep-lattice.yaml` (full version in the repository) for a
complete lattice covering webhooks, blockchain, email, sensors, system
startup/shutdown, agent registration, email workflow, market trading, and
all output types.

**Step 10: Switch governance mode**

Once your lattice is defined, change `governance` from `ui_only` to
`filter_all` in `dynaep-config.yaml`:

```yaml
lattice:
 governance: "filter_all" # was "ui_only"
```

### Phase 5: Enable New Features (Optional)

**Step 11: Enable agent interest registration**

```yaml
lattice:
 agent_interest_enabled: true # was false
```

This allows agents to register interest in lattice paths via
LATTICE_REGISTER events. The `agent:interest:register` action path must
exist in your lattice.

**Step 12: Enable the MLE validation hook (optional)**

```yaml
lattice:
 hook: "mle" # was "noop"
```

The MLE hook uses attractor indexing to score events against learned
patterns. Requires a trained attractor index (see hooks README).

**Step 13: Enable observer adapters (optional)**

Add observer adapters for external event sources:

```typescript
import { WebhookObserverAdapter } from "./observers/webhook";

const adapter = new WebhookObserverAdapter({
 port: 9000,
 endpoint: "/events",
});

adapter.onEvent((event) => {
 bridge.processLatticeEvent(event);
});

await adapter.start();
```

### Phase 6: Test

**Step 14: Run the test suite**

```bash
cd /root/dynAEP
python3 -m pytest sdk/python/tests/ -v 2>&1 | tail -20
```

All v0.4 tests should pass. New lattice tests are in `bridge/lattice/`.

**Step 15: Check the performance benchmarks**

```bash
cat performance-tests/current.json | python3 -m json.tool | head -30
```

Compare with `performance-tests/baseline.json` to check for regressions.

**Step 16: Validate the lattice**

```bash
python3 -c "
import yaml

with open('registries/aep-lattice.yaml') as f:
 lattice = yaml.safe_load(f)

actions = lattice.get('actions', {})
print(f'Lattice has {len(actions)} action nodes')

# Check for cycles (basic DAG validation)
visited = set()
path_stack = set()

def has_cycle(path):
 if path in path_stack:
 return True
 if path in visited:
 return False
 visited.add(path)
 path_stack.add(path)
 node = actions.get(path)
 if node:
 for child in node.get('children', []):
 if has_cycle(child):
 return True
 path_stack.remove(path)
 return False

for action_path in actions:
 if not has_cycle(action_path):
 print(f' DAG check: {action_path} - OK')
 else:
 print(f' DAG check: {action_path} - CYCLE DETECTED')
"
```

---

## 5. Verification

### 5.1 Smoke Tests

Run these checks after migration:

```bash
# 1. Config loads without errors
python3 -c "
from dynaep.bridge import DynAEPBridge
from dynaep import AEPConfig
import yaml

with open('dynaep-config.yaml') as f:
 cfg = yaml.safe_load(f)

# Should see lattice section
assert 'lattice' in cfg, 'Missing lattice section'
assert cfg['dynaep_version'] == '1.0', 'Wrong version'
print('Config load: OK')
"

# 2. Lattice file is valid YAML and has required fields
python3 -c "
import yaml
with open('registries/aep-lattice.yaml') as f:
 data = yaml.safe_load(f)
assert 'aep_version' in data, 'Missing aep_version'
assert 'dynaep_version' in data, 'Missing dynaep_version'
assert 'actions' in data, 'Missing actions'
print('Lattice file: OK')
"

# 3. Registration manifest is valid
python3 -c "
import yaml
with open('aep-registration.yaml') as f:
 data = yaml.safe_load(f)
assert len(data) >= 7, 'Expected 7+ components'
print(f'Registration: {len(data)-2} components registered')
"

# 4. Lattice policy is valid Rego
# (requires opa CLI)
which opa >/dev/null 2>&1 && opa check policies/lattice-policy.rego && echo "Rego: OK"
```

### 5.2 Behavioural Verification

Test that the bridge still processes v0.4 events correctly:

```python
from dynaep import AEPConfig, DynAEPBridge, DynAEPBridgeConfig

# Load your existing AEP config (v0.4 format)
config = AEPConfig.from_yaml("registries/aep-registry.yaml")
bridge = DynAEPBridge(config, DynAEPBridgeConfig())

# Test a standard v0.4 mutation event
event = {
 "type": "STATE_DELTA",
 "delta": [
 {"path": "/elements/CP-00001/visible", "value": False}
 ]
}
result = bridge.process_event(event)
assert not isinstance(result, DynAEPRejection), \
 f"Unexpected rejection: {result.error}"
print("v0.4 event processing: OK")
```

Test that lattice validation works (with filter_all mode):

```python
# This event has no lattice node -> should be rejected
event = {
 "type": "CUSTOM",
 "dynaep_type": "LATTICE_EVENT",
 "source": "unknown",
 "action_path": "nonexistent:path",
 "payload": {}
}
result = bridge.process_event(event)
# With filter_all, this should fail
print(f"Unknown action path: {'rejected (expected)' if hasattr(result, 'error') else 'accepted'}")
```

### 5.3 Performance Check

```bash
# Compare latency
python3 -c "
import time
from dynaep import AEPConfig, DynAEPBridge

config = AEPConfig.from_yaml('registries/aep-registry.yaml')
bridge = DynAEPBridge(config)

event = {
 'type': 'STATE_DELTA',
 'delta': [{'path': '/elements/CP-00001/visible', 'value': True}]
}

# Warmup
for _ in range(100):
 bridge.process_event(event)

# Measure
start = time.perf_counter()
for _ in range(1000):
 bridge.process_event(event)
elapsed = time.perf_counter() - start

print(f'1000 events in {elapsed*1000:.1f}ms ({elapsed:.1f}us per event)')
"
```

Expected: sub-millisecond per event (same as v0.4). Lattice validation adds
~10-50us per event for typical lattices.

### 5.4 Verify Rollback Readiness

```bash
# Ensure your backup is intact
ls -la dynaep-config.yaml.v0.4-backup
ls -la registries.v0.4-backup/aep-lattice.yaml 2>/dev/null || \
 echo "No old lattice (expected - it's new in v1.0)"
```

---

## 6. Rollback

If you need to revert to v0.4, follow these steps:

### 6.1 Rollback via Backup

```bash
cd /root/dynAEP

# Restore config
cp dynaep-config.yaml.v0.4-backup dynaep-config.yaml

# Restore registries
cp -r registries.v0.4-backup/* registries/
cp -r policies.v0.4-backup/* policies/

# Remove v1.0-only files
rm -f registries/aep-lattice.yaml
rm -f aep-registration.yaml
rm -f policies/lattice-policy.rego

# Verify version
grep dynaep_version dynaep-config.yaml
# Should show: dynaep_version: "0.4"
```

### 6.2 Rollback via Git

```bash
cd /root/dynAEP
git checkout 46da843 -- dynaep-config.yaml registries/ policies/
```

This reverts the config, registries and policies to their v0.4 state.
Note: this also reverts any lattice files you created (they will be
removed from the working tree).

### 6.3 Post-Rollback Verification

```bash
# Run the v0.4 test suite
python3 -m pytest sdk/python/tests/ -v 2>&1 | grep -E "passed|failed|ERROR"

# Verify config
grep dynaep_version dynaep-config.yaml
# Must show: dynaep_version: "0.4"

# Check no v1.0-only files remain
ls aep-registration.yaml 2>/dev/null && echo "WARNING: v1.0 file still present" \
 || echo "Clean rollback"
ls registries/aep-lattice.yaml 2>/dev/null && echo "WARNING: v1.0 file still present" \
 || echo "Clean rollback"
```

### 6.4 When to NOT Rollback

Do NOT rollback if:

- You have already deployed observer adapters that depend on the
 `ObserverAdapter` interface (it does not exist in v0.4).
- You have agents that depend on trust tier enforcement (v0.4 has no trust
 tier system).
- You have committed to the LATTICE_EVENT / LATTICE_FILTER_RESULT event
 format in downstream consumers.
- You have TypeScript code using `@dynaep/core` (it was not published for
 v0.4).

In these cases, instead of rolling back, set `governance: "ui_only"` and
`agent_interest_enabled: false` to disable lattice features while keeping
the v1.0 infrastructure in place.

### 6.5 Rollback Safety Checklist

| Check | Command | Expected |
|-------------------------------|------------------------------------------------------|------------------|
| Config version | `grep dynaep_version dynaep-config.yaml` | `"0.4"` |
| No lattice section | `grep -A5 '^lattice:' dynaep-config.yaml` | No output |
| No aep-lattice.yaml | `ls registries/aep-lattice.yaml 2>&1` | No such file |
| No aep-registration.yaml | `ls aep-registration.yaml 2>&1` | No such file |
| No lattice-policy.rego | `ls policies/lattice-policy.rego 2>&1` | No such file |
| Old backup intact | `ls dynaep-config.yaml.v0.4-backup` | File exists |
| Tests pass | `python3 -m pytest sdk/python/tests/ -q` | All passed |

---

## Appendix: Quick Reference

### Config Diff (v0.4 -> v1.0)

```diff
-aep_version: "1.1"
-dynaep_version: "0.4"
-schema_revision: 2
+aep_version: "1.2"
+dynaep_version: "1.0"
+schema_revision: 3

+ lattice:
+ registry: "./registries/aep-lattice.yaml"
+ governance: "filter_all"
+ agent_interest_enabled: true
+ hook: "mle"
+
 logging:
+ log_lattice_events: true
```

### File Inventory: New in v1.0

```
bridge/lattice/index.ts - LatticeFilter, ActionLattice, PathMatcher
aep-registration.yaml - Component registration manifest
registries/aep-lattice.yaml - Action Lattice definitions
hooks/interface.ts - ValidationHook interface
hooks/examples/mle-hook/index.ts - MLE reference hook
hooks/examples/noop-hook/index.ts - Noop test hook
observers/interface.ts - ObserverAdapter interface
observers/webhook/index.ts - Webhook adapter
observers/sse/index.ts - SSE adapter
observers/poll/index.ts - Poll adapter
observers/examples/blockchain/index.ts - Blockchain adapter
policies/lattice-policy.rego - Lattice Rego policy
AEP-SDKs/typescript/dynaep/src/bridge.ts - TypeScript SDK
package.json - @dynaep/core npm package
tsconfig.json - TypeScript config
```

### Quick Migration Commands

```bash
# 1. Backup
cp dynaep-config.yaml dynaep-config.yaml.v0.4-backup
cp -r registries registries.v0.4-backup
cp -r policies policies.v0.4-backup

# 2. Update config version fields
# (edit dynaep-config.yaml manually)

# 3. Create required files
touch registries/aep-lattice.yaml # populate with your actions
touch aep-registration.yaml # use template from section 4.7

# 4. Switch governance to ui_only
# (set governance: "ui_only" in dynaep-config.yaml lattice section)

# 5. Test
python3 -m pytest sdk/python/tests/ -v

# 6. Switch to filter_all when ready
# (set governance: "filter_all" in dynaep-config.yaml)

# 7. Monitor logs
python3 -c "
import yaml
with open('dynaep-config.yaml') as f:
 cfg = yaml.safe_load(f)
print(f'dynaEP {cfg[\"dynaep_version\"]} ready')
print(f'Lattice governance: {cfg[\"lattice\"][\"governance\"]}')
"
```

---

*End of migration guide. For questions, open an issue on the repository.*
