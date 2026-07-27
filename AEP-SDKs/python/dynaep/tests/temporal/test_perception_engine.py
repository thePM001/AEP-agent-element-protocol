# @PAD: /root/dynAEP/sdk/python/tests/temporal/test_perception_engine.py
"""Tests for PerceptionEngine - dynAEP perceptual temporal governance."""

import unittest
from dynaep.temporal.perception_registry import PerceptionRegistry
from dynaep.temporal.perception_engine import (
    PerceptionEngine,
    PerceptionEngineConfig,
    GovernedEnvelope,
)
from dynaep.temporal.perception_profile import UserTemporalInteraction


class TestPerceptionEngine(unittest.TestCase):

    def _make_engine(self, **overrides):
        registry = PerceptionRegistry()
        config = PerceptionEngineConfig(
            enable_adaptive_profiles=overrides.get("enable_adaptive_profiles", True),
            profile_learning_rate=overrides.get("profile_learning_rate", 0.15),
            profile_erosion_half_life_ms=overrides.get("profile_erosion_half_life_ms", 604800000),
            min_interactions_for_profile=overrides.get("min_interactions_for_profile", 5),
            hard_violation_action=overrides.get("hard_violation_action", "clamp"),
            soft_violation_action=overrides.get("soft_violation_action", "clamp"),
            governed_envelope_mode=overrides.get("governed_envelope_mode", "overwrite"),
        )
        return PerceptionEngine(registry=registry, config=config)

    def test_govern_returns_original_for_clean_annotations(self):
        engine = self._make_engine()
        envelope = engine.govern("speech", {"syllable_rate": 4.0, "turn_gap_ms": 400})
        self.assertEqual(envelope.applied, "original")
        self.assertEqual(len(envelope.violations), 0)
        self.assertIsNone(envelope.profile_used)

    def test_govern_returns_governed_for_violation(self):
        engine = self._make_engine()
        envelope = engine.govern("speech", {"syllable_rate": 10.0})
        self.assertEqual(envelope.applied, "governed")
        self.assertGreater(len(envelope.violations), 0)
        clamped_rate = envelope.governed_annotations["syllable_rate"]
        self.assertLess(clamped_rate, 10.0)

    def test_govern_preserves_original_annotations(self):
        engine = self._make_engine()
        envelope = engine.govern("speech", {"syllable_rate": 10.0, "turn_gap_ms": 50})
        self.assertEqual(envelope.original_annotations["syllable_rate"], 10.0)
        self.assertEqual(envelope.original_annotations["turn_gap_ms"], 50)

    def test_govern_applies_adaptive_profile_when_eligible(self):
        engine = self._make_engine(min_interactions_for_profile=2)
        import time
        for i in range(5):
            engine.ingest_interaction(UserTemporalInteraction(
                user_id="user-001",
                modality="speech",
                timestamp=time.time() * 1000 + i,
                interaction_type="slow_down_request",
                context_parameters={"syllable_rate": 5.0},
                response_latency_ms=None,
            ))
        envelope = engine.govern("speech", {"syllable_rate": 5.0}, user_id="user-001")
        self.assertEqual(envelope.profile_used, "user-001")
        self.assertEqual(envelope.applied, "adaptive")

    def test_govern_skips_adaptive_when_disabled(self):
        engine = self._make_engine(enable_adaptive_profiles=False, min_interactions_for_profile=1)
        import time
        engine.ingest_interaction(UserTemporalInteraction(
            user_id="user-001",
            modality="speech",
            timestamp=time.time() * 1000,
            interaction_type="slow_down_request",
            context_parameters={},
            response_latency_ms=None,
        ))
        envelope = engine.govern("speech", {"syllable_rate": 5.0}, user_id="user-001")
        self.assertIsNone(envelope.profile_used)

    def test_govern_skips_adaptive_when_no_user_id(self):
        engine = self._make_engine(min_interactions_for_profile=1)
        envelope = engine.govern("speech", {"syllable_rate": 5.0})
        self.assertIsNone(envelope.profile_used)

    def test_get_profile_returns_none_for_unknown_user(self):
        engine = self._make_engine()
        profile = engine.get_profile("nonexistent")
        self.assertIsNone(profile)

    def test_reset_profile_removes_user_data(self):
        engine = self._make_engine()
        import time
        engine.ingest_interaction(UserTemporalInteraction(
            user_id="user-001",
            modality="speech",
            timestamp=time.time() * 1000,
            interaction_type="slow_down_request",
            context_parameters={},
            response_latency_ms=None,
        ))
        self.assertIsNotNone(engine.get_profile("user-001"))
        engine.reset_profile("user-001")
        self.assertIsNone(engine.get_profile("user-001"))

    def test_list_profiles_returns_all_active(self):
        engine = self._make_engine()
        import time
        for uid in ["alice", "bob"]:
            engine.ingest_interaction(UserTemporalInteraction(
                user_id=uid,
                modality="speech",
                timestamp=time.time() * 1000,
                interaction_type="completion",
                context_parameters={},
                response_latency_ms=None,
            ))
        profiles = engine.list_profiles()
        self.assertEqual(len(profiles), 2)
        self.assertIn("alice", profiles)
        self.assertIn("bob", profiles)

    def test_adaptive_never_exceeds_hard_bounds(self):
        engine = self._make_engine(min_interactions_for_profile=1)
        registry = PerceptionRegistry()
        speech_profile = registry.get_modality("speech")
        syllable_bound = speech_profile.bounds["syllable_rate"]
        import time
        for i in range(50):
            engine.ingest_interaction(UserTemporalInteraction(
                user_id="aggressive",
                modality="speech",
                timestamp=time.time() * 1000 + i,
                interaction_type="speed_up_request",
                context_parameters={},
                response_latency_ms=None,
            ))
        envelope = engine.govern(
            "speech",
            {"syllable_rate": syllable_bound.comfortable_max},
            user_id="aggressive",
        )
        adaptive_value = envelope.adaptive_annotations["syllable_rate"]
        self.assertLessEqual(adaptive_value, syllable_bound.comfortable_max)
        self.assertGreaterEqual(adaptive_value, syllable_bound.comfortable_min)


if __name__ == "__main__":
    unittest.main()
