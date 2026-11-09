# AEP Conformance Test Suite

Status: normative. Stability: evolving. The writing lint and the consolidation scan are release gates; the concern list of the scan still changes.

Test battery that determines who gets to claim AEP-compliance for the **2.9 public tier**.

## Status

**Active** - runner ships with AEP 2.9.

## License

Fair Core License 1.0. Converts to Apache 2.0 after 24 months per version. No separate licence file ships with this suite.

## What This Gates

The reserved names "AEP", "AEP-compliant", "dynAEP" are subject to [`AEP-Components/dynAEP/NAME-POLICY.md`](../dynAEP/NAME-POLICY.md). Implementations may use these names only after passing this test suite and submitting a conformance report to the public registry.

## Running the Suite

From the repository root:

```bash
./AEP-Components/conformance/runner/run.sh
```

The runner needs cargo and node 22 with npm. It validates the manifest, builds the kernel binaries, runs every listed check, runs the language neutral vectors and then accounts for the run. It fails when any listed check did not run or did not pass, so no check is declared and skipped.

### Kernel checks only

```bash
cargo run --release -p aep-conformance
```

### Vectors against the kernel only

```bash
cargo build --release -p aep-conformance
rust/target/release/aep-conformance vectors
```

### vitest checks

The vitest checks run inside `run.sh`, which builds the kernel binaries, provisions the agent key CC-15 signs with and installs the harness from its lock file. Local harness only, not an npm registry distribution.

## Check Catalog

[`tests/manifest.json`](tests/manifest.json) is the catalog. Its `checks` list holds every check a compliance claim rests on. Its `planned` list holds checks whose subject is not in the public tree. Each planned check gives its reason and carries `"claim": "none"`. Nothing runs it.

| ID | Runner | Area |
|----|--------|------|
| CC-01 - CC-09 | Rust kernel | Crypto, channel, mesh and docking |
| CC-10 | Rust kernel | Base Node health in POTOMITAN mode when the internet drops and the mesh packet plane |
| CC-11 | Rust kernel | Docking trust_score moves the AgentMesh trust tier |
| CC-13 - CC-14 | Rust kernel | Plain ping and event side-channel rejection |
| CC-15 | vitest | Lattice-mandatory policy artifacts and frame builder |
| CC-16 | node | writing.gap documentation lint |
| CC-17 | vitest | EPSCOM kernel writing enforcement through aep-lattice-log |
| CC-24 | vitest | Intent ledger chain with evidence-ledger cross-ref |
| CC-26 | vitest | Intent knots in Lattice Memory with the optional Agentstream mirror |
| CC-28 - CC-34 | cargo test | UCM |
| CC-12, CC-18 - CC-23, CC-25, CC-27 | planned | No claim |

## Language neutral vectors

[`vectors/`](vectors/README.md) holds versioned JSON vectors that pin the answers of the Rust kernel, which is normative. The Go CAW, the TypeScript helpers and the example third-party runner run the same files. A third party can run them without a Rust toolchain.

## Submitting a Conformance Report

See [`registry/REGISTRY.md`](registry/REGISTRY.md).
