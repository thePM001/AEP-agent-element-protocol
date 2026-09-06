# @PAD: /root/dynAEP/sdk/python/tests/temporal/test_forecast.py
import unittest
from dynaep.temporal.forecast import ForecastSidecar, ForecastConfig, RuntimeCoordinates

class TestForecastSidecar(unittest.TestCase):

    def _make_sidecar(self, enabled=False):
        config = ForecastConfig(enabled=enabled, timesfm_endpoint=None, timesfm_mode="local", context_window=64, forecast_horizon=12, anomaly_threshold=3.0, debounce_ms=250, max_tracked_elements=500)
        return ForecastSidecar(config)

    def test_available_returns_false_when_timesfm_not_importable(self):
        sidecar = self._make_sidecar(enabled=True)
        result = sidecar.available()
        self.assertFalse(result)
        self.assertIsInstance(result, bool)

    def test_ingest_stores_coordinates(self):
        sidecar = self._make_sidecar(enabled=True)
        event = {
            "type": "CUSTOM",
            "dynaep_type": "AEP_RUNTIME_COORDINATES",
            "target_id": "CP-00001",
            "coordinates": {"x": 10, "y": 20, "width": 100, "height": 50, "visible": True, "rendered_at": "vp-lg"},
        }
        sidecar.ingest(event)
        history = sidecar.get_history("CP-00001")
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["x"], 10)

    def test_forecast_returns_none_for_insufficient_history(self):
        sidecar = self._make_sidecar(enabled=True)
        event = {
            "type": "CUSTOM",
            "dynaep_type": "AEP_RUNTIME_COORDINATES",
            "target_id": "CP-00002",
            "coordinates": {"x": 0, "y": 0, "width": 50, "height": 50, "visible": True, "rendered_at": "base"},
        }
        sidecar.ingest(event)
        result = sidecar.forecast("CP-00002")
        self.assertIsNone(result)

    def test_check_anomaly_returns_low_score_for_normal_mutation(self):
        sidecar = self._make_sidecar(enabled=True)
        for i in range(10):
            event = {
                "type": "CUSTOM",
                "dynaep_type": "AEP_RUNTIME_COORDINATES",
                "target_id": "CP-00003",
                "coordinates": {"x": 10 + i, "y": 20, "width": 100, "height": 50, "visible": True, "rendered_at": "vp-lg"},
            }
            sidecar.ingest(event)
        result = sidecar.check_anomaly("CP-00003", {"x": 20, "y": 20, "width": 100, "height": 50})
        self.assertFalse(result.is_anomaly)
        self.assertLess(result.score, 3.0)

    def test_adaptive_debounce_returns_valid_interval(self):
        sidecar = self._make_sidecar(enabled=True)
        interval = sidecar.adaptive_debounce("CP-00099")
        self.assertGreaterEqual(interval, 50)
        self.assertLessEqual(interval, 2000)

    def test_prune_removes_stale_tracking_data(self):
        sidecar = self._make_sidecar(enabled=True)
        for eid in ["CP-00010", "CP-00011", "CP-00012"]:
            event = {
                "type": "CUSTOM",
                "dynaep_type": "AEP_RUNTIME_COORDINATES",
                "target_id": eid,
                "coordinates": {"x": 0, "y": 0, "width": 50, "height": 50, "visible": True, "rendered_at": "base"},
            }
            sidecar.ingest(event)
        sidecar.prune(["CP-00010"])
        self.assertEqual(len(sidecar.get_history("CP-00010")), 1)
        self.assertEqual(len(sidecar.get_history("CP-00011")), 0)
        self.assertEqual(len(sidecar.get_history("CP-00012")), 0)

if __name__ == "__main__":
    unittest.main()
