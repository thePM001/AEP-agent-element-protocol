# OWASP Agentic AI Top 10 -- AEP 2.2 Defence Mapping

This document maps every risk in the OWASP Agentic AI Top 10 to the specific AEP 2.2 defence mechanism that mitigates it.

## AG01: Prompt Injection

**Risk:** Adversarial inputs manipulate agent behaviour through crafted prompts.

**AEP Defence:**
- **Forbidden Patterns** -- regex-based blocklist scans every tool input for injection signatures.
- **Behavioural Covenants** -- agent-declared constraint DSL prevents the agent from executing actions outside its declared scope regardless of prompt content.
- **Evidence Ledger** -- every action is recorded with full input context for post-incident forensic review.

## AG02: Insecure Tool Use

**Risk:** Agent invokes tools with unvalidated or overly broad parameters.

**AEP Defence:**
- **Capability Scoping** -- each tool declaration includes `scope` with `paths`, `binaries`, `element_prefixes` and `z_bands` constraints.
- **Execution Rings** -- Ring 2 (default) blocks delete, network and sub-agent operations. Ring 3 is read-only.
- **Gates** -- high-risk tools require human or webhook approval before execution.

## AG03: Excessive Agency

**Risk:** Agent operates with more authority than the task requires.

**AEP Defence:**
- **Execution Rings** -- four-ring privilege model enforces least-privilege by default.
- **Trust-Gated Capabilities** -- `min_trust_tier` on capabilities restricts access to high-privilege operations.
- **Session Limits** -- `max_actions`, `max_runtime_ms` and `max_denials` prevent unbounded operation.
- **Escalation Rules** -- automatic pause or termination after configurable thresholds.

## AG04: Insecure Output Handling

**Risk:** Agent outputs are consumed without validation by downstream systems.

**AEP Defence:**
- **AEP Structural Validation** -- every UI mutation is validated against the scene graph, registry and theme before rendering.
- **Evidence Ledger** -- every output is recorded for audit.
- **Rollback** -- invalid outputs that reach the codebase can be reverted using pre-mutation snapshots.

## AG05: Insufficient Access Controls

**Risk:** Agent accesses resources beyond its authorised scope.

**AEP Defence:**
- **Execution Rings** -- capability flags per ring enforce structural access control.
- **Trust Tiers** -- five-tier trust system gates capabilities by earned trust level.
- **Ring Promotion Requirements** -- advancing to a higher ring requires meeting trust tier minimums and (for Ring 0) operator approval.
- **Agent Identity** -- `require_agent_identity` policy enforces cryptographic identity verification.

## AG06: Improper Error Handling

**Risk:** Error messages leak sensitive information or internal state to agents.

**AEP Defence:**
- **Verdict Reasons** -- policy evaluation returns structured reasons without exposing internal state.
- **Evidence Ledger** -- errors are recorded in the append-only ledger, not propagated in tool outputs.
- **Kill Switch** -- catastrophic error conditions trigger session termination with optional rollback.

## AG07: Lack of Monitoring

**Risk:** Agent actions are not observed, logged or auditable.

**AEP Defence:**
- **Evidence Ledger** -- SHA-256 hash-chained JSONL audit trail of every action.
- **Merkle Proofs** -- per-entry cryptographic verification for tamper detection.
- **RFC 3161 Timestamps** -- external timestamp authority tokens for non-repudiation.
- **Session Reports** -- structured reports with action counts, denial counts, elapsed time and escalation events.

## AG08: Insecure Multi-Agent Communication

**Risk:** Agents interact without mutual authentication or trust verification.

**AEP Defence:**
- **Cross-Agent Verification** -- `verifyCounterparty()` handshake with `ProofBundle` exchange.
- **Agent Identity** -- Ed25519/RSA identity with `AgentIdentityManager` for creation and verification.
- **Covenant Requirements** -- configurable trust tier and ring level requirements for counterparty acceptance.

## AG09: Denial of Service

**Risk:** Agent overwhelms resources through excessive requests or runaway loops.

**AEP Defence:**
- **Per-Session Rate Limits** -- `max_per_minute` actions per session.
- **System-wide Rate Limits** -- shared counter across all sessions with `max_actions_per_minute`.
- **Intent Drift Detection** -- detects repetition anomalies (agent stuck in a loop) and triggers warn, gate, deny or kill.
- **Session Limits** -- `max_actions` and `max_runtime_ms` enforce hard ceilings.
- **Kill Switch** -- `killAll()` terminates every active session instantly.

## AG10: Supply Chain Vulnerabilities

**Risk:** Compromised tools, plugins or dependencies introduce malicious behaviour.

**AEP Defence:**
- **Forbidden Patterns** -- blocks known-dangerous command patterns and credential exposure.
- **Execution Rings** -- Ring 3 sandbox prevents write, delete and network operations for untrusted agents.
- **Post-Quantum Signatures** -- ML-DSA-65 ledger signatures provide quantum-resistant tamper evidence.
- **Offline Signing** -- air-gapped environments can maintain evidence integrity without network access.

---

## Summary Matrix

| OWASP Risk | Primary AEP Defence | Secondary AEP Defence |
|------------|---------------------|----------------------|
| AG01 Prompt Injection | Forbidden Patterns, Covenants | Evidence Ledger |
| AG02 Insecure Tool Use | Capability Scoping, Rings | Gates |
| AG03 Excessive Agency | Rings, Trust Tiers | Escalation, Limits |
| AG04 Insecure Output | Structural Validation | Rollback, Ledger |
| AG05 Insufficient Access | Rings, Trust Tiers | Agent Identity |
| AG06 Improper Errors | Verdict Reasons | Kill Switch |
| AG07 Lack of Monitoring | Evidence Ledger, Merkle | Timestamps, Reports |
| AG08 Insecure Multi-Agent | Handshake, Identity | Covenant Requirements |
| AG09 Denial of Service | Rate Limits, Drift Detection | Kill Switch |
| AG10 Supply Chain | Forbidden Patterns, Rings | Quantum Signatures |
