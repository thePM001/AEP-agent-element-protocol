# AEP v2.5 Agent Harness

## Features (75)

### Protocols
- **Anti-Stub Verification (ASV)** -- 7 pattern detection, AST-based, pre-commit hook
- **Biosecurity Eligibility Check** -- /aepassist endpoint, biosecure yes/no gating

### Endpoints
- `GET /aepassist/status` -- check user biosecurity eligibility
- `POST /aepassist/verify` -- initiate biosecurity verification
- `GET /aepassist/reverify` -- check re-verification status

### Anti-Stub Patterns Detected
1. Trivial return stubs (do: :ok, do: nil)
2. Pass-through stubs (returns input unchanged)
3. Facade functions (big docs, no implementation)
4. Empty module stubs
5. Raise stubs (raise "not implemented")
6. Delegation to known stubs
7. Test stubs (assertions against stub returns)

### Compliance Requirements
- AST-based stub detection (not regex)
- Pre-commit hook blocking hard violations
- Agent self-audit before task completion
- Biosecurity gating on all AI capabilities
- Biosecure users: AI access permitted
- Non-biosecure users: AI access denied

### Reference Implementation
Radia AGI Platform (private)

---

## Temporal Authority (dynAEP-TA)

The harness enforces dynAEP-TA temporal governance. Agents never own the clock. The bridge is the sole authoritative time source for the entire protocol stack.

### Bridge Clock Authority
- Synchronizes to NTP (default), PTP (IEEE 1588 for microsecond precision) or system clock (fallback)
- Every event is stamped with bridge-authoritative time
- Agent timestamps are preserved in metadata for audit but never trusted for ordering or validation
- All `Date.now()` calls in governed code paths are intercepted and replaced with bridge clock queries

### Causal Ordering
- Lamport vector clocks track ordering across all registered agents
- Out-of-order events are buffered and reordered by the bridge
- Clock regressions are rejected with a -20 trust penalty
- Missing causal dependencies are flagged with a -10 trust penalty

### TimesFM Forecasting
- Optional 200 M-parameter time-series foundation model (Google Research)
- Predictive forecasting and anomaly detection on element coordinate streams
- Disabled by default (requires TimesFM installation)
- Anomaly action configurable per governance preset (require_approval / warn / log_only)

### Perception Governance (dynAEP-TA-P)
Five output modalities with quantitative human perception thresholds from psychoacoustics research:

| Modality | Key Parameters | Comfortable Range |
|---|---|---|
| Speech | syllable rate, turn gap, pause placement, pitch range | 3.0-5.5 syl/s, 200-800 ms gap |
| Haptic | tap duration, vibration frequency, pattern interval | 30-200 ms tap, 50-300 hz |
| Notification | burst limit, display duration, recovery interval | max 3/min, 3-8 s display |
| Sensor | polling interval, display refresh alignment, response latency | 100-2000 ms poll |
| Audio | tempo, beat alignment tolerance, fade timing | 60-180 bpm |

Hard bounds define absolute human perception limits. Comfortable bounds define the range safe for sustained interaction. The harness clamps violations to the nearest valid boundary.

### Adaptive Perception Profiles
- Per-user temporal preference learning via exponential moving average (EMA)
- Learns from interaction signals: response latency, interruptions, replay requests, speed adjustments
- Profiles shift within the comfortable range but NEVER exceed hard perception bounds
- Configurable learning rate and erosion half-life
- Profiles require a minimum number of interactions before activation (default: 10)

### dynaep_temporal_query Tool
The MCP tool for all temporal operations. Supported operations:

- `authoritative_time` -- get bridge-stamped current time
- `perception_bounds` -- get modality bounds before constructing annotations
- `staleness_check` -- check if a timestamp is stale relative to bridge time
- `comfortable_range` -- get comfortable min/max for a specific parameter
- `validate_annotations` -- validate proposed temporal annotations
- `govern_preview` -- preview governed envelope without committing
- `list_modalities` -- list all registered perception modalities
- `get_modality_bounds` -- get full bounds for a specific modality

### New /aepassist Commands

```
npx aep assist temporal status     # show bridge clock sync status, source, drift
npx aep assist temporal bounds     # list perception bounds for all modalities
npx aep assist temporal profile    # show adaptive perception profile for a user
npx aep assist temporal reset      # reset temporal state (causal ordering, profiles)
```

### Temporal Validation Pipeline
Temporal validation runs BEFORE structural validation in the harness pipeline:

```
1. Temporal validation (drift, staleness, future timestamp, causal ordering)
2. Perception validation (annotation bounds, modality checks, adaptive profiles)
3. Structural validation (scene graph, registry, z-bands, skin bindings)
```

Both temporal and perception validation are controlled by flags in dynaep-config.yaml:
- `temporal_authority.enabled` -- enable/disable temporal validation
- `temporal_authority.perception_governance.enabled` -- enable/disable perception validation

---

## Authority
thePM001 // Biosecure UNVACCINATED Supreme User
