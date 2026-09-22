# AEP Protocol Components

All bundled AEP protocol components live under this directory. Each subfolder is a first-class component with its own `README.md`, registry manifest (`AEP-Base-Node/AEP-Registry/components/{id}.json`) and `lib/` or `crate/` implementation.

Runtime code for each component lives in that component folder. Client libraries are not a product of AEP 2.8.6.

Infrastructure and top-level surfaces outside this folder:

- `AEP-Base-Node/` - **mandatory AEP governance kernel** (not a bundled palette component)
- `AEP-CAW/` - CAW host sandboxes. An incorporated part of AEP that runs on the host
- `AEP-Base-Node/AEP-Docks/` - socket dock specs, UCB bridge, Universal Connect Dock (UCD)
- `AEP-Policy-System/` - policy YAML/REGO plus `policy-builder/` and `schema-builder/`
- `docker/` - container entrypoint and runtime deps
- `rust/` - build artifact target directory

The catalog resolves component paths via `AEP-Base-Node/AEP-Registry/catalog.json` (`repository.components_root`).

## Kernel pulse owner

The kernel pulse (the 1000 ms wait after freeze-at-seal) is owned by Base Node at `AEP-Base-Node/` with constants in `AEP-Components/base-node-pulse/`. TypeScript dynAEP does not own it. `dynaep-config.yaml` has no `pulse_ms` key. Palette READMEs that do not mention the wait are not a second pulse owner. To change the wait in theory, rebuild Base Node after editing compiled `PULSE_MS`. Keep freeze-at-seal. Do not set kernel drift to the wait length. Keep age longer than the wait.

## Display API

The governed display API for arbitrary frontends is the display API and its data lives at `AEP-Components/display-api/`. That folder carries the display catalog, the grant wall, the source locator files and the default client manifest. The dock that reads them is kernel code at `AEP-Base-Node/AEP-Crate/src/dock_display.rs`. A frontend reads a JSON projection over HTTP JSON or over the JSON line protocol, on TLS with a client certificate and every read is a sealed lattice channel frame. Base Node holds the pre-staging area, so several sectors of one named source stage side by side and each view projects its own pair after Admit. The reference clients and their tests live at `AEP-Components/lattice-channels/client/display-api/` and the operator document is at `AEP-User-Experience/docs/DISPLAY-API.md`.

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
