# dynAEP Validation Hooks

## Overview

Validation hooks are pluggable modules that give you fine-grained control over
whether a lattice event is allowed to proceed through the bridge. Hooks sit in
the validation pipeline after built-in structural checks (required fields,
thresholds, authorization) and can inspect the full event, lattice and matched
node to produce a verdict.

A hook can:

- **Pass** the event through (score >= threshold)
- **Fail** the event (score < threshold)
- **Provide adjustments** to the event payload on pass
- **Record metrics** for observability, audit or ML training

## Interface

Every hook must implement the `ValidationHook` interface defined in
`hooks/interface.ts`:

```typescript
export interface ValidationHook {
 name: string;
 version: string;
 validate(
 event: LatticeEvent,
 lattice: ActionLattice,
 node: LatticeNode,
 ): Promise<HookResult>;
}
```

The `validate` method receives:

| Parameter | Type | Description |
|-----------|----------------|------------------------------------------------------------|
| `event` | `LatticeEvent` | The incoming event with `action_path`, `payload`, metadata |
| `lattice` | `ActionLattice`| The full action lattice (nodes, edges, constraints) |
| `node` | `LatticeNode` | The specific node matched by `event.action_path` |

And returns a `HookResult`:

```typescript
export interface HookResult {
 passed: boolean; // Pass/fail
 score: number; // Quality score [0.0, 1.0]
 confidence: number; // Confidence in evaluation [0.0, 1.0]
 adjustments?: Record<string, unknown>; // Optional payload changes
 details?: string; // Human-readable explanation
}
```

## Built-in Examples

| Hook | File | Description |
|---------------|-------------------------------------------|-------------------------------------------------|
| `noop` | `examples/noop-hook/index.ts` | Pass-through; always passes with score 1.0 |
| `mle-validator`| `examples/mle-hook/index.ts` | MLE-based hypervector similarity checking |
| Config `mle` | `bridge/hook-loader.ts` | Aliases to `mle-validator` at bridge init |

## Writing a Custom Hook

### 1. Create the hook file

```
hooks/
 my-custom-hook/
 index.ts
 package.json # optional, for npm dependencies
```

### 2. Implement the interface

```typescript
// hooks/my-custom-hook/index.ts
import type {
 LatticeEvent,
 ActionLattice,
 LatticeNode,
} from "../../bridge/lattice";
import type { ValidationHook, HookResult } from "../../interface";

const myHook: ValidationHook = {
 name: "my-custom-validator",
 version: "1.0.0",

 async validate(
 event: LatticeEvent,
 lattice: ActionLattice,
 node: LatticeNode,
 ): Promise<HookResult> {
 // Your validation logic here
 // ...

 return {
 passed: true,
 score: 1.0,
 confidence: 1.0,
 details: "My custom hook: all checks passed",
 };
 },
};

export default myHook;
```

### 3. Use the `HookRegistry`

```typescript
import { HookRegistry } from "./hooks/interface";
import myHook from "./hooks/my-custom-hook/index";

const registry = new HookRegistry();
registry.register(myHook);

// Later, in the bridge:
const hook = registry.get("my-custom-validator");
if (hook) {
 const result = await hook.validate(event, lattice, node);
}
```

## Best Practices

1. **Keep it fast.** Hooks are called for every event. Sub-millisecond is ideal.
 If your hook does I/O (HTTP, disk), consider caching or batching.

2. **Be deterministic.** Given the same event, lattice and node, produce the
 same result. Non-deterministic hooks make debugging and replay difficult.

3. **Set confidence appropriately.** If you're uncertain (e.g., not enough data),
 set `confidence` low so the bridge can weight your result accordingly.

4. **Use `adjustments` sparingly.** Modifying the event payload is powerful but
 can cause cascading effects. Document what each adjustment key does.

5. **Version your hooks.** Use semver. The bridge logs hook versions on startup
 and includes them in audit trails.

6. **Handle errors gracefully.** Never throw from `validate()`. Catch errors and
 return a result with `passed: false` and a descriptive `details` string.

## Pipeline Integration

Hooks run inside `LatticeFilter.filterAsync()` in `bridge/lattice/index.ts`.
`DynAEPBridge.processEvent()` awaits `filterAsync()` for lattice-addressed events.

When a node has `type: "custom"` constraints:

1. `registerBuiltinHooks()` (from `bridge/hook-loader.ts`) ensures built-ins are loaded
2. The hook named by `lattice.hook` is resolved (`mle` → `mle-validator`)
3. `await hook.validate(event, lattice, node)` runs; result is recorded in `constraints_passed` / `constraints_failed`

Synchronous `filter()` **fails closed** on custom constraints and returns a
`filterAsync()` requirement. Do not use `filter()` for production paths with custom hooks.

Config: `lattice.hook` in `dynaep-config.yaml`. See [CONFIG.md](../CONFIG.md) and [README.md](../README.md) §8.
