# 10 / Base Node Pulse

Status: normative. Stability: stable. The constants are compiled and crate tests pin their values.

## What it is

The Base Node Pulse is the fixed validation interval of the kernel. When a capsule arrives, the Base Node freezes its clock for this capsule, keeps the capsule for 1000 ms and then runs every check against the frozen time. Proposals arriving in the same interval are judged against the same clock rule, so timing never decides a verdict by accident.

## Place among the 18

The AEP Base Node (01) hands each verified capsule from the Lattice Channels (08) to the pulse queue. After the wait the content enters the One Validation Envelope (03) and the Admit Gate (04) judges it. The time walls of Admit measure against the frozen time. dynAEP (07) does not own this wait.

## What ships in 2.9

- `PULSE_MS` of 1000, the wait after a capsule is opened.
- `MAX_DRIFT_MS` of 50: a timestamp more than 50 ms ahead of the Base Node clock is refused as `temporal:future_skew`.
- `MAX_AGE_MS` of 5000: a timestamp older than 5000 ms is refused as `temporal:stale_event`.
- A queue of 256 capsules and 262144 bytes. One signer fills at most half of each.
- The wire window before a capsule is opened: `MAX_FRAME_AGE_SECS` of 300 and `MAX_FRAME_FUTURE_SKEW_SECS` of 60.
- Source checks: the docking code owns the pulse, dynAEP does not and the drift is never set to the pulse length.

## Layout

| Path | Role |
|------|------|
| `crate/src/lib.rs` | The constants, the freeze functions and the source checks |
| `crate/src/main.rs` | The program `aep-base-node-pulse`, which runs the source checks |

## Interfaces

- Constants: `PULSE_MS`, `MAX_DRIFT_MS`, `MAX_AGE_MS`, `QUEUE_CAP_CAPSULES`, `QUEUE_CAP_BYTES`, `MAX_FRAME_AGE_SECS` and `MAX_FRAME_FUTURE_SKEW_SECS`.
- Functions: `freeze_temporal_snapshot`, `drift_against_freeze`, `age_against_freeze`, `hold_age_ms` and `fate_at`.
- No environment variable and no configuration key changes the wait. `dynaep-config.yaml` has no `pulse_ms` key.

## Compiled clocks

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

## Limits

- The pulse orders and delays. It judges nothing. The Admit Gate (04) does.
- The timestamp of an agent is a claim the Base Node compares with its own clock. It never becomes the freeze.
- The pulse is not the NTP sync of dynAEP (07).

## Run and test

```bash
cargo test -p aep-base-node-pulse
cargo run -p aep-base-node-pulse
```

## Related documents

- `AEP-Base-Node/README.md` for the kernel pass around the pulse
- `AEP-Components/dock-post-beat-collect/README.md` for the collect after the pulse
- `AEP-Components/tla/README.md` for the model DockPulse
