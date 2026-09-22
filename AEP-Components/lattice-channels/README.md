# Lattice Channels (unified)

Single AEP component for lattice channel transport, TypeScript client helpers and the Rust `aep-lattice-channel` crate.

- `lib/` - MJS/TS transport (`latticeGatedFetch`, frame builder)
- `client/` - TypeScript client re-exports
- `crate/` - Rust lattice channel implementation

Compiled AI: deterministic frame contracts; no runtime LLM in this layer.

## Display client

The reference client for the Base Node display API lives at `client/display-api/`. It posts one JSON body that carries a sealed display frame and reads a JSON projection back. The TypeScript client is `client/display-api/index.ts` and the Python client is `client/display-api/display.py`. Each one ships a seal path that runs the Base Node seal command, so a frontend author writes no seal code and each one accepts a unix socket path or a host plus a port and uses HTTP JSON over TLS against a host. A live TLS JSON test sits beside each client and `client/display-api/display_staging_demo.py` proves several sectors of one source end to end. See `AEP-Components/display-api/README.md` for the catalog and the grant wall.

## Kernel pulse after the sealed capsule

Lattice Channels carry the sealed capsule. They do not own the wait. After the seal is verified the capsule waits 1000 ms on the Base Node clock with time frozen at seal. There is no `pulse_ms` transport field. See `AEP-Base-Node/README.md` for the compiled constant and the theoretical rebuild path. TypeScript dynAEP remains a standalone component.
