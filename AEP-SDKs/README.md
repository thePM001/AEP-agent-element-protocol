# AEP-SDKs

Language SDKs for AEP 2.8. SDKs are not protocol components. They are client surfaces that call lattice-gated APIs. README and this file share one maturity table whose classes are native sealer, thin client, source-only thin client, placeholder and not product Admit.

| SDK | Path | Class |
|-----|------|-------|
| TypeScript aep-protocol | `typescript/aep-protocol/` | thin client |
| TypeScript dynAEP | `typescript/dynaep/` | not product Admit |
| React dynAEP | `react/dynaep-react.tsx` | thin client |
| Python aep-protocol | `python/aep-protocol/` | source-only thin client |
| Python dynAEP | `python/dynaep/` | source-only thin client |
| Go | `go/` | thin client |
| Rust | `rust/` | thin client |
| JavaScript | `javascript/` | thin client |
| Vue | `vue/` | placeholder |
| React | `react/` | thin client |
| Astro | `astro/` | placeholder |
| Elixir | `elixir/` | thin client |
| C++ | `cpp/` | thin client |
| Clojure | `clojure/` | thin client |
| HTML/CSS | `html-css/` | placeholder |

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