# Changelog

This file is the EXTERNAL changelog. Public product notes for the AEP 2.8.x public tree live here. Internal ticket-close records stay on the INTERNAL changelog and do not ride this tree.

## [2.8.6] - 2026-09-30 - Base Node dock keeps every frame answerable under concurrent writers
When two clients wrote to a dock at nearly the same moment a collect could answer unknown digest for a frame that was on its way through Admit. The apply step took the frame out of the held map and ran Admit before it recorded the answer. A collect that landed in that gap found the digest in neither place. The caller could not tell whether Admit had decided and a run open could be refused without being judged. The apply step now leaves the frame in the held map while Admit runs. It records the answer and drops the frame from the held map in one step under the pulse lock. A collect in the gap reads pending and the socket and Data Dock collect loops wait for the answer. A guard covers an apply step that ends early by recording a closed Deny for the digest. The new tests park Admit while a second client collects and run sixteen parallel writers for eight rounds. Both answered collect unknown digest on the previous code. Verify with cargo test -p aep-base-node.

## [2.8.6] - 2026-09-29 - CAW unix socket monitor judges the sendto destination
The CAW unix socket monitor read the address of a trapped sendto from arguments one and two. Those are the payload buffer and its length. The destination sits in arguments four and five. A one byte send on a connected socketpair was refused with EACCES and no audit event. The asyncio self pipe wake-up is such a send, so every asyncio program under aep-caw exec slept in epoll_wait for good. A payload that began like an AF_UNIX address was judged as one. A short payload let a sendto reach a socket path that unix socket policy denies. ExtractContext now reads arguments four and five for sendto and arguments one and two for connect and bind. A send on a connected socket carries the NULL destination and continues. An AF_UNIX destination goes to unix socket policy. The unix socket rules, the blocked socket families and the ptrace tracer are unchanged. Verify with go test ./internal/netmonitor/unix/ in AEP-CAW.

## [2.8.6] - 2026-09-29 - UCB collects a frame held for the pulse
Since the pulse holds a frame until the next beat, the validation dock answers a new frame with ok false, no deny and pending true. The UCB lattice client read every ok false answer as a Deny, so every UCB ingest answered 422 lattice frame rejected before Admit ran and wrote no ledger row. The UCB dock response now carries the pending flag. A pending answer makes the client collect the frame after the pulse and return the Admit outcome, while a deny or an ok false answer without pending still refuses the ingest. The end to end example passes every step again and its transcript is refreshed. Verify with cargo test -p aep-ucb and the run script at AEP-User-Experience/examples/end-to-end-run/run.sh.

## [2.8.6] - 2026-09-29 - End to end example builds with the workspace
The end to end example read the Admit result field by its old name and no longer compiled. It now reads the closed walls by the current name. The example is a member of the root workspace, so cargo test --workspace compiles it and the base-node workflow gains a job that checks it by name. The run script is executable again and builds the kernel, the dock gateway and the run on every start so it never uses a stale binary. It gives the Data Dock a free loopback port and it grants root:ping to caw-kernel-dock in its lattice and in a hub policy of its data folder, so the execution layer gate admits every wrapped command. The same hub grants the attach agent its ingest path. Verify with cargo check -p aep-end-to-end-run and the run script at AEP-User-Experience/examples/end-to-end-run/run.sh.

## [2.8.6] - 2026-09-28 - CAW socket wrapper lets network calls through
aep-caw-unixwrap traps connect, bind and sendto for every socket family because seccomp cannot read the address. Its handler judged only AF_UNIX addresses and refused everything else with EACCES and no audit row. Every TCP connect and every DNS query of a wrapped command failed. So did every send on a connected socket because such a send passes no address. The handler now lets a sendto without an address through. It lets an address of any other family through to the network policy. An AF_UNIX address still meets unix socket policy and an address that cannot be read still fails closed. The file rules, the command rules and the blocked socket families are unchanged. Verify with go test ./internal/netmonitor/unix/ in AEP-CAW.

## [2.8.6] - 2026-09-28 - Lattice and CAW config as GAP
The Base Node reads its action lattice from a GAP file as well as from YAML. A lattice path that ends in .gap is read as GAP. Without AEP_LATTICE_YAML the data folder lattice.yaml wins over lattice.gap. The lattice sits in a kind: aep.lattice document with the same keys as lattice.yaml and goes through the same loader, so Admit decides alike on both. CAW reads a policy from the policy field of a kind: aep.caw.mount_policy document and its server config from the config field of a kind: aep.caw.server_config document. Both use the same strict decoder as YAML. A policy name resolves to name.yaml, then name.yml, then name.gap. The config search also tries config.gap. YAML remains fully supported. Verify with cargo test -p aep-envelope -p aep-base-node and go test ./internal/gapdoc/... ./internal/policy/... ./internal/config/... in AEP-CAW.

## [2.8.6] - 2026-09-28 - CAW kernel dock sealed ping
The CAW kernel dock probe no longer sends a plain ping, which every dock refuses as a side channel. It seals one root:ping as the agent caw-kernel-dock with aep-lattice-log build-frame and sends it to the validation dock. After the pulse it collects the outcome and lets the command start only when the dock admits the frame. A silent dock still refuses the run with kernel-dock-silent. The Base Node provisions the caw-kernel-dock sign key and a system task manifest on every boot. The operator grants it root:ping in the lattice and in a caw-*.gap hub policy. The probe timeout default is now 5s and CAW gains the kernel_dock settings lattice_log_bin, lattice_db and agent_id. Every other caller still gets a plain ping refused. Verify with go test ./internal/kerneldock/... in AEP-CAW and cargo test -p aep-base-node.

## [2.8.6] - 2026-09-28 - No session admit cap
The rate.session wall no longer closes a session. Before this change every admitted write added one to a session counter that never reset, so a Base Node refused every write after 200 admits until it restarted. Admit no longer counts into that counter and the wall always opens. The per-second event rate that the pulse clears on every beat is the only rate limit. The wall row and snapshot fields remain so wall lists and older snapshots do not change. Verify with cargo test -p aep-envelope -p aep-base-node.

## [2.8.6] - 2026-09-27 - Base Node nine to ten
Workspace no longer pins wasmtime. No wasm sandbox crate. Data Dock off loopback without DATA_DOCK_API_KEY now mints $AEP_DATA/keys/data-dock.http-key with mode 0600 on first boot and reuses it after that, while an env key still wins over the file and the log names only the file path. The base-node workflow gains a probe job that builds aep-base-node and checks the --health JSON. Verify with cargo test -p aep-base-node --lib.

## [2.8.6] - 2026-09-27 - Base Node ten of ten
Data Dock on 8413 requires DATA_DOCK_API_KEY when it is not on loopback. It binds loopback by default even in Docker, answers 401 on a missing or wrong key and 429 over the DockDefence limits before any frame is built. Health status is one rollup used by aep-base-node --health with exit codes 0, 1 and 2 and by GET /health, where a closed ledger now reads as error. The official aep-base-node log lives in dock_log.rs with a closed set of event ids and redaction of keys and seal material. Drain aborts and counts late tasks, DockingRuntime remains five parts and Display API remains gone. Verify with cargo test -p aep-base-node --lib.

## [2.8.6] - 2026-09-27 - Data Dock HTTP
Data Dock listens on 8413 so frontends can read already-admitted lattice records as JSON while governed writes are sealed on the server before they enter the four existing Base Node docks. UCB remains on 8412 and port 28429 is never bound. The full route guide is AEP-User-Experience/docs/DATA-DOCK.md and independent verification is cargo test -p aep-base-node.

## [2.8.6] - 2026-09-27
Base Node DockingRuntime is five owned parts (io, keys, defence, admit and record). Same docks, same process, no UCB change.

## [2.8.6] - 2026-09-26 - Base Node kernel
Base Node isolates self-test from production database memory and keys so a held digest persists only after remaining walls and immediately before insert never on a seen digest. Bound HTTP fetches before INSERT and cannot flip Admit. Production refuses a world-writable lattice parent. Replay deny carries class frame.replay and inactive contract deny carries class contract.inactive on every inactive path. Independent verification is cargo test -p aep-base-node.

## [2.8.6] - 2026-09-19 - AEP286-P3
The root check now reads the catalog and every manifest through the registry loader and the full catalog validator so a catalog row that names a missing folder or a missing manifest fails.
## [2.8.6] - 2026-09-19 - AEP286-P11
The setup agent and Composer Lite trees now sit in the internal export area and the public protocol tree has no folder for either product so catalogs, Docker files and docs no longer name either product.
## [2.8.6] - 2026-09-19 - AEP286-P5
The root README now names CAW as an incorporated part of AEP that runs on the host and the components README names CAW the same way.
## [2.8.5] - 2026-09-12

Optional Universal Connect Bridge uses Predicate Profile perimeter-v1 by default and content checks call the scanner pack. Ingest uses a 256 KiB default cap and a 2 MiB hard cap with dock wait of 5 seconds and journal rotation at a byte cap. Operator key remains UCB_API_KEY and foreign agents use per-agent keys. Task manifests carry a digest and a signature so unsigned or provisional manifests cannot enable egress. The journal is hash-chained and ingest waits for collect-all Admit allow before the journal is persisted. CAW runtime identifiers use aep-caw and origin helper docs are gone from the public tree.
Validate runs under a two-slot pool with a forked child on Unix so the 2 second timeout kills that child and frees the slot. Composer uses a GAP engine URL only when set and does not invent a docker gateway. MCP JSON-RPC on the UCB MCP route uses the same auth as ingest and malformed tool arguments are refused. CCA setup writes protocol 2.8.5 and strips trust fields. Egress writes an audit row and isolates caller Authorization plus connection headers. Paper 005 VSA remains off unless named.
CAW CVE demo trees are not in the attachable component set while EPSCOM trust bundle mode is sha256-structure and ML-DSA is not claimed. AgentMesh docs say local issuance and a local cert is not mesh attestation.
## [2.8.x] - 2026-09-05 - ClosedWall dock collect and unbound fields
DenyReport closed walls now carry a class of writing, security, temporal, capability, poison or structural so a writing deny is not a transport failure. After enqueue the client collects the applied response by digest and enqueue is not Admit. Unbound scene, channel, time and sequence close Admit. GAP walls bind to a wrap or prefix except writing and security which stay always-on and GraphEngine does not run a node until admitGate allows.
## [2.8.x] - 2026-09-03 - live GAP named surfaces and UCB connectors
AEP-Policy-System GAP files load as live Admit walls on the kernel collect-all pass. CodeSandbox executes python, javascript, typescript and bash under the AEP data sandbox. Cedar and Rego transpilers emit GAP and reverse GAP exports emit Cedar and Rego. MCP proxy forwards policy-allowed tool calls through stdio JSON-RPC and SSE HTTP. Slack chat posts go through UCB egress and Jira creates issues through UCB egress. The advertised Python SDK now ships aep-protocol and dynaep clients. After dock allow the kernel executes bound HTTP and returns http on the dock response.
## [2.8.0] - 2026-09-04

The AEP 2.8 library now treats Base Node as the kernel: after a sealed lattice frame is opened the kernel freezes the clock at seal waits 1000 ms then runs the check that every opened message is supposed to meet. A missing scene dock timestamp or sequence fails those checks. Universal Connect Bridge remains an optional attach for foreign stacks.

## [2.8.0] - 2026-06-23

AEP Base Node is the mandatory Rust daemon with inference validation future and regulation docking ports. Lattice Channels use PQEncryptedCapsule. UCB is the secured perimeter dock for non-AEP agent stacks. Live evaluation is collect-all Admit.

## [2.75.0] - 2026-06-01
The 2.75 line adds CLI power tools named aep doctor, aep verify, aep lint-policy and aep red-team scan plus OPA Rego and Cedar transpilers, an MCP security gateway, Merkle-tree audit records, an intercept proxy, a YAML policy importer, a reference policy lattice and multi-agent collaboration primitives.
## [2.2.0] - 2026-04-24

The 2.2 line adds trust rings behavioural covenants agent identity cross-agent verification Merkle proofs a kill switch intent drift detection and streaming validation with early abort.

## [2.1.0] - 2026-04-24

The 2.1 line adds session governance a YAML policy engine an evidence ledger rollback and compensation an agent gateway MCP proxy mode and CLI commands aep init aep proxy aep exec aep validate and aep report.

## [2.0.0] - 2026-04-18

Lattice Memory adds vector similarity search and two storage backends. Basic Resolver maps proposals to validator pipelines. Memory Rego policies and TLA+ specifications ship with aep_version 2.0.

## [1.1.0] - 2026-04-16
The 1.1 line adds protocol extension registries for workflow, API, event and IaC plus TypeScript, React, Vue and Python SDKs, OPA Rego forbidden pattern policies, schema versioning, Template Nodes and a TLA+ formal specification. The licence transitions from MIT to Apache 2.0.
## [1.0.0] - 2026-04-01

Initial AEP protocol specification with a three-layer architecture of Structure Behaviour and Skin plus Z-band hierarchy and AOT and JIT validation modes.

