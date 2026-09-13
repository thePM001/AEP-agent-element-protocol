# Changelog

## 2026-09-12 - Changelog catalog established

This project now keeps CHANGELOG.md at the repository root.
A dated entry that names the ticket id is required before that ticket can close.
Write DENY on miss. Policy nla-server-aep-ticket-close-changelog-mandatory.

## [2.8.6] - 2026-09-13 - WASM sandbox home

Move the WASM sandbox under the Composer Lite canvas, because the canvas is its only caller: the canvas offers a WASM Policy node, the composer route for wasm evaluate forwards to the sandbox socket and the composer library builds the sealed frame. The crate dependencies and the twelve path references were updated in the same commit and the workspace check passes.

## [2.8.6] - 2026-09-13 - NOSHIP-286-P7 rename follow up

Rename AEP-CCA to AEP-CCA-Central-Setup-Agent at the repository root. The old directory name answers 404 and the path form was rewritten in the twenty five files that named it. The rename landed as one commit on main.

## [2.8.6] - 2026-09-13 - NOSHIP-286-P7

Promote the CCA central setup agent to AEP-CCA at the repository root. The component moved out of the components folder, the path form was rewritten in every file that named it and the old path is gone. The move landed as one commit on main.

## [2.8.6] - 2026-09-13 - NOSHIP-286-P6

Promote the CAW framework to AEP-CAW at the repository root. The component moved out of the components folder, the path form was rewritten in every file that named it and the old path is gone. The move landed as one commit on main.

## [2.8.6] - 2026-09-13 - NOSHIP-286-P4

Build proof and CI for the public tree. The workspace now builds after the standalone dynAEP engine surface was implemented, the conformance suite runs green at twelve checks, a conformance workflow builds the tree and runs the suite on push and pull request, the numeric memory and latency targets moved to the internal target file and the wrap example now seals its payload, reports the pulse, collects every wall and prints a deny report on a denied path.

## [2.8.6] - 2026-09-13 - NOSHIP-286-P0

Remove every upstream product indicator from the public tree. The framework notice file and the framework licence file that carried the upstream copyright line are deleted, the upstream manual set under the framework docs directory is deleted, the demo scripts and recordings are renamed, the demo walkthrough and recording text is scrubbed and the one shipped dev note is scrubbed. The ticket closes on the receipt under internal-export-area.

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

Ship a public local GAP TaskManifestV1 compiler or stop advertising tier 1. Public capabilities name a local gap-manifest-v1 compiler and no longer claim a licensed-only remote GAP engine.

## [2.8.5] - 2026-09-12 - UCB-285-P7

Ingest ACK waits for collect-all Admit allow. Dock-first send stays and the journal persists only after collect-all Admit allow with admit rows on the ingest reply.

## [2.8.5] - 2026-09-12 - UCB-285-P8

Egress audit row plus header isolation plus response cap. Egress writes an audit row, strips caller Authorization and connection headers and refuses credential inject on unsigned provisional manifests.

## [2.8.5] - 2026-09-12 - UCB-285-P9

Optional Paper 005 VSA profile after the dock is boring. Named profile paper005-vsa stays off in default tests and is not a substitute for manifests, signatures and SSRF controls.
