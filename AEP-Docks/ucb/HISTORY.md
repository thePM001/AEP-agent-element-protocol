# UCB attach notes (AEP 2.8.5)

This page is the public attach record for AEP 2.8.5. A file named CHANGELOG.md is not used.

The optional Universal Connect Bridge uses Predicate Profile perimeter-v1 by default. Content checks call the scanner pack. Ingest uses a 256 KiB default cap and a 2 MiB hard cap. Dock wait is 5 seconds and the journal rotates at a byte cap. The operator key remains UCB_API_KEY and foreign agents use per-agent keys. Task manifests carry a digest and a signature. Unsigned or provisional manifests cannot enable egress. The journal is hash-chained and rollback names the tail record after Base Node ACK. Ingest waits for collect-all Admit allow before the journal is persisted. Egress writes an audit row and isolates caller Authorization plus connection headers. Public compile uses the local gap-manifest-v1 compiler. Paper 005 VSA stays off unless named.

Validate runs under a two-slot pool. On Unix the worker is a forked child. The 2 second timeout kills that child and frees the slot. Acquire timeout returns validate busy. Join timeout returns validate timeout. Collect-all Admit deny, missing dock and silent dock fixtures stay in the crate tests.

Composer uses NLA_GAP_ENGINE_URL only when set and does not invent a docker gateway. MCP JSON-RPC on POST /ucb/v1/mcp uses the same auth as ingest. Malformed tool arguments are refused.

CCA setup writes protocol 2.8.5 and strips trust fields. Base Node health always runs. Enqueue is not Admit.

CAW runtime identifiers use aep-caw. Origin helper docs are gone from the public tree. LICENSE plus NOTICE copyright stay.
