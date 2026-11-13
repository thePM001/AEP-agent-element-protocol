# AEP 2.9 threat model

This is the engineering threat model of the AEP 2.9 public tree. It covers the Base Node kernel, the docks, the UCB dock gateway, the CAW execution layer, the lattice channels and the Admit layer with its written policy. For each layer it names the assets, the trust boundaries, what an attacker can do, the threats with their mitigations and the risk that remains.

Every mitigation names at least one check that proves it. A check is a conformance id such as `CC-13` from `AEP-Components/conformance/tests/manifest.json`. A check can also be a test written as `path::name`, where `name` is a Rust `fn`, a Go `func` or a quoted vitest title. The live-set CI job runs `node aep-check.mjs`, whose `threat model` section reads every table row below and fails when a row names no check. It also fails when a cited conformance id is missing or only planned and when a cited test is not in its file.

```bash
node AEP-User-Experience/harness/check-threat-model-trace.mjs
```

`BIOSECURITY.md` is the access policy of the tree and is not part of this model. `AEP-CAW/SECURITY.md` holds the full CAW security notes and `AEP-Components/ucm/THREAT-MODEL.md` the UCM notes. This file is the root they belong under.

## System and trust boundaries

An agent never acts directly. It proposes an action. The proposal reaches the Base Node on a docking port as a sealed lattice channel frame. The Base Node opens the frame, queues it on the pulse and runs Admit: every product wall is compiled and one collect-all AND decides. Only an allowed action is applied and written to the action lattice. Commands an agent starts run under the CAW, which asks the validation dock before every exec. External agents reach the docks through the UCB dock gateway.

| Boundary | Between | What crosses it |
|----------|---------|-----------------|
| TB-1 | Agent process and docking socket | Sealed lattice channel frames |
| TB-2 | Opened frame and Admit | The plaintext event and its action path |
| TB-3 | Admit and Apply | Only actions whose every wall is open |
| TB-4 | UCB dock gateway and the outside | HTTP ingest, MCP calls and egress to upstream services |
| TB-5 | CAW and the wrapped command | Process start, file access, network egress |
| TB-6 | Kernel and its files on disk | Keys, lattice database, policy system directory |
| TB-7 | One wrap and another | Grants, budgets and policy walls bound to a wrap |

## Attacker model

| Id | Capability |
|----|------------|
| AC-1 | Runs as an agent with a valid sign key and real grants. It chooses every field of the events it proposes. |
| AC-2 | Controls several such agents in one wrap and coordinates them. |
| AC-3 | Reads and writes the local network and can connect to any docking socket the file mode allows. |
| AC-4 | Replays, reorders, truncates or alters frames it observed. |
| AC-5 | Runs code inside a CAW wrapped process and tries to reach the network, files or other processes. |
| AC-6 | Sends crafted HTTP and MCP requests to the UCB dock gateway. |

Out of scope: an attacker with root on the Base Node host, a compromised kernel or CPU, physical access and the operator who writes the policy. An operator who grants an agent a wide action is trusted to mean it.

## Layer 1: Base Node kernel

**Assets.** The dock KEM key and the agent sign keys, the action lattice database, the task manifests, the live entry state (satisfied actions, sequence numbers, the budget ledger) and the policy system directory it reads.

**Trust boundaries.** TB-2, TB-3 and TB-6.

**Attacker capabilities.** AC-1, AC-3 and AC-4. The attacker cannot write the kernel files unless the file mode lets it.

| Id | Threat | Mitigation | Checks |
|----|--------|------------|--------|
| BN-1 | A frame that is not JSON or has no action path slips past Admit. | Non JSON and a missing action path are collect-all denies before Apply. | `AEP-Base-Node/AEP-Crate/src/envelope_admit.rs::denies_non_json`, `AEP-Base-Node/AEP-Crate/src/envelope_admit.rs::denies_without_action_path`, `CC-13`, `CC-14` |
| BN-2 | An action path the lattice does not hold is applied. | An unknown path closes `dag.membership` and an empty or missing lattice denies every frame. | `AEP-Base-Node/AEP-Crate/src/envelope_admit.rs::denies_unknown_path`, `AEP-Base-Node/AEP-Crate/src/envelope_admit.rs::non_empty_action_path_on_empty_lattice_is_deny`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::missing_lattice_opened_ping_is_admit_deny` |
| BN-3 | A denied action still changes kernel state. | Collect-all runs before Apply and a deny leaves the live entry unchanged. | `AEP-Base-Node/AEP-Crate/src/envelope_admit.rs::collect_all_deny_runs_before_process_event`, `AEP-Base-Node/AEP-Crate/src/envelope_admit.rs::process_event_must_not_mutate_then_envelope_admit_err`, `AEP-Components/admit-budget-window/crate/src/tests.rs::denied_action_spends_nothing` |
| BN-4 | Key files are read or silently replaced. | Secret files are created private, a world readable dock key refuses to load and a corrupt key is never regenerated in silence. | `AEP-Base-Node/AEP-Crate/src/dock_keys_store.rs::secret_files_restrict_permissions`, `AEP-Base-Node/AEP-Crate/src/dock_keys_store.rs::world_readable_dock_kem_refuses_load`, `AEP-Base-Node/AEP-Crate/src/dock_keys_store.rs::corrupt_dock_kem_refuses_silent_regeneration`, `AEP-Base-Node/AEP-Crate/src/dock_keys_store.rs::tm21_corrupt_agent_sign_keys_refuse_empty_recovery` |
| BN-5 | The lattice database is opened under a directory another user can write. | The kernel refuses a world writable parent unless the operator sets the flag. | `AEP-Base-Node/AEP-Crate/src/lattice_log.rs::open_lattice_db_world_writable_parent_refused`, `AEP-Base-Node/AEP-Crate/src/lattice_log.rs::refuse_walks_missing_parent_to_world_writable_ancestor` |
| BN-6 | An agent acts without a task manifest or with a provisional one. | Strict mode rejects a missing manifest, a provisional manifest and a session mismatch. | `AEP-Base-Node/AEP-Crate/src/task_manifest.rs::missing_manifest_rejected_when_strict`, `AEP-Base-Node/AEP-Crate/src/task_manifest.rs::provisional_manifest_rejected`, `AEP-Base-Node/AEP-Crate/src/task_manifest.rs::session_registration_mismatch_rejected` |
| BN-7 | A poisoned lock aborts the kernel or answers allow. | Every poisoned lock answers ok false without an abort. | `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::poisoned_live_entry_lock_returns_ok_false_without_abort`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::poisoned_replay_lock_returns_ok_false_without_abort`, `AEP-Components/dock-request-poison/crate/src/lib.rs::lock_or_poison_err_on_poisoned_mutex` |
| BN-8 | An agent seals a frame whose event names another agent, so Admit judges the grants of that agent and spends its budget. | Every agent keyed wall judges the signer of the frame and `frame.agent_binding` closes when the event names another agent. | `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::frame_of_agent_b_that_names_agent_a_is_denied_by_the_binding_wall`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::unnamed_event_is_judged_as_the_signer_of_the_frame`, `AEP-Components/admit-live-dock/crate/src/lib.rs::event_that_names_another_agent_closes_the_binding_wall` |
| BN-9 | A frame is applied without a ledger row, a hub deny leaves applied state behind or a refused frame applies on a later beat. | The hub permission is an Admit wall. The ledger row is written after Admit and before Apply and every side effect follows it. A frame whose held digest cannot be recorded never enters the pulse queue. | `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::hub_deny_leaves_the_live_entry_unchanged_with_one_deny_row`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::ledger_error_at_the_record_step_applies_nothing`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::failed_enqueue_record_leaves_no_capsule_for_a_later_beat`, `AEP-Components/live-entry/crate/src/lib.rs::refused_delta_leaves_no_admit_state_behind` |
| BN-10 | Any admitted event with a url field makes the kernel send an HTTP request for the agent to any destination. | Only an event on the action path `gateway:outbound_http` sends a request. The lattice and the hub must grant that path to the signer. The operator route list is the Admit wall `gateway.route` and one signer holds at most two requests in flight under `gateway.agent_bound`. The request checks every address of the destination against the shared range list of `aep-egress-address`, connects only to those addresses, follows no redirect and reads a bounded body. | `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::admitted_write_with_a_url_field_sends_no_request`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::gateway_frame_without_a_lattice_grant_sends_no_request`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::gateway_frame_to_an_unlisted_destination_is_denied_by_the_route_wall`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::one_agent_holds_a_bounded_number_of_requests_in_flight`, `AEP-Components/egress-address/crate/src/lib.rs::every_url_vector_has_its_verdict_without_a_lookup`, `AEP-Components/lattice-gated-fetch/crate/src/lib.rs::reply_over_the_body_cap_fails_the_request` |
| BN-11 | One slow request or one odd target id stalls or closes every dock. | Admit, Apply and every beat run on the blocking pool and the outbound request runs on a thread of its own, so a collect answers while requests are in flight. Element ids are cut by characters, so no target id panics while the live entry lock is held. | `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::collect_answers_within_500_ms_while_two_slow_fetches_run`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::query_with_a_multi_byte_target_id_is_answered_without_a_panic`, `AEP-Components/live-entry/crate/src/lib.rs::z_band_query_cuts_the_target_id_by_characters` |

**Residual risk.** A local user with the same uid as the kernel can read its keys. The kernel trusts the clock of its host for the pulse, the temporal walls and the budget window. A lattice the operator writes too wide grants what it says.

## Layer 2: Docks

**Assets.** The docking sockets, the replay store, the per signer and per dock rate limiters, the registered LRP contracts and the pulse queue.

**Trust boundaries.** TB-1 and TB-2.

**Attacker capabilities.** AC-3 and AC-4, plus AC-1 for a signed agent.

| Id | Threat | Mitigation | Checks |
|----|--------|------------|--------|
| DK-1 | A plain ping or plain event is accepted without a sealed frame. | Plain wire formats are refused. | `CC-13`, `CC-14`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::plain_ping_is_rejected`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::plain_register_lrp_is_rejected` |
| DK-2 | A captured frame is replayed. | The frame digest is kept in memory and in SQLite and a repeat is refused, also after eviction from memory. | `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::rejects_replayed_frame_digest`, `AEP-Base-Node/AEP-Crate/src/lib.rs::replay_guard_rejects_duplicate_digest` |
| DK-3 | A frame is altered or signed by a key the dock does not bind. | A tampered signature and an unbound signer key are refused. | `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::rejects_tampered_signature`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::rejects_unbound_wire_signer_public_key` |
| DK-4 | A frame meant for one port is sent to another. A frame arrives stale or from the future. | Port, age and future skew are checked on open. | `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::rejects_port_mismatch`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::rejects_stale_frame`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::rejects_future_skew_frame` |
| DK-5 | A flood of frames starves other agents. | Per signer and per dock rate limits refuse the excess and record a side channel anomaly. | `CC-08`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::rate_limit_records_side_channel_anomaly` |
| DK-6 | An LRP contract that is not on the allowlist is registered. A self reported trust score raises a trust tier. | Only allowlisted contracts register and a wire trust score without a signed field is ignored. | `CC-09`, `CC-11`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::rejects_non_allowlisted_lrp_contract`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::bm07_wire_trust_score_ignored_without_signed_field` |
| DK-7 | An agent stamps its event ahead of the kernel clock, so the drift walls compare the stamp with itself and the capsule waits in the pulse queue. | The freeze is the kernel clock, read when the frame arrives. A stamp more than 50 ms ahead of that clock or more than 5000 ms behind it is refused at enqueue and takes no room in the queue. A stamp in the past does not shorten the hold. | `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::frame_stamped_thirty_seconds_ahead_is_refused_at_enqueue`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::stamp_older_than_the_age_bound_is_refused_at_enqueue`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::seal_and_transit_time_is_not_drift_and_does_not_shorten_the_hold`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::freeze_is_the_kernel_clock_and_not_the_stamp_of_the_agent` |
| DK-8 | One signer fills the pulse queue and every other agent is refused. | One signer holds at most half of the queue in capsules and in bytes. | `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::signer_at_its_queue_share_leaves_room_for_another_signer`, `AEP-Components/base-node-pulse/crate/src/lib.rs::one_signer_holds_only_its_share` |
| DK-9 | A peer without the key of an agent spends the rate slots of the agent it names or writes anomaly rows without limit. | The signature of the registered key is checked before any rate slot is spent. The dock closes a connection after 32 refused lines. | `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::frame_with_a_bad_signature_spends_no_rate_slot_of_the_agent_it_names`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::one_connection_writes_a_bounded_number_of_anomaly_rows` |
| DK-10 | Silent or crowded connections take every connection slot of the docks and ended connections are held for the life of the daemon. | A connection that completes no line in 30 s is closed. Each docking port holds its own share of 16 slots. The task list releases ended connection tasks. | `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::idle_connection_is_closed_after_the_idle_timeout`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::a_full_port_leaves_slots_for_the_other_ports`, `AEP-Base-Node/AEP-Crate/src/docking/tests.rs::ended_connection_tasks_are_released` |

**Residual risk.** Two signers that each hold their share can still fill the pulse queue for one pulse. An agent whose clock runs more than 50 ms ahead of the kernel clock is refused. An agent may stamp its event up to 5000 ms in the past, which moves the event time of the Admit time walls and of the budget window by that much. A signed agent within its rate limit can still keep a dock busy with frames that Admit denies. A peer that reconnects after each closed connection writes up to 32 anomaly rows per connection. The socket file mode is the only guard against a local user who connects to a socket.

## Layer 3: UCB dock gateway

**Assets.** The gateway API key, the per agent keys, the egress routes and the upstream credentials they inject, the validator sandbox and the ingest journal.

**Trust boundaries.** TB-4 and TB-6.

**Attacker capabilities.** AC-6, plus AC-1 for an agent with a gateway key.

| Id | Threat | Mitigation | Checks |
|----|--------|------------|--------|
| UB-1 | Egress reaches loopback, private, shared, link local or reserved addresses, also through a second answer of the name server. | The egress layer refuses every class outside the public ranges of `aep-egress-address`, resolves the host once and connects only to the checked addresses. | `AEP-Base-Node/AEP-Docks/ucb/crate/tests/perimeter_conformance.rs::ssrf_private_and_link_local_refused`, `AEP-Base-Node/AEP-Docks/ucb/crate/src/egress.rs::blocks_loopback_upstream`, `AEP-Base-Node/AEP-Docks/ucb/crate/src/egress.rs::upstream_check_holds_the_shared_egress_vectors` |
| UB-2 | A request reaches an upstream no route names. | Egress without a matching route is denied. | `AEP-Base-Node/AEP-Docks/ucb/crate/src/egress.rs::implicit_deny_without_match`, `AEP-Base-Node/AEP-Docks/ucb/crate/src/egress.rs::tm23_match_route_path_boundary_and_legacy_prefix` |
| UB-3 | An unsigned or provisional manifest uses egress or credential injection. | Only a signed, provided manifest may egress and inject. | `AEP-Base-Node/AEP-Docks/ucb/crate/tests/perimeter_conformance.rs::unsigned_and_provisional_cannot_egress`, `AEP-Base-Node/AEP-Docks/ucb/crate/src/egress.rs::unsigned_provisional_cannot_inject`, `AEP-Base-Node/AEP-Docks/ucb/crate/src/manifest.rs::trust_fields_refuse` |
| UB-4 | Caller credentials leak to an upstream. Secrets come from any environment variable. | Authorization and connection headers are stripped and injected secrets come only from allowlisted prefixes. | `AEP-Base-Node/AEP-Docks/ucb/crate/src/egress.rs::strips_authorization_and_connection`, `AEP-Base-Node/AEP-Docks/ucb/crate/src/egress.rs::secret_env_allowlist_prefixes` |
| UB-5 | An oversized ingest, a replayed ingest or an ingest that Admit denies is journaled as accepted. | Size caps, replay refusal and the Admit verdict decide the ingest answer. | `AEP-Base-Node/AEP-Docks/ucb/crate/tests/perimeter_conformance.rs::oversize_ingest_refused`, `AEP-Base-Node/AEP-Docks/ucb/crate/tests/perimeter_conformance.rs::duplicate_replay_is_pr`, `AEP-Base-Node/AEP-Docks/ucb/crate/tests/perimeter_conformance.rs::ingest_ok_false_when_admit_denies` |
| UB-6 | A validator process escapes its sandbox. | The validator runs confined and a forbidden syscall kills it. The filter allows no process or network calls. | `AEP-Base-Node/AEP-Docks/ucb/crate/tests/validator_isolation.rs::confined_process_is_killed_on_a_forbidden_syscall`, `AEP-Base-Node/AEP-Docks/ucb/crate/src/sandbox.rs::filter_never_allows_process_or_network_calls` |
| UB-7 | The MCP surface is reached without a key. An agent key is rolled back. | The MCP route sits behind key auth and agent keys cannot roll back. | `AEP-Base-Node/AEP-Docks/ucb/crate/src/http.rs::mcp_route_is_behind_require_auth`, `AEP-Base-Node/AEP-Docks/ucb/crate/src/auth.rs::agent_key_cannot_rollback`, `CC-34` |

**Residual risk.** An upstream that a route names is trusted with what the route sends it. A holder of the gateway key acts as the gateway until the operator rotates it.

## Layer 4: CAW

**Assets.** The host files outside the workspace, the network beyond the declared routes, the processes of other sessions and the credentials of declared HTTP services.

**Trust boundaries.** TB-5, plus TB-1 for the kernel dock ping the CAW seals before every exec.

**Attacker capabilities.** AC-5.

| Id | Threat | Mitigation | Checks |
|----|--------|------------|--------|
| CW-1 | A command starts without the validation dock admitting it. | The kernel dock gate seals a ping before every exec and refuses on a missing socket, a silent dock, a deny or a missing sign key. | `AEP-CAW/internal/kerneldock/kerneldock_test.go::TestProbeRefusesDockDeny`, `AEP-CAW/internal/kerneldock/kerneldock_test.go::TestProbeRefusesMissingSocket`, `AEP-CAW/internal/kerneldock/kerneldock_test.go::TestProbeRefusesWithoutASignKey` |
| CW-2 | Egress reaches a destination that no rule names because a catch-all rule lets it through. | With `unmatched_egress: deny` a catch-all rule that is not deny stops matching, the eBPF allowlist drops it and the connection is denied as `unmatched-egress-deny`. The wrap coverage report lists every catch-all as unmatched until the mode is on. | `AEP-CAW/internal/policy/unmatched_egress_test.go::TestUnmatchedEgress_DenyIgnoresCatchAllNonDenyRules`, `AEP-CAW/internal/policy/unmatched_egress_test.go::TestUnmatchedEgress_DoubleStarAllowIsCatchAll`, `AEP-CAW/internal/api/ebpf_allow_test.go::TestBuildAllowedEndpoints_UnmatchedEgressDenyDropsCatchAll`, `AEP-Components/wrap-coverage/tests/wrap-coverage.test.mjs::"a CAW catch-all allow rule without unmatched_egress deny is unmatched"` |
| CW-3 | A domain on a threat feed is reached. | A threat feed match in deny mode refuses before rule evaluation and audit mode still respects the default deny. | `AEP-CAW/internal/policy/engine_threat_test.go::TestCheckNetworkCtx_ThreatFeedDeny`, `AEP-CAW/internal/policy/engine_threat_test.go::TestCheckNetworkCtx_ThreatFeedAuditRespectsDefaultDeny` |
| CW-4 | A wrapped process reads files outside its grant or traces another process. | Landlock confines file access and seccomp blocks ptrace. | `AEP-CAW/internal/landlock/integration_test.go::TestLandlockEnforcement_BlocksUnauthorizedAccess`, `AEP-CAW/internal/seccomp/integration_test.go::TestSeccompBlocksPtrace` |
| CW-5 | An opaque shell script hides a denied command. | An opaque `sh -c` script is denied when execve enforcement is not active. | `AEP-CAW/internal/policy/command_shellc_interception_test.go::TestCheckCommand_OpaqueDeniedWhenNoExecveEnforcement` |
| CW-6 | A policy switch is set to a value the engine does not know and silently means allow. | `unmatched_egress` accepts only empty, `default` or `deny` and validation refuses anything else. | `AEP-CAW/internal/policy/unmatched_egress_test.go::TestUnmatchedEgress_ValidateRejectsUnknownValue` |

**Residual risk.** `unmatched_egress` is off by default so existing policies keep their decisions. A policy without it still lets a catch-all allow or approve rule reach any destination on its ports. Approval rules become allow only when the operator sets the shadow allow switch. Kernel level confinement depends on the host kernel features listed in `AEP-CAW/SECURITY.md`.

## Layer 5: Lattice channels and crypto

**Assets.** Frame confidentiality and integrity, the binding of a frame to its channel, agent, session and contract. The post quantum keys.

**Trust boundaries.** TB-1.

**Attacker capabilities.** AC-3 and AC-4.

| Id | Threat | Mitigation | Checks |
|----|--------|------------|--------|
| LC-1 | A capsule is altered or signed by the wrong key. | Tampered ciphertext, a bad signature and a fingerprint mismatch are refused. | `CC-01`, `AEP-Components/lattice-crypto/crate/src/lib.rs::tampered_ciphertext_rejected`, `AEP-Components/lattice-crypto/crate/src/lib.rs::bad_signature_rejected`, `AEP-Components/lattice-crypto/crate/src/lib.rs::fingerprint_mismatch_rejected` |
| LC-2 | A sealed frame is moved to another channel, agent, session or contract. | The binding is part of the AEAD data and a capsule with a binding opens only with it. | `AEP-Components/lattice-crypto/crate/src/lib.rs::binding_aad_required_for_open_with_binding`, `AEP-Components/lattice-channels/crate/src/lib.rs::binding_uses_v2_magic_not_v1_join` |
| LC-3 | A delimiter inside an id makes two different bindings encode the same bytes. | Ids that carry the delimiter are refused before sealing and the encoding is length prefixed. | `AEP-Components/lattice-channels/crate/src/lib.rs::delimiter_in_agent_id_rejected`, `AEP-Components/lattice-channels/crate/src/lib.rs::build_frame_rejects_delimiter_before_seal`, `AEP-Components/lattice-channels/crate/src/lib.rs::length_prefix_is_unambiguous` |
| LC-4 | A frame on an inactive contract or a burst of frames passes the channel. | The contract gate and the channel rate limiter refuse them. | `CC-02`, `AEP-Components/lattice-channels/crate/src/lib.rs::contract_enforcement_blocks_inactive`, `AEP-Components/lattice-channels/crate/src/lib.rs::rate_limiter_blocks_burst` |

**Residual risk.** Traffic analysis of frame sizes and timing is out of scope. Key compromise on the agent host lets the attacker act as that agent within its grants and budgets.

## Layer 6: Admit and written policy

**Assets.** The grants of every agent, the walls of the written GAP policy, the budget ledger and the boundary between wraps.

**Trust boundaries.** TB-2, TB-3 and TB-7.

**Attacker capabilities.** AC-1 and AC-2. The attacker chooses every field of its events and may split work over time and over agents.

| Id | Threat | Mitigation | Checks |
|----|--------|------------|--------|
| AD-1 | An agent acts on a path it is not granted or skips a parent action. | `agent_permission` and the partial order walls close. Parent closure is partitioned per agent. | `CC-35`, `AEP-Components/conformance/crate/tests/redteam_multistep.rs::cc35_every_multi_step_attack_is_denied` |
| AD-2 | Data leaves one agent in slices that each pass Admit. | The budget policy holds every agent to a volume budget over a sliding window and closes `policy:budget:agent_volume_bytes` on the slice that would pass it. | `CC-35`, `AEP-Components/admit-budget-window/crate/src/tests.rs::volume_slices_close_the_agent_wall_inside_the_window`, `AEP-Components/admit-budget-window/crate/src/tests.rs::spend_leaves_the_window_after_window_ms` |
| AD-3 | Several agents of one wrap each send a share. | The wrap budget sums every agent of the wrap and the wrap is the wrap of the lattice node, so an event cannot move its spend. Unwrapped actions share one bucket. | `CC-35`, `AEP-Components/admit-budget-window/crate/src/tests.rs::wrap_budget_counts_every_agent_of_the_wrap`, `AEP-Components/admit-budget-window/crate/src/tests.rs::unwrapped_actions_share_one_wrap_bucket` |
| AD-4 | Sensitive reads that each pass add up past what a task needs. | Sensitivity is the weight of the action path plus the weights of the scan rule table classes found in the event, summed over the window. | `CC-35`, `AEP-Components/admit-budget-window/crate/src/tests.rs::sensitivity_adds_path_weight_and_content_classes`, `AEP-Components/admit-budget-window/crate/src/tests.rs::sensitivity_budget_closes_on_weighted_reads` |
| AD-5 | An agent probes one new target or capability after another. | The novelty budget counts targets the scope had not touched before and closes on the one past the limit. | `CC-35`, `AEP-Components/admit-budget-window/crate/src/tests.rs::novelty_counts_new_targets_only`, `AEP-Components/admit-budget-window/crate/src/tests.rs::known_targets_are_bounded` |
| AD-6 | The budget policy is removed or broken so no budget applies. | `budget` is a required stem: a missing file closes `policy:budget:loaded` and unreadable parameters close `policy:budget:parameters`. | `AEP-Components/policy-system-admit/crate/src/lib.rs::missing_budget_policy_closes_its_loaded_wall`, `AEP-Components/admit-budget-window/crate/src/tests.rs::unreadable_policy_closes_the_parameters_wall`, `AEP-Components/admit-budget-window/crate/src/tests.rs::reference_budget_policy_parses` |
| AD-7 | The budgets deny ordinary work and operators turn them off. | Control chains that spread the same work over time are allowed and an action that adds nothing to a dimension is not held by it. | `AEP-Components/conformance/crate/tests/redteam_multistep.rs::cc35_control_chains_are_allowed`, `AEP-Components/admit-budget-window/crate/src/tests.rs::sensitivity_budget_closes_on_weighted_reads` |
| AD-8 | A credential, egress route, tool or lattice grant sits outside every wrap and acts ungoverned. | The wrap coverage report lists each one with the wrap that governs it, exits 1 on any unmatched entry and runs in CI on the end-to-end example. | `AEP-Components/wrap-coverage/tests/wrap-coverage.test.mjs::"the end-to-end inventory has zero unmatched entries"`, `AEP-Components/wrap-coverage/tests/wrap-coverage.test.mjs::"a credential without a grant is unmatched"`, `AEP-Components/wrap-coverage/tests/wrap-coverage.test.mjs::"a lattice grant that no wrap grants is unmatched"` |
| AD-9 | Content of an action carries personal data or writing that the policy forbids. | The always on security and writing stems close on every action path. | `CC-16`, `CC-17`, `CC-35`, `AEP-Components/policy-system-admit/crate/src/lib.rs::pii_always_on_from_security_gap` |

**Residual risk.**

- Budgets are counts over a window. An attacker who spreads a leak over longer than the window can stay under each limit. So can one who spreads it across more wraps than one operator watches. The limits in `AEP-Policy-System/reference/budget.gap` are a starting point and an operator sets them per deployment.
- Sensitivity weights come from action path prefixes and from the pattern classes of the shared scan rule table. Data that matches no prefix and no class carries no sensitivity weight. An adversary can tune content against patterns, so volume and novelty remain the budgets that hold an unknown kind of data.
- Novelty remembers a bounded number of targets per scope. A target that falls out of memory counts as new again, which errs toward denial.
- The budget ledger lives in the memory of the kernel process and starts empty after a restart.
- The wrap coverage report judges the inventory it is given. A credential or route that the deployment uses and the inventory omits is outside the report.

## Traceability

Each row above names its checks in the last column. The checks run in these places.

- Rust tests and conformance checks: `bash AEP-Components/conformance/runner/run.sh` and `cargo test --workspace` in the live-set and rust-workspace CI jobs. CC-35 is listed in the conformance manifest.
- Go tests: `go test ./...` in the caw CI job.
- vitest tests: `npm test` in the TypeScript CI job.
- The wrap coverage report on the end-to-end example and this traceability check: the live-set CI job.
