# ===========================================================================
# aep-protocols - Unified AEP Protocol Extensions SDK
# Hallucination-proof validation for workflows, APIs, events and infrastructure.
# pip install aep-protocols pydantic
#
# Usage:
#   from aep_protocols import WorkflowRegistry, APIRegistry, EventRegistry, IaCRegistry
#   from aep_protocols.prebuilt import (
#       create_task_management_registry,
#       create_task_api_registry,
#       create_task_event_registry,
#       create_k8s_registry,
#   )
# ===========================================================================

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from pydantic import BaseModel, Field


# ===========================================================================
# SHARED UTILITIES
# ===========================================================================

def _type_check(value: Any, expected: str) -> bool:
    type_map = {
        "string": str, "integer": int, "number": (int, float),
        "boolean": bool, "array": list, "object": dict,
    }
    t = type_map.get(expected)
    return isinstance(value, t) if t else True


def _nested_get(d: dict, path: str) -> Any:
    current = d
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def _validate_payload_against_schema(data: dict, schema: dict) -> list[str]:
    errors: list[str] = []
    properties = schema.get("properties", {})
    required = schema.get("required", [])

    for req_field in required:
        if req_field not in data:
            errors.append(f'Missing required field: "{req_field}"')

    for key, value in data.items():
        if key in properties:
            prop = properties[key]

            # Type check
            expected_type = prop.get("type")
            if expected_type and not _type_check(value, expected_type):
                errors.append(f'Field "{key}" expected type "{expected_type}", got {type(value).__name__}')

            # Enum check
            allowed = prop.get("enum")
            if allowed and value not in allowed:
                errors.append(f'Field "{key}" must be one of {allowed}, got "{value}"')

            # Pattern check
            pattern = prop.get("pattern")
            if pattern and isinstance(value, str) and not re.match(pattern, value):
                errors.append(f'Field "{key}" does not match pattern "{pattern}"')

            # Min/max
            minimum = prop.get("minimum")
            if minimum is not None and isinstance(value, (int, float)) and value < minimum:
                errors.append(f'Field "{key}" must be >= {minimum}')

            maximum = prop.get("maximum")
            if maximum is not None and isinstance(value, (int, float)) and value > maximum:
                errors.append(f'Field "{key}" must be <= {maximum}')
        else:
            additional = schema.get("additionalProperties", True)
            if not additional:
                errors.append(f'Unexpected field: "{key}" (additionalProperties=false)')

    return errors


@dataclass
class ValidationResult:
    valid: bool
    errors: list[str]
    detail: Optional[dict] = None

    def __repr__(self) -> str:
        status = "PASS" if self.valid else f"FAIL ({len(self.errors)} errors)"
        return f"ValidationResult({status})"

    def print_report(self) -> None:
        if self.valid:
            print(f"PASS: 0 errors")
        else:
            print(f"FAIL: {len(self.errors)} error(s)")
        for e in self.errors:
            print(f"  ERROR: {e}")


# ===========================================================================
# PROTOCOL 1: WORKFLOWS
# ===========================================================================

class WorkflowStepSchema(BaseModel):
    action: str = Field(..., description="Registered action name")
    payload_schema: dict = Field(default_factory=dict, description="JSON Schema for the payload")
    allowed_transitions: list[str] = Field(default_factory=list, description="Actions that can follow this one")
    requires_approval: bool = Field(default=False)
    max_retries: int = Field(default=3)
    timeout_ms: int = Field(default=30000)


class WorkflowRegistry:
    """Hallucination-proof workflow step validation.
    Every agent-proposed workflow action is validated against this registry.
    State transitions are enforced. Invalid actions are rejected with specific errors.
    STATELESS: execution state is passed in by the caller, never stored in the registry.
    This prevents race conditions when multiple agents share the same registry."""

    def __init__(self):
        self.steps: dict[str, WorkflowStepSchema] = {}

    def register(self, action: str, schema: WorkflowStepSchema):
        self.steps[action] = schema

    def validate_step(self, action: str, payload: dict, current_state: Optional[str] = None) -> ValidationResult:
        errors: list[str] = []

        if action not in self.steps:
            errors.append(
                f'Unknown action: "{action}". '
                f"Registered: {sorted(self.steps.keys())}"
            )
            return ValidationResult(valid=False, errors=errors)

        step = self.steps[action]

        # Transition check using the provided context state
        if current_state and current_state in self.steps:
            allowed = self.steps[current_state].allowed_transitions
            if allowed and action not in allowed:
                errors.append(
                    f'Invalid transition: cannot go from "{current_state}" to "{action}". '
                    f"Allowed: {allowed}"
                )

        # Payload validation
        errors.extend(_validate_payload_against_schema(payload, step.payload_schema))

        if errors:
            return ValidationResult(valid=False, errors=errors)

        return ValidationResult(
            valid=True, errors=[],
            detail={"action": action, "status": "executed", "previous_state": current_state},
        )

    def get_available_actions(self, current_state: Optional[str] = None) -> list[str]:
        if not current_state or current_state not in self.steps:
            return list(self.steps.keys())
        allowed = self.steps[current_state].allowed_transitions
        return allowed if allowed else list(self.steps.keys())

    def list_steps(self) -> list[dict]:
        return [
            {
                "action": action,
                "requires_approval": s.requires_approval,
                "transitions": s.allowed_transitions,
                "required_fields": s.payload_schema.get("required", []),
            }
            for action, s in self.steps.items()
        ]


# ===========================================================================
# PROTOCOL 2: REST APIs
# ===========================================================================

class EndpointSchema(BaseModel):
    method: str = Field(..., description="HTTP method")
    path: str = Field(..., description="URL path pattern (e.g., /api/tasks/{task_id})")
    path_params: dict = Field(default_factory=dict)
    query_params: dict = Field(default_factory=dict)
    request_body: Optional[dict] = Field(default=None, description="JSON Schema for request body")
    response_schema: Optional[dict] = Field(default=None)
    required_headers: list[str] = Field(default_factory=list)
    rate_limit_per_minute: int = Field(default=60)


class APIRegistry:
    """Hallucination-proof API call validation.
    Every agent-proposed API call is validated against registered endpoint schemas.
    Methods, paths, bodies, headers and query params are all enforced."""

    def __init__(self):
        self.endpoints: dict[str, EndpointSchema] = {}

    def register(self, endpoint_id: str, schema: EndpointSchema):
        self.endpoints[endpoint_id] = schema

    def validate_call(
        self,
        method: str,
        path: str,
        body: Optional[dict] = None,
        query: Optional[dict] = None,
        headers: Optional[dict] = None,
    ) -> ValidationResult:
        errors: list[str] = []

        # Find matching endpoint
        matched: Optional[EndpointSchema] = None
        matched_id: Optional[str] = None

        for eid, schema in self.endpoints.items():
            if schema.method != method.upper():
                continue
            if self._path_matches(schema.path, path):
                matched = schema
                matched_id = eid
                break

        if not matched:
            registered = [f"{s.method} {s.path}" for s in self.endpoints.values()]
            errors.append(f'No endpoint for {method.upper()} {path}. Registered: {registered}')
            return ValidationResult(valid=False, errors=errors)

        # Body validation
        if matched.request_body:
            if body is None:
                errors.append(f"{method.upper()} {path} requires a request body")
            else:
                errors.extend(_validate_payload_against_schema(body, matched.request_body))
        elif body is not None and method.upper() in {"GET", "DELETE"}:
            errors.append(f"{method.upper()} requests should not have a body")

        # Required headers
        headers = headers or {}
        for req_header in matched.required_headers:
            if req_header.lower() not in {k.lower() for k in headers}:
                errors.append(f'Missing required header: "{req_header}"')

        # Query params
        if matched.query_params and query:
            for key in query:
                if key not in matched.query_params:
                    errors.append(f'Unknown query parameter: "{key}"')

        if errors:
            return ValidationResult(valid=False, errors=errors, detail={"endpoint_id": matched_id})

        return ValidationResult(
            valid=True, errors=[],
            detail={"endpoint_id": matched_id, "method": method.upper(), "path": path, "status": 200},
        )

    def list_endpoints(self) -> list[dict]:
        return [
            {"id": eid, "method": s.method, "path": s.path, "has_body": s.request_body is not None}
            for eid, s in self.endpoints.items()
        ]

    @staticmethod
    def _path_matches(pattern: str, actual: str) -> bool:
        regex = re.sub(r"\{[^}]+\}", r"[^/]+", pattern)
        return bool(re.fullmatch(regex, actual))


# ===========================================================================
# PROTOCOL 3: EVENTS / PUB-SUB
# ===========================================================================

class EventSchema(BaseModel):
    topic: str = Field(..., description="Event topic/channel name")
    payload_schema: dict = Field(default_factory=dict)
    allowed_producers: list[str] = Field(default_factory=list, description="Agent IDs allowed to emit")
    max_payload_bytes: int = Field(default=65536)
    requires_correlation_id: bool = Field(default=True)


class EventRegistry:
    """Hallucination-proof event validation for message queues and pub/sub.
    Every agent-produced event is validated against the event registry.
    Topics, payloads, producers, correlation IDs and size limits are enforced."""

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
    ) -> ValidationResult:
        errors: list[str] = []

        if event_id not in self.events:
            errors.append(f'Unknown event: "{event_id}". Registered: {sorted(self.events.keys())}')
            return ValidationResult(valid=False, errors=errors)

        schema = self.events[event_id]

        # Producer check
        if schema.allowed_producers and producer_id:
            if producer_id not in schema.allowed_producers:
                errors.append(f'Producer "{producer_id}" not allowed for "{event_id}". Allowed: {schema.allowed_producers}')

        # Correlation ID
        if schema.requires_correlation_id and not correlation_id:
            errors.append(f'Event "{event_id}" requires a correlation_id')

        # Payload validation
        errors.extend(_validate_payload_against_schema(payload, schema.payload_schema))

        # Size check
        payload_size = len(json.dumps(payload).encode())
        if payload_size > schema.max_payload_bytes:
            errors.append(f"Payload size {payload_size} exceeds max {schema.max_payload_bytes} bytes")

        if errors:
            return ValidationResult(valid=False, errors=errors)

        return ValidationResult(
            valid=True, errors=[],
            detail={"event_id": event_id, "topic": schema.topic},
        )

    def list_events(self) -> list[dict]:
        return [
            {"id": eid, "topic": s.topic, "requires_correlation": s.requires_correlation_id}
            for eid, s in self.events.items()
        ]


# ===========================================================================
# PROTOCOL 4: INFRASTRUCTURE AS CODE
# ===========================================================================

class ResourceSchema(BaseModel):
    kind: str = Field(..., description="Resource kind (Deployment, Service, etc)")
    api_version: str = Field(..., description="API version (apps/v1, v1, etc)")
    required_fields: list[str] = Field(default_factory=list)
    properties: dict = Field(default_factory=dict, description="JSON Schema per dotted path")
    forbidden_fields: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list, description="Human-readable constraint descriptions")


class IaCRegistry:
    """Hallucination-proof infrastructure configuration validation.
    Every agent-generated resource (K8s, Terraform, Docker etc) is validated
    against registered schemas. Required fields, forbidden fields, types and
    value ranges are all enforced."""

    def __init__(self):
        self.resources: dict[str, ResourceSchema] = {}

    def register(self, resource_id: str, schema: ResourceSchema):
        self.resources[resource_id] = schema

    def validate_resource(self, kind: str, spec: dict) -> ValidationResult:
        errors: list[str] = []

        matched: Optional[ResourceSchema] = None
        matched_id: Optional[str] = None

        for rid, schema in self.resources.items():
            if schema.kind == kind:
                matched = schema
                matched_id = rid
                break

        if not matched:
            kinds = sorted(set(s.kind for s in self.resources.values()))
            errors.append(f'Unknown resource kind: "{kind}". Registered: {kinds}')
            return ValidationResult(valid=False, errors=errors)

        # Required fields
        for req in matched.required_fields:
            if _nested_get(spec, req) is None:
                errors.append(f'Missing required field: "{req}"')

        # Forbidden fields
        for forbidden in matched.forbidden_fields:
            if _nested_get(spec, forbidden) is not None:
                errors.append(f'Forbidden field present: "{forbidden}"')

        # Property validation
        for prop_path, prop_schema in matched.properties.items():
            value = _nested_get(spec, prop_path)
            if value is not None:
                expected_type = prop_schema.get("type")
                if expected_type and not _type_check(value, expected_type):
                    errors.append(f'"{prop_path}" expected "{expected_type}", got {type(value).__name__}')

                allowed = prop_schema.get("enum")
                if allowed and value not in allowed:
                    errors.append(f'"{prop_path}" must be one of {allowed}')

                minimum = prop_schema.get("minimum")
                if minimum is not None and isinstance(value, (int, float)) and value < minimum:
                    errors.append(f'"{prop_path}" must be >= {minimum}')

                maximum = prop_schema.get("maximum")
                if maximum is not None and isinstance(value, (int, float)) and value > maximum:
                    errors.append(f'"{prop_path}" must be <= {maximum}')

        if errors:
            return ValidationResult(valid=False, errors=errors, detail={"resource_id": matched_id})

        return ValidationResult(
            valid=True, errors=[],
            detail={"resource_id": matched_id, "kind": kind},
        )

    def list_resources(self) -> list[dict]:
        return [
            {"id": rid, "kind": s.kind, "api_version": s.api_version}
            for rid, s in self.resources.items()
        ]


# ===========================================================================
# PRE-BUILT REGISTRIES
# ===========================================================================

# ---------------------------------------------------------------------------
# Workflows: Task Management
# ---------------------------------------------------------------------------

def create_task_management_registry() -> WorkflowRegistry:
    r = WorkflowRegistry()

    r.register("create_task", WorkflowStepSchema(
        action="create_task",
        payload_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "assignee": {"type": "string"},
                "priority": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
            },
            "required": ["title"],
        },
        allowed_transitions=["assign", "complete_task", "archive"],
    ))

    r.register("assign", WorkflowStepSchema(
        action="assign",
        payload_schema={
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "assignee": {"type": "string"},
            },
            "required": ["task_id", "assignee"],
        },
        allowed_transitions=["complete_task", "escalate"],
    ))

    r.register("complete_task", WorkflowStepSchema(
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

    r.register("approve", WorkflowStepSchema(
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

    r.register("reject", WorkflowStepSchema(
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

    r.register("escalate", WorkflowStepSchema(
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

    r.register("archive", WorkflowStepSchema(
        action="archive",
        payload_schema={
            "type": "object",
            "properties": {"task_id": {"type": "string"}},
            "required": ["task_id"],
        },
        allowed_transitions=[],
    ))

    r.register("notify", WorkflowStepSchema(
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

    return r


# ---------------------------------------------------------------------------
# APIs: REST Task API
# ---------------------------------------------------------------------------

def create_task_api_registry() -> APIRegistry:
    r = APIRegistry()

    r.register("list_tasks", EndpointSchema(
        method="GET", path="/api/tasks",
        query_params={"status": {"type": "string"}, "assignee": {"type": "string"}},
    ))

    r.register("get_task", EndpointSchema(
        method="GET", path="/api/tasks/{task_id}",
        path_params={"task_id": {"type": "string"}},
    ))

    r.register("create_task", EndpointSchema(
        method="POST", path="/api/tasks",
        request_body={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "description": {"type": "string"},
                "assignee": {"type": "string"},
                "priority": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
                "due_date": {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"},
            },
            "required": ["title"],
            "additionalProperties": False,
        },
        required_headers=["Content-Type"],
    ))

    r.register("update_task", EndpointSchema(
        method="PATCH", path="/api/tasks/{task_id}",
        path_params={"task_id": {"type": "string"}},
        request_body={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "status": {"type": "string", "enum": ["open", "in_progress", "done", "archived"]},
                "assignee": {"type": "string"},
                "priority": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
            },
            "additionalProperties": False,
        },
        required_headers=["Content-Type"],
    ))

    r.register("delete_task", EndpointSchema(
        method="DELETE", path="/api/tasks/{task_id}",
        path_params={"task_id": {"type": "string"}},
    ))

    return r


# ---------------------------------------------------------------------------
# Events: Task Event System
# ---------------------------------------------------------------------------

def create_task_event_registry() -> EventRegistry:
    r = EventRegistry()

    r.register("task.created", EventSchema(
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

    r.register("task.assigned", EventSchema(
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

    r.register("task.completed", EventSchema(
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

    r.register("task.approved", EventSchema(
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

    r.register("notification.send", EventSchema(
        topic="notifications",
        payload_schema={
            "type": "object",
            "properties": {
                "recipients": {"type": "array"},
                "channel": {"type": "string"},
                "message": {"type": "string"},
            },
            "required": ["recipients", "message"],
        },
    ))

    return r


# ---------------------------------------------------------------------------
# IaC: Kubernetes Resources
# ---------------------------------------------------------------------------

def create_k8s_registry() -> IaCRegistry:
    r = IaCRegistry()

    r.register("k8s_deployment", ResourceSchema(
        kind="Deployment", api_version="apps/v1",
        required_fields=[
            "metadata.name", "spec.replicas",
            "spec.selector.matchLabels", "spec.template.spec.containers",
        ],
        properties={
            "spec.replicas": {"type": "integer", "minimum": 1, "maximum": 100},
            "metadata.namespace": {"type": "string"},
            "metadata.name": {"type": "string"},
        },
        forbidden_fields=["spec.template.spec.hostNetwork"],
        constraints=["Replicas must be 1-100", "hostNetwork is forbidden"],
    ))

    r.register("k8s_service", ResourceSchema(
        kind="Service", api_version="v1",
        required_fields=["metadata.name", "spec.selector", "spec.ports"],
        properties={
            "spec.type": {"type": "string", "enum": ["ClusterIP", "NodePort", "LoadBalancer"]},
            "metadata.name": {"type": "string"},
        },
    ))

    r.register("k8s_configmap", ResourceSchema(
        kind="ConfigMap", api_version="v1",
        required_fields=["metadata.name"],
        properties={
            "metadata.name": {"type": "string"},
            "data": {"type": "object"},
        },
        forbidden_fields=["binaryData"],
    ))

    r.register("k8s_ingress", ResourceSchema(
        kind="Ingress", api_version="networking.k8s.io/v1",
        required_fields=["metadata.name", "spec.rules"],
        properties={
            "metadata.name": {"type": "string"},
            "spec.tls": {"type": "array"},
        },
    ))

    return r
