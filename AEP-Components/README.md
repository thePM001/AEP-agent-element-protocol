# AEP Protocol Components

This folder contains the protocol components of AEP. The AEP page lists 18 main components and every subfolder here belongs to exactly one of them or to the list of shared parts. The data file `AEP-Components/component-map.json` is the single source of this table and the README check of `aep-check.mjs` reads it.

## Component map

The home folder of a component contains its README with ten parts: title, status line, What it is, Place among the 18, What ships in 2.9, Layout, Interfaces, Limits, Run and test and Related documents. Three components have their home outside this folder: the AEP Base Node (01), UCB (02) and the CAWs (11).

| No | Component | Home folder | Folders that belong to it |
|----|-----------|-------------|---------------------------|
| 01 | AEP Base Node | `AEP-Base-Node` | `kernel-types`, `live-entry`, `one-live-evaluation`, `wall-set-backpressure`, `AEP-Base-Node/AEP-Crate`, `AEP-Base-Node/AEP-Registry`, `AEP-Base-Node/AEP-Agent-Control-Hub`, `AEP-Base-Node/AEP-Potomitan`, `AEP-Base-Node/AEP-Multi-Base-Node` |
| 02 | UCB | `AEP-Base-Node/AEP-Docks/ucb` | `dock-line-reader`, `dock-post-beat-collect`, `dock-request-poison`, `egress-address`, `AEP-Base-Node/AEP-Docks`, `AEP-Base-Node/AEP-Docks/universal-connect` |
| 03 | One Validation Envelope | `AEP-Components/envelope` | `envelope-walls`, `evaluation-chain`, `unbound-field-close` |
| 04 | Admit Gate | `AEP-Components/admit` | `admit-budget-window`, `admit-channel-order-walls`, `admit-live-dock`, `admit-temporal-bounds`, `admit-writing-walls`, `policy-system-admit`, `one-admit-id`, `covenant`, `permissions` |
| 05 | Graph Engine | `AEP-Components/graph-engine` | `graph-engine-admit-gate`, `decomposition`, `session`, `recovery` |
| 06 | GAP | `AEP-Components/gap` | `gap-schema-profile-v13`, `policy-engine`, `policy-leftover-skins`, `AEP-Policy-System` |
| 07 | dynAEP | `AEP-Components/dynAEP` | `hyperlattice`, `named-surfaces`, `wrap-coverage` |
| 08 | Lattice Channels | `AEP-Components/lattice-channels` | `lattice-crypto`, `lattice-gated-fetch` |
| 09 | Evidence Ledger | `AEP-Components/evidence-ledger` | `proof-bundle`, `telemetry` |
| 10 | Base Node Pulse | `AEP-Components/base-node-pulse` | none |
| 11 | CAWs | `AEP-CAW` | `isolation`, `intercept`, `mcp-security`, `caw-cve-demo-trees` |
| 12 | Scanners | `AEP-Components/scanners` | none |
| 13 | AgentMesh | `AEP-Components/agentmesh` | `agentmesh-local-issuance`, `identity` |
| 14 | Economics | `AEP-Components/economics` | none |
| 15 | Lattice Memory | `AEP-Components/lattice-memory` | none |
| 16 | Intent Ledger | `AEP-Components/intent-ledger` | `intent` |
| 17 | Model Gateway | `AEP-Components/model-gateway` | `streaming` |
| 18 | TLA+ | `AEP-Components/tla` | `verification`, `conformance` |

## Shared parts

These folders serve more than one component:

| Folder | Role |
|--------|------|
| `datasets` | A file based store of evaluation datasets with simple versions. |
| `ede` | Enforced draft environments, in which a coding agent changes a repository only through a scanned draft. |
| `platform-core` | Shared path helpers and the catalog of regulation modules that several components import. |
| `ucm` | The Universal Computation Module, the exact calculation engine with signed receipts. |

## README files and manifests

Every subfolder has a `README.md`. The README of a home folder describes the whole component and the README of a member folder describes that folder. A component with a catalog entry has a registry manifest under `AEP-Base-Node/AEP-Registry/components/` and its code in `lib/` or `crate/`. Runtime code for each component lives in that component folder. Client libraries are not a product of AEP 2.9.

Infrastructure and top-level surfaces outside this folder:

- `AEP-Base-Node/` - **mandatory AEP governance kernel**, component 01
- `AEP-CAW/` - CAW host sandboxes, component 11. An incorporated part of AEP that runs on the host
- `AEP-Base-Node/AEP-Docks/` - socket dock specs, the UCB bridge of component 02 and the Universal Connect Dock (UCD)
- `AEP-Policy-System/` - policy files plus `policy-builder/` and `schema-builder/`, part of component 06
- `docker/` - container entrypoint and runtime deps
- `rust/` - build artifact target directory

The catalog resolves component paths via `AEP-Base-Node/AEP-Registry/catalog.json` (`repository.components_root`).
## Component status

Every TypeScript and mjs component README carries one line after its title: `Status: <status>. Stability: <stability>.`

| Status | Meaning |
|--------|---------|
| normative | AEP relies on this code at runtime or in a release gate. It typechecks strictly and has tests. |
| reference | A tested implementation of a contract that a Rust crate or the host owns. A tested library that the live path does not call is reference too. |
| sketch | Illustrative code under a `sketch/` folder. It compiles and is not shipped behaviour. |

Stability is `stable`, `evolving` or `experimental`.

## TypeScript and mjs checks

The root `package.json` is an npm workspace over the TypeScript and mjs components. `tsconfig.base.json` holds the strict compiler settings (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Run from the repository root:

```bash
npm ci
npm run typecheck   # tsc -p tsconfig.json, no emit
npm run lint        # eslint with typescript-eslint, zero warnings
npm test            # vitest over AEP-Components/**/*.test.{ts,mjs}
```

The CI job `TypeScript typecheck, lint and tests` in `.github/workflows/baseline.yml` runs the same four steps and blocks on each. Tests live in `<component>/tests/`. A single component runs with `npx vitest run AEP-Components/<component>`.

## Kernel pulse owner

The kernel pulse (the 1000 ms wait after freeze-at-seal) is owned by Base Node at `AEP-Base-Node/` with constants in `AEP-Components/base-node-pulse/`. TypeScript dynAEP does not own it. `dynaep-config.yaml` has no `pulse_ms` key. Palette READMEs that do not mention the wait are not a second pulse owner. To change the wait in theory, rebuild Base Node after editing compiled `PULSE_MS`. Keep freeze-at-seal. Do not set kernel drift to the wait length. Keep age longer than the wait.

## Graph state owner

One live graph owns state, which is the Action Lattice under `AEP-Components/dynAEP/`. TypeScript dynAEP holds the live runtime graph state and it is the only state owner.

The other graph surfaces are projections. The hyperlattice under `AEP-Components/hyperlattice/` is the JavaScript view of the live graph. The graph engine under `AEP-Components/graph-engine/` is a workflow runner and a projection helper. The composer canvas reads the projection that `AEP-Components/hyperlattice/lib/graph-store.mjs` holds, so the canvas store keeps a projection and not a private state copy.

## Runtime ledger

One runtime ledger is named. The runtime ledger is the SQLite lattice log in Base Node, which is `AEP-Base-Node/AEP-Crate/src/lattice_log.rs` with the `aep-lattice-log` CLI over the `action-lattice.db` store.

Every other ledger surface is a derived view or a capability that calls the runtime ledger.

| Surface | Standing |
|---------|----------|
| SQLite lattice log in Base Node | The runtime ledger |
| evidence-ledger component | A capability that frontends call, which is not the runtime ledger |
| intent-ledger component | A derived provenance view |
| evaluation chain meet result | A derived view. It is not the runtime ledger |
| host audit log in AEP-CAW | A derived view that records what the enforcer did |
