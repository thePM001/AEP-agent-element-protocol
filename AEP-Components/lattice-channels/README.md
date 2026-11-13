# 08 / Lattice Channels

Status: normative. Stability: evolving. Frame sealing calls the aep-lattice-log binary; lattice-gated-fetch .ts, .mjs and .js keep the same exports.

## What it is

Lattice Channels are the transport of AEP. Every message to the Base Node travels as a sealed capsule: the content is encrypted, the sender signs it and the header binds it to one dock. Post-quantum schemes protect both the key exchange and the signature. No other path leads into the Base Node.

## Place among the 18

Every component hands its messages to the channel and UCB (02) seals the work of external systems for it. The capsule ends at a dock of the AEP Base Node (01), where the Base Node Pulse (10) takes over. AgentMesh (13) supplies the identity of the signer and the mTLS settings for TCP endpoints.

## What ships in 2.9

- The crate `aep-lattice-channel` builds, verifies and opens capsules. ML-KEM-768 protects the key exchange, AES-256-GCM the content and ML-DSA-65 the signature.
- A dock accepts sealed capsules only. A plain ping, event or register message is refused and logged.
- Replay protection by capsule hash and a rate limiter per agent.
- The layer is deterministic and no model runs in it.
- JavaScript helpers build capsules for clients and send the outbound web request of an agent through the Base Node.
- The crate `aep-lattice-gated-fetch` executes the one granted outbound request against the operator route list.

## Layout

| Path | Role |
|------|------|
| `crate/` | The crate `aep-lattice-channel` |
| `lib/lattice-transport.mjs` | Dock paths, capsule helpers and the writing checks for clients |
| `lib/lattice-gated-fetch.ts` | The outbound request helper, also as `.mjs` and `.js` |
| `client/` | TypeScript client exports |
| `tests/` | vitest suites |
| `AEP-Components/lattice-crypto/` | The crate `aep-lattice-crypto` with ML-KEM-768 and ML-DSA-65 and the program `aep-ml-dsa` |
| `AEP-Components/lattice-gated-fetch/` | The outbound request of the kernel |

## Interfaces

- Rust: `build_frame`, `build_frame_for_dock`, `verify_and_open_frame`, `open_frame` and `frame_digest`.
- JavaScript: `latticeGatedFetch`, `dockPath`, `normalizeDockPort` and `resolveLatticeLogBin`.
- Docks: `inference`, `validation`, `regulation` and `future`.
- Environment: `AEP_LATTICE_LOG_BIN`, `AEP_LATTICE_ALLOW_LOOPBACK` and `AEP_LATTICE_ALLOW_PRIVATE`.
- Wire format: one sealed capsule per line. The channel version is `2.9`.

## Kernel pulse after the sealed capsule

Lattice Channels carry the sealed capsule. They do not own the wait. After the seal is verified the capsule waits 1000 ms on the Base Node clock with time frozen at seal. There is no `pulse_ms` transport field. See `AEP-Base-Node/README.md` for the compiled constant and the theoretical rebuild path. TypeScript dynAEP remains a standalone component.

## LatticeChannel security (mandatory)

Every software development kit, editor and runtime module talks to protocol components only through Lattice Channels: docking sockets carry sealed encrypted capsules and nothing else.

A plain ping, event or register message on the wire is rejected and logged as a side-channel anomaly, meaning an attempt to skip the sealed capsule.

Scene proof at boot checks that the scene graph is structurally valid. That boot proof is not the runtime check. Actions after a sealed capsule is opened are judged in the Base Node kernel.

After the seal is verified, the writing scan and the capsule-hash replay, the capsule waits one second on the Base Node clock. Time is frozen at seal so that one-second hold still fits inside 50 ms of allowed clock drift. The freeze is the Base Node clock, read when the frame arrives. The timestamp an agent seals into its event is compared with that clock and never replaces it, so a stamp more than 50 ms ahead of the Base Node clock is refused before the capsule is queued. The time the seal and the transit take is age and not drift: a stamp up to five seconds behind the Base Node clock is accepted and an older one is refused. A capsule older than five seconds fails. Replay is keyed by the capsule hash so the same sealed bytes cannot be judged twice as a new event.

### Kernel pulse wait

The one-second wait on this path is the kernel pulse. See [Kernel pulse](../base-node-pulse/README.md) for the compiled 1000 ms constant, why dynAEP yaml cannot change it and how a builder can change it in theory by rebuilding Base Node.

A missing scene, dock, timestamp or sequence fails the check. The destination dock may be taken from the opened frame docking port.

When the dock denies, the report names the closed walls and the reasons plus a mechanical repair for missing fields and writing. Grant lists stay off that report. A retry must seal a new capsule because replay is keyed when the capsule is first queued.

Writing walls govern output shape and are not transport security. EPSCOM writing walls stay protocol law at priority 255. Closed walls carry a class of writing, security, temporal, capability, poison or structural so a writing deny is not read as a transport failure.

Putting a capsule on the dock is not the check. After the one-second wait the client asks for the result by the capsule hash on the same dock so a deny names the closed walls and an allow returns an event id.

Base Node can run in a container. Language clients share one sealer for that capsule and do not open a private route.

```mermaid
flowchart LR
  UI[Harness]
  UCB[optional foreign airlock]
  LT[sealed encrypted capsule]
  BN[Base Node kernel]
  EVAL[wait one second then every check then carry out]
  LEDGER[derived fifteen-row record]
  UI --> LT
  UCB --> LT
  LT --> BN
  BN --> EVAL
  EVAL --> LEDGER
```

| Path | Wire format | Notes |
|------|-------------|-------|
| Docking ports | sealed frame only | Plain ping, event and register rejected |
| WASM sandbox | Unix socket `wasm_sandbox` | Evaluate via seal, record and capsule hash |
| Outbound HTTP | Lattice-gated via inference dock | Audit frame before fetch |
| Optional foreign airlock | HTTP/MCP on `:8412` | Only for non-AEP foreign stacks. API-key auth; manifest required; no fallback synthesis |
| Policy | lattice-channel mandatory at boot | Strict lattice at runtime |

## Limits

- The channel transports and proves origin. It does not judge. The Admit Gate (04) does.
- The channel does not own the wait after the seal. The Base Node Pulse (10) does.
- Writing rules shape output and are no transport security.

## Run and test

```bash
cargo test -p aep-lattice-channel -p aep-lattice-crypto -p aep-lattice-gated-fetch
npx vitest run AEP-Components/lattice-channels
```

## Related documents

- `AEP-Base-Node/AEP-Docks/docs/DOCKING-PORTS.md` for the wire protocol of the docks
- `AEP-Components/lattice-gated-fetch/README.md` for the outbound request
- `AEP-Components/base-node-pulse/README.md` for the wait after the seal
