# 17 / Model Gateway

Status: normative. Stability: evolving.

## What it is

The Model Gateway is the routing component for model calls to several providers. Every inference request passes one central class, which evaluates the policy before the call, sends the request through the adapter of the chosen provider and inspects the answer. Security checks on the stream can abort an answer while it is still arriving.

## Place among the 18

An application or agent hands a model request to the gateway. The gateway asks the policy engine of GAP (06), runs the Scanners (12) on input and output, calls the hooks of Economics (14) and writes to the Evidence Ledger (09). It returns the governed answer to the caller. Outbound traffic of a deployment is governed by the CAWs (11) and the AEP Base Node (01).

## What ships in 2.9

- `GovernedModelGateway` with one `call` per request: input scan, model dispatch, output scan, recovery, cost tracking, telemetry and ledger record.
- Provider adapters for Anthropic, OpenAI, Ollama and any endpoint with the OpenAI interface, held in a `ProviderRegistry`.
- Hard scanner findings on a stream are collected together before the answer is refused.
- The stream validator and middleware in `AEP-Components/streaming/`, which can abort a stream.
- Optional economics dependencies for the budget check, the concurrency limit, the provider fallback and the cost computation.
- The page shows a latency adapter and a governance adapter as fixed parts and parallel provider endpoints. In this tree latency based selection is a strategy of Economics (14), governance is the gateway class itself and one request goes to one resolved provider. Parallel dispatch to several providers is planned.

## Layout

| Path | Role |
|------|------|
| `lib/gateway.ts` | The governed gateway |
| `lib/registry.ts` | The provider registry |
| `lib/providers/` | Adapters for Anthropic, OpenAI, Ollama and custom endpoints |
| `lib/types.ts` | Request, response and configuration types |
| `tests/` | vitest suites for gateway, providers, registry, stream collection and economics wiring |
| `AEP-Components/streaming/` | Stream validator and middleware |

## Interfaces

- `new GovernedModelGateway(options, deps)` with `deps` such as `policy`, `registry`, `ledger`, `scanner` and `economics`.
- `gateway.call(request)` returns the governed response.
- `ProviderRegistry` with `register`, `get`, `has`, `list` and `resolve`.
- Component id `model-gateway` with the manifest `AEP-Base-Node/AEP-Registry/components/model-gateway.json`.

## Limits

- The gateway governs calls made through it. A process calling a provider directly is stopped by the network rules of the CAWs (11) and not by the gateway.
- The gateway verdict is no kernel verdict. Actions of an agent still pass the Admit Gate (04).
- Provider keys come from the deployment. The tree ships none.

## Run and test

```bash
npx vitest run AEP-Components/model-gateway AEP-Components/streaming
```

## Related documents

- `AEP-Components/economics/README.md` for the cost hooks
- `AEP-Components/streaming/README.md` for stream checks
- `AEP-Components/scanners/README.md` for the scanner pipeline
