# Agent Coding Regression Prevention (AEP 2.9 design)

**Status:** ACTIVE design for bootstrap on 2.8 and full enforcement in 2.9  
**Date:** 2026-07-26  
**Authority:** Biosecure UNVACCINATED Supreme User directive  

This document is the **protocol-facing** design. Operator audit inventories stay on host/Gitea NLA-PLATFORM internal paths only (never public GitHub AEP trees).

## Why this exists

Coding agents that work on AEP (or on code governed through AEP) repeatedly reintroduce the same failure classes after "successful" fix waves:

- env or flag bypass of security gates
- happy-path-only tests
- silent drop / fail-open defaults
- incomplete crash restore
- stub or no-op security
- doc/code drift
- destructive over-eagerness
- self-weakening of gates and policies
- infinite re-exec loops without code change

**Principle:** treat every coding agent as an untrusted generator. Move acceptance outside the model. The lattice refuses patches that do not carry and pass proofs.

## 1. Code is a lattice scene

- Proposed changes are Governed Code Scenes, not free-form text drops.
- Agents emit sealed frames with a Proof-Carrying Patch (PCP).
- Base Node (or a non-agent solidifier) is the only final writer for governed paths.

## 2. Proof-Carrying Patch (PCP)

Every security-relevant change must include:

- target files and diff (or AST edit script)
- claimed invariants
- executable negative-path tests for every security function touched
- restore completeness proof when state is claimed
- adversarial suite + self_test_digest (Merkle of tests)
- ML-DSA signature over the object

Incomplete negative-path suite => `IncompleteSecurityProof` anomaly. No env override.

## 3. Evaluation steps C1-C8 (fail-closed)

| Step | Name | Blocks |
| - | - | - |
| C1 | Bypass Detector | env/feature disables security gate |
| C2 | Stub / No-Op Scanner | empty enforcement, identity return, silent catch |
| C3 | Negative-Path Completeness | missing error-branch tests |
| C4 | Restore Completeness | crash restore loses causal state |
| C5 | Order / Determinism Proof | unsorted Merkle / order-dependent claims |
| C6 | Destructive Action Gate | unscoped delete, force-push without quorum |
| C7 | Doc/Code Drift Lock | claims without implementation |
| C8 | Self-Application Rule | AEP-core changes need meta-lattice + full suite |

## 4. External verification harness

1. Apply PCP in sandboxed CAW (seccomp, no network, RO source, RW temp).
2. Run negative tests, full suite, adversarial cases.
3. Measure error-branch coverage; static-scan for bypass/stub/silent-drop.
4. Write signed evidence ledger entry.
5. Only then allow final write.

The model cannot attest that tests passed.

## 5. Meta protection for AEP itself

- Coding agents: Ring 2 (no direct solidify).
- Forbid gate weakening, new env bypasses, security coverage regression.
- Policy/GAP/core crate changes: Auditor ring (different model family) + human signature.
- Kill-switch after N IncompleteSecurityProof anomalies.
- Nightly C-suite with auto-rollback on regression.

## 6. Zero-trust defaults (2.9)

- Cryptographic tool capability tickets (no bare tool name strings).
- VFS without secrets; solidifier performs Gitea writes.
- Ephemeral mTLS session identity.
- Instruction channel vs Data channel (no tools from data).
- AST-bound mutations for governed agents.
- Taint IFC: high taint blocks state-changing tools.
- Zero-socket sandbox + fetch-intent clean room.
- FSM: PLANNING -> DRAFTING -> TESTING -> REVIEW.
- Wasm/Firecracker execute-and-destroy.
- AST hash progression locks (no re-exec same hash).
- Session TTL hop limit; non-renewable tickets.
- Idempotent-only tool surface.

## 7. Bootstrap rules on 2.8 (now)

Until the full lattice lands:

1. Same commit: fix + negative-path test that fails on old tip and passes on new tip.
2. No new security env bypasses.
3. No silent error swallow on security paths.
4. Restore functions need crash-restart tests.
5. Permanent regression fixtures per closed bug ID.
6. After each fix wave: full regression corpus green before the next wave starts.
7. Dependency pins and `cargo audit` in CI.

## 8. Acceptance

- PCP reject path live.
- C1-C8 fixtures pass/fail as designed.
- Harness outside the model.
- Two consecutive fix waves with zero new category regressions.
- Public zero-trust claims only after re-audit under these rules.

## 9. Canonical full plan

Detailed tasks and audit mapping live on Gitea NLA-PLATFORM:

`Platform-Development/aep28-internal-audits/code-audit-07-2026/IMPLEMENTATION-PLAN-AGENT-BUG-RECURRENCE-PREVENTION-2026-07-26.md`
