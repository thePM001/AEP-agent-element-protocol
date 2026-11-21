# Lattice Memory (AEP 2.9)

Lattice Memory keeps a record of every verdict of the Admit Gate and never admits, because looking similar to a past allow is not allow and Base Node is the only live evaluator. Attractors do not skip the compiled pulse or collect-all walls. Writing walls use CORRECTWRITING_EN and writing:* ids.

## What it keeps

After the Base Node writes a verdict to the Evidence Ledger, it hands a note of the verdict to the memory. The memory writes one record per verdict: the shape digest of the proposal, its fingerprint, the signer, the verdict and the ids of the closed walls of a deny. It never keeps the body of a proposal.

Accepted records form attractors. An attractor is a shape that was accepted before, with a count of the records that support it. A rejection enters the log and forms no attractor.

A frame the dock refuses before Admit is not a verdict of Admit: a bad signature, a replayed frame, a stale stamp or a payload that fails the writing check on entry. Such a frame is a row of the Evidence Ledger and no record of the memory.

## Where it lives

The memory is one folder, `lattice-memory`, in the data folder of the Base Node beside the ledger file. It holds:

| File | Role |
|------|------|
| `store.lmmeta` | The format version and the dimension of operator embeddings |
| `<domain>.lmlog` | The append-only log of one domain |
| `<domain>.lmsnap` | A snapshot of the attractors of one domain, so a large log opens fast |

The domains of the Base Node are `admit.inference_engine`, `admit.validation_engine`, `admit.future_features` and `admit.regulation_module`, one per docking port. The Intent Ledger writes to `intent` and the Graph Engine to `graph`.

No database engine and no query language is involved. The store is plain files written by pure Rust code.

## Backends

The log file backend is the store for production. The in-memory backend keeps everything in the process and serves development and tests. Both sit behind one trait and neither has an operation that changes or removes a record.

## What Admit reads

Admit reads a route hint and an exact-match memo from the Base Node and writes nothing.

- The hint is hot when an accepted proposal of the same shape or a near one was recorded. A hot hint only means that the memo is asked.
- The memo holds the rows of the writing walls for byte identical text under the same compiled lattice and the same wall set. It lives in the process of the Base Node and starts empty at every start.
- Every wall that reads the clock, a budget or the state of the node is computed on every proposal.

The verdict with memory is the verdict without memory. The conformance suite judges every chain of its multi-step corpus both ways and requires the same verdict and the same deny report for every step.

## Health

`aep-base-node --health` and the Data Dock report these fields:

| Field | Meaning |
|-------|---------|
| `lattice_memory_status` | `ok`, `off`, `absent` when no store exists yet or `error` |
| `lattice_memory_records` | Records of the store |
| `lattice_memory_attractors` | Attractors of every domain together |
| `lattice_memory_dropped` | Verdicts the dock could not hand over because the queue was full |
| `lattice_memory_failed` | Verdicts the memory could not write |
| `lattice_memory_dim` | Bits of the fingerprint: 256 |
| `vector_store` | `simhash256+log` |

A health check opens the files to read and changes nothing. A running node answers from its live counters and opens no file.

A node whose memory cannot be opened reports `error` and runs without it. Every proposal then takes the cold path and no verdict changes. A count of dropped verdicts above zero means the node judged faster than the memory wrote for a moment. Those verdicts are in the Evidence Ledger and not in the memory.

## Operator tasks

- Turn the memory off: start the Base Node with `AEP_LATTICE_MEMORY=off`.
- Check a store: `aep-lattice-memory --store <folder> verify` walks the hash chain of every domain and rebuilds its attractors from the log. Exit code 1 means the store does not hold together.
- Read counts without a running node: `aep-lattice-memory --store <folder> health`.
- Use operator embeddings: create the store with `--embedding-dim <n>`. An embedding of any other length is refused with an error and is never cut or padded.
- Flush every record to the disk: open the store with `--durable`. Without it a loss of power may lose the newest records and never their order.
- Coming from the earlier store: the Base Node starts a fresh store. It removes the rows of the earlier store from the ledger file and the index file beside it. The earlier rows are not carried over.

## What Memory does not do

Memory does not Admit, does not Apply and does not rewrite agent permission. A nearby past allow is evidence for a later reader and is not membership proof for this capsule.

The logs only grow. Retention is not built: an operator who needs it archives a log file while the node is stopped.
