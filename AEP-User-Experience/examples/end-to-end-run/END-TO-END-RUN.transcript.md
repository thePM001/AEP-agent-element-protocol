This note records one observed run of the end to end example in this folder. The run walks every layer twice and prints the refuse path first and the pass path second. The last line of the pass section shows the ledger row that the kernel wrote.

> AEP end to end run. The refuse path prints first and the pass path prints second.
> kernel pulse ms 1000
> kernel drift bound ms 50
> attach action ucb:ingest scene scene-ucb agent agent-a
> 
> == refuse path
> REFUSE 1 caw session: policy aep-e2e-missing-policy is absent, so the session refused with exit 1: POST /api/v1/sessions: 400 Bad Request: {"error":"resolve policy: policy \"aep-e2e-missing-policy\" not found in \"./configs/policies\""}
> REFUSE 2 sealed capsule: a foreign recipient key refused the capsule: fingerprint mismatch
> REFUSE 3 pulse: the agent stamp drifts 500 ms past the 50 ms freeze bound and the temporal wall closes
> REFUSE 4 collect all: 4 walls closed together on one path and every wall ran, so this is a collect all deny and not an early exit
> REFUSE REPORT error: Admit collect-all walls then Apply: no sequence bound; this agent does not have permission for this action; no scene bound; drift 500 exceeds 50
> REFUSE REPORT closed walls: causal.sequence=structural gap.agent_permission=capability scene.membership=structural time.authority=temporal
> REFUSE REPORT closed set key length: 216
> REFUSE 5 apply: collect all admit refused, so the plan holds no ledger allowance and no rate step and no row is written
> REFUSE 6 caw exec: the wrapped command refused with exit 126: aep-caw: command denied by policy (rule=approve-curl-wget)
> REFUSE 7 dock attach: the ingest refused with HTTP 422 and the DenyReport error is ManifestMissing and the closed walls are ucb.manifest=structural
> REFUSE 8 ledger row: the refuse path wrote no row and the ledger count stays 0
> 
> == pass path
> PASS 1 caw session: the session session-03f42ea5-205f-4864-9562-a39857ffea93 holds the workspace
> PASS 2 sealed capsule: the recipient key opened the capsule and the payload is aep-2.8.6-end-to-end-run
> PASS 3 pulse: the seal stamp drifts 0 ms inside the 50 ms bound, the capsule waits at the seal beat and turns ready 1000 ms later
> PASS 4 collect all: collect all ran every wall on the path and 0 walls closed
> PASS 5 apply: the plan carries the ledger allowance and the rate step and the applied snapshot rate is 1
> PASS 6 caw exec: the wrapped command returned exit 0 and the output is aep-2.8.6-end-to-end-pass
> PASS 7 dock attach: the ingest returned status integrated and the admit row is event_id 1 allow true digest da334ac8065f...
> PASS 8 ledger row: the pass path moved the ledger count from 0 to 2 and the newest row is id 2 agent agent-a event_type UCB_INGEST frame_digest 5a8ff5542046...
> 
> == verdict
> RESULT refuse path first and pass path second with the ledger row
