# Lattice Memory (AEP 2.9)

Lattice Memory is the record of the verdicts of the Admit Gate. It never admits, because looking similar to a past allow is not allow and the Base Node is the only live evaluator. Attractors do not skip the compiled pulse or collect-all walls. Writing walls use CORRECTWRITING_EN and writing:* ids.

## What it keeps

After the Base Node writes a verdict to the Evidence Ledger, it hands a note of the verdict to a queue. One thread takes the notes and writes one record per verdict: the shape digest of the proposal, its fingerprint, the signer, the verdict and the ids of the closed walls of a deny. It never keeps the body of a proposal. The digest and the fingerprint are computed under the memory key of the node, so somebody who reads the store and guesses a proposal cannot confirm the guess.

Accepted records form attractors. An attractor is a shape that was accepted before, with a count of the records that support it. A rejection enters the log and forms no attractor.

A frame the dock refuses before Admit is not a verdict of Admit: a bad signature, a replayed frame, a stale stamp or a payload that fails the writing check on entry. Such a frame is a row of the Evidence Ledger and no record of the memory.

## What can be missing

The memory records every verdict its queue has room for. It does not promise every verdict:

- The queue holds 4096 verdicts and 64 MiB of proposals. A verdict that finds it full is dropped and counted in `lattice_memory_dropped`.
- A write the store refuses is counted in `lattice_memory_failed` and `lattice_memory_status` reads `failing` until a write succeeds again.
- A node that is killed loses the verdicts that waited in its queue.

Every one of these verdicts is in the Evidence Ledger. `lattice_memory_ledger_gap` shows how many verdict rows of the Evidence Ledger have no record in the memory, counted from the first start of the memory on. A gap that remains above zero after the queue is empty is the number of verdicts the memory lost.

## Where it lives

The memory is one folder, `lattice-memory`, in the data folder of the Base Node beside the ledger file. It holds:

| File | Role |
|------|------|
| `store.lmmeta` | The format version and the dimension of operator embeddings |
| `<domain>.lmlog` | The append-only log of one domain |
| `<domain>.lmsnap` | A snapshot of the attractors of one domain, so a large log opens fast |

The domains of the Base Node are `admit.inference_engine`, `admit.validation_engine`, `admit.future_features` and `admit.regulation_module`, one per docking port. Only the Base Node writes them: the program `aep-lattice-memory` refuses a record for these domains. The Intent Ledger writes to `intent` and the Graph Engine to `graph`. The Base Node does not open those two.

Two things of the memory are outside the folder, in the data folder of the node:

- `lattice-memory.key`: the memory key of the node, 32 bytes that only the user of the node may read. Keep it with the store. Without it the node cannot check the heads below.
- The Evidence Ledger holds the head of each judged domain: its record count and the hash of its newest record, signed with the memory key.

No database engine and no query language is involved in the store. It is plain files written by pure Rust code.

## Backends

The log file backend is the store for production. The in-memory backend keeps everything in the process and serves development and tests. Both sit behind one trait and neither has an operation that changes or removes a record.

## What Admit reads

Admit reads one thing from the Base Node and writes nothing: an exact-match memo.

- The memo holds the rows of the writing walls for byte identical text. It lives in the process of the Base Node and starts empty at every start.
- Every wall that reads the clock, a budget, a file or the state of the node is computed on every proposal.
- Similarity never skips a wall.

The verdict with memory is the verdict without memory. The conformance suite judges every chain of its multi-step corpus both ways. A test of the Base Node sends the same corpus as sealed frames through a node with memory and a node without it. Both require the same answer for every step.

## What it does for speed

The memo saves the work of the writing walls for a text the node judged before since its start. That is the whole gain. A proposal with a new text is not faster. A store that already holds many records makes nothing faster, because the memo lives in the process and starts empty.

Measured on the build host with the 3494 proposals of the conformance corpus through the whole dock path: a proposal took 2402 microseconds in the median without memory and 2335 with it. It took 4661 in the mean without memory and 3975 with it. 1935 of these proposals carry a text that was judged before. Your figures depend on how often your agents repeat a text and on how long those texts are. `lattice_memory_memo_replayed` counts the proposals the memo answered.

## Health

`aep-base-node --health` and the Data Dock report these fields:

| Field | Meaning |
|-------|---------|
| `lattice_memory_status` | `ok`, `failing` while writes fail, `off`, `absent` when no store exists yet or `error` when the store could not be opened |
| `lattice_memory_records` | Records of the judged domains |
| `lattice_memory_attractors` | Attractors of the judged domains |
| `lattice_memory_dropped` | Verdicts the dock could not hand over because the queue was full |
| `lattice_memory_failed` | Verdicts the memory could not write |
| `lattice_memory_queue_depth` | Verdicts that wait in the queue |
| `lattice_memory_hot` | Recorded proposals whose shape was accepted before, counting a shape near it too |
| `lattice_memory_cold` | Recorded proposals of a shape that was not accepted before |
| `lattice_memory_memo_replayed` | Proposals whose writing rows Admit took from the memo |
| `lattice_memory_ledger_gap` | Verdict rows of the Evidence Ledger minus records of the memory. Null when a node that is not running is asked |
| `lattice_memory_durable` | True when every record is flushed to the disk |
| `lattice_memory_dim` | Bits of the fingerprint: 256 |
| `vector_store` | `simhash256+log` |

A health check of a node that is not running opens the files to read and changes nothing. A running node answers from its live counters and opens no file of the store.

A node whose memory cannot be opened reports `error` and runs without it. No verdict changes and none is recorded.

## What a damaged store looks like

The store reports damage and never repairs it in silence:

- The rest of a write that a crash cut short is cut off by the next writer. It was never a record.
- A changed bit or byte in any frame, a removed or moved record, a log that is shorter than its snapshot and a log that is shorter than the count the Evidence Ledger holds are each reported. The store is not written to. The node starts without memory with the status `error`.

What to do then: stop the node, keep a copy of the folder, find out what happened and repair or replace the store. Start the node once with `AEP_LATTICE_MEMORY_ACCEPT_STORE=1`. On that one start the node takes the store as it is and writes new heads to the Evidence Ledger.

## Operator tasks

- Turn the memory off: start the Base Node with `AEP_LATTICE_MEMORY=off`.
- Flush every record to the disk: start the Base Node with `AEP_LATTICE_MEMORY_DURABLE=on`. Without it a loss of power may lose the newest records and never their order. Each record then costs one flush of the disk on the writer thread, not on the path of a verdict. The program takes `--durable` for its own writes.
- Check the store of a node that is stopped: `aep-base-node --verify-memory` reads every frame of every log, rebuilds the attractors, compares each snapshot with its log and each head of the Evidence Ledger with its log. It prints JSON. Exit code 2 means the store does not verify.
- Check a store without the ledger: `aep-lattice-memory --store <folder> verify`. Exit code 1 means the store does not hold together.
- Read the recorded verdicts of a port: `echo '{"port":"validation_engine"}' | aep-lattice-memory --store <folder> verdicts`. The answer is one page. Send the `next` of a page as `after` to read on.
- Read counts without a running node: `aep-lattice-memory --store <folder> health`.
- Write many records from a program of your own: use `record-lines`, one process for all records. A call of `record` opens the store, writes one record and closes.
- Use operator embeddings: create the store with `--embedding-dim <n>`. An embedding of any other length is refused with an error and is never cut or padded.
- Coming from the earlier store: the Base Node starts a fresh store. It removes the rows of the earlier store from the ledger file and the index file beside it. The earlier rows are not carried over.

## What Memory does not do

Memory does not Admit, does not Apply and does not rewrite agent permission. A nearby past allow is evidence for a later reader and is not membership proof for this capsule.

The logs only grow, by about 250 bytes per verdict. No retention setting exists. An operator who needs room stops the node, moves a log file with its snapshot away and starts the node once with `AEP_LATTICE_MEMORY_ACCEPT_STORE=1`.
