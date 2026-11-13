# Base Node pulse

Compiled kernel clocks for AEP 2.9 live in this crate. Pulse hold is the wait after a sealed capsule is opened: Base Node freezes the clock at seal then holds until `PULSE_MS` (1000) before collect-all checks, with drift `MAX_DRIFT_MS` (50) against that freeze, age `MAX_AGE_MS` (5000) and queue caps of 256 capsules and 262144 bytes.

The freeze is the Base Node clock, read when the frame arrives. The timestamp an agent seals into its event is a claim that Base Node compares with that clock. It never becomes the freeze. The window is not symmetric: the stamp is written before the seal and read after the transit, so a stamp from an agreeing clock is always in the past. A stamp that is ahead of the clock by more than `MAX_DRIFT_MS` is refused at enqueue as `temporal:future_skew`. A stamp that is behind by more than `MAX_AGE_MS` is refused as `temporal:stale_event`. A refused frame takes no room in the queue. A stamp inside the window is the event time that the time walls of Admit measure against. It does not move the hold: a capsule turns ready one pulse after it arrived.

One signer holds at most `QUEUE_SIGNER_SHARE_CAPSULES` (128) capsules and `QUEUE_SIGNER_SHARE_BYTES` (131072) bytes of the queue, which is half of each cap. A signer at its share reads `pulse queue signer share capsules` or `pulse queue signer share bytes` while every other signer is still served.

Wire sent_at freshness sits beside pulse hold as `MAX_FRAME_AGE_SECS` (300) and `MAX_FRAME_FUTURE_SKEW_SECS` (60). `docking.rs` must import those constants and must not keep local copies because the wire window is wider: it covers transit before open while pulse age covers hold after freeze.

TypeScript dynAEP does not own this wait and `dynaep-config.yaml` has no `pulse_ms` key.

## How the wait can be changed in theory

A builder who wants a different wait edits `PULSE_MS` in `crate/src/lib.rs` and rebuilds Base Node while keeping freeze-at-seal. Do not set `MAX_DRIFT_MS` to the wait length because tests require they differ and they reject a 1000 ms drift default. Keep `MAX_AGE_MS` longer than `PULSE_MS` or capsules expire before they become ready and do not replace pulse age 5000 with 300 seconds. Tests currently pin `PULSE_MS == 1000` so a theoretical rebuild must update those pins and there is no yaml or env toggle.

## Kernel pulse

Two compiled clocks live in `aep-base-node-pulse`. Pulse hold is the wait after a sealed capsule (the encrypted frame on the wire) is opened: Base Node freezes the clock at seal, waits 1000 ms, then runs every check together and only then carries out the allowed action. Putting a capsule on the dock is not that check because after the wait the client asks for the result by the capsule hash so a deny names the closed walls and an allow returns an event id. Allowed clock drift is 50 ms against the freeze which is why a 1000 ms hold still meets drift while a capsule held longer than five seconds is aged out.

Wire sent_at freshness is the other clock. Before open, `frame_is_fresh` checks `sent_at_unix` against `MAX_FRAME_AGE_SECS` (300) and `MAX_FRAME_FUTURE_SKEW_SECS` (60). The wire window is wider because it covers transit before open while pulse age covers hold after freeze so five seconds of pulse age is not the 300 second wire window.

### This wait is not a dynAEP setting

The wait is a compiled kernel constant of 1000 ms. It is not an environment variable and it is not a dynAEP yaml key. TypeScript dynAEP remains a standalone component and does not own this wait. The 1000 ms NTP LARGE_STEP figure in dynAEP timekeeping is a clock-sync cap rather than this kernel wait so LARGE_STEP must not be treated as this wait.

### How the wait can be changed in theory

A builder who wants a different wait rebuilds Base Node with a different compiled pulse length. Freeze-at-seal remains so the hold is judged against the freeze rather than a moving clock. Allowed drift is not set to the wait length so `MAX_DRIFT_MS` must not be set to 1000. The five-second age remains longer than the wait or capsules would expire before they became ready so pulse age 5000 must not be replaced with 300 seconds. This is a kernel rebuild rather than a yaml or env toggle and the 300 second wire window remains a separate compiled pair.
