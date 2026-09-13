# Changelog

## [2.8.5] - 2026-09-12 - UCB perimeter-v1 attach gateway

Universal Connect Bridge now uses Predicate Profile perimeter-v1 as the default. Content checks call the scanner pack and return a scanner id instead of four English phrases. Ingest and egress bodies are bounded and the journal rotates at a byte cap. One shared API key is replaced by per-agent keys while the operator key remains. Task manifests carry a digest and a signature. Unsigned or provisional manifests cannot enable egress. The journal is a hash-chained evidence log and rollback names the tail record after Base Node ACK. Ingest ACK waits for collect-all Admit allow before the journal is persisted. Egress writes an audit row, isolates caller Authorization and connection headers and refuses credential inject on unsigned provisional manifests. Public capabilities name a local gap-manifest-v1 compiler that compiles provided GAP text or JSON. Paper 005 VSA stays off unless named.

Library aep-ucb-perimeter-v1 is a workspace member and aep-ucb depends on it.

## [2.8.5] - 2026-09-12 - UCB-285-P0

Ship UCB Predicate Profile perimeter-v1 as the default crate. Live aep-ucb parses Predicate Profile perimeter-v1 by default and keeps Paper 005 VSA off unless named.

## [2.8.5] - 2026-09-12 - UCB-285-P1

Wire aep-ucb P_C through the AEP scanner pack. Ingest content checks call the scanner pack and a secrets payload returns P_C with scanner Secrets.

## [2.8.5] - 2026-09-12 - UCB-285-P2

Bound UCB ingest and egress body size plus timeouts. Ingest uses a 256 KiB default cap and a 2 MiB hard cap with dock timeout 5s and a journal byte cap.

## [2.8.5] - 2026-09-12 - UCB-285-P3

Replace the one shared UCB API key with per-agent keys. Operator key remains UCB_API_KEY and agent keys cannot rollback while the plaintext recovery file is no longer written.

## [2.8.5] - 2026-09-12 - UCB-285-P4

Sign task manifests. Provisional cannot egress. Stored manifests carry a digest and a signature and unsigned or provisional objects cannot enable egress.

## [2.8.5] - 2026-09-12 - UCB-285-P5

Hash-chain the UCB journal and rollback by named diff ids. The journal is hash-chained and rollback of a non-tail diff id is refused until Base Node ACK of the tail.

## [2.8.5] - 2026-09-12 - UCB-285-P6

Ship a public local GAP TaskManifestV1 compiler or stop advertising tier 1. Public capabilities name a local gap-manifest-v1 compiler and no longer claim a licensed-only remote GAP engine. Ingest compiles provided GAP text or JSON on the live path.

## [2.8.5] - 2026-09-12 - UCB-285-P7

Ingest ACK waits for collect-all Admit allow. Dock-first send stays and the journal persists only after collect-all Admit allow with admit rows on the ingest reply.

## [2.8.5] - 2026-09-12 - UCB-285-P8

Egress audit row plus header isolation plus response cap. Egress writes an audit row, strips caller Authorization and connection headers and refuses credential inject on unsigned provisional manifests.

## [2.8.5] - 2026-09-12 - UCB-285-P9

Optional Paper 005 VSA profile after the dock is boring. Named profile paper005-vsa stays off in default tests and is not a substitute for manifests, signatures and SSRF controls.
