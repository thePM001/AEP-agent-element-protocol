# 14 / Economics

Status: reference. Stability: evolving. Model-gateway calls it for cost estimates, budget caps and concurrency.

## What it is

Economics is the component for cost telemetry and budget control. It estimates the cost of a model call before the call happens, refuses or warns when a budget cap is reached and handles x402 payments, the small payments an agent makes in answer to an HTTP 402 reply.

## Place among the 18

The Model Gateway (17) calls the economics hooks before and after each model call. The Admit Gate (04) has its own budget wall in `AEP-Components/admit-budget-window/`, judged in the kernel. Spend records can go to the Evidence Ledger (09).

## What ships in 2.9

- A price catalog per million tokens and a cost estimator in micro USD before dispatch.
- A budget enforcer with a hard cap, a soft warning level and daily or monthly periods.
- A limiter for concurrent requests and a fallback to a healthy provider.
- Provider and model selection by weight or by latency.
- A mapping from model names to provider ids.
- The x402 flow with verify and settle for the schemes exact, upto and batch settlement.
- The page lists a fixed cap per session. In this tree the cap applies per period and scope. A cap per session is planned.

## Layout

| Path | Role |
|------|------|
| `lib/pricing.ts` | Price catalog lookups |
| `lib/cost-estimator.ts` | Token and cost estimation before inference |
| `lib/budget.ts` | Budget caps |
| `lib/concurrency.ts` | Concurrent request limit |
| `lib/fallback.ts` | Provider fallback on budget or health |
| `lib/balance.ts` | Weighted provider and model selection |
| `lib/model-mapping.ts` | Model alias resolution |
| `lib/x402.ts` | The x402 payment flow |
| `lib/gateway-integration.ts` | The hooks for the Model Gateway |
| `tests/` | vitest suites |

## Interfaces

`GovernedModelGateway` accepts optional `economics` dependencies:

```typescript
import { GovernedModelGateway } from "../model-gateway/lib/gateway.js";
import { createPriceCatalog, createBudgetEnforcer, createConcurrencyLimiter } from "./index.js";

const gw = new GovernedModelGateway(options, {
  policy,
  registry,
  economics: {
    priceCatalog: createPriceCatalog(entries),
    budget: createBudgetEnforcer(budgetConfig),
    concurrency: createConcurrencyLimiter(10),
    costEstimateEnabled: true,
  },
});
```

- Factories: `createPriceCatalog`, `createBudgetEnforcer`, `createConcurrencyLimiter` and `createX402Gateway`.
- Component id `economics` with the manifest `AEP-Base-Node/AEP-Registry/components/economics.json`.

## Limits

- The library computes and refuses inside the gateway process. The kernel budget wall is part of the Admit Gate (04).
- The price catalog is data in the tree. It is no live price feed.
- x402 settlement talks to the payment endpoint a deployment configures. The tree ships no payment network.

## Run and test

```bash
npx vitest run AEP-Components/economics
```

## Related documents

- `AEP-Components/model-gateway/README.md` for the caller
- `AEP-Components/admit-budget-window/README.md` for the budget wall of the kernel
- `AEP-User-Experience/harness/harness/aep-economics.js` for a harness example
