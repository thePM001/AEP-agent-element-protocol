# @PAD: /root/dynAEP/sdk/python/tests/temporal/test_validator.py
import unittest
import time
from dynaep.temporal.clock import BridgeClock, ClockConfig
from dynaep.temporal.validator import (
    TemporalValidator,
    TemporalValidatorConfig,
    TemporalValidationResult,
    TemporalViolation,
)


class TestTemporalValidator(unittest.TestCase):

    def _make_clock(self):
        config = ClockConfig(
            protocol="system",
            source="localhost",
            sync_interval_ms=0,
            max_drift_ms=50000,
            bridge_is_authority=True,
        )
        clock = BridgeClock(config)
        clock.sync()
        return clock

    def _make_validator(self, clock, **overrides):
        defaults = dict(
            max_drift_ms=100,
            max_future_ms=500,
            max_staleness_ms=10000,
            overwrite_timestamps=False,
            log_rejections=True,
            mode="strict",
        )
        defaults.update(overrides)
        config = TemporalValidatorConfig(**defaults)
        return TemporalValidator(clock, config)

    def test_accepts_event_within_drift_tolerance(self):
        clock = self._make_clock()
        validator = self._make_validator(clock, max_drift_ms=200)
        event = {"type": "STATE_DELTA", "timestamp": int(time.time() * 1000)}
        result = validator.validate(event)
        self.assertTrue(result.accepted)
        self.assertEqual(len(result.violations), 0)

    def test_rejects_event_exceeding_max_drift(self):
        clock = self._make_clock()
        validator = self._make_validator(clock, max_drift_ms=50)
        event = {"type": "STATE_DELTA", "timestamp": int(time.time() * 1000) - 200}
        result = validator.validate(event)
        violation_types = [v.type for v in result.violations]
        self.assertIn("drift_exceeded", violation_types)

    def test_rejects_future_timestamp(self):
        clock = self._make_clock()
        validator = self._make_validator(clock, max_drift_ms=50000, max_future_ms=500)
        event = {"type": "STATE_DELTA", "timestamp": int(time.time() * 1000) + 2000}
        result = validator.validate(event)
        violation_types = [v.type for v in result.violations]
        self.assertIn("future_timestamp", violation_types)

    def test_rejects_stale_event(self):
        clock = self._make_clock()
        validator = self._make_validator(
            clock, max_drift_ms=50000, max_staleness_ms=5000
        )
        event = {"type": "STATE_DELTA", "timestamp": int(time.time() * 1000) - 10000}
        result = validator.validate(event)
        violation_types = [v.type for v in result.violations]
        self.assertIn("stale_event", violation_types)

    def test_overwrites_timestamp_when_configured(self):
        clock = self._make_clock()
        validator = self._make_validator(
            clock, overwrite_timestamps=True, mode="permissive",
            max_drift_ms=50000, max_future_ms=50000, max_staleness_ms=50000,
        )
        original_ts = 12345
        event = {"type": "STATE_DELTA", "timestamp": original_ts}
        validator.validate(event)
        self.assertNotEqual(event["timestamp"], original_ts)
        self.assertGreater(event["timestamp"], 0)

    def test_preserves_timestamp_when_not_overwriting(self):
        clock = self._make_clock()
        validator = self._make_validator(
            clock, overwrite_timestamps=False, mode="permissive",
            max_drift_ms=50000, max_future_ms=50000, max_staleness_ms=50000,
        )
        original_ts = int(time.time() * 1000)
        event = {"type": "STATE_DELTA", "timestamp": original_ts}
        validator.validate(event)
        self.assertEqual(event["timestamp"], original_ts)

    def test_handles_missing_timestamp_gracefully(self):
        clock = self._make_clock()
        validator = self._make_validator(clock)
        event = {"type": "STATE_DELTA"}
        result = validator.validate(event)
        self.assertTrue(result.accepted)
        self.assertEqual(len(result.violations), 0)

    def test_strict_mode_rejects_on_violation(self):
        clock = self._make_clock()
        validator = self._make_validator(
            clock, max_drift_ms=10, max_future_ms=10, max_staleness_ms=10, mode="strict"
        )
        event = {"type": "STATE_DELTA", "timestamp": int(time.time() * 1000) - 500}
        result = validator.validate(event)
        self.assertFalse(result.accepted)

    def test_permissive_mode_accepts_with_violations(self):
        clock = self._make_clock()
        validator = self._make_validator(
            clock, max_drift_ms=10, max_future_ms=10, max_staleness_ms=10, mode="permissive"
        )
        event = {"type": "STATE_DELTA", "timestamp": int(time.time() * 1000) - 500}
        result = validator.validate(event)
        self.assertTrue(result.accepted)
        self.assertGreater(len(result.violations), 0)

    def test_log_only_mode_accepts_all(self):
        clock = self._make_clock()
        validator = self._make_validator(
            clock, max_drift_ms=10, max_future_ms=10, max_staleness_ms=10, mode="log_only"
        )
        event = {"type": "STATE_DELTA", "timestamp": int(time.time() * 1000) - 500}
        result = validator.validate(event)
        self.assertTrue(result.accepted)
        self.assertGreater(len(result.violations), 0)

    def test_validate_batch_processes_multiple_events(self):
        clock = self._make_clock()
        validator = self._make_validator(
            clock, max_drift_ms=50000, max_future_ms=50000,
            max_staleness_ms=50000, mode="permissive",
        )
        events = [
            {"type": "EVENT_A", "timestamp": int(time.time() * 1000)},
            {"type": "EVENT_B", "timestamp": int(time.time() * 1000)},
            {"type": "EVENT_C", "timestamp": int(time.time() * 1000)},
        ]
        results = validator.validate_batch(events)
        self.assertEqual(len(results), 3)
        for r in results:
            self.assertIsNotNone(r.bridge_timestamp)

    def test_attaches_temporal_metadata_to_event(self):
        clock = self._make_clock()
        validator = self._make_validator(
            clock, max_drift_ms=50000, max_future_ms=50000,
            max_staleness_ms=50000,
        )
        event = {"type": "STATE_DELTA", "timestamp": int(time.time() * 1000)}
        validator.validate(event)
        self.assertIn("_temporal", event)
        self.assertIn("bridge_time_ms", event["_temporal"])
        self.assertIn("source", event["_temporal"])

    def test_check_drift_returns_tuple(self):
        clock = self._make_clock()
        validator = self._make_validator(clock, max_drift_ms=100)
        agent_time = int(time.time() * 1000) - 50
        result = validator.check_drift(agent_time)
        self.assertIsInstance(result, tuple)
        self.assertEqual(len(result), 2)
        within, drift = result
        self.assertIsInstance(within, bool)
        self.assertIsInstance(drift, int)

    def test_check_staleness_returns_bool(self):
        clock = self._make_clock()
        validator = self._make_validator(clock, max_staleness_ms=5000)
        agent_time = int(time.time() * 1000) - 10000
        result = validator.check_staleness(agent_time)
        self.assertIsInstance(result, bool)
        self.assertTrue(result)


if __name__ == "__main__":
    unittest.main()
