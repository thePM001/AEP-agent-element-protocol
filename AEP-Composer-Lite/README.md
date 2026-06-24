# AEP Composer Lite (WASM Visual Canvas)

**Composer Lite IS the WASM Composer** for AEP 2.8 public tier. Dark blue futuristic canvas where users define nodes, place them and wire connections. **This is NOT the internal NLA Agent Composer** (`:8415`/`:8416`).

## Features

- Visual node canvas with drag, connect, pan/zoom
- Node types: Agent, WASM Policy, Validation/Inference docks, Lattice Event, Transform
- Graph persistence to `composer-lite-graph.json` in `AEP_DATA`
- WASM policy evaluation via lattice socket (`POST /api/wasm/evaluate` -> `wasm_sandbox`)
- **CCA** (Composer Canvas Assistant) - optional LLM via **OpenRouter** or **local llama.cpp**
- **CAW Framework** integration - CCA plans enable `caw-framework` for governed coding agents; shell workloads run inside `aep-caw` sandboxes (GAP-authored profiles)

## CAW sandboxes (execution layer)

Composer Lite is the planning and canvas surface. **Host enforcement** for coding agents is **CAW** (`AEP-Components/caw-framework/`, binary `aep-caw`):

| Piece | Role |
|-------|------|
| GAP profiles | `AEP-Components/gap/policies/reference/caw-*.gap` (`agent-sandbox`, `coding-agent`, `restricted`, …) |
| Compile | `node AEP-Components/gap/lib/gap-compile.mjs --materialize $AEP_DATA` |
| Runtime | `aep-caw session create`, `aep-caw wrap`, `aep-caw exec` |
| CCA | Deployment plans auto-enable `caw-framework`; see root README [GAP-centric policies and CAW sandboxes](../README.md#gap-centric-policies-and-caw-sandboxes) |

**Operator rule:** agents with shell access must run via `aep-caw exec`, not raw bash. Full operator guide: [`AEP-Components/caw-framework/README.md`](../AEP-Components/caw-framework/README.md).

## Service

| Property | Value |
|----------|-------|
| Port | `8424` (`COMPOSER_LITE_PORT`) |
| Health | `GET /api/health` |
| Canvas UI | `GET /` |
| Graph API | `GET/PUT /api/graph` |
| CCA chat | `POST /api/cca/chat` |
| Inference config | `GET/POST /api/inference` |

## Install wizard (visual)

Fresh-environment activation UI (LRPs, components, CAW, inference, CCA bootstrap):

| URL | Purpose |
|-----|---------|
| `GET /install` | Multi-step install wizard |
| `GET /api/setup/catalog` | LRP + component catalog |
| `GET /api/setup/status` | Activation + dock health |
| `POST /api/setup/activate` | Run setup agent with selections |
| `POST /api/setup/cca-bootstrap` | Generate + execute CCA plan from intent |

```bash
open http://localhost:8424/install
```

## Run locally

```bash
AEP_DATA=/tmp/aep-data node composer-lite/server.mjs
open http://localhost:8424/install
```

## Docker

```bash
docker compose -f docker-compose.public.yml up -d
docker compose -f docker-compose.public.yml exec aep aep-setup-agent
open http://localhost:8424
```

Disable with `COMPOSER_LITE=0`.

## Component registry

- `GET /api/registry` - bundled catalog and installed extensions
- `POST /api/registry/install` - enable a component for WASM palette extensions
- `GET /api/palette` - merges registry node types when enabled

See [registry/README.md](../AEP-Base-Node/registry/README.md). Default install is offline (`AEP_COMPONENTS_FETCH=0`).
