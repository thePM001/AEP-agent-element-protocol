# @PAD: /root/dynAEP/sdk/python/tests/temporal/test_clock.py
import unittest
import time
from dynaep.temporal.clock import BridgeClock, ClockConfig

class TestBridgeClock(unittest.TestCase):

    def test_initializes_with_ntp_config(self):
        config = ClockConfig(protocol="ntp", source="pool.ntp.org", sync_interval_ms=30000, max_drift_ms=50, bridge_is_authority=True)
        clock = BridgeClock(config)
        health = clock.health()
        self.assertEqual(health.protocol, "ntp")
        self.assertIsInstance(health.uptime_ms, int)
        self.assertGreaterEqual(health.uptime_ms, 0)

    def test_falls_back_to_system_clock(self):
        config = ClockConfig(protocol="system", source="localhost", sync_interval_ms=30000, max_drift_ms=50, bridge_is_authority=True)
        clock = BridgeClock(config)
        result = clock.sync()
        self.assertTrue(result.success)
        self.assertEqual(clock.health().protocol, "system")

    def test_stamp_produces_correct_bridge_timestamp(self):
        config = ClockConfig(protocol="system", source="localhost", sync_interval_ms=30000, max_drift_ms=50, bridge_is_authority=True)
        clock = BridgeClock(config)
        clock.sync()
        ts = clock.stamp(None)
        self.assertGreater(ts.bridge_time_ms, 0)
        self.assertIsNone(ts.agent_time_ms)
        self.assertEqual(ts.drift_ms, 0)

    def test_measure_drift_computes_correct_drift(self):
        config = ClockConfig(protocol="system", source="localhost", sync_interval_ms=30000, max_drift_ms=50, bridge_is_authority=True)
        clock = BridgeClock(config)
        clock.sync()
        agent_time = int(time.time() * 1000) - 100
        drift = clock.measure_drift(agent_time)
        self.assertGreaterEqual(drift, 90)
        self.assertLessEqual(drift, 200)

    def test_health_returns_complete_status(self):
        config = ClockConfig(protocol="system", source="localhost", sync_interval_ms=30000, max_drift_ms=50, bridge_is_authority=True)
        clock = BridgeClock(config)
        h = clock.health()
        self.assertIn("synced", vars(h) if hasattr(h, '__dict__') else dir(h))
        self.assertIsInstance(h.source, str)
        self.assertIsInstance(h.protocol, str)

    def test_is_synced_reflects_sync_state(self):
        config = ClockConfig(protocol="system", source="localhost", sync_interval_ms=30000, max_drift_ms=50, bridge_is_authority=True)
        clock = BridgeClock(config)
        self.assertFalse(clock.is_synced())
        clock.sync()
        self.assertTrue(clock.is_synced())

if __name__ == "__main__":
    unittest.main()
