# EPSCOM Detection Signatures

**Location:** `AEP-Base-Node/signatures/` (Base Node kernel adjunct, default wired, CCA accessible)

Detection signatures for the Agent Element Protocol (AEP). Authored and curated by **EPSCOM** (Eudaimonic Earth Post-Scarcity Committee). Part of NLA structure - not an optional root-level folder.

## Layout

```
AEP-Base-Node/signatures/
  signatures/       # YAML detection rules (one file per rule)
  trust-bundle/     # SHA-256 structure index. Mode sha256-structure. ML-DSA is not claimed.
  schemas/          # signature-v1.schema.json
  lib/              # signatures-registry.mjs, signatures-context.mjs (CCA)
  tooling/          # validate-signatures.mjs
  docs/             # authoring guides
```

## Default wiring

- **Docker/bootstrap:** `base-node.json` -> `epscom_signatures.enabled: true`
- **CCA:** `loadSignaturesContext()` in registry knowledge bundle
- **Registry:** `epscom-signatures` component (`default_enabled: true`)
- **Scanners:** consume via `scanWithSignatures()` from `lib/signatures-registry.mjs`

## Trust bundle

Mode sha256-structure. ML-DSA is not claimed. Detectors load the trust-bundle index, verify SHA-256 structure then hot-load YAML files listed in entries. This bundle does not claim ML-DSA.

```bash
node AEP-Base-Node/signatures/tooling/validate-signatures.mjs
```

## Licensing

- **Signature content** (`signatures/`, `schemas/`, `trust-bundle/`): CC BY-SA 4.0 (`LICENSE-CONTENT`)
- **Tooling** (`tooling/`, `lib/`): Apache 2.0 (`LICENSE-TOOLING`)
