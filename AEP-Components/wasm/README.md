# AEP WASM Sandbox (Layer 2 Isolation)

Policy and hook evaluation runs inside a fuel-limited WASM sandbox. All access is via **Lattice Channels** only.

## Service

| Property | Value |
|----------|-------|
| Binary | `aep-wasm-sandbox` |
| Socket | `${AEP_SOCKET_BASE}/wasm_sandbox` |
| Env | `WASM_SANDBOX_SOCKET`, `WASM_SANDBOX=1` |
| Wire format | `{ "frame": LatticeChannelFrame }` only |
| Evaluate | Seal+record via `aep-lattice-log`, then send frame to socket |

Plain HTTP on `:8423` is **rejected** when `AEP_LATTICE_STRICT=1`.

## Docker

Enabled by default (`WASM_SANDBOX=1`). Composer Lite proxies health at `GET /api/wasm-sandbox/health` via lattice socket probe.

## Implementation

Rust crate: `wasm/crate` (wasmtime, memory page cap, fuel metering, Unix socket listener).