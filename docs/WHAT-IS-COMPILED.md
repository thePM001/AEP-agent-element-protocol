# What is compiled (AEP 2.8.6)

The kernel pulse is compiled as PULSE_MS 1000 in AEP-Components/base-node-pulse/crate and it is not an environment variable, a dynAEP yaml key or the NTP LARGE_STEP clock-sync cap. TypeScript dynAEP remains a standalone component and does not own this wait. Base Node freezes the clock at seal, waits PULSE_MS, runs every written wall together and applies only after Admit, so enqueue is not Admit. A builder who wants a different wait rebuilds Base Node after editing the compiled constant and freeze-at-seal stays so the hold is judged against the freeze rather than a moving clock.

MAX_DRIFT_MS is 50 against the freeze and must not be set to 1000. MAX_AGE_MS is 5000 and must stay longer than PULSE_MS or capsules would expire before they became ready. MAX_FRAME_AGE_SECS is 300 and MAX_FRAME_FUTURE_SKEW_SECS is 60 as the wire sent_at window before open, so pulse age is not the 300 second wire window and LARGE_STEP stays an NTP cap that must not be treated as PULSE_MS.

theme yaml has no Admit authority, TypeScript processEvent is not product Admit, UCB is not a second evaluator, CAW is not a second evaluator and Lattice Memory never admits. Writing walls use CORRECTWRITING_EN and writing:* ids.
