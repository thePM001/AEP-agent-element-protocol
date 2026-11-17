# AEP Isolation

Seal record contract for the AEP 2.9 protocol crate graph.

- **Crate:** `AEP-Components/isolation/crate`
- **Crate name:** `aep-isolation`
- **Kernel type:** the shared seal record type lives in the kernel type crate

## What this crate is

This crate is a seal record contract. It records one operating system process
against one isolation specification and it returns the public `ProcessSealed`
record. The record binds the process id, the algorithm and the specification
digest, so a reused process id with a different specification can never satisfy
a seal.

This crate is not an enforcer. It applies no restriction of its own. The Rust CAW
in `AEP-CAWs-RustGvisor` confines a process inside gVisor. A seal on its own is a
record and not confinement.

## Read the record

| Call | Result |
|------|--------|
| `IsolationSpec::digest` | The canonical digest of one specification |
| `seal_process` | One seal record for a process and a specification |
| `seal_holds` | True only for the same process and the same specification |
| `seal_once` | One seal per process, so a caller cannot widen a live seal |

## Binding a seal to a sandbox plan

A specification carries two optional fields. `runtime` is the name of the sandbox
runtime. `plan_digest` is the sha256 digest of the sandbox plan. Both are empty
or both are set. `IsolationSpec::for_sandbox` sets them. A seal over such a
specification holds only for the process that runs under exactly that plan in that
runtime. A specification with neither field has the digest it always had.

## Tests

`cargo test -p aep-isolation` runs the seal record tests in `crate/src/lib.rs`
plus the contract test in `crate/tests/seal_record_contract.rs`. Both state that
the crate records a seal and does not enforce one.
