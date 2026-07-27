# Observer Adapters

The observer adapter framework provides a **pluggable event-ingestion layer** for
dynAEP. Any external event source - webhooks, SSE streams, polled REST APIs,
blockchain nodes, message queues, etc. - can be wrapped as an `ObserverAdapter`
and plugged into the bridge's event pipeline.

## Architecture

```
┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐
│ External Source │────▶│ Observer │────▶│ LatticeEvent │
│ (webhook, SSE, │ │ Adapter │ │ (normalised) │
│ blockchain, …) │ │ .onEvent() │ │ │
└──────────────────┘ └──────────────┘ └────────┬─────────┘
 │
 ▼
 ┌──────────────────┐
 │ LatticeFilter │
 │ (validation, │
 │ routing) │
 └──────────────────┘
```

Each adapter is responsible for:

1. **Connecting** to its external source (listen on a port, open a stream, start
 a polling timer, etc.).
2. **Parsing** the incoming data into the native format of the source.
3. **Normalising** into a canonical `LatticeEvent`.
4. **Forwarding** to the registered callback via `onEvent()`.

All four adapters included here are **zero external dependencies** - they use
only Node.js built-in modules (`http`, `crypto`) and the Web API (`fetch`,
`AbortController`), which are available in Node 18+.

## Included Adapters

| Adapter | Directory | Use Case |
|---|---|---|
| **Interface** | `observers/interface.ts` | `ObserverAdapter` & `LatticeEvent` type definitions |
| **Webhook** | `observers/webhook/` | POST on `127.0.0.1` by default; optional HMAC (`x-signature-256`); injects verified digest into `payload.signature` |
| **SSE** | `observers/sse/` | Consume Server-Sent Events streams with auto-reconnect |
| **Poll** | `observers/poll/` | Poll REST APIs with diff-based change detection |
| **Blockchain** | `observers/examples/blockchain/` | Ethereum event log poller (reference impl) |

## Quick Start

```typescript
import { WebhookObserverAdapter } from "./observers/webhook";

const adapter = new WebhookObserverAdapter({
 port: 9000,
 endpoint: "/events",
});

adapter.onEvent((event) => {
 console.log(`Received event: ${event.action_path}`, event.payload);
});

await adapter.start();
// ... later
await adapter.stop();
```

## The `ObserverAdapter` Interface

Every adapter implements:

```typescript
interface ObserverAdapter {
 name: string;
 start(): Promise<void>;
 stop(): Promise<void>;
 onEvent(callback: (event: LatticeEvent) => void): void;
}
```

### Lifecycle

1. **Construct** - pass configuration to the constructor.
2. **`onEvent(callback)`** - register the callback that receives normalised
 `LatticeEvent` objects. Only one callback is supported; subsequent calls
 replace the previous one.
3. **`start()`** - begin consuming events. Must be idempotent; calling
 `start()` twice is a no-op.
4. **`stop()`** - release all resources (server sockets, timers, streams).
 Must be idempotent and safe to call even if not started.

### Error Handling

- Adapters log errors via `console.error` and continue operating.
- Transient failures (network drops, HTTP errors) trigger retry/reconnect
 logic rather than crashing the adapter.
- Fatal configuration errors are thrown from the constructor so they are
 caught at setup time, not at runtime.

## The `LatticeEvent` Shape

```typescript
interface LatticeEvent {
 source: string; // e.g. "webhook:9000", "eth:0xabc..."
 action_path: string; // e.g. "market:order:new", "blockchain:transfer"
 payload: Record<string, unknown>;
 bridge_timestamp: number; // set by the adapter at normalisation time
 agent_id?: string;
}
```

The `action_path` is the key field: it determines how the event is routed
through the Action Lattice (see `bridge/lattice/`).

## Adding a New Adapter

### 1. Create the directory

```
observers/<your-source>/
└── index.ts
```

### 2. Implement `ObserverAdapter`

```typescript
import { LatticeEvent, ObserverAdapter } from "../interface";

export interface MyAdapterConfig {
 // your configuration options
}

export class MyAdapter implements ObserverAdapter {
 readonly name: string;

 constructor(config: MyAdapterConfig) {
 this.name = "my-source";
 }

 async start(): Promise<void> { /* connect, listen, poll, etc. */ }
 async stop(): Promise<void> { /* tear down resources */ }

 onEvent(callback: (event: LatticeEvent) => void): void {
 // store the callback
 }
}
```

### 3. Normalise to `LatticeEvent`

Every event from your source must be converted:

```typescript
const latticeEvent: LatticeEvent = {
 source: this.name,
 action_path: "my-source:event-type",
 payload: { /* your data */ },
 bridge_timestamp: Date.now(),
};
this.eventCallback?.(latticeEvent);
```

### 4. Handle errors gracefully

- Catch network errors and implement retry logic.
- Log failures but don't throw from event-processing paths.
- If your adapter has a `stop()` method, make sure it can be called safely
 from error handlers.

### 5. (Optional) Provide typed event shapes

If your source has multiple event types, export TypeScript interfaces for
them so consumers can narrow the payload type:

```typescript
export interface MyEventA {
 type: "a";
 /* ... */
}
export interface MyEventB {
 type: "b";
 /* ... */
}
```

## Testing

Each adapter is designed to be testable without external infrastructure:

- **Webhook**: start the adapter, send HTTP requests to `localhost:<port>`.
- **SSE**: use a local `http.Server` that writes SSE-formatted text.
- **Poll**: use a local `http.Server` that returns JSON and changes responses
 between polls.
- **Blockchain**: use a local Anvil/Hardhat node with a deployed test contract.

## Known Limitations

- The **poll adapter**'s deep-equality check works only on JSON-serialisable
 data. Binary or streaming responses are not supported.
- The **blockchain example** handles only the three most common ERC-20/ERC-721
 event signatures. Custom events require extending the `decodeLog` method.
- The **SSE adapter** does not honour the `retry:` field from the server.
 Use `reconnectBaseMs` in the config instead.
