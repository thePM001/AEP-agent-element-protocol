# AEP Conformance Test Suite

Test battery that determines who gets to claim AEP-compliance for the **2.8 public tier**.

## Status

**Active** - runner ships with AEP 2.8 Phase 5.

## License

Fair Core License 1.0. Converts to Apache 2.0 after 24 months per version. See `LICENSE` for terms.

## What This Gates

The reserved names "AEP", "AEP-compliant", "dynAEP" are subject to [`AEP-Components/dynAEP/NAME-POLICY.md`](../dynAEP/NAME-POLICY.md). Implementations may use these names only after passing this test suite and submitting a conformance report to the public registry.

## Running the Suite

From the repository root:

```bash
./AEP-Components/conformance/runner/run.sh
```

### Rust checks only

```bash
cargo run --release -p aep-conformance
```

### Node integration checks only

```bash
cd AEP-Components/conformance/harness && npm install && ./node_modules/.bin/vitest run
```

(Local harness only - not npm registry distribution.)

## Check Catalog

See [`tests/manifest.json`](tests/manifest.json) for the full CC-01 through CC-16 catalog.

| ID | Area |
|----|------|
| CC-01 - CC-09 | Rust mandatory (crypto, channel, mesh, docking) |
| CC-10 | POTOMITAN failover health E2E |
| CC-11 | AgentMesh trust rotation |
| CC-12 | PQ capsule bridge roundtrip |
| CC-13 - CC-14 | Plain ping/event side-channel rejection |
| CC-15 | Lattice-mandatory policy artifacts |
| CC-16 | writing.gap documentation lint |

## Submitting a Conformance Report

See [`registry/REGISTRY.md`](registry/REGISTRY.md).