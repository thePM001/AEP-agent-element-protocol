# Base Node pulse

Compiled kernel wait for AEP 2.8. After a sealed capsule is opened, Base Node freezes the clock at seal then holds until `PULSE_MS` (1000) before collect-all checks. Drift is `MAX_DRIFT_MS` (50) against that freeze. Age is `MAX_AGE_MS` (5000). Queue caps are 256 capsules and 262144 bytes.

TypeScript dynAEP does not own this wait. `dynaep-config.yaml` has no `pulse_ms` key.

## How the wait can be changed in theory

Edit `PULSE_MS` in `crate/src/lib.rs` and rebuild Base Node. Keep freeze-at-seal. Do not set `MAX_DRIFT_MS` to the wait length (tests require they differ). Keep `MAX_AGE_MS` longer than `PULSE_MS` or capsules expire before they become ready. Tests currently pin `PULSE_MS == 1000` so a theoretical rebuild must update those pins. There is no yaml or env toggle.
