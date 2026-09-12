# aep-ucb-perimeter-v1

@PAD: gaplune-creation-pad emit ( zero-LLM )
@GCDE: gaplune.policy.v1

This library is the AEP 2.8.5 UCB perimeter profile. Default profile is signed provenance, schema with byte caps, scanner-backed content checks and a replay window. Paper 005 VSA stays off unless named. Named profile paper005-vsa is not a substitute for manifests, signatures and SSRF controls.

Scanner pack classes are Secrets, Injection, Pii, DestructiveShell and PromptOverride. A secrets payload returns P_C with scanner Secrets. Ingest default body cap is 256 KiB, ingest hard cap is 2 MiB and egress default body cap is 1 MiB. The hash-chained journal rotates at 32 MiB. Live crate aep-ucb depends on this library.
