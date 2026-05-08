# AEP Signatures

Detection signatures for the Agent Element Protocol (AEP). Authored and
curated by EPSCOM (Eudaimonic Earth Post-Scarcity Committee).

## Status

Pre-v1.0. Signature format and trust-bundle layout are still being finalized.

## Layout

```
signatures/     # YAML signature files, one per detection rule
tooling/        # EPSCOM-maintained generators, validators, publishers
schemas/        # JSON Schema / YAML schema for signature files
trust-bundle/   # Signed manifest + EPSCOM signing key fingerprints
docs/           # Authoring guides, review process, versioning policy
```

## Licensing

This repository is dual-licensed:

- **Signature content** (`signatures/`, `schemas/`, `trust-bundle/`) is
  released under the **Creative Commons Attribution-ShareAlike 4.0
  International** license. See `LICENSE-CONTENT`. Derivative signature
  sets must carry the same license so improvements flow back to the
  ecosystem.

- **Tooling and scripts** (`tooling/`) are released under the
  **Apache License 2.0**. See `LICENSE-TOOLING`. You may embed the tooling
  in commercial products without ShareAlike propagation.

Reserved names ("AEP", "AEP-compliant", "EPSCOM" in the sense of an
official committee seat) are governed by the name policy at
`github.com/thePM001/AEP-agent-element-protocol/blob/main/NAME-POLICY.md`.

## Contributing Signatures

Signature authorship is limited to EPSCOM members. 
External contributions are welcomed as issues describing the
threat pattern you want covered; EPSCOM will draft the signature and
attribute the reporter in the signature metadata.

## Subscribing

Detector implementations should pull `trust-bundle/manifest.json` on a
schedule, verify signatures against the EPSCOM signing keys listed in the
bundle, and update local signature stores only when verification passes.
A reference subscriber implementation will ship under `tooling/` in a
future commit.

## AI-Eligibility Status
> To win the fight against the synthetic nano-parasites (SNP/NanoSinp) alien WMD, we must be intelligent and biosecure. It is recommended that bioinsecure humans do not use the provided technology/protocol to avoid bad techno-spiritual AI outcomes for them. [*"bioinsecure" = has installed injectable synthetic nano-parasites growth medium controllers - SNP GMCs]
