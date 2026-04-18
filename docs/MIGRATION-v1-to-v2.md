# Migration Guide: AEP v1.1 to v2.0

## What Changed

### Version bump
- `aep_version` in all three config files updated from `"1.1"` to `"2.0"`.

### New optional fields
- `memory_key` (string, optional) in scene elements - associates an element with a memory persistence key.
- `memory_persistence` (boolean, optional) in registry entries - marks entries that should track validation history.

### New SDK files
- `sdk/sdk-aep-memory.py` - Lattice Memory (Python)
- `sdk/sdk-aep-memory.ts` - Lattice Memory (TypeScript)
- `sdk/sdk-aep-resolver.py` - Basic Resolver (Python)
- `sdk/sdk-aep-resolver.ts` - Basic Resolver (TypeScript)

### New policy file
- `aep-memory-policy.rego` - OPA/Rego policies for memory entry validation.

### New TLA+ specs
- `docs/TLA+/AEP.tla` - standalone extraction of the core AEP invariants.
- `docs/TLA+/AEP_Memory.tla` - memory-specific invariants including `MemoryDoesNotAffectDecision`.

### New documentation
- `docs/LATTICE-MEMORY.md` - full Lattice Memory architecture and API reference.
- `docs/RESOLVER.md` - Basic Resolver architecture and API reference.
- `CHANGELOG.md` - version history.

## What Stayed the Same

- **Three-layer architecture** - Structure, Behaviour, Skin remain independent layers.
- **Z-band hierarchy** - all prefix-to-z-band mappings unchanged.
- **Element ID convention** - `XX-NNNNN` format unchanged.
- **Rego policies** - existing `aep-policy.rego` unchanged and fully compatible.
- **TLA+ invariants** - all v1.1 invariants preserved.
- **SDK files** - all existing SDK files (`sdk-aep-core.ts`, `sdk-aep-python.py`, `sdk-aep-protocols.py`, `sdk-aep-react.tsx`, `sdk-aep-vue.ts`) unchanged.
- **License** - Apache 2.0, no change.
- **Config schema** - all v1.1 config files are valid v2.0 files (just update `aep_version`).

## Step-by-Step Migration

### 1. Update config versions

In `aep-scene.json`:
```json
"aep_version": "2.0"
```

In `aep-registry.yaml`:
```yaml
aep_version: "2.0"
```

In `aep-theme.yaml`:
```yaml
aep_version: "2.0"
```

### 2. Install new SDK modules

Copy the new SDK files into your project's SDK directory:
- `sdk-aep-memory.py`
- `sdk-aep-memory.ts`
- `sdk-aep-resolver.py`
- `sdk-aep-resolver.ts`

No new dependencies required. Both memory and resolver modules use only the Python standard library.

### 3. (Optional) Enable Lattice Memory

```python
from sdk_aep_memory import InMemoryFabric
fabric = InMemoryFabric()
```

Or with SQLite persistence:
```python
from sdk_aep_memory import SQLiteFabric
fabric = SQLiteFabric("aep_memory.db")
```

### 4. (Optional) Initialize Basic Resolver

```python
from sdk_aep_resolver import BasicResolver
resolver = BasicResolver(config=aep_config, memory=fabric)
```

### 5. (Optional) Add memory fields to configs

Add `memory_key` to scene elements that need persistence:
```json
"SH-00001": {
  ...
  "memory_key": "shell-root-v1"
}
```

Add `memory_persistence` to registry entries that should track history:
```yaml
CP-00001:
  ...
  memory_persistence: true
```

### 6. (Optional) Deploy memory Rego policies

Add `aep-memory-policy.rego` to your OPA policy bundle alongside `aep-policy.rego`.

## Rollback

If you need to revert to v1.1:

```bash
git reset --hard v1.1-baseline
git push origin main --force
```

The `v1.1-baseline` tag marks the exact state of the repository before the v2.0 upgrade. This single command restores everything.
