# AEP 2.8 Base Node Docking Ports

All docking traffic uses **Lattice Channels** with **PQEncryptedCapsule** (ML-KEM-768 + AES-256-GCM + ML-DSA-65).

| Port ID | Name | Priority | Socket suffix | Purpose |
|---------|------|----------|---------------|---------|
| `inference_engine` | Inference Engine Dock | 200 | `/inference` | AEP Inference Engines |
| `validation_engine` | Validation Engine Dock | 200 | `/validation` | AEP validation engines (2.75e Docker / future) |
| `future_features` | Future Features Dock | 200 | `/future` | Reserved internal plugins (not foreign ingress) |
| `regulation_module` | Regulation Module Dock | 150 | `/regulation` | Legacy Regulation Providers (LRPs) |

EPSCOM regulations always take priority over LRP rules (`epscom_priority: 255`).

Unix socket listeners are live in Phase 4 (`aep-base-node --daemon`). Protocol: newline-delimited JSON per connection.

| Request | Response |
|---------|----------|
| `{"ping":true}` | `{"ok":true,"pong":true}` |
| `{"frame":{...LatticeChannelFrame}}` | `{"ok":true,"digest":"...","event_id":N}` |
| `{"event":{...DynAepEventInput}}` | validation dock only; same as `aep-lattice-log record` |

Health JSON includes `docking_ports_listening` when socket files exist.