# @PAD: /root/dynAEP/sdk/python/dynaep/temporal/perception_profile.py
# ===========================================================================
# dynaep - Adaptive Perception Profiles (Python)
# Learns per-user temporal preferences from interaction patterns.
# Mirror of the TypeScript AdaptiveProfileManager.
# ===========================================================================

from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field
from typing import Optional

from dynaep.temporal.perception_registry import PerceptionRegistry


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@dataclass
class UserTemporalInteraction:
    user_id: str
    modality: str
    timestamp: float
    interaction_type: str  # response | interruption | replay_request | skip | slow_down_request | speed_up_request | completion | abandonment
    context_parameters: dict[str, float]
    response_latency_ms: Optional[float] = None


@dataclass
class ParameterAdjustment:
    parameter: str
    learned_offset: float
    sample_count: int
    variance: float
    last_updated_at: float


@dataclass
class ModalityPreference:
    modality: str
    parameter_adjustments: dict[str, ParameterAdjustment]
    confidence_score: float
    last_interaction_at: float


@dataclass
class AdaptivePerceptionProfile:
    user_id: str
    created_at: float
    updated_at: float
    interaction_count: int
    modalities: dict[str, ModalityPreference]


@dataclass
class AdaptiveProfileConfig:
    learning_rate: float
    erosion_half_life_ms: float
    min_samples_for_adjustment: int
    max_offset_from_comfortable: float
    forecast_enabled: bool
    persistence_enabled: bool
    persistence_path: str


# ---------------------------------------------------------------------------
# Signal Interpretation
# ---------------------------------------------------------------------------

@dataclass
class SignalResult:
    direction: int   # -1 = slow down, +1 = speed up, 0 = neutral
    magnitude: float  # 0.0 to 1.0


def _interpret_signal(interaction_type: str, response_latency_ms: Optional[float]) -> SignalResult:
    if interaction_type == "response":
        if response_latency_ms is None:
            return SignalResult(direction=0, magnitude=0.0)
        if response_latency_ms > 3000:
            return SignalResult(direction=-1, magnitude=0.6)
        if response_latency_ms > 1500:
            return SignalResult(direction=-1, magnitude=0.3)
        return SignalResult(direction=0, magnitude=0.0)
    elif interaction_type == "interruption":
        return SignalResult(direction=1, magnitude=0.5)
    elif interaction_type == "replay_request":
        return SignalResult(direction=-1, magnitude=0.7)
    elif interaction_type == "skip":
        return SignalResult(direction=1, magnitude=0.4)
    elif interaction_type == "slow_down_request":
        return SignalResult(direction=-1, magnitude=0.9)
    elif interaction_type == "speed_up_request":
        return SignalResult(direction=1, magnitude=0.9)
    elif interaction_type == "completion":
        return SignalResult(direction=0, magnitude=0.1)
    elif interaction_type == "abandonment":
        return SignalResult(direction=1, magnitude=0.6)
    else:
        return SignalResult(direction=0, magnitude=0.0)


# ---------------------------------------------------------------------------
# AdaptiveProfileManager
# ---------------------------------------------------------------------------

class AdaptiveProfileManager:
    """
    Manages per-user adaptive perception profiles that learn temporal
    preferences from interaction patterns. Profiles adjust annotation
    values within the comfortable range but NEVER exceed hard bounds.
    """

    def __init__(
        self,
        registry: PerceptionRegistry,
        config: AdaptiveProfileConfig,
    ) -> None:
        self._registry = registry
        self._config = config
        self._profiles: dict[str, AdaptivePerceptionProfile] = {}

    def ingest(self, interaction: UserTemporalInteraction) -> None:
        """Ingest a user interaction and update the corresponding profile."""
        user_id = interaction.user_id
        profile = self._profiles.get(user_id)

        if profile is None:
            profile = AdaptivePerceptionProfile(
                user_id=user_id,
                created_at=interaction.timestamp,
                updated_at=interaction.timestamp,
                interaction_count=0,
                modalities={},
            )
            self._profiles[user_id] = profile

        profile.interaction_count += 1
        profile.updated_at = interaction.timestamp

        pref = profile.modalities.get(interaction.modality)
        if pref is None:
            pref = ModalityPreference(
                modality=interaction.modality,
                parameter_adjustments={},
                confidence_score=0.0,
                last_interaction_at=interaction.timestamp,
            )
            profile.modalities[interaction.modality] = pref

        pref.last_interaction_at = interaction.timestamp

        signal = _interpret_signal(interaction.interaction_type, interaction.response_latency_ms)
        if signal.direction == 0 and signal.magnitude < 0.05:
            self._reinforce_neutral(pref, interaction.timestamp)
            self._update_confidence(pref)
            return

        modality_profile = self._registry.get_modality(interaction.modality)
        if modality_profile is None:
            return

        for param_name, bound in modality_profile.bounds.items():
            comfortable_width = bound.comfortable_max - bound.comfortable_min
            if comfortable_width <= 0:
                continue

            max_offset = comfortable_width * self._config.max_offset_from_comfortable
            signal_offset = signal.direction * signal.magnitude * max_offset

            adj = pref.parameter_adjustments.get(param_name)
            if adj is None:
                adj = ParameterAdjustment(
                    parameter=param_name,
                    learned_offset=0.0,
                    sample_count=0,
                    variance=0.0,
                    last_updated_at=interaction.timestamp,
                )
                pref.parameter_adjustments[param_name] = adj

            alpha = self._config.learning_rate
            old_offset = adj.learned_offset
            new_offset = alpha * signal_offset + (1 - alpha) * old_offset

            clamped_offset = max(-max_offset, min(max_offset, new_offset))

            delta = signal_offset - old_offset
            adj.variance = (1 - alpha) * adj.variance + alpha * delta * delta

            adj.learned_offset = clamped_offset
            adj.sample_count += 1
            adj.last_updated_at = interaction.timestamp

        self._update_confidence(pref)

    def _reinforce_neutral(self, pref: ModalityPreference, timestamp: float) -> None:
        """Decay existing offsets slightly toward zero on neutral signal."""
        decay_factor = 0.98
        for adj in pref.parameter_adjustments.values():
            adj.learned_offset *= decay_factor
            adj.sample_count += 1
            adj.last_updated_at = timestamp

    def _update_confidence(self, pref: ModalityPreference) -> None:
        """Recompute confidence score from sample counts."""
        total_samples = 0
        param_count = 0
        for adj in pref.parameter_adjustments.values():
            total_samples += adj.sample_count
            param_count += 1
        if param_count == 0:
            pref.confidence_score = 0.0
            return
        avg_samples = total_samples / param_count
        confidence = min(1.0, math.log2(avg_samples + 1) / 5.0)
        pref.confidence_score = confidence

    def get_profile(self, user_id: str) -> Optional[AdaptivePerceptionProfile]:
        """Return the adaptive profile for a user, or None."""
        return self._profiles.get(user_id)

    def adjust(
        self,
        user_id: str,
        modality: str,
        annotations: dict[str, object],
    ) -> dict[str, object]:
        """
        Apply the adaptive profile to annotations, returning adjusted
        values. Only adjusts if the profile has sufficient history.
        """
        profile = self._profiles.get(user_id)
        if profile is None:
            return dict(annotations)

        pref = profile.modalities.get(modality)
        if pref is None:
            return dict(annotations)

        modality_profile = self._registry.get_modality(modality)
        if modality_profile is None:
            return dict(annotations)

        adjusted = dict(annotations)

        for param_name, value in annotations.items():
            if not isinstance(value, (int, float)):
                continue

            adj = pref.parameter_adjustments.get(param_name)
            if adj is None or adj.sample_count < self._config.min_samples_for_adjustment:
                continue

            bound = modality_profile.bounds.get(param_name)
            if bound is None:
                continue

            adjusted_value = float(value) + adj.learned_offset
            clamped = max(bound.comfortable_min, min(bound.comfortable_max, adjusted_value))
            adjusted[param_name] = clamped

        return adjusted

    def erode_profiles(self) -> None:
        """Erode stale profile data based on the configured half-life."""
        now = time.time() * 1000
        half_life = self._config.erosion_half_life_ms

        for profile in self._profiles.values():
            for pref in profile.modalities.values():
                for adj in pref.parameter_adjustments.values():
                    elapsed = now - adj.last_updated_at
                    if elapsed <= 0:
                        continue
                    decay_factor = 0.5 ** (elapsed / half_life)
                    adj.learned_offset *= decay_factor

    def reset(self, user_id: str) -> None:
        """Reset a specific user's profile."""
        self._profiles.pop(user_id, None)

    def prune(self, retention_ms: float) -> int:
        """Prune profiles with no interactions within the retention window."""
        now = time.time() * 1000
        keys_to_delete = [
            uid for uid, profile in self._profiles.items()
            if (now - profile.updated_at) > retention_ms
        ]
        for key in keys_to_delete:
            del self._profiles[key]
        return len(keys_to_delete)

    def list_profiles(self) -> list[str]:
        """Return the list of all user IDs with active profiles."""
        return list(self._profiles.keys())

    def serialize(self) -> str:
        """Serialize all profiles to a JSON string."""
        data = {}
        for user_id, profile in self._profiles.items():
            modalities = {}
            for mod_name, pref in profile.modalities.items():
                adjustments = {}
                for pn, adj in pref.parameter_adjustments.items():
                    adjustments[pn] = {
                        "parameter": adj.parameter,
                        "learned_offset": adj.learned_offset,
                        "sample_count": adj.sample_count,
                        "variance": adj.variance,
                        "last_updated_at": adj.last_updated_at,
                    }
                modalities[mod_name] = {
                    "modality": pref.modality,
                    "parameter_adjustments": adjustments,
                    "confidence_score": pref.confidence_score,
                    "last_interaction_at": pref.last_interaction_at,
                }
            data[user_id] = {
                "user_id": profile.user_id,
                "created_at": profile.created_at,
                "updated_at": profile.updated_at,
                "interaction_count": profile.interaction_count,
                "modalities": modalities,
            }
        return json.dumps(data)

    def deserialize(self, data_str: str) -> None:
        """Load profiles from a previously serialized JSON string."""
        parsed = json.loads(data_str)
        self._profiles.clear()
        for user_id, pdata in parsed.items():
            modalities = {}
            for mod_name, mdata in pdata.get("modalities", {}).items():
                adjustments = {}
                for pn, adata in mdata.get("parameter_adjustments", {}).items():
                    adjustments[pn] = ParameterAdjustment(
                        parameter=adata["parameter"],
                        learned_offset=adata["learned_offset"],
                        sample_count=adata["sample_count"],
                        variance=adata["variance"],
                        last_updated_at=adata["last_updated_at"],
                    )
                modalities[mod_name] = ModalityPreference(
                    modality=mdata["modality"],
                    parameter_adjustments=adjustments,
                    confidence_score=mdata["confidence_score"],
                    last_interaction_at=mdata["last_interaction_at"],
                )
            self._profiles[user_id] = AdaptivePerceptionProfile(
                user_id=pdata["user_id"],
                created_at=pdata["created_at"],
                updated_at=pdata["updated_at"],
                interaction_count=pdata["interaction_count"],
                modalities=modalities,
            )
