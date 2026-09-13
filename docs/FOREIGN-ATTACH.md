# Foreign attach (AEP 2.8.6)

Send a task manifest when you attach a foreign stack through the optional Universal Connect Bridge. The bridge checks the contract and then docks the sealed capsule so Base Node can evaluate it. Do not omit the manifest, do not send trust fields and do not expect the bridge to invent a contract. Foreign frameworks stay fixtures rather than protocol members.

Present the manifest together with a sealed capsule. Base Node freezes the clock at seal, waits the compiled 1000 ms pulse, runs every written wall together, records the ledger and applies only after Admit. Enqueue on the dock is not Admit.

## Attach fields the dock reads

Three fields on the ingest body decide whether the sealed frame passes the dock Admit.

- The provenance digest binds the provenance triple and the perimeter refuses an unbound provenance. Compute it as a sha256 over source, protocol and session joined by pipes.
- The lattice action path names the path for the sealed inner event. The dock reads the sealed path so the path must exist in the base node lattice and the lattice must grant the named agent.
- The scene field binds the scene the attach touches, because the dock closes an unbound scene.

The attach agent also needs a sign key that the kernel holds. Provision it with the kernel binary, the provision flag and the agent id against the same base node config.

## Perimeter profile

The default Predicate Profile is perimeter-v1, which checks signed provenance, schema plus byte caps, the scanner pack and a replay window. Paper 005 VSA stays off unless the operator names that profile. Public UCB compiles provided GAP text or JSON with the local gap-manifest-v1 compiler and does not advertise a restricted remote GAP engine. POST /ucb/v1/compile-manifest is the public compile path. Rollback names the tail journal record after Base Node ACK. When collect-all Admit refuses, ingest reports ok false and the journal is not persisted. Unsigned or provisional contracts cannot inject credentials on egress. Operator key is UCB_API_KEY and foreign agents use per-agent keys.


## MCP

POST /ucb/v1/mcp serves JSON-RPC for UCB tools and uses the same auth as ingest, delegate, rollback, egress and compile-manifest. Mutating tools need an authenticated key. Malformed tool arguments are refused.

## Manifest and session refuses

- Missing manifest: supply a stored or provided task manifest then reseal.
- Provisional manifest: finish promotion then store a non-provisional contract.
- Missing session: bind session id on the manifest then reseal.
- Mismatched session: use the same session id on frame and manifest then reseal.
- Required session omitted: bind session id on the frame to the manifest value then reseal.

An empty agent permission list refuses and looking similar to a past allow is not allow. Lattice Memory never admits. See the error catalog for the full deny dialect.
