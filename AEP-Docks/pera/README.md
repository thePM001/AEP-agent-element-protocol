# PERA Dock (`pera`)

**PERA** (Perceptive Rails) is the Base Node docking port for future perception and world-model integration. It follows the same pattern as the **future features** dock: lattice-gated, internal, and reserved until the PERA runtime is enabled.

| Property | Value |
|----------|-------|
| Port ID | `pera` |
| Socket suffix | `{AEP_SOCKET_BASE}/pera` |
| Contract | `pera-perceptive-rails` |
| Event type | `docking_pera_perceptive_rails` |
| Priority | 200 (same tier as inference, validation, future) |
| Rust module | `AEP-Base-Node/crate/src/pera.rs` |

## Purpose

When activated, the PERA dock will receive lattice-sealed frames for:

- Sensor and data-stream perception ingress
- Self-output feedback (effects of agent actions in the physical world / internet)
- Internal world-model updates (AEP scene graphs, sub-model arrays)
- Status evolution tracking across perception sub-models

## 2.8 status

**Provisioned only.** The Unix socket listens when `aep-base-node --daemon` runs; lattice frames are recorded like other internal docks. No PERA runtime ships in 2.8.

Architecture reference: Gitea `NLA-PLATFORM` repo, `NLA-Research/pera.md`.

## Wire format

Same as all Base Node docks: newline-delimited JSON with `{"frame": LatticeChannelFrame}`.

Reserved action paths (dynAEP, when runtime ships):

- `pera:perception:ingest`
- `pera:world_model:update`
- `pera:status:evolution`
- `pera:hyperframe:create`