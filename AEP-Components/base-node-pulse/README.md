# Base Node pulse

Compiled kernel clocks for AEP 2.8 live in this crate. Pulse hold is the wait after a sealed capsule is opened: Base Node freezes the clock at seal then holds until `PULSE_MS` (1000) before collect-all checks, with drift `MAX_DRIFT_MS` (50) against that freeze, age `MAX_AGE_MS` (5000) and queue caps of 256 capsules and 262144 bytes.

Wire sent_at freshness sits beside pulse hold as `MAX_FRAME_AGE_SECS` (300) and `MAX_FRAME_FUTURE_SKEW_SECS` (60). `docking.rs` must import those constants and must not keep local copies because the wire window is wider: it covers transit before open while pulse age covers hold after freeze.

TypeScript dynAEP does not own this wait and `dynaep-config.yaml` has no `pulse_ms` key.

## How the wait can be changed in theory

A builder who wants a different wait edits `PULSE_MS` in `crate/src/lib.rs` and rebuilds Base Node while keeping freeze-at-seal. Do not set `MAX_DRIFT_MS` to the wait length because tests require they differ and they reject a 1000 ms drift default. Keep `MAX_AGE_MS` longer than `PULSE_MS` or capsules expire before they become ready and do not replace pulse age 5000 with 300 seconds. Tests currently pin `PULSE_MS == 1000` so a theoretical rebuild must update those pins and there is no yaml or env toggle.
