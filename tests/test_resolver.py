"""
Tests for sdk-aep-resolver.py (Basic Resolver).
Run: python -m pytest tests/test_resolver.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sdk"))

from importlib.util import spec_from_file_location, module_from_spec

sdk_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sdk")

# Load memory module
mem_spec = spec_from_file_location("sdk_aep_memory", os.path.join(sdk_dir, "sdk-aep-memory.py"))
mem_mod = module_from_spec(mem_spec)
sys.modules["sdk_aep_memory"] = mem_mod
mem_spec.loader.exec_module(mem_mod)
InMemoryFabric = mem_mod.InMemoryFabric
create_memory_entry = mem_mod.create_memory_entry

# Load resolver module
res_spec = spec_from_file_location("sdk_aep_resolver", os.path.join(sdk_dir, "sdk-aep-resolver.py"))
res_mod = module_from_spec(res_spec)
sys.modules["sdk_aep_resolver"] = res_mod
res_spec.loader.exec_module(res_mod)
BasicResolver = res_mod.BasicResolver
ResolveRequest = res_mod.ResolveRequest
ResolveResult = res_mod.ResolveResult

import pytest


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------

class TestRouting:
    def test_ui_element_routes_to_ui(self):
        resolver = BasicResolver()
        request = ResolveRequest(proposal_type="ui_element", element_id="CP-00001", payload={})
        result = resolver.resolve(request)
        assert result.route == "ui"

    def test_workflow_step_routes_to_workflow(self):
        resolver = BasicResolver()
        request = ResolveRequest(proposal_type="workflow_step", action="assign", payload={})
        result = resolver.resolve(request)
        assert result.route == "workflow"

    def test_api_call_routes_to_api(self):
        resolver = BasicResolver()
        request = ResolveRequest(proposal_type="api_call", payload={"method": "GET", "path": "/api/health"})
        result = resolver.resolve(request)
        assert result.route == "api"

    def test_event_routes_to_event(self):
        resolver = BasicResolver()
        request = ResolveRequest(proposal_type="event", payload={"topic": "tasks"})
        result = resolver.resolve(request)
        assert result.route == "event"

    def test_iac_resource_routes_to_iac(self):
        resolver = BasicResolver()
        request = ResolveRequest(proposal_type="iac_resource", payload={"kind": "Deployment"})
        result = resolver.resolve(request)
        assert result.route == "iac"

    def test_unknown_proposal_type(self):
        resolver = BasicResolver()
        request = ResolveRequest(proposal_type="invalid_type", payload={})
        result = resolver.resolve(request)
        assert result.route == "unknown"
        assert not result.policy_pass


# ---------------------------------------------------------------------------
# Graceful degradation (no config)
# ---------------------------------------------------------------------------

class TestGracefulDegradation:
    def test_no_config_ui_has_constraints_note(self):
        resolver = BasicResolver(config=None)
        request = ResolveRequest(proposal_type="ui_element", element_id="CP-00001", payload={})
        result = resolver.resolve(request)
        assert result.route == "ui"
        assert any("No AEP config" in c for c in result.constraints)

    def test_no_workflow_registry_has_constraints_note(self):
        resolver = BasicResolver()
        request = ResolveRequest(proposal_type="workflow_step", action="assign", payload={})
        result = resolver.resolve(request)
        assert result.route == "workflow"
        assert any("No workflow registry" in c for c in result.constraints)

    def test_no_api_registry_has_constraints_note(self):
        resolver = BasicResolver()
        request = ResolveRequest(proposal_type="api_call", payload={})
        result = resolver.resolve(request)
        assert any("No API registry" in c for c in result.constraints)

    def test_no_event_registry_has_constraints_note(self):
        resolver = BasicResolver()
        request = ResolveRequest(proposal_type="event", payload={})
        result = resolver.resolve(request)
        assert any("No event registry" in c for c in result.constraints)

    def test_no_iac_registry_has_constraints_note(self):
        resolver = BasicResolver()
        request = ResolveRequest(proposal_type="iac_resource", payload={})
        result = resolver.resolve(request)
        assert any("No IaC registry" in c for c in result.constraints)


# ---------------------------------------------------------------------------
# UI element validation
# ---------------------------------------------------------------------------

class TestUIElementValidation:
    def test_missing_element_id(self):
        resolver = BasicResolver()
        request = ResolveRequest(proposal_type="ui_element", payload={})
        result = resolver.resolve(request)
        assert not result.policy_pass
        assert any("requires element_id" in e for e in result.policy_errors)


# ---------------------------------------------------------------------------
# Workflow validation
# ---------------------------------------------------------------------------

class TestWorkflowValidation:
    def test_missing_action(self):
        resolver = BasicResolver()
        request = ResolveRequest(proposal_type="workflow_step", payload={})
        result = resolver.resolve(request)
        assert not result.policy_pass
        assert any("requires action" in e for e in result.policy_errors)


# ---------------------------------------------------------------------------
# Memory integration
# ---------------------------------------------------------------------------

class TestMemoryIntegration:
    def _seeded_resolver(self):
        fabric = InMemoryFabric()
        entry = create_memory_entry(
            element_id="CP-00005", domain="ui",
            proposal={"type": "component", "z": 20, "parent": "TB-00001"},
            result="accepted", errors=[],
            traversal_path=["z_band", "parent_check"],
            embedding=[0.3, 0.7, 0.5, 0.1],
        )
        fabric.record(entry)
        return BasicResolver(config=None, memory=fabric)

    def test_fast_path_hit(self):
        resolver = self._seeded_resolver()
        request = ResolveRequest(
            proposal_type="ui_element",
            element_id="CP-00005",
            payload={"_embedding": [0.3, 0.7, 0.5, 0.1]},
        )
        result = resolver.resolve(request)
        assert result.fast_path is True
        assert result.nearest_attractor is not None
        assert result.nearest_attractor.element_id == "CP-00005"

    def test_fast_path_miss_no_embedding(self):
        resolver = self._seeded_resolver()
        request = ResolveRequest(
            proposal_type="ui_element",
            element_id="CP-00005",
            payload={},
        )
        result = resolver.resolve(request)
        assert result.fast_path is False

    def test_no_memory_no_crash(self):
        resolver = BasicResolver(config=None, memory=None)
        request = ResolveRequest(
            proposal_type="ui_element",
            element_id="CP-00001",
            payload={"_embedding": [0.1, 0.2]},
        )
        result = resolver.resolve(request)
        assert result.fast_path is False
        assert result.nearest_attractor is None


# ---------------------------------------------------------------------------
# Available routes
# ---------------------------------------------------------------------------

class TestAvailableRoutes:
    def test_no_registries_returns_empty(self):
        resolver = BasicResolver()
        assert resolver.get_available_routes() == []

    def test_with_memory_only(self):
        fabric = InMemoryFabric()
        resolver = BasicResolver(memory=fabric)
        # Memory does not count as a route
        assert resolver.get_available_routes() == []


# ---------------------------------------------------------------------------
# Statelessness
# ---------------------------------------------------------------------------

class TestStatelessness:
    def test_resolve_does_not_mutate_memory(self):
        fabric = InMemoryFabric()
        entry = create_memory_entry(
            element_id="CP-00001", domain="ui",
            proposal={}, result="accepted", embedding=[0.5, 0.5],
        )
        fabric.record(entry)
        count_before = len(fabric.export_history())

        resolver = BasicResolver(config=None, memory=fabric)
        resolver.resolve(ResolveRequest(
            proposal_type="ui_element", element_id="CP-00001",
            payload={"_embedding": [0.5, 0.5]},
        ))

        count_after = len(fabric.export_history())
        assert count_before == count_after, "Resolver must not write to memory"
