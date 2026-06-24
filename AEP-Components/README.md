# AEP Protocol Components

All bundled AEP protocol components live under this directory. Each subfolder is a first-class component with its own `README.md`, registry manifest (`AEP-Base-Node/registry/components/{id}.json`) and `lib/` or `crate/` implementation.

The TypeScript SDK (`typescript-sdk/`) is a **thin client surface** only (`index.ts`, `gateway.ts`, `cli.ts`). It re-exports sibling components here; it is not a monolith.

Infrastructure and top-level surfaces outside this folder:

- `AEP-Base-Node/` - **mandatory AEP governance kernel** (not a bundled palette component)
- `AEP-Composer-Lite/` - WASM visual canvas (:8424), not a protocol component subfolder
- `AEP-Docks/` - socket dock specs, UCB bridge, Universal Connect Dock (UCD)
- `AEP-Policy-System/` - policy YAML/REGO plus `policy-builder/` and `schema-builder/`
- `AEP-Subprotocols/` - regulation subprotocol crates
- `AEP-NOSHIP/` - internal tests, plans, and docs (not shipped)
- `docker/` - container entrypoint and runtime deps
- `AEP-User-Experience/scripts/` - manual modification and E2E tooling
- `rust/` - build artifact target directory

CCA and the setup agent resolve component paths via `AEP-Base-Node/registry/catalog.json` (`repository.components_root`).
