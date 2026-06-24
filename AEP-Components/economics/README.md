# Economics

**Economics is a distinct AEP 2.8 component.** Pricing catalogs, budget enforcement, cost estimation, provider balancing and X402 nanopayment negotiation.

- **Implementation:** `economics/lib/`
- **Registry:** `AEP-Base-Node/registry/components/economics.json`

## Modules

| File | Role |
|------|------|
| `pricing.ts` | Price catalog lookups |
| `budget.ts` | Session and daily budget caps |
| `cost-estimator.ts` | Token/cost estimation before inference |
| `balance.ts` | Weighted provider/model selection |
| `x402.ts` | HTTP 402 nanopayment flow |
| `model-mapping.ts` | Model alias resolution |
| `concurrency.ts` | Concurrent request budgeting |
| `fallback.ts` | Provider failover on budget/health |

## Model gateway integration

`GovernedModelGateway` accepts optional `economics` deps:

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

Hooks live in `lib/gateway-integration.ts` (pre-dispatch budget check, concurrency acquire/release, fallback health, post-call spend recording).

Tests: `./AEP-Components/conformance/runner/run.sh`