# AEP 2.9 Rust workspace

This is the Rust workspace note. It is not the product front page. The workspace root is Cargo.toml at the tree root. The Base Node kernel crate lives only at AEP-Base-Node/AEP-Crate and it is the one default member. Component crates live under AEP-Components.

Build output is directed here via .cargo/config.toml:

    rust/target/release/aep-base-node
    rust/target/release/aep-lattice-log
    rust/target/release/aep-memory
    rust/target/release/aep-conformance
    rust/target/release/aep-ucb

From the repository root:

    cargo test -p aep-base-node --lib
    cargo test --workspace
    cargo build --release -p aep-base-node -p aep-lattice-memory -p aep-ucb
    ./rust/target/release/aep-base-node --self-test

## Crate groups by component

Each crate of the workspace belongs to one of the 18 main components or to the shared parts. The numbers follow `AEP-Components/component-map.json` and the README of each component has the detail.

| Component | Crates |
|-----------|--------|
| 01 AEP Base Node | `aep-base-node`, `aep-agent-control-hub`, `aep-potomitan`, `multi-base-node-core`, `aep-kernel-types`, `aep-live-entry`, `aep-one-live-evaluation` and `aep-wall-set-backpressure` |
| 02 UCB | `aep-ucb`, `aep-ucb-perimeter-v1`, `aep-dock-line-reader`, `aep-dock-post-beat-collect`, `aep-dock-request-poison` and `aep-egress-address` |
| 03 One Validation Envelope | `aep-envelope`, `aep-envelope-walls`, `aep-evaluation-chain` and `aep-unbound-field-close` |
| 04 Admit Gate | `aep-admit`, `aep-admit-live-dock`, `aep-admit-writing-walls`, `aep-admit-channel-order-walls`, `aep-admit-temporal-bounds`, `aep-admit-budget-window`, `aep-policy-system-admit` and `aep-permissions` |
| 05 Graph Engine | `aep-graph-engine-admit-gate` |
| 06 GAP | `gap-schema-profile-v13` and `aep-policy-leftover-skins` |
| 07 dynAEP | `aep-dynaep` |
| 08 Lattice Channels | `aep-lattice-channel`, `aep-lattice-crypto` and `aep-lattice-gated-fetch` |
| 10 Base Node Pulse | `aep-base-node-pulse` |
| 11 CAWs | `aep-isolation` and `aep-caw-cve-demo-trees`. The CAW runtime itself is a Go module in `AEP-CAW/` |
| 13 AgentMesh | `aep-agentmesh` and `aep-agentmesh-local-issuance` |
| 15 Lattice Memory | `aep-lattice-memory` |
| 18 TLA+ | `aep-tla-verify` and `aep-conformance` |
| Shared parts | `aep-ede`, `aep-ucm-core`, `aep-ucm-receipt`, `aep-ucm-lookup` and `aep-ucm` |

The components 09, 12, 14, 16 and 17 are written in TypeScript and have no crate. The example crate `aep-end-to-end-run` lives in `AEP-User-Experience/examples/end-to-end-run`.
