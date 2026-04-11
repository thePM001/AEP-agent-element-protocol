# ===========================================================================
# AEP API Extension
# Hallucination-proof API call validation.
# Every agent-proposed API call is validated against registered endpoint schemas.
# pip install aep pyyaml
# ===========================================================================

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# API Endpoint Registry (the topological matrix for APIs)
# ---------------------------------------------------------------------------

class EndpointSchema(BaseModel):
    """Every API endpoint must be registered with its full schema."""
    method: str = Field(..., description="HTTP method (GET, POST, PUT, PATCH, DELETE)")
    path: str = Field(..., description="URL path pattern (e.g., /api/tasks/{task_id})")
    path_params: dict = Field(default_factory=dict, description="Path parameter types")
    query_params: dict = Field(default_factory=dict, description="Query parameter types")
    request_body: Optional[dict] = Field(default=None, description="JSON Schema for request body")
    response_schema: Optional[dict] = Field(default=None, description="JSON Schema for response")
    required_headers: list[str] = Field(default_factory=list)
    rate_limit_per_minute: int = Field(default=60)


class APIRegistry:
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
    ) -> dict:
        errors: list[str] = []

        # Find matching endpoint
        matched_endpoint: Optional[EndpointSchema] = None
        matched_id: Optional[str] = None

        for eid, schema in self.endpoints.items():
            if schema.method != method.upper():
                continue
            if self._path_matches(schema.path, path):
                matched_endpoint = schema
                matched_id = eid
                break

        if not matched_endpoint:
            registered = [
                f"{s.method} {s.path}" for s in self.endpoints.values()
            ]
            errors.append(
                f'No registered endpoint for {method.upper()} {path}. '
                f"Registered: {registered}"
            )
            return {"valid": False, "endpoint_id": None, "errors": errors}

        # Body validation
        if matched_endpoint.request_body:
            if body is None:
                errors.append(f"{method.upper()} {path} requires a request body")
            else:
                body_errors = self._validate_against_schema(body, matched_endpoint.request_body)
                errors.extend(body_errors)
        elif body is not None and method.upper() in {"GET", "DELETE"}:
            errors.append(f"{method.upper()} requests should not have a body")

        # Required headers
        headers = headers or {}
        for req_header in matched_endpoint.required_headers:
            if req_header.lower() not in {k.lower() for k in headers}:
                errors.append(f'Missing required header: "{req_header}"')

        # Query params
        if matched_endpoint.query_params and query:
            for key, value in query.items():
                if key not in matched_endpoint.query_params:
                    errors.append(f'Unknown query parameter: "{key}"')

        if errors:
            return {"valid": False, "endpoint_id": matched_id, "errors": errors}

        return {
            "valid": True,
            "endpoint_id": matched_id,
            "method": method.upper(),
            "path": path,
            "status": 200,
            "errors": None,
        }

    def list_endpoints(self) -> list[dict]:
        return [
            {
                "id": eid,
                "method": schema.method,
                "path": schema.path,
                "has_body": schema.request_body is not None,
                "required_headers": schema.required_headers,
            }
            for eid, schema in self.endpoints.items()
        ]

    @staticmethod
    def _path_matches(pattern: str, actual: str) -> bool:
        regex = re.sub(r"\{[^}]+\}", r"[^/]+", pattern)
        return bool(re.fullmatch(regex, actual))

    @staticmethod
    def _validate_against_schema(data: dict, schema: dict) -> list[str]:
        errors: list[str] = []
        properties = schema.get("properties", {})
        required = schema.get("required", [])

        for req_field in required:
            if req_field not in data:
                errors.append(f'Missing required field: "{req_field}"')

        for key, value in data.items():
            if key in properties:
                expected_type = properties[key].get("type")
                if expected_type and not _type_check(value, expected_type):
                    errors.append(
                        f'Field "{key}" expected type "{expected_type}", '
                        f"got {type(value).__name__}"
                    )

                # Enum check
                allowed = properties[key].get("enum")
                if allowed and value not in allowed:
                    errors.append(f'Field "{key}" must be one of {allowed}, got "{value}"')

                # Pattern check
                pattern = properties[key].get("pattern")
                if pattern and isinstance(value, str) and not re.match(pattern, value):
                    errors.append(f'Field "{key}" does not match pattern "{pattern}"')
            else:
                additional = schema.get("additionalProperties", True)
                if not additional:
                    errors.append(f'Unexpected field: "{key}" (additionalProperties=false)')

        return errors


def _type_check(value: Any, expected: str) -> bool:
    type_map = {
        "string": str, "integer": int, "number": (int, float),
        "boolean": bool, "array": list, "object": dict,
    }
    t = type_map.get(expected)
    return isinstance(value, t) if t else True


# ---------------------------------------------------------------------------
# Pre-built registry: REST Task API
# ---------------------------------------------------------------------------

def create_task_api_registry() -> APIRegistry:
    registry = APIRegistry()

    registry.register("list_tasks", EndpointSchema(
        method="GET",
        path="/api/tasks",
        query_params={"status": {"type": "string"}, "assignee": {"type": "string"}},
    ))

    registry.register("get_task", EndpointSchema(
        method="GET",
        path="/api/tasks/{task_id}",
        path_params={"task_id": {"type": "string"}},
    ))

    registry.register("create_task", EndpointSchema(
        method="POST",
        path="/api/tasks",
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

    registry.register("update_task", EndpointSchema(
        method="PATCH",
        path="/api/tasks/{task_id}",
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

    registry.register("delete_task", EndpointSchema(
        method="DELETE",
        path="/api/tasks/{task_id}",
        path_params={"task_id": {"type": "string"}},
    ))

    return registry
