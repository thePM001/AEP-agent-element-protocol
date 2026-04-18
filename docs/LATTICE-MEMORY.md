# Lattice Memory

## What Is Lattice Memory

Lattice Memory is AEP v2.0's persistent memory subsystem for the adjudication lattice. It stores the outcomes of every validation pass: accepted proposals, rejected proposals, the errors that caused rejection and the traversal path through the validator pipeline.

Memory serves two purposes:

1. **Audit trail** - every validation decision is recorded in an append-only log. You can reconstruct exactly what happened, when and why.
2. **Attractor fast-path** - when a new proposal closely matches a previously accepted one (by vector similarity), the resolver can flag it as a likely-valid candidate and skip expensive re-computation in advisory systems downstream.

Memory is **read-only to the validation pipeline**. The accept/reject decision is 100% deterministic and based solely on the scene graph, registry, theme and Rego policies. Memory never overrides a validation result. This property is formally specified in TLA+ as the `MemoryDoesNotAffectDecision` invariant.

## Architecture

```
                         +------------------+
                         |  Agent Proposal  |
                         +--------+---------+
                                  |
                    +-------------v--------------+
                    |   Basic Resolver (routing)  |
                    |   Reads memory for          |
                    |   attractor fast-path       |
                    +-------------+--------------+
                                  |
                    +-------------v--------------+
                    |   AOT / JIT Validator       |
                    |   Deterministic decision    |
                    |   Memory NOT consulted      |
                    +-------------+--------------+
                                  |
                         +--------v---------+
                         |  Validation      |
                         |  Result          |
                         +--------+---------+
                                  |
                    +-------------v--------------+
                    |   Memory Fabric             |
                    |   Append-only recording     |
                    |   (InMemory or SQLite)       |
                    +-----------------------------+
```

## Append-Only Immutable Design

Memory entries are **write-once**. Once a `MemoryEntry` is recorded, it cannot be modified or deleted (except via `clear()` which is intended for testing only). This guarantees:

- The audit trail is tamper-proof within a single session.
- Historical queries always return consistent results.
- No race conditions from concurrent updates to the same entry.

The `MemoryAppendOnly` TLA+ invariant formally specifies this property: every entry present before a state transition must remain unchanged after.

## API Reference

### MemoryEntry

A single validation record.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `str` | Unique identifier (UUID v4) |
| `timestamp` | `str` | ISO 8601 timestamp |
| `element_id` | `str` | AEP element ID this entry relates to |
| `domain` | `str` | One of: `ui`, `workflow`, `api`, `event`, `iac` |
| `proposal` | `dict` | The proposed change or action |
| `result` | `str` | `"accepted"` or `"rejected"` |
| `errors` | `list[str]` | Empty if accepted, error messages if rejected |
| `traversal_path` | `list[str]` | Validators that ran, in order |
| `embedding` | `list[float]` or `None` | Vector embedding of the proposal |
| `metadata` | `dict` or `None` | Arbitrary extra data |

### MemoryFabric Interface

All storage backends implement this interface.

| Method | Returns | Description |
|--------|---------|-------------|
| `record(entry)` | `None` | Append a validation result. Write-once. |
| `find_nearest_attractor(embedding, limit=5)` | `list[MemoryEntry]` | Vector similarity search among accepted entries |
| `get_rejection_history(element_id)` | `list[MemoryEntry]` | All rejections for an element |
| `get_acceptance_history(element_id)` | `list[MemoryEntry]` | All acceptances for an element |
| `get_validation_count(element_id)` | `int` | Total validations (pass and fail) |
| `get_fast_path_hit(embedding, threshold=0.95)` | `MemoryEntry` or `None` | Nearest attractor if similarity above threshold |
| `export_history()` | `list[MemoryEntry]` | Full audit export |
| `clear()` | `None` | Wipe all entries (testing only) |

## Storage Backends

### InMemoryFabric

Stores everything in Python lists and dictionaries. Suitable for development, testing and small-scale use. Vector similarity computed via cosine distance using only the Python standard library.

```python
from sdk_aep_memory import InMemoryFabric, create_memory_entry

fabric = InMemoryFabric()
entry = create_memory_entry(
    element_id="CP-00001",
    domain="ui",
    proposal={"z": 20, "parent": "PN-00001"},
    result="accepted",
    errors=[],
    traversal_path=["z_band", "parent_check", "registry_lookup"],
)
fabric.record(entry)
```

### SQLiteFabric

Stores entries in a SQLite database file. Thread-safe (`check_same_thread=False`). Creates tables and indexes automatically on first use.

```python
from sdk_aep_memory import SQLiteFabric, create_memory_entry

fabric = SQLiteFabric("aep_memory.db")
entry = create_memory_entry(
    element_id="CP-00002",
    domain="ui",
    proposal={"z": 20, "parent": "PN-00001"},
    result="rejected",
    errors=["z=20 outside band 10-19 for prefix PN"],
    traversal_path=["z_band"],
)
fabric.record(entry)

# Query rejection history
rejections = fabric.get_rejection_history("CP-00002")
```

## Integration with AOT/JIT Validation

Memory is **read-only to the validation pipeline**. The validators (AOT and JIT) never consult memory when making accept/reject decisions. This means:

- A proposal that was accepted last time can be rejected now if the scene graph changed.
- A proposal that was rejected last time can be accepted now if the constraint was removed.
- Memory provides context, not authority.

The resolver reads memory to provide advisory information (attractor matches, historical patterns), but the final decision is always made by the deterministic validator.

## Attractor Fast-Path

When a new proposal arrives, the resolver can optionally check memory for a "fast-path hit": a previously accepted proposal that is nearly identical (cosine similarity above threshold, default 0.95).

If a fast-path hit is found:
- The `ResolveResult.fast_path` flag is set to `True`.
- The `ResolveResult.nearest_attractor` contains the matching `MemoryEntry`.
- Downstream systems can use this as a signal to skip expensive advisory computations.

The fast-path **does not bypass validation**. The proposal still goes through the full AOT/JIT pipeline.

## Embedding Strategies

The `embedding` field on `MemoryEntry` is optional. You can use any embedding strategy:

**Hash fingerprint (default):** Generate a deterministic vector from the proposal content using a hash function. Simple, fast, no external dependencies. Suitable for exact and near-exact match detection.

**Bring-your-own embedder:** Pass embeddings from any model (sentence-transformers, OpenAI, Cohere, etc). The memory fabric just stores and compares vectors - it does not generate them.

**No embedding:** If you do not provide embeddings, the attractor fast-path and similarity search are unavailable. All other memory functions (recording, history queries, audit export) work without embeddings.

## The MemoryDoesNotAffectDecision Invariant

This is the most important formal property of Lattice Memory. Stated in TLA+:

```tla
MemoryDoesNotAffectDecision ==
  \A proposal \in O :
    LET resultWithMemory    == Validate(proposal, scene, registry, memory_fabric)
        resultWithoutMemory == Validate(proposal, scene, registry, <<>>)
    IN resultWithMemory.valid = resultWithoutMemory.valid
```

In plain language: for every possible proposal, the validation result is identical whether memory contains zero entries or a million entries. Memory is a side-channel for advisory data. It never touches the accept/reject path.

This invariant is what makes AEP's determinism guarantee compatible with a learning memory system. The lattice remembers, but the lattice's judgment is not swayed by what it remembers.

## Example Usage

### Python

```python
from sdk_aep_memory import InMemoryFabric, create_memory_entry

# Create fabric
fabric = InMemoryFabric()

# Record an accepted proposal
entry = create_memory_entry(
    element_id="CP-00003",
    domain="ui",
    proposal={"type": "component", "z": 20, "parent": "PN-00001"},
    result="accepted",
    errors=[],
    traversal_path=["z_band", "parent_check", "registry_lookup", "skin_binding"],
    embedding=[0.1, 0.9, 0.3, 0.5],
)
fabric.record(entry)

# Check for fast-path hit on a similar proposal
hit = fabric.get_fast_path_hit([0.1, 0.9, 0.3, 0.5], threshold=0.95)
if hit:
    print(f"Fast-path match: {hit.id}")

# Export full audit trail
for e in fabric.export_history():
    print(f"{e.timestamp} {e.element_id} {e.result}")
```

### TypeScript

```typescript
import { InMemoryFabric, createMemoryEntry } from "./sdk-aep-memory";

const fabric = new InMemoryFabric();

const entry = createMemoryEntry({
  elementId: "CP-00003",
  domain: "ui",
  proposal: { type: "component", z: 20, parent: "PN-00001" },
  result: "accepted",
  errors: [],
  traversalPath: ["z_band", "parent_check", "registry_lookup"],
  embedding: [0.1, 0.9, 0.3, 0.5],
});
fabric.record(entry);

const hit = fabric.getFastPathHit([0.1, 0.9, 0.3, 0.5], 0.95);
if (hit) {
  console.log(`Fast-path match: ${hit.id}`);
}
```

## Rego Policy for Memory

AEP v2.0 includes `aep-memory-policy.rego` which validates memory entries:

1. Entry result must be `"accepted"` or `"rejected"` (no other values).
2. UI domain entries must reference elements that exist in the registry (or are template instances).
3. Accepted entries must have zero errors.

Evaluate with:
```bash
opa eval -i input.json -d aep-memory-policy.rego "data.aep.memory.deny"
```
