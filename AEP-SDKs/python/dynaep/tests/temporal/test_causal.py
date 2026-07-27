# @PAD: /root/dynAEP/sdk/python/tests/temporal/test_causal.py
import unittest
from dynaep.temporal.causal import (
    CausalOrderingEngine,
    CausalConfig,
    CausalEvent,
    CausalOrderResult,
    CausalViolation,
)


class TestCausalOrderingEngine(unittest.TestCase):

    def _make_config(self, **overrides):
        defaults = dict(
            max_reorder_buffer_size=64,
            max_reorder_wait_ms=5000,
            conflict_resolution="last_write_wins",
            enable_vector_clocks=True,
            enable_element_history=True,
            history_depth=100,
        )
        defaults.update(overrides)
        return CausalConfig(**defaults)

    def _make_event(self, event_id, agent_id, seq, **overrides):
        defaults = dict(
            event_id=event_id,
            agent_id=agent_id,
            bridge_time_ms=1000 + seq,
            target_element_id="elem-1",
            sequence_number=seq,
            vector_clock={},
            causal_dependencies=[],
        )
        defaults.update(overrides)
        return CausalEvent(**defaults)

    def test_registers_agent_and_initializes_vector_clock(self):
        engine = CausalOrderingEngine(self._make_config())
        engine.register_agent("agent-alpha")
        vc = engine.get_vector_clock()
        self.assertIn("agent-alpha", vc)
        self.assertEqual(vc["agent-alpha"], 0)

    def test_processes_in_order_events_without_buffering(self):
        engine = CausalOrderingEngine(self._make_config())
        engine.register_agent("agent-1")
        results = []
        for seq in range(1, 4):
            evt = self._make_event("e-" + str(seq), "agent-1", seq)
            r = engine.process(evt)
            results.append(r)
        for r in results:
            self.assertTrue(r.ordered)

    def test_buffers_out_of_order_events(self):
        engine = CausalOrderingEngine(self._make_config())
        engine.register_agent("agent-1")
        evt2 = self._make_event("e-2", "agent-1", 2)
        result = engine.process(evt2)
        self.assertFalse(result.ordered)
        violation_types = [v.type for v in result.violations]
        self.assertIn("out_of_order", violation_types)

    def test_drains_buffer_when_gap_filled(self):
        engine = CausalOrderingEngine(self._make_config())
        engine.register_agent("agent-1")
        engine.process(self._make_event("e-2", "agent-1", 2))
        result = engine.process(self._make_event("e-1", "agent-1", 1))
        self.assertTrue(result.ordered)
        self.assertIn("e-2", result.reordered_events)

    def test_detects_clock_regression(self):
        engine = CausalOrderingEngine(self._make_config())
        engine.register_agent("agent-1")
        engine.process(self._make_event("e-1", "agent-1", 1))
        engine.process(self._make_event("e-2", "agent-1", 2))
        engine.process(self._make_event("e-3", "agent-1", 3))
        regressed = self._make_event("e-bad", "agent-1", 1)
        result = engine.process(regressed)
        violation_types = [v.type for v in result.violations]
        self.assertIn("agent_clock_regression", violation_types)

    def test_detects_missing_dependencies(self):
        engine = CausalOrderingEngine(self._make_config())
        engine.register_agent("agent-1")
        evt = self._make_event(
            "e-1", "agent-1", 1,
            causal_dependencies=["nonexistent-event"],
        )
        result = engine.process(evt)
        violation_types = [v.type for v in result.violations]
        self.assertIn("missing_dependency", violation_types)

    def test_detects_duplicate_event_id(self):
        engine = CausalOrderingEngine(self._make_config())
        engine.register_agent("agent-1")
        engine.process(self._make_event("e-1", "agent-1", 1))
        duplicate = self._make_event("e-1", "agent-1", 2)
        result = engine.process(duplicate)
        violation_types = [v.type for v in result.violations]
        self.assertIn("duplicate_sequence", violation_types)

    def test_flush_drains_buffer(self):
        engine = CausalOrderingEngine(self._make_config())
        engine.register_agent("agent-1")
        engine.process(self._make_event("e-3", "agent-1", 3, bridge_time_ms=3000))
        engine.process(self._make_event("e-2", "agent-1", 2, bridge_time_ms=2000))
        flushed = engine.flush()
        self.assertEqual(len(flushed), 2)
        self.assertLessEqual(
            flushed[0].sequence_number,
            flushed[1].sequence_number,
        )

    def test_vector_clock_advances_for_single_agent(self):
        engine = CausalOrderingEngine(self._make_config())
        engine.register_agent("agent-1")
        for seq in range(1, 4):
            engine.process(self._make_event("e-" + str(seq), "agent-1", seq))
        vc = engine.get_vector_clock()
        self.assertEqual(vc["agent-1"], 3)

    def test_vector_clock_advances_for_multiple_agents(self):
        engine = CausalOrderingEngine(self._make_config())
        engine.register_agent("agent-A")
        engine.register_agent("agent-B")
        engine.process(self._make_event("a-1", "agent-A", 1))
        engine.process(self._make_event("b-1", "agent-B", 1))
        engine.process(self._make_event("a-2", "agent-A", 2))
        vc = engine.get_vector_clock()
        self.assertEqual(vc["agent-A"], 2)
        self.assertEqual(vc["agent-B"], 1)

    def test_detect_conflicts_concurrent_same_element(self):
        engine = CausalOrderingEngine(self._make_config())
        event_a = CausalEvent(
            event_id="a-1", agent_id="agent-A", bridge_time_ms=1000,
            target_element_id="shared-elem", sequence_number=1,
            vector_clock={"agent-A": 1, "agent-B": 0},
            causal_dependencies=[],
        )
        event_b = CausalEvent(
            event_id="b-1", agent_id="agent-B", bridge_time_ms=1001,
            target_element_id="shared-elem", sequence_number=1,
            vector_clock={"agent-A": 0, "agent-B": 1},
            causal_dependencies=[],
        )
        self.assertTrue(engine.detect_conflicts(event_a, event_b))

    def test_detect_conflicts_different_elements(self):
        engine = CausalOrderingEngine(self._make_config())
        event_a = CausalEvent(
            event_id="a-1", agent_id="agent-A", bridge_time_ms=1000,
            target_element_id="elem-alpha", sequence_number=1,
            vector_clock={"agent-A": 1}, causal_dependencies=[],
        )
        event_b = CausalEvent(
            event_id="b-1", agent_id="agent-B", bridge_time_ms=1001,
            target_element_id="elem-beta", sequence_number=1,
            vector_clock={"agent-B": 1}, causal_dependencies=[],
        )
        self.assertFalse(engine.detect_conflicts(event_a, event_b))

    def test_element_history_records_delivered_events(self):
        engine = CausalOrderingEngine(self._make_config())
        engine.register_agent("agent-1")
        engine.process(self._make_event("e-1", "agent-1", 1, target_element_id="CP-00001"))
        engine.process(self._make_event("e-2", "agent-1", 2, target_element_id="CP-00001"))
        history = engine.element_history("CP-00001")
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0].event_id, "e-1")
        self.assertEqual(history[1].event_id, "e-2")

    def test_reset_clears_all_state(self):
        engine = CausalOrderingEngine(self._make_config())
        engine.register_agent("agent-1")
        engine.process(self._make_event("e-1", "agent-1", 1))
        engine.reset()
        vc = engine.get_vector_clock()
        self.assertEqual(len(vc), 0)
        history = engine.element_history("elem-1")
        self.assertEqual(len(history), 0)

    def test_respects_max_reorder_buffer_size(self):
        engine = CausalOrderingEngine(self._make_config(max_reorder_buffer_size=3))
        engine.register_agent("agent-1")
        engine.process(self._make_event("e-5", "agent-1", 5, bridge_time_ms=5000))
        engine.process(self._make_event("e-4", "agent-1", 4, bridge_time_ms=4000))
        engine.process(self._make_event("e-3", "agent-1", 3, bridge_time_ms=3000))
        engine.process(self._make_event("e-2", "agent-1", 2, bridge_time_ms=2000))
        flushed = engine.flush()
        self.assertLessEqual(len(flushed), 3)


if __name__ == "__main__":
    unittest.main()
