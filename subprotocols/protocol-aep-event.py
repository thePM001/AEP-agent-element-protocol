# ===========================================================================
# AEP Event Extension
# Hallucination-proof event validation for message queues and pub/sub.
# Every agent-produced event is validated against the event registry.
# ===========================================================================

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Event Schema Registry
# ---------------------------------------------------------------------------

class EventSchema(BaseModel):
    topic: str = Field(..., description="Event topic/channel name")
    payload_schema: dict = Field(default_factory=dict, description="JSON Schema for the event payload")
    allowed_producers: list[str] = Field(default_factory=list, description="Agent IDs allowed to emit this event")
    max_payload_bytes: int = Field(default=65536)
    requires_correlation_id: bool = Field(default=True)


class EventRegistry:
    def __init__(self):
        self.events: dict[str, EventSchema] = {}

    def register(self, event_id: str, schema: EventSchema):
        self.events[event_id] = schema

    def validate_event(
        self,
        event_id: str,
        payload: dict,
        producer_id: Optional[str] = None,
        correlation_id: Optional[str] = None,
    ) -> dict:
        errors: list[str] = []

        if event_id not in self.events:
            errors.append(
                f'Unknown event: "{event_id}". '
                f"Registered: {sorted(self.events.keys())}"
            )
            return {"valid": False, "errors": errors}

        schema = self.events[event_id]

        # Producer check
        if schema.allowed_producers and producer_id:
            if producer_id not in schema.allowed_producers:
                errors.append(
                    f'Producer "{producer_id}" not allowed for event "{event_id}". '
                    f"Allowed: {schema.allowed_producers}"
                )

        # Correlation ID
        if schema.requires_correlation_id and not correlation_id:
            errors.append(f'Event "{event_id}" requires a correlation_id')

        # Payload schema validation
        required = schema.payload_schema.get("required", [])
        properties = schema.payload_schema.get("properties", {})

        for req_field in required:
            if req_field not in payload:
                errors.append(f'Missing required field: "{req_field}"')

        for key, value in payload.items():
            if key in properties:
                expected_type = properties[key].get("type")
                if expected_type and not _type_check(value, expected_type):
                    errors.append(f'Field "{key}" expected "{expected_type}", got {type(value).__name__}')

        # Size check
        import json
        payload_size = len(json.dumps(payload).encode())
        if payload_size > schema.max_payload_bytes:
            errors.append(f"Payload size {payload_size} exceeds max {schema.max_payload_bytes} bytes")

        if errors:
            return {"valid": False, "errors": errors}

        return {"valid": True, "event_id": event_id, "topic": schema.topic, "errors": None}

    def list_events(self) -> list[dict]:
        return [
            {"id": eid, "topic": s.topic, "requires_correlation": s.requires_correlation_id}
            for eid, s in self.events.items()
        ]


def _type_check(value: Any, expected: str) -> bool:
    type_map = {
        "string": str, "integer": int, "number": (int, float),
        "boolean": bool, "array": list, "object": dict,
    }
    t = type_map.get(expected)
    return isinstance(value, t) if t else True


# ---------------------------------------------------------------------------
# Pre-built registry: Task Management Events
# ---------------------------------------------------------------------------

def create_task_event_registry() -> EventRegistry:
    registry = EventRegistry()

    registry.register("task.created", EventSchema(
        topic="tasks",
        payload_schema={
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "title": {"type": "string"},
                "created_by": {"type": "string"},
            },
            "required": ["task_id", "title", "created_by"],
        },
    ))

    registry.register("task.assigned", EventSchema(
        topic="tasks",
        payload_schema={
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "assignee": {"type": "string"},
                "assigned_by": {"type": "string"},
            },
            "required": ["task_id", "assignee"],
        },
    ))

    registry.register("task.completed", EventSchema(
        topic="tasks",
        payload_schema={
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "result": {"type": "string"},
                "completed_by": {"type": "string"},
            },
            "required": ["task_id"],
        },
    ))

    registry.register("task.approved", EventSchema(
        topic="tasks",
        payload_schema={
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "approver": {"type": "string"},
            },
            "required": ["task_id", "approver"],
        },
    ))

    registry.register("notification.send", EventSchema(
        topic="notifications",
        payload_schema={
            "type": "object",
            "properties": {
                "recipients": {"type": "array"},
                "channel": {"type": "string"},
                "message": {"type": "string"},
                "priority": {"type": "string"},
            },
            "required": ["recipients", "message"],
        },
    ))

    return registry
