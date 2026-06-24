# @PAD: /root/dynAEP/sdk/python/tests/temporal/test_perception_registry.py
"""Tests for PerceptionRegistry - dynAEP perceptual temporal governance."""

import unittest
from dynaep.temporal.perception_registry import (
    PerceptionRegistry,
    PerceptionBounds,
    PerceptionViolation,
    PerceptionValidationResult,
    ModalityProfile,
)


class TestPerceptionRegistry(unittest.TestCase):

    def test_lists_all_five_modalities(self):
        registry = PerceptionRegistry()
        modalities = registry.list_modalities()
        self.assertEqual(len(modalities), 5)
        self.assertIn("speech", modalities)
        self.assertIn("haptic", modalities)
        self.assertIn("notification", modalities)
        self.assertIn("sensor", modalities)
        self.assertIn("audio", modalities)

    def test_get_modality_returns_speech_profile(self):
        registry = PerceptionRegistry()
        profile = registry.get_modality("speech")
        self.assertIsNotNone(profile)
        self.assertEqual(profile.modality, "speech")
        self.assertIn("syllable_rate", profile.bounds)
        self.assertIn("turn_gap_ms", profile.bounds)

    def test_get_modality_returns_none_for_unknown(self):
        registry = PerceptionRegistry()
        profile = registry.get_modality("taste")
        self.assertIsNone(profile)

    def test_speech_bounds_structure(self):
        registry = PerceptionRegistry()
        profile = registry.get_modality("speech")
        bound = profile.bounds["syllable_rate"]
        self.assertLess(bound.min, bound.comfortable_min)
        self.assertLessEqual(bound.comfortable_min, bound.comfortable_max)
        self.assertLess(bound.comfortable_max, bound.max)
        self.assertEqual(bound.unit, "per_second")
        self.assertGreater(len(bound.source), 0)

    def test_validate_clean_annotations_no_violations(self):
        registry = PerceptionRegistry()
        result = registry.validate("speech", {"syllable_rate": 4.0, "turn_gap_ms": 400})
        self.assertTrue(result.valid)
        self.assertEqual(len(result.violations), 0)

    def test_validate_detects_hard_violation(self):
        registry = PerceptionRegistry()
        result = registry.validate("speech", {"syllable_rate": 10.0})
        self.assertFalse(result.valid)
        self.assertGreater(len(result.violations), 0)
        violation = next(v for v in result.violations if v.parameter == "syllable_rate")
        self.assertEqual(violation.severity, "hard")

    def test_validate_clamps_to_hard_bounds(self):
        registry = PerceptionRegistry()
        profile = registry.get_modality("speech")
        bound = profile.bounds["syllable_rate"]
        result = registry.validate("speech", {"syllable_rate": 100.0})
        clamped_value = result.clamped["syllable_rate"]
        self.assertLessEqual(clamped_value, bound.max)
        self.assertGreaterEqual(clamped_value, bound.min)

    def test_comfortable_range_returns_correct_values(self):
        registry = PerceptionRegistry()
        r = registry.comfortable_range("speech", "syllable_rate")
        self.assertIsNotNone(r)
        self.assertGreater(r["max"], r["min"])

    def test_comfortable_range_returns_none_for_unknown(self):
        registry = PerceptionRegistry()
        self.assertIsNone(registry.comfortable_range("taste", "speed"))
        self.assertIsNone(registry.comfortable_range("speech", "nonexistent"))

    def test_load_overrides_never_exceed_hard_bounds(self):
        registry = PerceptionRegistry()
        profile = registry.get_modality("speech")
        bound = profile.bounds["syllable_rate"]
        registry.load_overrides("speech", {
            "syllable_rate": {
                "comfortable_min": bound.min - 100,
                "comfortable_max": bound.max + 100,
            },
        })
        updated = registry.get_modality("speech")
        updated_bound = updated.bounds["syllable_rate"]
        self.assertGreaterEqual(updated_bound.comfortable_min, updated_bound.min)
        self.assertLessEqual(updated_bound.comfortable_max, updated_bound.max)


if __name__ == "__main__":
    unittest.main()
