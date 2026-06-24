# AEP-SDKs

Language SDKs for AEP 2.8. SDKs are **not** protocol components - they are thin compiled-AI client surfaces that call lattice-gated APIs.

| SDK | Path | Status |
|-----|------|--------|
| TypeScript aep-protocol | `typescript/aep-protocol/` | Operational |
| TypeScript dynaep | `typescript/dynaep/` | Bridge + Action Lattice (`src/bridge.ts`, `cli/dynaep-cli.ts`) |
| React dynaep | `react/dynaep-react.tsx`, `dynaep-copilotkit.tsx` | dynAEP UI bindings |
| Python aep | `python/aep-protocol/` | Operational |
| Python dynaep | `python/dynaep/` | Operational |
| Go | `go/` | Operational |
| Rust | `rust/` | Operational |
| JavaScript | `javascript/` | Operational |
| Vue | `vue/` | Operational |
| React | `react/` | Operational |
| Astro | `astro/` | Operational |
| Elixir | `elixir/` | Operational |
| C++ | `cpp/` | Operational |
| Clojure | `clojure/` | Operational |
| HTML/CSS | `html-css/` | Operational |

Paradigm: [Compiled AI](https://doi.org/10.48550/arXiv.2604.05150) - deterministic artifacts, zero runtime LLM in SDK transports.

**NPM is forbidden.** Use lattice-gated distribution or language-native package managers only where policy allows.

## Produce and verify all SDKs

```bash
node AEP-User-Experience/scripts/produce-aep-sdks.mjs
```

The producer:

1. Fixes and validates TypeScript `aep-protocol` entrypoints
2. Compiles TypeScript `dynaep` to `dist/`
3. Packages both Python SDK trees (`aep` + `dynaep`)
4. Runs compile/test smoke checks for Go, Rust, C++, Elixir, JavaScript
5. Verifies Vue, React, Astro, Clojure, and HTML/CSS entry files
6. Stages artifacts under `AEP-SDKs/dist/` and writes `sdk-manifest.json`

## Python path setup

```bash
export PYTHONPATH="AEP-SDKs/python/aep-protocol:AEP-SDKs/python/dynaep"
python3 -c "from aep.lattice_client import build_lattice_frame; from dynaep import DynAEPBridge"
```

## Lattice binary

Build Base Node once so SDK smoke tests can call `aep-lattice-log`:

```bash
cd AEP-Base-Node && cargo build --bin aep-lattice-log
```