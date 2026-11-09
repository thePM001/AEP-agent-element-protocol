# AEP conformance vectors

Language neutral test vectors for the AEP 2.9 public tier. A vector names an input and the answer the Rust kernel gives for it. An implementation in any language passes a suite when it gives the same answer for every case of that suite. No Rust toolchain is needed to read or run them.

## The Rust kernel is normative

The Base Node kernel in `AEP-Base-Node/AEP-Crate` and the crates it uses decide what the right answer is. The vectors pin that answer. `aep-conformance vectors` runs every case of every suite against the kernel on every run of `AEP-Components/conformance/runner/run.sh`, so a vector that drifts from the kernel fails the runner. When the kernel and another implementation disagree the other implementation is wrong.

## Versioning

The folder name is the format version. `v1` holds format version 1 and every file in it says so:

```json
{
  "format": "aep-conformance-vectors",
  "format_version": 1,
  "aep_version": "2.9.0",
  "normative": "rust",
  "suite": "dock-answer",
  "checks": ["CC-07"],
  "description": "...",
  "cases": [{ "id": "admitted", "input": { "line": "..." }, "expect": { "verdict": "admitted" } }]
}
```

Cases may be added to a suite within a format version. A change to the meaning of an input or an answer is a new format version in a new folder and the old folder remains until the release after next. A runner must refuse a file whose `format` or `format_version` it does not know.

## Suites of format version 1

| Suite | Input | Answer | Checks |
|-------|-------|--------|--------|
| `dock-socket` | `port`: a dock port id as it travels on the wire | `suffix` (the socket file name under the socket base) or `error: unknown_dock` | CC-07 |
| `dock-request` | `line`: one request line sent to a fresh dock | `verdict` with the exact `error` text or an `error_prefix` where the tail is a parser message | CC-09, CC-13, CC-14 |
| `dock-answer` | `line`, one answer line read back from a dock | `verdict`: `admitted`, `pending`, `refused` or `malformed` | CC-07 |
| `mesh-mode` | `internet_up` and `mesh_peers` | POTOMITAN `mode` and whether the node is `reachable` | CC-04, CC-05, CC-10 |
| `writing` | `text`, prose | the writing.gap `violations` by `rule` and `line`, the `fixed` text and `ok_after_fix` | CC-16, CC-17 |

The rules behind each suite:

- **dock-socket.** The four docks are `inference_engine`, `validation_engine`, `future_features` and `regulation_module` with the socket names `inference`, `validation`, `future` and `regulation`. Ids are exact: no case folding and no trimming. Trimming text from a configuration file is a matter for the client and is not part of the wire.
- **dock-request.** A dock accepts only a sealed LatticeChannelFrame. A plain ping, a plain event, a plain register_lrp, a collect for a digest the dock does not hold and any line that is not one of these request shapes are refused. A refusal never records an event. Sealed frames need live keys and are covered by the kernel checks, not by vectors.
- **dock-answer.** An answer is a JSON object with field names matched exactly. `ok` is required and is a boolean. `event_id` is an integer, `digest` and `error` are strings and `pending`, `pong` and `http_queued` are booleans, each optional and each allowed to be null. A line that breaks any of this is malformed. A pending answer with a non empty digest is pending and one without a digest is refused. Otherwise only `ok` true with an `event_id` is admitted. Version 1 does not pin the inner shape of `deny` or `http`.
- **mesh-mode.** Internet up is `internet` whatever the peers. Internet down with at least one active peer is `potomitan`. Internet down with no peer is `offline` and only that mode is unreachable.
- **writing.** Line numbers start at 1. The fix runs line by line and the fixed text joins the lines with a line feed, so a trailing line feed is not kept. The rule ids are those of `AEP-Policy-System/reference/writing.gap`.

## Who runs which suite

| Implementation | Runs | Where |
|----------------|------|-------|
| Rust kernel (normative) | every suite | `aep-conformance vectors` in `run.sh` and `cargo test -p aep-conformance` |
| Go CAW | `dock-socket`, `dock-answer` | `go test -run Vectors ./internal/kerneldock` in `AEP-CAW` |
| TypeScript helpers | `dock-socket`, `writing` | `tests/vectors-ts-helpers.test.mjs` in the vitest harness of `run.sh` |
| Example third-party runner | `dock-socket`, `dock-request`, `dock-answer`, `mesh-mode` | `examples/third-party-runner/run-vectors.mjs` |

The Go CAW and the TypeScript helpers run the suites for the parts of the protocol they implement. The TypeScript helpers reach the writing rules through the kernel binary `aep-lattice-log`, the same way every TypeScript caller does. CI runs all of them on every push and pull request. The example third-party runner runs in a job with no Rust toolchain on its PATH.

## Writing your own runner

Read every `*.json` file in `v1`, check `format` and `format_version`, run each case of the suites you implement through your implementation and compare your answer with `expect`. Every key in `expect` must match your answer exactly, except `error_prefix`, which must match the start of your `error`. Report each suite you do not implement instead of passing it.

The example runner shows the whole loop in one file that needs Node 18 or later and nothing else. It imports nothing from this repository and carries its own implementation of four suites:

```bash
node AEP-Components/conformance/vectors/examples/third-party-runner/run-vectors.mjs \
  --require dock-socket,dock-request,dock-answer,mesh-mode
```

It exits 0 when every suite it implements passes and every required suite ran. A passing vector run does not replace the conformance runner: a compliance claim still needs a passing `run.sh` report as described in `AEP-Components/conformance/registry/REGISTRY.md`.
