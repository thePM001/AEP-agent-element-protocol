# AepCaw DB Access Spec v0.7 - Pressure-Test Redline

**Date:** 2026-05-08
**Target spec:** `docs/aep-caw-db-access-spec.md` (v0.7, marked "implementation-frozen")
**Purpose:** Surface concerns before code is written. Each item is a proposed spec edit. Reviewer decides accept / reject / defer; survivors merge as v0.8 with a §0 changelog entry.

The spec is structurally sound. The 23 items below are bugs, contradictions, missing failure cases, and operator footguns - not architectural reconsiderations.

---

## Triage summary

| Tier | Count | Character |
|------|-------|-----------|
| 1. Will change spec semantics | 5 | DEALLOCATE in sample, cancel-mapping eviction, approval default, statement_text redaction, critical-tier tiebreak |
| 2. Implementation traps | 4 | Replication boundary, dirty-since-sync wording, conn-string objects, SNI |
| 3. Security & threat model | 4 | Proxy identity (the big one), bypass-event rate limit, temp shadow direction, audit-on-dangerous warning |
| 4. Algorithm precision (§10.2/§14.2/§15) | 8 | Ordering contradiction, approve+audit overlap, multi-glob rule, in-tx Sync guard, pre-deny response forwarding, cancel-rule sequencing, mapping-commit ordering, mapping per-proxy vs per-service |
| 5. Operator footguns | 2 | Bypass-tool bundle scope, missing audit-on-DANGEROUS warning |

23 items.

---

## Tier 1 - Will change spec semantics

### R1. §9.2 sample policy denies DEALLOCATE

**Issue.** §7.3 maps `DEALLOCATE name` and `DEALLOCATE ALL` to `session(discard_plans)`. The sample's `app-allow-safe-session-settings` allowlists subtypes `[set, reset, set_local]`. `app-deny-other-session-settings` denies the rest. Under this policy, every SQL-level prepared-statement workflow that issues `DEALLOCATE` is denied - common in some Django, asyncpg, and pgbouncer transaction-pooled configurations.

**Edit (§9.2 sample policy).**

```yaml
- name: app-allow-safe-session-settings
  db_service: appdb
  operations: [session]
  subtypes: [set, reset, set_local,
             discard_plans, discard_all, discard_temp, discard_sequences]
  objects: ["application_name", "timezone", ...]
  decision: allow
```

**Edit (§9.2 narrative).** Add a sentence after the sample: *"`discard_plans` and friends are in the safe list because client drivers issue them as part of normal prepared-statement lifecycle. Deny on these breaks ORMs that maintain a server-side prepared-statement cache."*

**Impact.** Sample policy is the documentation surface operators copy. Today's sample bricks prepared-statement-using apps.

---

### R2. §15.3 cancel-mapping eviction can drop live mappings

**Issue.** "Oldest entries evicted first if `cancel_mapping_max` (100k) is hit." Oldest by creation timestamp is not the same as no-longer-needed. A long-running streaming connection has an old mapping that is still in active use; under churn, eviction silently breaks `Ctrl+C` for that session.

**Edit (§15.3).** Replace the eviction policy with:

> Eviction considers only entries whose connection has been closed for ≥ `cancel_grace_window`. If the cap is hit and no evictable entries exist, the proxy fails new connection setup with `BACKEND_KEY_TABLE_FULL` and emits an operational alert. Live mappings are never evicted.

**Edit (§17 failure-modes table).** Add row: `cancel_mapping_max hit with no evictable entries | Connection setup fails. BACKEND_KEY_TABLE_FULL. Operational alert.`

---

### R3. Approval `timeout` default is unsafe inside transactions

**Issue.** §9.2: default 5 minutes. §14.5 acknowledges this and recommends 30-60s, but the default is shipped as 5min. Defaults should be the safe choice; operators who need long approvals opt up.

**Edit (§9.2 statement-rule field table).** `timeout | only for approve | Default 60 seconds.`

**Edit (§14.5).** Replace "Operators are recommended to set short `timeout`…" with: *"The default is 60 seconds, sized to be safe inside open transactions. Operators with long-form approval workflows should opt up explicitly per rule, accepting the lock-hold cost."*

---

### R4. `DBEvent.statement_text` lacks a redaction control

**Issue.** §10.3 redacts the *approval preview*, but `policies.db.log_statements: true` ships full statement text - including INSERT values, WHERE-clause PII, and embedded credentials in `CREATE SUBSCRIPTION CONNECTION '...'` - to the event store. Approval preview redaction without event redaction defeats the privacy posture.

**Edit (§10.3 settings).** Promote `log_statements` to an enum:

```yaml
policies:
  db:
    log_statements: parameters_redacted   # none | parameters_redacted | full
    approval_statement_preview: redacted  # none | redacted | full
    approval_statement_preview_chars: 200
```

**Edit (§8 DBEvent schema).** `statement_redaction` field already exists (`none | parameters_redacted | full`). State that this field reflects the *event-level* redaction applied, independent of approval preview. Operators with `log_statements: parameters_redacted` get `parameters_redacted` events regardless of approval-preview setting.

**Edit (§10.3 narrative).** A privacy-sensitive deployment should set both `log_statements: parameters_redacted` (or `none`) and `approval_statement_preview: redacted` (or `none`) for the strongest posture.

---

### R5. Critical-tier tiebreak for primary effect is under-defined

**Issue.** §5.2 example asserts `COPY <table> TO '/path'` has `unsafe_io` as primary "because copying to a path is a filesystem operation primarily." But by the rule as written (highest tier → syntactic root → AST traversal), `unsafe_io` and `bulk_export` are both critical, and `COPY` is the syntactic root for both effects. The example is a vibe call, not a rule application; two implementers will produce different primaries.

**Edit (§5.2 ordering rule).** Add an explicit total order on group-tier ties:

> 1. Highest risk tier first.
> 2. Tie-break on tier: a fixed group order - `unsafe_io > bulk_export > schema_destroy > privilege > unknown` for critical; `delete > schema_create > schema_alter > bulk_load > procedural` for high; document order is the canonical tiebreaker within each tier.
> 3. Final tiebreak: stable AST traversal order.

**Edit (§5.2 example).** The `COPY <table> TO '/path'` row becomes a clean rule application: critical tier → fixed group order → `unsafe_io > bulk_export` → primary is `unsafe_io`. The vibe-call sentence is removed.

---

## Tier 2 - Implementation traps

### R6. Replication passthrough boundary

**Edit (§11.1).** State explicitly: *"When a replication-mode connection is allowed, passthrough begins at StartupMessage acceptance, not at the first CopyBoth frame. The bootstrap commands (`IDENTIFY_SYSTEM`, `CREATE_REPLICATION_SLOT`, `START_REPLICATION`) are not classified."* Add to §17 failure-modes table for symmetry.

### R7. `upstream_dirty_since_sync` reset wording

**Edit (§14.2).** "Reset to false after observing the next `ReadyForQuery` from upstream **in the current Sync window**." The flag is per-window; the lifetime reading is incorrect.

### R8. Connection strings as effect objects

**Issue.** §5.2 example shows `{kind: "external_endpoint", name: "host=upstream.example port=5432"}`. Connection strings vary syntactically (URI vs keyword=value), can embed passwords, and are fragile to glob-match. Persisting raw strings into events leaks credentials.

**Edit (§5.2, §6, §8).** External-endpoint objects are structured: `{kind: "external_endpoint", host: "<host>", port: <int>}`. Raw connection strings are parsed at classification time; passwords and other non-host/port fields are discarded before the object is committed to the effect. Operators write rules against `host` and `port`, not raw strings.

### R9. SNI under passthrough is best-effort

**Edit (§13.2 footnote to the visibility matrix).** *"SNI under passthrough depends on the client driver setting it in ClientHello. Many Postgres drivers do not set SNI by default, especially when connecting by IP. SNI-based connection rules under passthrough are best-effort; operators should validate against their specific driver stack."*

---

## Tier 3 - Security & threat model

### R10. Proxy identity and listener authentication (the big one)

**Issue.** §12.4 says: *"process token issued by the AepCaw supervisor at proxy launch; the supervisor checks token validity against its internal registry on every egress evaluation."* No such token, registry, or per-rule process-identity field exists in the codebase today. `NetworkRule` (`internal/policy/model.go`) has no process-identity columns. The spec's primitive is aspirational.

Separately, §11.2/§11.3 don't specify how the proxy *listener* authenticates inbound connections. `connect_redirect` covers the agent's TCP connect()s, but a co-resident non-agent process on the same host can connect to the proxy's localhost listener directly - bypassing the redirect - and speak SQL through it. The unavoidability claim is silent on this.

**Edit (§12.4 - replace existing prose).**

> The proxy egress exemption is implemented via **SessionID-keyed rule evaluation**, AepCaw's existing process-tracking primitive (set at ptrace attach in `internal/ptrace/attach.go`; consulted in `internal/policy/engine.go` `CheckNetworkCtx`). Mechanism:
>
> 1. The supervisor launches the DB proxy as a separate process under a distinct SessionID, outside the agent's ptrace tree.
> 2. Per-service `network_rules` deny egress to declared DB destinations *for the agent's SessionID*. The proxy's SessionID is not subject to those rules (or carries explicit allow rules).
> 3. SessionID is supervisor-assigned at session creation. A child process inherits its parent's SessionID via ptrace tracking. An agent process cannot spawn a child with a different SessionID without supervisor cooperation.
> 4. Forging a SessionID at the rule-evaluation API requires either compromising the supervisor (out of model per §12.1) or escaping the ptrace tree (which the unavoidability bundle prevents).
>
> **Phase 1 dependency.** The current `NetworkRule` schema has no process-identity fields beyond what SessionID provides. Adding per-rule `proxy_session: true` matchability, or equivalently a built-in egress exemption keyed on the proxy's SessionID, is part of the Phase 1 deliverable, not pre-existing infrastructure. §23.4 implementation order item 10 ("Unavoidability bundle generation from `db_services` config") MUST include this work.

**Edit (§12 - add new subsection §12.5 "Listener authentication").**

> The proxy listens on a Unix domain socket or localhost TCP port. Inbound connections must be authenticated to the agent's SessionID before any Postgres protocol is accepted. Authentication mechanism:
>
> - **Unix socket (preferred).** SO_PEERCRED returns the connecting process's PID and UID. The proxy resolves PID to TGID to SessionID via the existing AepCaw ptrace registry and matches against the configured agent SessionID for this proxy instance. Unix sockets are placed at a path the agent's `file_rules` permit and other tenants do not.
> - **Localhost TCP (fallback).** The proxy verifies the inbound TCP socket's `SO_PEERCRED` (`getsockopt(TCP_INFO)` on Linux) where available; on platforms without per-socket peer creds for TCP, the proxy refuses to start in localhost-TCP mode and the operator must use Unix sockets.
>
> An inbound connection that fails authentication is closed with no protocol response. Event `db_listener_auth_fail` emitted with `peer_pid`, `peer_session_id`, and `reason`.

**Edit (§12.7 "What unavoidability does not cover").** Remove the implicit assumption that the proxy listener is trusted; add: *"A co-resident non-agent process attempting to use the proxy as an SQL forwarder. Mitigated by listener authentication (§12.5)."*

**Open follow-up (not a redline):** §11.3 step 1 ("Agent initiates TCP connect. Intercepted via `connect_redirect`") needs to specify whether `connect_redirect` rewrites to a Unix socket or to localhost TCP. Spec is silent. Recommend Unix socket so SO_PEERCRED works portably; this becomes a §11.3 edit if confirmed.

### R11. `db_bypass_attempt` rate limiting

**Edit (§12.5, soon to be §12.6 after R10's renumbering).** *"Bypass-attempt events are deduplicated per `(session_id, process_identity, destination_tuple)` within a 60-second window. Suppressed duplicates increment a counter on the canonical event for the window."*

### R12. `maybe_temp_shadowed` failure direction

**Edit (§6.1 after the resolution-tags table).** *"Temp-table tracking is best-effort. **False negatives are unsafe**: a real temp shadow tagged `qualified_syntactic` lets an allow rule on the production table apply to a temp table the agent created. False positives (tagging `maybe_temp_shadowed` when no real shadowing exists) are noisy but safe. The default-bundle deploys `deny on CREATE TEMP TABLE` for high-assurance services as the durable mitigation; relying on `maybe_temp_shadowed` alone is not recommended."*

**Edit (§6.4).** Promote the temp-table deny pattern from "recommended" to "default for the high-assurance bundle."

### R13. `audit` on critical/high → load-time warning

**Edit (§9.4).** Add validation: *"A rule with `decision: audit` whose `operations:` resolves to one or more groups with risk tier ≥ `high` produces a non-fatal warning at config-load. Operators who genuinely intend audit-as-allow on dangerous operations silence the warning by setting `acknowledge_audit_on_dangerous: true` on the rule."*

---

## Tier 4 - §10.2 / §14.2 / §15 algorithm precision

### R14. ⚠ §10.2 contradicts itself on rule ordering

**Issue.** §10.2 prose: *"Walk rules top-to-bottom (first-match-wins per object, with object-set semantics below)."* §10.2 algorithm: *"Collect all allow/audit rules whose group/subtype/resolution match e."* §10.4: *"rule evaluation is first-match-wins (top-to-bottom in the policy file)."*

These produce different outcomes when an object is matched by both an allow rule and a deny rule:
- First-match-wins per object: object matches the first rule that fits → if allow comes first, allowed.
- Collect-all (any-deny-wins): the deny applies regardless of order → denied.

The deny precedence in the algorithm strongly implies collect-all. The "first-match-wins" prose is wrong.

**Edit (§10.2 first sentence).** Replace "Walk rules top-to-bottom (first-match-wins per object, with object-set semantics below)" with: *"Rule order does not affect outcomes. The algorithm is order-independent: deny rules trigger on any matching object regardless of position; allow / audit / approve rules contribute to coverage; the most-restrictive verb across covered objects wins."*

**Edit (§10.4).** Replace the section with: *"For each effect, rule evaluation is order-independent. Deny matches anywhere produce deny. Allow / audit / approve rules contribute to the per-object coverage set. The final effect-level decision is the most-restrictive verb among rules that cover the object set, with `deny ≡ implicit_deny > approve > audit > allow` (§10.2). No-match for any object → implicit deny."*

**Why this matters.** This is the most important finding in this redline. Two policy-evaluator implementations that read the spec carefully will produce different decisions on perfectly normal policies until this is fixed. CI tests in §23.3 will not catch the divergence because they will themselves be written to one interpretation.

### R15. `approve` + `audit` overlap

**Edit (§10.2).** Add: *"When an effect's coverage includes a mix of allow / audit / approve rules and no deny, the final decision is `approve` (most-restrictive). After human approval, the forwarded event carries `decision.verb: \"approve\"`. Audit tags from co-covering rules are recorded in `decision.contributing_audit_rules` (array of rule names) but do not change the verb. Watchtower alerting that targets `decision.verb == audit` does not fire on these events; alerting that targets the contributing-rules list does."*

### R16. Multi-glob rules

**Edit (§9.2 field table for `objects:`).** *"Glob list. A rule with `objects: [\"a\", \"b\"]` covers any object whose name globs against `a` or `b`. Coverage is per-object: if an effect has objects `{a, c}`, this rule covers `a` only."*

### R17. §14.2 Sync sub-cases need an in-tx guard

**Edit (§14.2 Sync handling).** Add at the top, before the three sub-cases: *"If upstream is in `T` state, §14.3 governs and this Sync handling does not apply. The sub-cases below assume upstream is in `I` or `E` state."*

### R18. Pre-deny upstream response forwarding

**Issue.** §14.2 case 2 (absorbing + dirty) says "drain upstream responses (any pending ParseComplete, BindComplete, etc.) - implementations should suppress these to keep the response stream clean." That loses the agent's actual successful results from messages that *were* forwarded before the deny.

**Edit (§14.2 case 2).** Replace with: *"Forward upstream responses for messages that were sent upstream before the deny point (these are normal protocol responses to allowed messages; the agent expects them). Once the proxy synthesizes `ErrorResponse` for the deny, suppress all further upstream responses until upstream's `ReadyForQuery`. Forward upstream's RFQ status to the client."*

### R19. CancelRequest connection-rule sequencing

**Edit (§15.2).** Add explicit sequence: *"(1) Mapping lookup. (2) Connection-rule evaluation against `match_kind: cancel` rules with `db_service`, `client_identity`. (3) On `allow`, forward translated `CancelRequest(real_pid, real_secret)` and emit DBEvent. On `deny`, close client connection and emit deny event. `decision: approve` is rejected at config-load time for `match_kind: cancel` rules: cancel is a real-time signal that cannot be held."*

**Edit (§9.4 config-load validation).** Add: *"`decision: approve` on a `match_kind: cancel` rule → load error."*

### R20. §15.1 mapping-commit ordering

**Edit (§15.1).** Add as step 4: *"The mapping is committed to the table **before** the proxy forwards `BackendKeyData(syn_pid, syn_secret)` to the client. The client cannot present a synthetic key the proxy has not committed; race-free."*

### R21. §15.3 mapping table per-proxy vs per-service

**Edit (§15.3).** Add: *"The mapping table is proxy-wide. `cancel_mapping_max` is a global cap, not per-service. A high-churn service can consume capacity that would otherwise be available to a low-churn one. Operators sizing the cap should account for fleet-wide churn. Per-service caps are deferred to a future revision."*

---

## Tier 5 - Footguns

### R22. Bypass-tool bundle scope

**Edit (§12.6, after R10's renumbering becomes §12.7).** Add: *"The bundle is convenience, not boundary. Tools known to be missing as of v0.7: `chisel`, `gost`, `frpc`, raw `nc`/`ncat`, container-runtime escapes (`docker run --net=host` if the agent has docker access), and any custom binary the agent compiles or downloads. The boundary is §12.3 destination egress denial, which catches all of these regardless of binary identity."*

### R23. `CREATE` alias non-expansion

**Issue.** §5.4 already deliberately excludes `INSERT` from the `CREATE` alias and explains why. Worth strengthening so operators don't trip on it.

**Edit (§5.4 callout).** Promote the deliberate non-expansion to its own callout block immediately after the alias table: *"**Operator note.** `CREATE` does not expand to `write`. A rule allowing `CREATE` does not allow `INSERT`. To allow both, write `[CREATE, INSERT]` explicitly. This is deliberate: a sysadmin granting DDL should not implicitly grant DML. Sample policies show this idiom."*

---

## Items NOT in this redline

Pressure-test territory I considered and chose not to flag, with reasons:

- **§5/§7 taxonomy/mapping table.** Tabular content; the §20 corpus tests will pin behavior. Pressure-testing the table line-by-line is high effort, low yield.
- **§12.6 bypass tool detection** beyond what R22 addresses. The bundle is acknowledged as convenience.
- **§19 Open Questions.** Already tracked.
- **§20 Classifier corpus.** Process detail, not algorithm.
- **§23 Engineering Handoff.** Process detail.
- **`maybe_temp_shadowed` algorithm correctness.** Implementation detail; spec correctly marks it best-effort.
- **OCSF mapping fidelity.** Out of scope for spec pressure-test; verify at integration.

---

## Recommended adoption sequence

1. **Adopt Tier 1 (R1 - R5) verbatim.** No tradeoffs to weigh.
2. **Adopt Tier 4 R14 verbatim.** This is the highest-impact correctness fix in the redline; fixing it before §23.3 evaluator tests are written prevents tests-encoding-the-bug.
3. **Adopt R10 with engineering review.** The proxy-identity edit names a concrete mechanism; engineering should sign off that SessionID-keyed rules can carry the load before the prose lands.
4. **Adopt remaining items with light review.** Most are wording or one-paragraph additions.
5. **Cut a v0.8 with a §0 changelog entry listing every adopted item by R-number.**
