# ===========================================================================
# AEP Workflow Extension
# Hallucination-proof workflow step validation.
# Every agent-proposed workflow action is validated against this registry.
# pip install aep pyyaml
# ===========================================================================

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Workflow Step Registry (the topological matrix for workflows)
# ---------------------------------------------------------------------------

class WorkflowStepSchema(BaseModel):
    """Every workflow step must match a registered schema."""
    action: str = Field(..., description="Registered action name")
    payload_schema: dict = Field(default_factory=dict, description="JSON Schema for the payload")
    allowed_transitions: list[str] = Field(default_factory=list, description="Actions that can follow this one")
    requires_approval: bool = Field(default=False)
    max_retries: int = Field(default=3)
    timeout_ms: int = Field(default=30000)


class WorkflowRegistry:
    def __init__(self):
        self.steps: dict[str, WorkflowStepSchema] = {}
        self.current_state: Optional[str] = None

    def register(self, action: str, schema: WorkflowStepSchema):
        self.steps[action] = schema

    def validate_step(self, action: str, payload: dict) -> dict:
        errors: list[str] = []

        # Action must exist
        if action not in self.steps:
            errors.append(
                f'Unknown action: "{action}". '
                f"Registered: {sorted(self.steps.keys())}"
            )
            return {"valid": False, "errors": errors}

        step = self.steps[action]

        # Transition check
        if self.current_state and self.current_state in self.steps:
            allowed = self.steps[self.current_state].allowed_transitions
            if allowed and action not in allowed:
                errors.append(
                    f'Invalid transition: cannot go from "{self.current_state}" to "{action}". '
                    f"Allowed: {allowed}"
                )

        # Payload schema check (basic type/required validation)
        required = step.payload_schema.get("required", [])
        properties = step.payload_schema.get("properties", {})
        for req_field in required:
            if req_field not in payload:
                errors.append(f'Missing required field: "{req_field}" in payload')

        for key, value in payload.items():
            if key in properties:
                expected_type = properties[key].get("type")
                if expected_type and not _type_matches(value, expected_type):
                    errors.append(
                        f'Field "{key}" expected type "{expected_type}", '
                        f"got {type(value).__name__}"
                    )

        if errors:
            return {"valid": False, "errors": errors}

        # Update state
        self.current_state = action
        return {"valid": True, "action": action, "status": "executed", "errors": None}

    def get_available_actions(self) -> list[str]:
        if not self.current_state or self.current_state not in self.steps:
            return list(self.steps.keys())
        allowed = self.steps[self.current_state].allowed_transitions
        return allowed if allowed else list(self.steps.keys())

    def reset(self):
        self.current_state = None


def _type_matches(value: Any, expected: str) -> bool:
    type_map = {
        "string": str, "integer": int, "number": (int, float),
        "boolean": bool, "array": list, "object": dict,
    }
    expected_type = type_map.get(expected)
    if expected_type is None:
        return True
    return isinstance(value, expected_type)


# ---------------------------------------------------------------------------
# Pre-built registries for common workflows
# ---------------------------------------------------------------------------

def create_task_management_registry() -> WorkflowRegistry:
    registry = WorkflowRegistry()

    registry.register("create_task", WorkflowStepSchema(
        action="create_task",
        payload_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "assignee": {"type": "string"},
                "priority": {"type": "string"},
            },
            "required": ["title"],
        },
        allowed_transitions=["assign", "complete_task", "archive"],
    ))

    registry.register("assign", WorkflowStepSchema(
        action="assign",
        payload_schema={
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "assignee": {"type": "string"},
            },
            "required": ["task_id", "assignee"],
        },
        allowed_transitions=["complete_task", "escalate", "reassign"],
    ))

    registry.register("complete_task", WorkflowStepSchema(
        action="complete_task",
        payload_schema={
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "result": {"type": "string"},
            },
            "required": ["task_id"],
        },
        allowed_transitions=["approve", "reject"],
    ))

    registry.register("approve", WorkflowStepSchema(
        action="approve",
        payload_schema={
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "approver": {"type": "string"},
            },
            "required": ["task_id"],
        },
        requires_approval=True,
        allowed_transitions=["archive", "notify"],
    ))

    registry.register("reject", WorkflowStepSchema(
        action="reject",
        payload_schema={
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "reason": {"type": "string"},
            },
            "required": ["task_id", "reason"],
        },
        allowed_transitions=["assign", "escalate"],
    ))

    registry.register("escalate", WorkflowStepSchema(
        action="escalate",
        payload_schema={
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "escalate_to": {"type": "string"},
                "reason": {"type": "string"},
            },
            "required": ["task_id", "escalate_to"],
        },
        allowed_transitions=["assign", "approve", "reject"],
    ))

    registry.register("archive", WorkflowStepSchema(
        action="archive",
        payload_schema={
            "type": "object",
            "properties": {"task_id": {"type": "string"}},
            "required": ["task_id"],
        },
        allowed_transitions=[],  # terminal state
    ))

    registry.register("notify", WorkflowStepSchema(
        action="notify",
        payload_schema={
            "type": "object",
            "properties": {
                "recipients": {"type": "array"},
                "message": {"type": "string"},
            },
            "required": ["recipients", "message"],
        },
        allowed_transitions=["archive"],
    ))

    return registry
