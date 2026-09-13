# End to end run (AEP 2.8.6)

One command walks every layer of the stack twice. The refuse path runs first and every layer fails closed. The pass path runs second and the same layers allow. The observed transcript sits beside this note.

## Run it

- From the repository root run the script at `AEP-User-Experience/examples/end-to-end-run/run.sh`.
- The first run builds the kernel binaries, the dock gateway and the execution layer binaries. Later runs reuse them.
- The run uses release binaries because the temporal wall measures the gap between the seal and the dock enqueue, so an unoptimized build signs slowly enough to cross the fifty millisecond bound.
- The run writes its transcript into a quoted note beside this one, with the run directory and the two loopback ports replaced by tokens.

## Layer order

The run walks eight layers in this order and each layer takes the refuse path first.

| Step | Layer | Refuse | Pass |
|------|-------|--------|------|
| 1 | Execution layer session | the named policy is absent so the session refuses | the session opens on the workspace |
| 2 | Sealed capsule | a foreign recipient key refuses the capsule | the recipient key opens the capsule |
| 3 | The pulse | the agent stamp drifts past the freeze bound so the temporal wall closes | the stamp sits inside the bound, the capsule waits at the seal beat and turns ready after the pulse |
| 4 | Collect all | every wall on the path runs and the closed set carries several walls | every wall on the path runs and no wall closes |
| 5 | Apply | the plan holds no ledger allowance so no row is written | the plan holds the ledger allowance and the rate step |
| 6 | Execution layer command | the wrapped command is denied by a policy rule | the wrapped command returns exit 0 and prints its output |
| 7 | Dock attach | the ingest refuses without a task manifest and carries a refuse report | the ingest returns the integrated status with an admit row |
| 8 | Ledger row | the refuse path writes no row | the pass path writes a row in the kernel action lattice |

The kernel, the execution layer and the dock are all live in this run. The kernel daemon serves the docking sockets. The dock gateway builds a sealed frame and sends it to the validation dock. The dock queues the frame on the pulse, runs collect-all admit and then applies the result. The apply writes the ledger row.

## What the run prints

The refuse section prints one line per layer, then a refuse report with the error line, the closed wall set and the closed set key length. The pass section prints one line per layer. The run exits zero only when every refuse line and every pass line holds.

- `REFUSE` carries a refusal line.
- `REFUSE REPORT` carries a line of the refuse report.
- `PASS` carries an allow line.
- `RESULT` carries the verdict line.

## What the run configures

The run is the operator for one temporary deployment. It writes all of this into a temp directory.

- A base node config with a socket base and a lattice db.
- A lattice that grants the attach action to the named attach agent.
- A provisioned agent sign key for the attach agent.
- A server config for the execution layer that keeps the sandbox shells off.
- A task manifest on the pass ingest and no manifest on the refuse ingest.

The run reads the shipped reference policy set at `AEP-Policy-System`. The reference documents grant the named agent `agent-a` so the run attaches as that agent. An operator who installs a policy set under a different agent name changes the attach agent at the top of the run script.

## Attach fields the dock reads

Three fields decide the dock attach and the run names all three.

- The lattice action path on the ingest body. The dock admit reads the sealed action path so the path must exist in the lattice and the lattice must grant it.
- The scene field on the ingest body. The dock admit closes an unbound scene.
- The provenance digest on the ingest body. The perimeter refuses an unbound provenance and the digest binds the provenance triple as a sha256 over source, protocol and session joined by pipes. The run computes it for you.

The attach agent also needs a sign key that the kernel holds. Provision it once per deployment.

- Run the kernel binary with the provision flag and the agent id against the same base node config.
