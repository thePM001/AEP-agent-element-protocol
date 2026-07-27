# AEP Component Registry

Offline-first catalog of protocol modules shipped in the Docker image. Optional community extensions resolve from the public GitHub repository when `AEP_COMPONENTS_FETCH=1`.

## Local catalog

- `catalog.json` - index of bundled and optional components
- `components/` - per-component manifests
- `lib/registry.mjs` - loader used by setup-agent and Composer Lite

## CCA Setup Agent (recommended)

CCA loads every manifest (capabilities, actions, setup_hooks, cca blocks), probes environment and generates **ImplementationPlan** JSON.

```bash
aep-cca probe
aep-cca plan --intent "Postgres evidence, EU AI Act, 3 coding agents, local llama.cpp"
aep-cca plan --intent "..." --execute
```

Composer Lite exposes the same via `/api/cca/*` endpoints.

## Setup agent

Executes CCA plans or legacy interactive activation:

```bash
aep-setup-agent --from-plan
aep-setup-agent --cca --intent "your deployment"
aep-setup-agent --non-interactive
```

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

## Add a WASM canvas node type

1. Copy `AEP-Base-Node/registry/components/community-extension-template.json` to a new file under `AEP-Base-Node/registry/components/`.
2. Define `composer_node` in the manifest (type, label, color).
3. Add an entry to `AEP-Base-Node/registry/catalog.json` with `"composer_palette": true`.
4. Re-run setup-agent and enable the component or call `POST /api/registry/install` from Composer Lite.

## API

Composer Lite exposes:

- `GET /api/registry` - full catalog plus installed extensions
- `GET /api/palette` - built-in nodes plus registry palette extensions
- `POST /api/registry/install` - enable a component id locally