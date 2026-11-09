# AEP Protocol Components

All bundled AEP protocol components live under this directory. Each subfolder is a first-class component with its own `README.md`, registry manifest (`AEP-Base-Node/AEP-Registry/components/{id}.json`) and `lib/` or `crate/` implementation.

Runtime code for each component lives in that component folder. Client libraries are not a product of AEP 2.9.

Infrastructure and top-level surfaces outside this folder:

- `AEP-Base-Node/` - **mandatory AEP governance kernel** (not a bundled palette component)
- `AEP-CAW/` - CAW host sandboxes. An incorporated part of AEP that runs on the host
- `AEP-Base-Node/AEP-Docks/` - socket dock specs, UCB bridge, Universal Connect Dock (UCD)
- `AEP-Policy-System/` - policy YAML/REGO plus `policy-builder/` and `schema-builder/`
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
| evidence-ledger component | A capability that frontends call. It is not the runtime ledger |
| intent-ledger component | A derived provenance view |
| evaluation chain meet result | A derived view. It is not the runtime ledger |
| host audit log in AEP-CAW | A derived view that records what the enforcer did |
