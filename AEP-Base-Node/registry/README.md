# AEP Component Registry

Offline-first catalog of protocol modules shipped in the Docker image. Optional community extensions resolve from the public GitHub repository when `AEP_COMPONENTS_FETCH=1`.

## Local catalog

- `catalog.json` - index of bundled and optional components
- `components/` - per-component manifests
- `lib/registry.mjs` - loader used by Base Node and hyperlattice

Manifest `setup_hooks` and `actions` are consumed by `AEP-Base-Node/registry/lib/setup-hooks.mjs` during plan execution.

## Public GitHub extensions

Set these only when you want to merge newer catalog entries from GitHub:

```bash
export AEP_COMPONENTS_REPO=https://github.com/thePM001/AEP-agent-element-protocol
export AEP_COMPONENTS_FETCH=1
export AEP_COMPONENTS_BRANCH=main
```

Default install is fully offline. No remote server is required.

Public catalog URL (when 2.8 is published): `https://github.com/thePM001/AEP-agent-element-protocol`

