# Base Node pulse

Compiled kernel clocks for AEP 2.9 live in this crate. Pulse hold is the wait after a sealed capsule is opened: Base Node freezes the clock at seal then holds until `PULSE_MS` (1000) before collect-all checks, with drift `MAX_DRIFT_MS` (50) against that freeze, age `MAX_AGE_MS` (5000) and queue caps of 256 capsules and 262144 bytes.

The freeze is the Base Node clock, read when the frame arrives. The timestamp an agent seals into its event is a claim that Base Node compares with that clock. It never becomes the freeze. The window is not symmetric: the stamp is written before the seal and read after the transit, so a stamp from an agreeing clock is always in the past. A stamp that is ahead of the clock by more than `MAX_DRIFT_MS` is refused at enqueue as `temporal:future_skew`. A stamp that is behind by more than `MAX_AGE_MS` is refused as `temporal:stale_event`. A refused frame takes no room in the queue. A stamp inside the window is the event time that the time walls of Admit measure against. It does not move the hold: a capsule turns ready one pulse after it arrived.

One signer holds at most `QUEUE_SIGNER_SHARE_CAPSULES` (128) capsules and `QUEUE_SIGNER_SHARE_BYTES` (131072) bytes of the queue, which is half of each cap. A signer at its share reads `pulse queue signer share capsules` or `pulse queue signer share bytes` while every other signer is still served.

Wire sent_at freshness sits beside pulse hold as `MAX_FRAME_AGE_SECS` (300) and `MAX_FRAME_FUTURE_SKEW_SECS` (60). `docking.rs` must import those constants and must not keep local copies because the wire window is wider: it covers transit before open while pulse age covers hold after freeze.

TypeScript dynAEP does not own this wait and `dynaep-config.yaml` has no `pulse_ms` key.

## How the wait can be changed in theory

A builder who wants a different wait edits `PULSE_MS` in `crate/src/lib.rs` and rebuilds Base Node while keeping freeze-at-seal. Do not set `MAX_DRIFT_MS` to the wait length because tests require they differ and they reject a 1000 ms drift default. Keep `MAX_AGE_MS` longer than `PULSE_MS` or capsules expire before they become ready and do not replace pulse age 5000 with 300 seconds. Tests currently pin `PULSE_MS == 1000` so a theoretical rebuild must update those pins and there is no yaml or env toggle.
