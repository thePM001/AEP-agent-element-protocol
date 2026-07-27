# @PAD: /root/dynAEP/sdk/python/dynaep/rego/decision_cache.py
"""
OPT-002: Rego Decision Cache (Python)
LRU cache for Rego policy evaluation results keyed by structural signature.
"""

from __future__ import annotations

import json
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Optional


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@dataclass
class RegoResult:
    structural_deny: list[str] = field(default_factory=list)
    temporal_deny: list[str] = field(default_factory=list)
    perception_deny: list[str] = field(default_factory=list)
    temporal_warn: list[str] = field(default_factory=list)
    perception_warn: list[str] = field(default_factory=list)
    temporal_escalate: list[str] = field(default_factory=list)
    perception_escalate: list[str] = field(default_factory=list)


@dataclass
class CacheStats:
    hits: int = 0
    misses: int = 0
    evictions: int = 0
    size: int = 0
    max_size: int = 0


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
# Cache Key Computation
# ---------------------------------------------------------------------------

def compute_cache_key(input_data: dict[str, Any]) -> str:
    """
    Compute a deterministic cache key from structural signature fields.
    Captures ONLY properties that affect Rego evaluation outcomes.
    """
    event = input_data.get("event", {})
    target_id = event.get("target_id", "")
    mutation = event.get("mutation", {})

    # Element prefix (first 2 chars)
    element_prefix = target_id[:2] if len(target_id) >= 2 else ""

    # Operation type
    operation_type = "unknown"
    event_type = event.get("type")
    dynaep_type = event.get("dynaep_type", "")

    if event_type == "STATE_DELTA":
        operation_type = "state_delta"
    elif isinstance(dynaep_type, str) and dynaep_type:
        if dynaep_type == "AEP_MUTATE_STRUCTURE":
            operation_type = "move" if mutation.get("parent") or mutation.get("anchors") else "skin_change"
        elif dynaep_type == "AEP_MUTATE_BEHAVIOUR":
            operation_type = "behaviour_change"
        elif dynaep_type == "AEP_MUTATE_SKIN":
            operation_type = "skin_change"
        else:
            operation_type = dynaep_type

    # Z-band validity
    scene = input_data.get("scene", {})
    target_scene = scene.get(target_id, {})
    z_band_valid = True
    if isinstance(target_scene, dict):
        z = target_scene.get("z")
        if isinstance(z, (int, float)):
            band = Z_BANDS.get(element_prefix)
            if band:
                z_band_valid = band[0] <= z <= band[1]

    # Parent prefix
    parent_prefix = ""
    if isinstance(target_scene, dict):
        parent_id = target_scene.get("parent", "")
        if isinstance(parent_id, str) and len(parent_id) >= 2:
            parent_prefix = parent_id[:2]

    # Perception/temporal
    perception = input_data.get("perception")
    has_perception = perception is not None
    modality_type = perception.get("modality", "") if has_perception else ""
    has_temporal = input_data.get("temporal") is not None
    active_modality_count = 0
    if has_perception and isinstance(perception, dict):
        active_modality_count = perception.get("active_modalities", 0)

    fields = {
        "amc": active_modality_count,
        "hp": has_perception,
        "ht": has_temporal,
        "mt": modality_type,
        "op": operation_type,
        "p": element_prefix,
        "pp": parent_prefix,
        "zv": z_band_valid,
    }

    # Stable serialization (keys already sorted)
    return "|".join(f"{k}:{json.dumps(v)}" for k, v in sorted(fields.items()))


# ---------------------------------------------------------------------------
# LRU Cache
# ---------------------------------------------------------------------------

class RegoDecisionCache:
    """LRU decision cache for Rego evaluation results."""

    def __init__(self, max_size: int = 5000):
        self._max_size = max_size
        self._cache: OrderedDict[str, RegoResult] = OrderedDict()
        self._hits = 0
        self._misses = 0
        self._evictions = 0

    def lookup(self, input_data: dict[str, Any]) -> Optional[RegoResult]:
        """Look up cached result by structural signature. Returns None on miss."""
        key = compute_cache_key(input_data)
        if key in self._cache:
            self._hits += 1
            self._cache.move_to_end(key)  # Mark as most recently used
            return self._cache[key]
        self._misses += 1
        return None

    def store(self, input_data: dict[str, Any], result: RegoResult) -> None:
        """Cache result under structural signature key."""
        key = compute_cache_key(input_data)
        if key in self._cache:
            self._cache.move_to_end(key)
            self._cache[key] = result
            return

        if len(self._cache) >= self._max_size:
            self._cache.popitem(last=False)  # Evict LRU
            self._evictions += 1

        self._cache[key] = result

    def invalidate(self) -> None:
        """Clear the entire cache. Called on policy reload."""
        self._cache.clear()

    def stats(self) -> CacheStats:
        """Return cache statistics."""
        return CacheStats(
            hits=self._hits,
            misses=self._misses,
            evictions=self._evictions,
            size=len(self._cache),
            max_size=self._max_size,
        )
