# AEP 2.5 Agent Harness -- dynAEP-TA Temporal Authority Update

## What Changed

The AEP 2.5 agent harness now recognizes dynAEP-TA (Temporal Authority) and dynAEP-TA-P (Perceptual Temporal Governance) as protocol stack layers. When dynAEP-TA is available, the harness enforces that all temporal operations go through the bridge clock rather than local time sources.

## New /aepassist Commands

```
npx aep assist temporal status     # show bridge clock sync status, source, drift
npx aep assist temporal bounds     # list perception bounds for all modalities
npx aep assist temporal profile    # show adaptive perception profile for a user
npx aep assist temporal reset      # reset temporal state (causal ordering, profiles)
```

## Harness Behaviour Changes

### 1. Temporal Authority Enforcement

When `temporal_authority.stack_wide` is true in dynaep-config.yaml, the harness:

- Intercepts any call to Date.now(), performance.now() or equivalent in governed code paths and replaces it with a call to `dynaep_temporal_query(authoritative_time)`.
- Warns the agent if it emits events without temporal annotations when the output modality requires them.
- Validates that all timestamps in evidence ledger entries come from the bridge clock.

### 2. Perception Governance in Scanner Pipeline

The temporal content scanner (evaluation chain Step 15) now queries dynAEP-TA for authoritative time when checking content staleness, instead of computing time from its own clock. This ensures that staleness checks across the entire evaluation chain use a single, consistent time source.

New scanner interaction:
- Step 15 calls `dynaep_temporal_query(staleness_check, target_id, max_age_ms)` instead of comparing against `Date.now()`.
- If dynAEP-TA is unavailable, falls back to local clock with a warning.

### 3. Trust Score Integration

Temporal violations produce trust penalties through the existing trust scoring system:

| Violation | Penalty |
|---|---|
| drift_exceeded | -10 trust |
| future_timestamp | -15 trust |
| stale_event | -5 trust |
| causal_violation (regression) | -20 trust |
| causal_violation (missing dependency) | -10 trust |
| perception hard violation | -15 trust |
| perception soft violation | -5 trust |
| cross-modality ceiling exceeded | -20 trust |

Successful temporal validations produce +1 trust reward per event (same as existing successful action rewards).

### 4. Evidence Ledger Integration

Every temporal event produces an evidence ledger entry:

```json
{
  "sequence": 1042,
  "timestamp": "2026-04-30T12:00:00.000Z",
  "hash": "sha256:...",
  "previousHash": "sha256:...",
  "type": "temporal_validation",
  "data": {
    "eventId": "evt-00042",
    "agentId": "agent-alpha",
    "bridgeTimeMs": 1714300800000,
    "agentTimeMs": 1714300799950,
    "driftMs": 50,
    "causalPosition": 42,
    "validationResult": "accepted"
  }
}
```

Perception governance events also produce ledger entries:

```json
{
  "sequence": 1043,
  "timestamp": "2026-04-30T12:00:00.050Z",
  "hash": "sha256:...",
  "previousHash": "sha256:...",
  "type": "perception_governance",
  "data": {
    "modality": "speech",
    "originalSyllableRate": 7.5,
    "governedSyllableRate": 5.5,
    "adaptiveSyllableRate": 4.8,
    "profileUsed": "user-12345",
    "violations": ["syllableRate:soft", "turnGapMs:hard"]
  }
}
```

### 5. OTEL Integration

New OpenTelemetry spans emitted by the harness:

- `dynaep.temporal.clock_sync` -- clock synchronization events
- `dynaep.temporal.validation` -- per-event temporal validation
- `dynaep.temporal.causal_ordering` -- causal ordering decisions
- `dynaep.temporal.forecast` -- TimesFM forecast computations
- `dynaep.perception.governance` -- perception validation and clamping
- `dynaep.perception.profile_update` -- adaptive profile learning

### 6. Governance Preset Updates

The four governance presets now include temporal authority settings:

**strict**: NTP sync with 25 ms drift threshold, PTP preferred if available, anomaly action require_approval, perception hard violations reject, adaptive profiles enabled with 10% offset limit.

**standard**: NTP sync with 50 ms drift threshold, anomaly action warn, perception hard violations clamp, adaptive profiles enabled with 30% offset limit.

**relaxed**: System clock, 500 ms drift threshold, anomaly action log_only, perception hard violations clamp, adaptive profiles disabled.

**audit**: NTP sync with 50 ms drift threshold, all temporal events logged to evidence ledger, full OTEL export for temporal and perception spans, perception hard violations logged without enforcement.

### 7. Covenant Extension

New covenant keywords for temporal governance:

```
permit temporal.override_perception_bounds    # allow agent to request perception override
forbid temporal.skip_causal_ordering          # never allow bypassing causal checks
require temporal.bridge_clock_only            # mandatory bridge clock usage
permit temporal.adaptive_profile_reset        # allow agent to reset user profiles
forbid temporal.exceed_modality_ceiling       # never allow more than N simultaneous modalities
```

## Configuration

Add to your AEP 2.5 policy file:

```yaml
version: "2.5"

temporal_authority:
  enabled: true
  trust_penalties:
    drift_exceeded: -10
    future_timestamp: -15
    stale_event: -5
    causal_regression: -20
    causal_missing_dep: -10
    perception_hard: -15
    perception_soft: -5
    modality_ceiling: -20
  evidence_ledger:
    log_temporal_events: true
    log_perception_events: true
  otel:
    export_temporal_spans: true
    export_perception_spans: true
```

## Migration from v2.5 without Temporal Authority

Adding temporal authority is non-breaking. All temporal features default to enabled where safe and disabled where they require external dependencies:

- Bridge clock: enabled (falls back to system clock if NTP unreachable)
- Causal ordering: enabled
- TimesFM forecasting: disabled by default (requires TimesFM installation)
- Perception governance: enabled (static registry bounds always available)
- Adaptive profiles: enabled (learning starts after 10 interactions)
- Evidence ledger integration: enabled
- OTEL export: follows existing OTEL configuration

No existing config files, policies, sessions, ledgers or SDK modules require modification.
