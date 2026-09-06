# @PAD: /root/dynAEP/sdk/python/dynaep/rego/unified_evaluator.py
"""
OPT-002: Unified Rego Evaluator (Python)
Uses OPA CLI or precompiled decision tables. No WASM in Python.
"""

from __future__ import annotations

import json
import logging
import subprocess
from dataclasses import dataclass, field
from typing import Any, Optional

from dynaep.rego.decision_cache import RegoDecisionCache, RegoResult, CacheStats

logger = logging.getLogger("dynaep.rego")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass
class RegoConfig:
    policy_path: str = "./aep-policy.rego"
    evaluation: str = "precompiled"  # cli | precompiled
    bundle_mode: str = "unified"
    decision_cache_size: int = 5000
    cache_invalidate_on_reload: bool = True  # safety invariant, always True
    separate_policy_paths: Optional[dict[str, str]] = None

    def __post_init__(self):
        # Enforce safety invariant
        self.cache_invalidate_on_reload = True


# ---------------------------------------------------------------------------
# Z-Band Constants
# ---------------------------------------------------------------------------

Z_BANDS: dict[str, tuple[int, int]] = {
    "SH": (0, 9), "PN": (10, 19), "NV": (10, 19), "CP": (20, 29),
    "FM": (20, 29), "IC": (20, 29), "CZ": (30, 39), "CN": (30, 39),
    "TB": (40, 49), "WD": (50, 59), "OV": (60, 69), "MD": (70, 79),
    "DD": (70, 79), "TT": (80, 89),
}


# ---------------------------------------------------------------------------
# Precompiled Evaluation
# ---------------------------------------------------------------------------

def _evaluate_precompiled_structural(input_data: dict[str, Any]) -> list[str]:
    deny: list[str] = []
    scene = input_data.get("scene", {})
    registry = input_data.get("registry", {})
    theme = input_data.get("theme", {})
    component_styles = theme.get("component_styles", {})

    ids = [k for k in scene if k != "aep_version"]

    # Modal above grid
    for m in ids:
        if not m.startswith("MD"):
            continue
        for g in ids:
            if not g.startswith("CZ"):
                continue
            mz = scene.get(m, {}).get("z")
            gz = scene.get(g, {}).get("z")
            if mz is not None and gz is not None and mz <= gz:
                deny.append(f"Modal {m} (z={mz}) must render above grid {g} (z={gz})")

    # Tooltip above modal
    for tt in ids:
        if not tt.startswith("TT"):
            continue
        for md in ids:
            if not md.startswith("MD"):
                continue
            ttz = scene.get(tt, {}).get("z")
            mdz = scene.get(md, {}).get("z")
            if ttz is not None and mdz is not None and ttz <= mdz:
                deny.append(f"Tooltip {tt} (z={ttz}) must render above modal {md} (z={mdz})")

    # Orphan
    for eid in ids:
        el = scene.get(eid, {})
        parent = el.get("parent")
        if parent is not None and parent not in scene:
            deny.append(f"Orphan element: {eid} references non-existent parent {parent}")

    # Registry entry
    for eid in ids:
        if eid not in registry:
            prefix = eid[:2]
            is_template = any(
                r.get("instance_prefix") == prefix
                for r in registry.values()
                if isinstance(r, dict)
            )
            if not is_template:
                deny.append(f"Unregistered element: {eid} exists in scene but has no registry entry")

    # Skin binding
    for eid, entry in registry.items():
        if not isinstance(entry, dict):
            continue
        sb = entry.get("skin_binding")
        if sb and sb not in component_styles:
            deny.append(f"Unresolved skin_binding: {eid} references '{sb}' which does not exist in theme component_styles")

    # Z-band
    for eid in ids:
        el = scene.get(eid, {})
        z = el.get("z")
        if z is None:
            continue
        prefix = eid[:2]
        band = Z_BANDS.get(prefix)
        if not band:
            continue
        if z < band[0]:
            deny.append(f"z-band violation: {eid} has z={z}, below minimum {band[0]} for prefix {prefix}")
        if z > band[1]:
            deny.append(f"z-band violation: {eid} has z={z}, above maximum {band[1]} for prefix {prefix}")

    # Children existence
    for eid in ids:
        children = scene.get(eid, {}).get("children", [])
        if not isinstance(children, list):
            continue
        for child in children:
            if child not in scene:
                deny.append(f"Missing child: {eid} declares child {child} which does not exist in scene")

    # Version checks
    if not scene.get("aep_version"):
        deny.append("Missing aep_version in scene config")
    if not registry.get("aep_version"):
        deny.append("Missing aep_version in registry config")
    if not theme.get("aep_version"):
        deny.append("Missing aep_version in theme config")

    sv = scene.get("aep_version")
    rv = registry.get("aep_version")
    tv = theme.get("aep_version")
    if sv and rv and sv != rv:
        deny.append(f"Version mismatch: scene is {sv} but registry is {rv}")
    if sv and tv and sv != tv:
        deny.append(f"Version mismatch: scene is {sv} but theme is {tv}")

    return deny


def _evaluate_precompiled_temporal(input_data: dict[str, Any]) -> tuple[list[str], list[str], list[str]]:
    deny: list[str] = []
    warn: list[str] = []
    escalate: list[str] = []

    temporal = input_data.get("temporal", {})
    causal = input_data.get("causal", {})
    forecast = input_data.get("forecast", {})
    config = input_data.get("config", {})
    timekeeping = config.get("timekeeping", {})
    forecast_cfg = config.get("forecast", {})
    event = input_data.get("event", {})

    drift_ms = temporal.get("drift_ms", 0)
    max_drift = timekeeping.get("max_drift_ms", 50)
    agent_time = temporal.get("agent_time_ms", 0)
    bridge_time = temporal.get("bridge_time_ms", 0)
    max_future = timekeeping.get("max_future_ms", 500)
    max_staleness = timekeeping.get("max_staleness_ms", 5000)

    if drift_ms > max_drift:
        deny.append(f"Temporal drift exceeded: agent drift {drift_ms} ms exceeds threshold {max_drift} ms for event targeting {event.get('target_id', 'unknown')}")
    if agent_time > bridge_time + max_future:
        deny.append(f"Future timestamp detected: agent time {agent_time} exceeds bridge time {bridge_time} + tolerance {max_future} ms")
    if bridge_time - agent_time > max_staleness:
        deny.append(f"Stale event: agent time {agent_time} is {bridge_time - agent_time} ms behind bridge time {bridge_time}")

    if causal.get("violation_type") == "agent_clock_regression":
        deny.append(f"Causal regression: agent {causal.get('agent_id')} sent sequence {causal.get('received_sequence')} but expected {causal.get('expected_sequence')}")
    if causal.get("violation_type") == "duplicate_sequence":
        deny.append(f"Duplicate sequence: agent {causal.get('agent_id')} sent duplicate sequence {causal.get('received_sequence')} for event {causal.get('event_id')}")

    if drift_ms > max_drift / 2 and drift_ms <= max_drift:
        warn.append(f"High drift warning: agent drift {drift_ms} ms approaching threshold {max_drift} ms")

    fill_ratio = causal.get("buffer_fill_ratio", 0)
    if fill_ratio > 0.8:
        warn.append(f"Reorder buffer at {fill_ratio * 100}% capacity ({causal.get('buffer_size', 0)}/{causal.get('buffer_max_size', 0)} events)")

    anomaly_score = forecast.get("anomaly_score", 0)
    anomaly_threshold = forecast_cfg.get("anomaly_threshold", 3.0)
    anomaly_action = forecast_cfg.get("anomaly_action", "warn")
    if anomaly_score > anomaly_threshold and anomaly_action == "require_approval":
        escalate.append(f"Temporal anomaly on {event.get('target_id', 'unknown')}: score {anomaly_score} exceeds threshold {anomaly_threshold}, approval required")

    return deny, warn, escalate


def _evaluate_precompiled_perception(input_data: dict[str, Any]) -> tuple[list[str], list[str], list[str]]:
    deny: list[str] = []
    warn: list[str] = []
    escalate: list[str] = []

    perception = input_data.get("perception", {})
    modality = perception.get("modality", "")
    ann = perception.get("annotations", {})

    if modality == "speech":
        sr = ann.get("syllable_rate", 0)
        if sr > 8.0:
            deny.append(f"Speech syllable rate {sr} exceeds hard limit 8.0 per second")
        tg = ann.get("turn_gap_ms")
        if tg is not None and tg < 150:
            deny.append(f"Speech turn gap {tg} ms below 150 ms interruption threshold")
        pr = ann.get("pitch_range")
        if pr is not None and pr < 0.5:
            deny.append(f"Speech pitch range {pr} below monotone threshold 0.5")
        if sr > 5.5 and sr <= 8.0:
            warn.append(f"Speech syllable rate {sr} exceeds comfortable maximum 5.5 per second")
        eds = ann.get("emphasis_duration_stretch")
        if eds is not None and eds > 1.5 and eds <= 2.0:
            warn.append(f"Speech emphasis stretch {eds} perceived as exaggerated (above 1.5)")

    if modality == "haptic":
        td = ann.get("tap_duration_ms")
        if td is not None and td < 10:
            deny.append(f"Haptic tap duration {td} ms below perceptual threshold 10 ms")
        vf = ann.get("vibration_frequency_hz")
        if vf is not None and vf > 500:
            deny.append(f"Haptic vibration frequency {vf} hz exceeds mechanoreceptor ceiling 500 hz")
        ti = ann.get("tap_interval_ms")
        if ti is not None and ti < 100 and ti >= 50:
            warn.append(f"Haptic tap interval {ti} ms perceived as continuous vibration (below 100 ms)")

    if modality == "notification":
        mi = ann.get("min_interval_ms")
        if mi is not None and mi < 1000:
            deny.append(f"Notification interval {mi} ms constitutes spam (below 1000 ms)")
        bmc = ann.get("burst_max_count")
        if bmc is not None and bmc > 10:
            deny.append(f"Notification burst count {bmc} exceeds denial-of-attention limit 10")
        if bmc is not None and bmc > 3 and bmc <= 10:
            warn.append(f"Notification burst count {bmc} may trigger attention fatigue (above 3)")

    if modality == "sensor":
        hmi = ann.get("health_monitoring_interval_ms")
        if hmi is not None and hmi > 300000:
            deny.append(f"Health monitoring interval {hmi} ms exceeds 300000 ms acute event risk threshold")

    if modality == "audio":
        tempo = ann.get("tempo_bpm")
        if tempo is not None and tempo > 300:
            deny.append(f"Audio tempo {tempo} BPM exceeds noise threshold 300")
        if tempo is not None and tempo < 20:
            deny.append(f"Audio tempo {tempo} BPM below isolation threshold 20")

    if perception.get("applied") == "adaptive":
        conf = perception.get("profile_confidence", 1.0)
        if conf < 0.3:
            escalate.append(f"Adaptive profile for user {perception.get('user_id', 'unknown')} has low confidence {conf}, approval recommended")

    vc = perception.get("violation_count", 0)
    if vc > 3:
        escalate.append(f"Output event has {vc} perception violations, manual review recommended")

    return deny, warn, escalate


# ---------------------------------------------------------------------------
# Unified Evaluator
# ---------------------------------------------------------------------------

class UnifiedRegoEvaluator:
    """
    Unified Rego evaluator for Python. Uses OPA CLI or precompiled
    decision tables (no WASM in Python).
    """

    def __init__(self, config: Optional[RegoConfig] = None):
        self.config = config or RegoConfig()
        self._cache: Optional[RegoDecisionCache] = None
        if self.config.decision_cache_size > 0:
            self._cache = RegoDecisionCache(self.config.decision_cache_size)
        self._backend = self.config.evaluation

    def evaluate(self, input_data: dict[str, Any]) -> RegoResult:
        """Evaluate all three policy packages. Checks cache first."""
        if self._cache:
            cached = self._cache.lookup(input_data)
            if cached is not None:
                return cached

        if self._backend == "cli":
            result = self._evaluate_cli(input_data)
        else:
            result = self._evaluate_precompiled(input_data)

        if self._cache:
            self._cache.store(input_data, result)

        return result

    def reload(self, policy_paths: Optional[list[str]] = None) -> None:
        """Reload policies. Invalidates cache."""
        if self._cache:
            self._cache.invalidate()

    def cache_stats(self) -> CacheStats:
        if self._cache:
            return self._cache.stats()
        return CacheStats()

    # -----------------------------------------------------------------------
    # Backends
    # -----------------------------------------------------------------------

    def _evaluate_precompiled(self, input_data: dict[str, Any]) -> RegoResult:
        structural = _evaluate_precompiled_structural(input_data)
        t_deny, t_warn, t_escalate = _evaluate_precompiled_temporal(input_data)
        p_deny, p_warn, p_escalate = _evaluate_precompiled_perception(input_data)

        return RegoResult(
            structural_deny=structural,
            temporal_deny=t_deny,
            perception_deny=p_deny,
            temporal_warn=t_warn,
            perception_warn=p_warn,
            temporal_escalate=t_escalate,
            perception_escalate=p_escalate,
        )

    def _evaluate_cli(self, input_data: dict[str, Any]) -> RegoResult:
        try:
            input_json = json.dumps(input_data)
            paths = self.config.separate_policy_paths or {
                "structural": self.config.policy_path,
                "temporal": "policies/temporal-policy.rego",
                "perception": "policies/perception-policy.rego",
            }

            structural = self._run_opa(input_json, paths["structural"], "data.aep.forbidden.deny")
            temporal = self._run_opa(input_json, paths["temporal"], "data.dynaep.temporal.deny_temporal")
            perception = self._run_opa(input_json, paths["perception"], "data.dynaep.perception.deny_perception")

            return RegoResult(
                structural_deny=structural,
                temporal_deny=temporal,
                perception_deny=perception,
            )
        except Exception:
            logger.warning("OPA CLI evaluation failed, falling back to precompiled")
            return self._evaluate_precompiled(input_data)

    def _run_opa(self, input_json: str, policy_path: str, query: str) -> list[str]:
        result = subprocess.run(
            ["opa", "eval", "-I", "-d", policy_path, query],
            input=input_json,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0:
            return []
        parsed = json.loads(result.stdout)
        return self._extract_results(parsed)

    @staticmethod
    def _extract_results(parsed: dict[str, Any]) -> list[str]:
        try:
            results = parsed.get("result", [])
            if not results:
                return []
            exprs = results[0].get("expressions", [])
            if not exprs:
                return []
            value = exprs[0].get("value", [])
            return value if isinstance(value, list) else []
        except (IndexError, KeyError, TypeError):
            return []
