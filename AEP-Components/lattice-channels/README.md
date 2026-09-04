# Lattice Channels (unified)

Single AEP component for lattice channel transport, TypeScript client helpers, and the Rust `aep-lattice-channel` crate.

- `lib/` - MJS/TS transport (`latticeGatedFetch`, frame builder)
- `client/` - TypeScript client re-exports
- `crate/` - Rust lattice channel implementation

Compiled AI: deterministic frame contracts; no runtime LLM in this layer.

## Kernel pulse after the sealed capsule

Lattice Channels carry the sealed capsule. They do not own the wait. After the seal is verified the capsule waits 1000 ms on the Base Node clock with time frozen at seal. There is no `pulse_ms` transport field. See `AEP-Base-Node/README.md` for the compiled constant and the theoretical rebuild path. TypeScript dynAEP remains a standalone component.
