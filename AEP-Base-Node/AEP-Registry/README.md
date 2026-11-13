# AEP Component Registry

This folder belongs to component 01 (AEP Base Node) and the README of the whole component is `AEP-Base-Node/README.md`.

Offline-first catalog of protocol modules shipped in the Docker image. Optional community extensions resolve from the public GitHub repository when `AEP_COMPONENTS_FETCH=1`.

## Local catalog

- `catalog.json` - index of bundled and optional components
- `components/` - per-component manifests
- `lib/registry.mjs` - loader used by Base Node and hyperlattice

Manifest `setup_hooks` and `actions` are consumed by `AEP-Base-Node/AEP-Registry/lib/setup-hooks.mjs` during plan execution.

## Public GitHub extensions

Set these only when you want to merge newer catalog entries from GitHub:

```bash
export AEP_COMPONENTS_REPO=https://github.com/thePM001/AEP-agent-element-protocol
export AEP_COMPONENTS_FETCH=1
export AEP_COMPONENTS_BRANCH=main
```

Default install is fully offline. No remote server is required.

Public catalog URL: `https://github.com/thePM001/AEP-agent-element-protocol`

## Layout

| Path | Role |
|------|------|
| `catalog.json` | The index of bundled and optional components |
| `components/` | One manifest per component |
| `schemas/` | JSON schemas for manifests, records and the node registry |
| `profiles/` | Profiles for a single node and for several nodes |
| `nodes.json` | The example node registry |
| `lib/registry.mjs` | The catalog loader |
| `lib/manifest-validator.mjs` | The manifest validator behind the registry section of `aep-check.mjs` |
| `lib/setup-hooks.mjs` | Setup hooks and actions of a manifest |
| `scripts/` | The script for materialized manifests |

## Run and test

The registry section of the root check validates the catalog and every manifest. Run it from the repository root:

```bash
AEP_CHECK_ONLY=registry node aep-check.mjs
```
