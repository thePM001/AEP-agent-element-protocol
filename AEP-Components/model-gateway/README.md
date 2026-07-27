# Model Gateway

Governed multi-provider LLM gateway with adapters and optional economics hooks.

- **Component ID:** `model-gateway`
- **Path:** `AEP-Components/model-gateway/`
- **Manifest:** `AEP-Base-Node/registry/components/model-gateway.json`

Pass `economics` in `GatewayDependencies` to enable pre-dispatch budget checks, concurrency limiting, provider health fallback and price-catalog cost computation. See `AEP-Components/economics/lib/gateway-integration.ts`.

Tests: `./AEP-Components/conformance/runner/run.sh`
