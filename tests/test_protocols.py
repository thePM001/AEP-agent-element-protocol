"""
Tests for sdk-aep-protocols.py (Protocol Extensions).
Run: python -m pytest tests/test_protocols.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sdk"))

from importlib.util import spec_from_file_location, module_from_spec

sdk_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sdk")
proto_spec = spec_from_file_location("sdk_aep_protocols", os.path.join(sdk_dir, "sdk-aep-protocols.py"))
proto_mod = module_from_spec(proto_spec)
sys.modules["sdk_aep_protocols"] = proto_mod
proto_spec.loader.exec_module(proto_mod)

WorkflowRegistry = proto_mod.WorkflowRegistry
APIRegistry = proto_mod.APIRegistry
EventRegistry = proto_mod.EventRegistry
IaCRegistry = proto_mod.IaCRegistry
ValidationResult = proto_mod.ValidationResult

# Prebuilt factories
create_task_management_registry = proto_mod.create_task_management_registry
create_task_api_registry = proto_mod.create_task_api_registry
create_task_event_registry = proto_mod.create_task_event_registry
create_k8s_registry = proto_mod.create_k8s_registry

import pytest


# ---------------------------------------------------------------------------
# WorkflowRegistry
# ---------------------------------------------------------------------------

class TestWorkflowRegistry:
    def _make_registry(self):
        return create_task_management_registry()

    def test_valid_action(self):
        reg = self._make_registry()
        result = reg.validate_step("create_task", {"title": "Test"})
        assert result.valid, f"Expected valid but got: {result.errors}"

    def test_invalid_action(self):
        reg = self._make_registry()
        result = reg.validate_step("nonexistent_action", {})
        assert not result.valid

    def test_state_transition(self):
        reg = self._make_registry()
        # create_task should have allowed transitions
        if hasattr(reg, "steps") and "create_task" in reg.steps:
            step = reg.steps["create_task"]
            assert step.allowed_transitions is not None

    def test_available_actions(self):
        reg = self._make_registry()
        if hasattr(reg, "get_available_actions"):
            actions = reg.get_available_actions("create_task")
            assert isinstance(actions, list)


# ---------------------------------------------------------------------------
# APIRegistry
# ---------------------------------------------------------------------------

class TestAPIRegistry:
    def _make_registry(self):
        return create_task_api_registry()

    def test_valid_call(self):
        reg = self._make_registry()
        result = reg.validate_call(
            "POST", "/api/tasks", body={"title": "Test"},
            headers={"Content-Type": "application/json"},
        )
        assert result.valid, f"Expected valid but got: {result.errors}"

    def test_invalid_method(self):
        reg = self._make_registry()
        result = reg.validate_call("PATCH", "/api/nonexistent", body={})
        assert not result.valid

    def test_list_endpoints(self):
        reg = self._make_registry()
        endpoints = reg.list_endpoints()
        assert isinstance(endpoints, list)
        assert len(endpoints) > 0


# ---------------------------------------------------------------------------
# EventRegistry
# ---------------------------------------------------------------------------

class TestEventRegistry:
    def _make_registry(self):
        return create_task_event_registry()

    def test_valid_event(self):
        reg = self._make_registry()
        result = reg.validate_event(
            "task.created",
            {"task_id": "T-001", "title": "Test", "created_by": "user"},
            correlation_id="corr-001",
        )
        assert result.valid, f"Expected valid but got: {result.errors}"

    def test_invalid_event(self):
        reg = self._make_registry()
        result = reg.validate_event("nonexistent.event", {})
        assert not result.valid

    def test_list_events(self):
        reg = self._make_registry()
        events = reg.list_events()
        assert isinstance(events, list)
        assert len(events) > 0


# ---------------------------------------------------------------------------
# IaCRegistry
# ---------------------------------------------------------------------------

class TestIaCRegistry:
    def _make_registry(self):
        return create_k8s_registry()

    def test_valid_resource(self):
        reg = self._make_registry()
        result = reg.validate_resource("Deployment", {
            "metadata": {"name": "test"},
            "spec": {
                "replicas": 1,
                "selector": {"matchLabels": {"app": "test"}},
                "template": {"spec": {"containers": [{"name": "c", "image": "img"}]}},
            },
        })
        assert result.valid, f"Expected valid but got: {result.errors}"

    def test_invalid_kind(self):
        reg = self._make_registry()
        result = reg.validate_resource("InvalidKind", {})
        assert not result.valid

    def test_list_resources(self):
        reg = self._make_registry()
        resources = reg.list_resources()
        assert isinstance(resources, list)
        assert len(resources) > 0
