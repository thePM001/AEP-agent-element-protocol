# @PAD: /root/dynAEP/sdk/python/dynaep/temporal/perception_engine.py
# ===========================================================================
# dynaep - Perception Validation Engine (Python)
# Validates agent-proposed temporal annotations against the perception
# registry and adaptive user profiles. Produces governed temporal envelopes
# that are perception-safe.
# Mirror of the TypeScript PerceptionEngine.
# ===========================================================================

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from dynaep.temporal.perception_registry import PerceptionRegistry, PerceptionViolation
from dynaep.temporal.perception_profile import (
    AdaptiveProfileManager,
    AdaptiveProfileConfig,
    AdaptivePerceptionProfile,
    UserTemporalInteraction,
)


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@dataclass
class GovernedEnvelope:
    original_annotations: dict[str, object]
    governed_annotations: dict[str, object]
    adaptive_annotations: dict[str, object]
    applied: str  # "original" | "governed" | "adaptive"
    violations: list[PerceptionViolation]
    profile_used: Optional[str]


@dataclass
class PerceptionEngineConfig:
    enable_adaptive_profiles: bool
    profile_learning_rate: float
    profile_erosion_half_life_ms: float
    min_interactions_for_profile: int
    hard_violation_action: str  # "reject" | "clamp"
    soft_violation_action: str  # "clamp" | "warn" | "log_only"
    governed_envelope_mode: str  # "overwrite" | "metadata_only"


# ---------------------------------------------------------------------------
# PerceptionEngine
# ---------------------------------------------------------------------------

class PerceptionEngine:
    """
    Orchestrates perception governance by combining the static registry
    validation with adaptive profile adjustments. Produces governed
    envelopes that are safe for human perception.
    """

    def __init__(
        self,
        registry: PerceptionRegistry,
        config: PerceptionEngineConfig,
    ) -> None:
        self._registry = registry
        self._config = config

        profile_config = AdaptiveProfileConfig(
            learning_rate=config.profile_learning_rate,
            erosion_half_life_ms=config.profile_erosion_half_life_ms,
            min_samples_for_adjustment=config.min_interactions_for_profile,
            max_offset_from_comfortable=0.3,
            forecast_enabled=False,
            persistence_enabled=False,
            persistence_path="",
        )

        self._profile_manager = AdaptiveProfileManager(
            registry=registry,
            config=profile_config,
        )

    def govern(
        self,
        modality: str,
        annotations: dict[str, object],
        user_id: Optional[str] = None,
    ) -> GovernedEnvelope:
        """
        Validate and govern temporal annotations for an output event.
        Applies static registry bounds, then adaptive profile adjustments.
        """
        original_annotations = dict(annotations)

        # Step 1: Validate against static registry
        static_result = self._registry.validate(modality, original_annotations)
        governed_annotations = dict(static_result.clamped)

        # Step 2: Apply soft violation handling
        if self._config.soft_violation_action == "log_only":
            for violation in static_result.violations:
                if violation.severity == "soft":
                    governed_annotations[violation.parameter] = original_annotations[violation.parameter]

        # Step 3: Apply adaptive profile if enabled and user_id is present
        adaptive_annotations = dict(governed_annotations)
        profile_used: Optional[str] = None

        if self._config.enable_adaptive_profiles and user_id is not None:
            profile = self._profile_manager.get_profile(user_id)
            if profile is not None and profile.interaction_count >= self._config.min_interactions_for_profile:
                adaptive_annotations = self._profile_manager.adjust(
                    user_id, modality, governed_annotations,
                )
                profile_used = user_id

        # Determine which annotation set was applied
        applied = "original"
        if len(static_result.violations) > 0:
            applied = "governed"
        if profile_used is not None:
            applied = "adaptive"

        return GovernedEnvelope(
            original_annotations=original_annotations,
            governed_annotations=governed_annotations,
            adaptive_annotations=adaptive_annotations,
            applied=applied,
            violations=static_result.violations,
            profile_used=profile_used,
        )

    def validate_static(
        self,
        modality: str,
        annotations: dict[str, object],
    ):
        """Validate annotations against the static registry only."""
        return self._registry.validate(modality, annotations)

    def get_profile(self, user_id: str) -> Optional[AdaptivePerceptionProfile]:
        """Get the adaptive perception profile for a user."""
        return self._profile_manager.get_profile(user_id)

    def ingest_interaction(self, interaction: UserTemporalInteraction) -> None:
        """Ingest a user interaction to update the adaptive profile."""
        self._profile_manager.ingest(interaction)

    def reset_profile(self, user_id: str) -> None:
        """Reset a user's adaptive profile."""
        self._profile_manager.reset(user_id)

    def list_profiles(self) -> list[str]:
        """Return the list of all user IDs with active profiles."""
        return self._profile_manager.list_profiles()

    def get_profile_manager(self) -> AdaptiveProfileManager:
        """Return the underlying profile manager for direct access."""
        return self._profile_manager
