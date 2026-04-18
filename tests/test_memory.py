"""
Tests for sdk-aep-memory.py (Lattice Memory).
Run: python -m pytest tests/test_memory.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sdk"))

from importlib.util import spec_from_file_location, module_from_spec

sdk_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sdk")
mem_spec = spec_from_file_location("sdk_aep_memory", os.path.join(sdk_dir, "sdk-aep-memory.py"))
mem_mod = module_from_spec(mem_spec)
sys.modules["sdk_aep_memory"] = mem_mod
mem_spec.loader.exec_module(mem_mod)

MemoryEntry = mem_mod.MemoryEntry
InMemoryFabric = mem_mod.InMemoryFabric
SQLiteFabric = mem_mod.SQLiteFabric
create_memory_entry = mem_mod.create_memory_entry
cosine_similarity = mem_mod.cosine_similarity

import pytest


# ---------------------------------------------------------------------------
# cosine_similarity
# ---------------------------------------------------------------------------

class TestCosineSimilarity:
    def test_identical_vectors(self):
        assert cosine_similarity([1, 0, 0], [1, 0, 0]) == pytest.approx(1.0)

    def test_orthogonal_vectors(self):
        assert cosine_similarity([1, 0], [0, 1]) == pytest.approx(0.0)

    def test_opposite_vectors(self):
        assert cosine_similarity([1, 0], [-1, 0]) == pytest.approx(-1.0)

    def test_empty_vectors(self):
        assert cosine_similarity([], []) == 0.0

    def test_zero_magnitude(self):
        assert cosine_similarity([0, 0], [1, 1]) == 0.0

    def test_mismatched_lengths(self):
        with pytest.raises(ValueError, match="length mismatch"):
            cosine_similarity([1, 2], [1, 2, 3])


# ---------------------------------------------------------------------------
# create_memory_entry
# ---------------------------------------------------------------------------

class TestCreateMemoryEntry:
    def test_creates_valid_entry(self):
        entry = create_memory_entry(
            element_id="CP-00001",
            domain="ui",
            proposal={"z": 20, "parent": "PN-00001"},
            result="accepted",
            errors=[],
            traversal_path=["z_band", "parent_check"],
        )
        assert entry.element_id == "CP-00001"
        assert entry.domain == "ui"
        assert entry.result == "accepted"
        assert entry.errors == []
        assert entry.traversal_path == ["z_band", "parent_check"]
        assert len(entry.id) == 36  # UUID v4
        assert "T" in entry.timestamp  # ISO 8601

    def test_invalid_domain_raises(self):
        with pytest.raises(ValueError, match="Invalid domain"):
            create_memory_entry(
                element_id="X-1", domain="invalid",
                proposal={}, result="accepted",
            )

    def test_invalid_result_raises(self):
        with pytest.raises(ValueError, match="Invalid result"):
            create_memory_entry(
                element_id="X-1", domain="ui",
                proposal={}, result="maybe",
            )

    def test_frozen_immutable(self):
        entry = create_memory_entry(
            element_id="CP-00001", domain="ui",
            proposal={}, result="accepted",
        )
        with pytest.raises(AttributeError):
            entry.result = "rejected"

    def test_optional_embedding(self):
        entry = create_memory_entry(
            element_id="CP-00001", domain="ui",
            proposal={}, result="accepted",
            embedding=[0.1, 0.9],
        )
        assert entry.embedding == [0.1, 0.9]

    def test_optional_metadata(self):
        entry = create_memory_entry(
            element_id="CP-00001", domain="ui",
            proposal={}, result="accepted",
            metadata={"agent": "test"},
        )
        assert entry.metadata == {"agent": "test"}


# ---------------------------------------------------------------------------
# InMemoryFabric
# ---------------------------------------------------------------------------

class TestInMemoryFabric:
    def _make_fabric(self):
        fabric = InMemoryFabric()
        entries = [
            create_memory_entry("CP-00001", "ui", {"z": 20}, "accepted", [], ["z_band"], [0.1, 0.8, 0.3]),
            create_memory_entry("CP-00002", "ui", {"z": 5}, "rejected", ["z=5 outside band"], ["z_band"], [0.9, 0.1, 0.7]),
            create_memory_entry("CP-00003", "ui", {"z": 22}, "accepted", [], ["z_band", "parent"], [0.15, 0.85, 0.28]),
        ]
        for e in entries:
            fabric.record(e)
        return fabric

    def test_record_and_export(self):
        fabric = self._make_fabric()
        assert len(fabric.export_history()) == 3

    def test_get_rejection_history(self):
        fabric = self._make_fabric()
        rejections = fabric.get_rejection_history("CP-00002")
        assert len(rejections) == 1
        assert rejections[0].result == "rejected"

    def test_get_acceptance_history(self):
        fabric = self._make_fabric()
        accepts = fabric.get_acceptance_history("CP-00001")
        assert len(accepts) == 1
        assert accepts[0].result == "accepted"

    def test_get_validation_count(self):
        fabric = self._make_fabric()
        assert fabric.get_validation_count("CP-00001") == 1
        assert fabric.get_validation_count("NONEXIST") == 0

    def test_find_nearest_attractor(self):
        fabric = self._make_fabric()
        results = fabric.find_nearest_attractor([0.12, 0.82, 0.29], limit=2)
        assert len(results) <= 2
        # Only accepted entries with embeddings should appear
        for r in results:
            assert r.result == "accepted"

    def test_fast_path_hit_exact(self):
        fabric = self._make_fabric()
        hit = fabric.get_fast_path_hit([0.1, 0.8, 0.3], threshold=0.99)
        assert hit is not None
        assert hit.element_id == "CP-00001"

    def test_fast_path_miss_distant(self):
        fabric = self._make_fabric()
        miss = fabric.get_fast_path_hit([0.9, 0.1, 0.9], threshold=0.95)
        assert miss is None

    def test_clear(self):
        fabric = self._make_fabric()
        assert len(fabric.export_history()) == 3
        fabric.clear()
        assert len(fabric.export_history()) == 0

    def test_append_only_semantics(self):
        """Verify that recorded entries remain unchanged after subsequent records."""
        fabric = InMemoryFabric()
        e1 = create_memory_entry("CP-00001", "ui", {"z": 20}, "accepted")
        fabric.record(e1)
        snapshot_before = fabric.export_history()[0]

        e2 = create_memory_entry("CP-00002", "ui", {"z": 25}, "rejected", ["err"])
        fabric.record(e2)
        snapshot_after = fabric.export_history()[0]

        assert snapshot_before.id == snapshot_after.id
        assert snapshot_before.result == snapshot_after.result


# ---------------------------------------------------------------------------
# SQLiteFabric
# ---------------------------------------------------------------------------

class TestSQLiteFabric:
    def _make_fabric(self):
        fabric = SQLiteFabric(":memory:")
        entries = [
            create_memory_entry("CP-00001", "ui", {"z": 20}, "accepted", [], ["z_band"], [0.1, 0.8, 0.3]),
            create_memory_entry("CP-00002", "ui", {"z": 5}, "rejected", ["z=5 outside band"], ["z_band"], [0.9, 0.1, 0.7]),
        ]
        for e in entries:
            fabric.record(e)
        return fabric

    def test_record_and_export(self):
        fabric = self._make_fabric()
        history = fabric.export_history()
        assert len(history) == 2

    def test_rejection_history(self):
        fabric = self._make_fabric()
        rejections = fabric.get_rejection_history("CP-00002")
        assert len(rejections) == 1

    def test_acceptance_history(self):
        fabric = self._make_fabric()
        accepts = fabric.get_acceptance_history("CP-00001")
        assert len(accepts) == 1

    def test_validation_count(self):
        fabric = self._make_fabric()
        assert fabric.get_validation_count("CP-00001") == 1

    def test_fast_path_hit(self):
        fabric = self._make_fabric()
        hit = fabric.get_fast_path_hit([0.1, 0.8, 0.3], threshold=0.99)
        assert hit is not None
        assert hit.element_id == "CP-00001"

    def test_fast_path_miss(self):
        fabric = self._make_fabric()
        miss = fabric.get_fast_path_hit([0.9, 0.1, 0.9], threshold=0.95)
        assert miss is None

    def test_find_nearest_attractor(self):
        fabric = self._make_fabric()
        results = fabric.find_nearest_attractor([0.1, 0.8, 0.3], limit=5)
        assert len(results) == 1  # Only accepted entries
        assert results[0].element_id == "CP-00001"

    def test_clear(self):
        fabric = self._make_fabric()
        fabric.clear()
        assert len(fabric.export_history()) == 0

    def test_roundtrip_serialization(self):
        """Ensure JSON serialization/deserialization preserves data."""
        fabric = SQLiteFabric(":memory:")
        entry = create_memory_entry(
            element_id="WF-001", domain="workflow",
            proposal={"action": "assign", "task_id": "T-1"},
            result="rejected",
            errors=["Invalid transition"],
            traversal_path=["workflow_registry"],
            metadata={"agent": "coder"},
        )
        fabric.record(entry)
        restored = fabric.export_history()[0]
        assert restored.element_id == entry.element_id
        assert restored.proposal == entry.proposal
        assert restored.errors == entry.errors
        assert restored.metadata == entry.metadata


# ---------------------------------------------------------------------------
# Domain coverage
# ---------------------------------------------------------------------------

class TestAllDomains:
    """Verify all 5 domains are accepted."""

    @pytest.mark.parametrize("domain", ["ui", "workflow", "api", "event", "iac"])
    def test_valid_domains(self, domain):
        entry = create_memory_entry(
            element_id=f"TEST-{domain}", domain=domain,
            proposal={}, result="accepted",
        )
        assert entry.domain == domain
