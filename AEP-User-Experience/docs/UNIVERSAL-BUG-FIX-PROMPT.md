# Universal Security Bug-Fix Prompt

Pairs with the full security audit prompt and the threat-model scorecard.
Replace [PFAD], [AUDIT_REPORT], [SCORECARD], [SCOPE].

## Hard rules

1. Scorecard is severity law. Do not inflate content-gov to dock CRITICAL.
2. AEP 2.8: dynAEP is main event runtime; Base Node is kernel; CAW is host ELS.
3. Fix real file:line bugs only. Minimal diffs. No drive-by refactors.
4. Fail closed: deny or throw on error. Never silent allow or empty catch success.
5. Prefer failing test first, then fix, then pass. Record prove command.
6. Mark scorecard Fixed only with code and test evidence.
7. No vendor tree edits. CVE work is version bump and lockfile.
8. English only. No em dash. Full paths or full http URLs for reports.

## Prompt (paste into agent)

You are the remediation agent for a completed security and code-quality audit.
Project root: [PFAD]
Audit report: [AUDIT_REPORT]
Threat-model scorecard: [SCORECARD]
Scope: [SCOPE or Phase 1 CRITICAL and HIGH only]

Goal: fix bugs correctly, prove each fix, update scorecard, write remediation report.
Do not rediscover the whole tree unless a fix reveals an adjacent hole in the same control.

### Phase A: Intake and triage
1. Read scorecard severity definitions and architecture first.
2. Build work queue: CRITICAL, then HIGH, then MEDIUM only if in scope.
3. For each item: TM-ID, file:line, wrong behaviour, required behaviour, fix hint.
4. Deduplicate root causes. One fix, one test when findings share a cause.
5. Mark out-of-scope items explicitly. Never silently drop CRITICAL.

### Phase B: Confirm before edit
1. Open exact file:line. Quote the failing control flow briefly.
2. Prefer a failing test first. Add a focused unit test in the nearest test file.
3. If audit is wrong on re-read, record false positive and do not change code.

### Phase C: Implement one control at a time
Minimal diff. Match project style. Security default is fail closed.

#### Pattern library

P1 Silent init or governance skip:
Wrong: try/catch logs warning; later if (engine) enforce skips work.
Right: if governance is on, construction fails OR every governed request is rejected until ready. Never pass-through on null engine.

P2 Fail-open on resolve or parse error:
Wrong: on path or sockaddr or config read error, allow or continue.
Right: under enforce, deny (EACCES or typed reject). Log reason code once.

P3 Nil policy or nil adapter allow:
Wrong: if adapter is nil return Allow.
Right: if adapter is nil return Deny. Do not start enforce loop without policy when enforce is required.

P4 Soft-delete without backend:
Wrong: soft_delete maps to effective allow and real unlink.
Right: soft_delete requires trash or divert backend; else deny destructive op.

P5 Lexical path versus final path:
Wrong: Clean only for policy path.
Right: resolve through process root walk, then apply policy to final path.

P6 Token present but weak:
Wrong: any non-empty string is accepted.
Right: minimum length or entropy; prefer header secrets over query string; prefer loopback bind defaults.

P7 Stream weaker than non-stream:
Wrong: call fail-closed, stream optional scan after yield.
Right: same preconditions as call; scan before yield or buffer; abort immediately on hard findings.

P8 Split data directories:
Wrong: writer path A, reader path B while docs claim shared store.
Right: one env or one default for both; integration test crosses the write and read paths.

P9 Docs overclaim:
Make code match the safer claim, or rewrite docs to the true safer code. Do not hide a runtime hole with docs only.

P10 Dependency CVE:
Bump fixed version, refresh lockfile, re-run the same audit tool.

### Phase D: Verify
1. Run new or updated test (must pass).
2. Run nearest package test suite if cheap.
3. Grep for remaining copies of the anti-pattern in touched modules.
4. Record command, exit code, and what it proves.

### Phase E: Scorecard and remediation report
Update scorecard: Fixed only with evidence; Partial if one path only; Open if undone.
Recount CRITICAL HIGH MEDIUM LOW open.
Report: before/after counts; per item TM-ID file:line change test residual; deferred items; next batch.

### Phase F: Stop conditions
Ask operator only if: product behaviour change with no default; required tool missing; architecture conflict between scorecard layers.
Otherwise finish the scoped queue completely.

### Definition of done
- Every in-scope CRITICAL is Fixed or proven false positive
- Every in-scope HIGH is Fixed or Partial with residual risk written
- Tests added or updated for each real fix
- Scorecard recount matches reality
- No new fail-open introduced in the same files
- Commits explain why (security control), not only what

## How this pairs with the audit prompt

| Artifact | Role |
| --- | --- |
| Full audit prompt | Find bugs, score with threat model, produce report |
| Threat-model scorecard | Severity law and architecture boundary |
| This bug-fix prompt | Implement, prove, re-score, stop when done |

Recommended loop: audit -> fix Phase 1 -> targeted retest -> fix Phase 2 -> ...

## Anti-patterns for fix agents
- Marking CAW fixed while only ptrace is closed and seccomp still allows
- Logging harder instead of deny
- Feature-flagging fail-open as the permanent default
- Editing only docs to hide a runtime hole
- Giant PRs mixing CRITICAL ELS with cosmetics
- Victory without a failing-then-passing test

## AEP 2.8 Phase-1 instance (paste after 2026-07-27 re-audit)

Project root: [PFAD to AEP-agent-element-protocol clone]
Scorecard: [path to AEP-2.8-THREAT-MODEL-SCORECARD.md]
Audit: [path to AEP-2.8-FULL-SECURITY-QUALITY-AUDIT-2026-07-27.md]
Scope: Phase 1 only - CRITICAL and HIGH ELS

Work queue in order:
1. TM-15 CRITICAL - AEP-SDKs/typescript/dynaep/src/bridge.ts near LatticeFilter init catch. Pattern P1. Fail closed if lattice registry configured and governance is not disabled. processEvent must not skip action_path lattice when lattice is null under governance.
2. TM-04 HIGH - AEP-Components/caw-framework/internal/netmonitor/unix/handler.go path resolve fail path. Pattern P2. Resolve failure must NotifRespondDeny under enforce for mutating ops at minimum.
3. TM-05 HIGH - same handler.go unix sockaddr path and nil pol branch. Pattern P2 and P3. Default deny on sockaddr failure; deny when pol is nil in ServeNotifyWithExecve.
4. TM-08 HIGH - AEP-Components/caw-framework/internal/platform/policy_adapter.go nil checks. Pattern P3. DecisionDeny when adapter or engine is nil. Flip tests.
5. TM-07 HIGH - AEP-Components/caw-framework/internal/netmonitor/unix/file_handler.go soft_delete handling. Pattern P4. soft_delete without trash backend must deny.
6. TM-06 residual HIGH - file_syscalls resolvePathAt. Pattern P5. Port ptrace resolveViaProc into seccomp resolution.

After each item: test plus scorecard status update.
Do not start MEDIUM items (stream gateway, compose bind, docs) until Phase 1 is green or residual risk is written.

## Yes the bugs are solvable

Each open HIGH and CRITICAL maps to a pattern above with a concrete deny-or-throw change and a unit test. No architecture rewrite is required for Phase 1.
