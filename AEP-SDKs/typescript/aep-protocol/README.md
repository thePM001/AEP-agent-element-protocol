# AEP TypeScript SDK

Unified TypeScript governance stack and SDK clients for AEP 2.8 (Phase 8 consolidation).

## Layout

| Path | Contents |
|------|----------|
| `index.ts` | Single public export surface |
| `src/` | Inherited 2.75e governance stack (session, policy, ledger, gateway, scanners, ...) |
| `sdk/` | Scene validator, docking client, memory fabric, resolver clients |

## Lattice enforcement

All outbound HTTP from SDK providers and evidence backends uses `lattice-channels/lib/lattice-gated-fetch.ts` via `src/lattice/index.ts` re-exports. No raw `fetch()` for external gateways when `AEP_LATTICE_STRICT=1` (default).

## Import

```typescript
import { SessionManager, latticeGatedFetch, BaseNodeDockingClient } from "./typescript-sdk/index.js";
```

## Registry

`AEP-Base-Node/registry/components/aep-typescript-sdk.json` - path `typescript-sdk/`