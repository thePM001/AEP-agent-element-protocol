# PERA Dock (`pera`)

**PERA**

| Property | Value |
|----------|-------|
| Port ID | `pera` |
| Socket suffix | `{AEP_SOCKET_BASE}/pera` |
| Contract | `pera-perceptive-rails` |
| Event type | `docking_pera_perceptive_rails` |
| Priority | 200 (same tier as inference, validation, future) |
| Rust module | `AEP-Base-Node/crate/src/pera.rs` |

## Purpose

*reserved*

## 2.8 status

**Provisioned only.** The Unix socket listens when `aep-base-node --daemon` runs; lattice frames are recorded like other internal docks. No PERA runtime ships in 2.8.

## Wire format

Same as all Base Node docks: newline-delimited JSON with `{"frame": LatticeChannelFrame}`.

