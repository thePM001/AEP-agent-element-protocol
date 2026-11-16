This note records one observed run of the end to end example in this folder. The run walks every layer twice and prints the refuse path first and the pass path second. The last line of the pass section shows the ledger row that the kernel wrote.

> AEP end to end run. The refuse path prints first and the pass path prints second.
> kernel pulse ms 1000
> kernel drift bound ms 50
> attach action ucb:ingest scene scene-ucb agent agent-a
> host sandbox: none in this release, the Go CAW is retired and a Rust CAW with gVisor replaces it
> 
> == refuse path
> REFUSE 1 sealed capsule: a foreign recipient key refused the capsule: fingerprint mismatch
> REFUSE 2 pulse: the agent stamp drifts 500 ms past the 50 ms freeze bound and the temporal wall closes
> REFUSE 3 collect all: 4 walls closed together on one path and every wall ran, so this is a collect all deny and not an early exit
> REFUSE REPORT error: Admit collect-all walls then Apply: no sequence bound; this agent does not have permission for this action; no scene bound; drift 500 exceeds 50
> REFUSE REPORT closed walls: causal.sequence=structural gap.agent_permission=capability scene.membership=structural time.authority=temporal
> REFUSE REPORT closed set key length: 216
> REFUSE 4 apply: collect all admit refused, so the plan holds no ledger allowance and no rate step and no row is written
> REFUSE 5 dock attach: the ingest refused with HTTP 422 and the DenyReport error is ManifestMissing and the closed walls are ucb.manifest=structural
> REFUSE 6 ledger row: the refuse path wrote no row and the ledger count remains 0
> 
> == pass path
> PASS 1 sealed capsule: the recipient key opened the capsule and the payload is aep-2.9-end-to-end-run
> PASS 2 pulse: the seal stamp drifts 0 ms inside the 50 ms bound, the capsule waits at the seal beat and turns ready 1000 ms later
> PASS 3 collect all: collect all ran every wall on the path and 0 walls closed
> PASS 4 apply: the plan carries the ledger allowance and the rate step and the applied snapshot rate is 1
> PASS 5 dock attach: the ingest returned status integrated and the admit row is event_id 1 allow true digest 18fdf9fef07e...
> PASS 6 ledger row: the pass path moved the ledger count from 0 to 2 and the newest row is id 2 agent agent-a event_type UCB_INGEST frame_digest 9153422f2195...
> 
> == verdict
> RESULT refuse path first and pass path second with the ledger row
