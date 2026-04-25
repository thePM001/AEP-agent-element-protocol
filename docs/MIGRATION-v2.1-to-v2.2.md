# Migration Guide: AEP v2.1 to v2.2

## What Changed

### Version bump
- `version` in all policy YAML files updated from `"2.1"` to `"2.2"`.
- `package.json` version bumped to `2.2.0`.
- Agent harness renamed from `aep-2.1-agent-harness` to `aep-2.2-agent-harness`.

### New modules
- `src/trust/` -- Trust Scoring with time-based decay (TrustManager, types).
- `src/rings/` -- Execution Rings with four privilege levels (RingManager, types).
- `src/covenant/` -- Behavioural Covenants DSL (parser, evaluator, compiler, types).
- `src/identity/` -- Agent Identity with Ed25519/RSA support (AgentIdentityManager, types).
- `src/verification/` -- Cross-Agent Verification handshake (verifyCounterparty, generateProof, requirements).
- `src/intent/` -- Intent Drift Detection with warmup period (IntentDriftDetector).
- `src/session/kill-switch.ts` -- Kill Switch (killAll, killSession).
- `src/ledger/merkle.ts` -- Merkle Tree for per-entry verification.
- `src/ledger/quantum.ts` -- Post-Quantum Signatures (ML-DSA-65 simulation).
- `src/ledger/timestamp.ts` -- RFC 3161 Timestamp Queue.
- `src/ledger/offline.ts` -- Offline Ledger for air-gapped environments.

### New policy config sections (all optional)
- `trust` -- initial score, decay rate, penalty/reward weights.
- `ring` -- default ring, promotion requirements per ring level.
- `intent` -- tracking toggle, drift threshold, warmup actions, on_drift action.
- `identity` -- require_agent_identity toggle, trusted public keys.
- `quantum` -- enable post-quantum signatures.
- `timestamp` -- TSA URL, batch size, flush interval.
- `system` -- max_actions_per_minute, max_concurrent_sessions.

### New CLI commands
- `aep kill` -- activate kill switch (all sessions or by ID).
- `aep trust` -- display current trust score and tier.
- `aep ring` -- display current execution ring and capabilities.
- `aep drift` -- display intent drift score and factors.
- `aep identity create` -- generate a new agent identity key pair.
- `aep identity verify` -- verify an agent identity.
- `aep covenant parse` -- parse and display a covenant DSL string.
- `aep covenant verify` -- verify an action against a covenant.
- `aep owasp` -- display OWASP Agentic AI Top 10 mapping.
- `aep describe` -- display full AEP 2.2 capability summary.
- `aep report --format json|csv|html` -- export evidence ledger.

### New built-in policies
- `multi-agent.policy.yaml` -- designed for multi-agent orchestration with cross-agent verification and agent identity requirements.
- `covenant-only.policy.yaml` -- minimal policy that relies primarily on covenant enforcement.

### Updated schemas
- `CapabilitySchema` gains optional `min_trust_tier` field.
- `GateSchema` gains optional `webhook_url` and `timeout_ms` fields.
- `Verdict` type gains optional `trustDelta` field.
- `PolicyEvaluator` now runs a 12-step evaluation chain.

## What Stayed the Same

- Three-layer architecture (Structure, Behaviour, Skin).
- Z-band hierarchy and prefix convention.
- AOT and JIT validation logic.
- All existing Rego policies.
- Lattice Memory and Basic Resolver.
- All existing SDK files.
- Licence (Apache 2.0).
- All v2.1 policy files remain valid. New sections are optional with sensible defaults.

## Step-by-Step Migration

### 1. Update policy versions

In every `.policy.yaml` file:
```yaml
version: "2.2"
```

### 2. Install updated package

```bash
npm install @aep/core@2.2.0
```

### 3. (Optional) Add trust scoring

```yaml
trust:
  initial_score: 500
  decay_rate: 5
```

### 4. (Optional) Configure execution rings

```yaml
ring:
  default: 2
  promotion:
    to_ring_1:
      min_trust_tier: "trusted"
```

### 5. (Optional) Add behavioural covenant

```yaml
covenant: |
  covenant ProjectRules {
    permit file:read;
    permit file:write (path in ["src/", "tests/"]);
    forbid file:delete;
    require trustTier >= "standard";
  }
```

### 6. (Optional) Enable intent drift detection

```yaml
intent:
  tracking: true
  drift_threshold: 0.5
  warmup_actions: 10
  on_drift: "warn"
```

### 7. Update agent harness

Replace `aep-2.1-agent-harness` with `aep-2.2-agent-harness` in your project.

### 8. Run tests

```bash
npm test
```

All 216 tests should pass with zero regressions.

## Rollback

All new policy sections are optional with defaults matching v2.1 behaviour. To revert:

1. Change `version: "2.2"` back to `version: "2.1"` in policy files.
2. Remove any `trust`, `ring`, `covenant`, `intent`, `identity`, `quantum`, `timestamp` or `system` sections.
3. Downgrade the package: `npm install @aep/core@2.1.0`.
