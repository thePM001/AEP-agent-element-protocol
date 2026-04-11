# ===========================================================================
# AEP IaC Extension
# Hallucination-proof infrastructure configuration validation.
# Every agent-generated config (K8s, Terraform, Docker etc) is validated
# against registered resource schemas.
# ===========================================================================

from __future__ import annotations

import re
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Resource Schema Registry
# ---------------------------------------------------------------------------

class ResourceSchema(BaseModel):
    kind: str = Field(..., description="Resource kind (Deployment, Service, ConfigMap, etc)")
    api_version: str = Field(..., description="API version (apps/v1, v1, etc)")
    required_fields: list[str] = Field(default_factory=list)
    properties: dict = Field(default_factory=dict, description="JSON Schema for the resource spec")
    forbidden_fields: list[str] = Field(default_factory=list, description="Fields that must never appear")
    constraints: list[str] = Field(default_factory=list, description="Human-readable constraint descriptions")


class IaCRegistry:
    def __init__(self):
        self.resources: dict[str, ResourceSchema] = {}

    def register(self, resource_id: str, schema: ResourceSchema):
        self.resources[resource_id] = schema

    def validate_resource(self, kind: str, spec: dict) -> dict:
        errors: list[str] = []

        # Find matching resource schema
        matched: Optional[ResourceSchema] = None
        matched_id: Optional[str] = None

        for rid, schema in self.resources.items():
            if schema.kind == kind:
                matched = schema
                matched_id = rid
                break

        if not matched:
            errors.append(
                f'Unknown resource kind: "{kind}". '
                f"Registered: {sorted(set(s.kind for s in self.resources.values()))}"
            )
            return {"valid": False, "resource_id": None, "errors": errors}

        # Required fields
        for req in matched.required_fields:
            if not _nested_get(spec, req):
                errors.append(f'Missing required field: "{req}"')

        # Forbidden fields
        for forbidden in matched.forbidden_fields:
            if _nested_get(spec, forbidden) is not None:
                errors.append(f'Forbidden field present: "{forbidden}"')

        # Property type checks
        for prop_path, prop_schema in matched.properties.items():
            value = _nested_get(spec, prop_path)
            if value is not None:
                expected_type = prop_schema.get("type")
                if expected_type and not _type_check(value, expected_type):
                    errors.append(f'"{prop_path}" expected "{expected_type}", got {type(value).__name__}')

                # Enum
                allowed = prop_schema.get("enum")
                if allowed and value not in allowed:
                    errors.append(f'"{prop_path}" must be one of {allowed}')

                # Min/max
                minimum = prop_schema.get("minimum")
                if minimum is not None and isinstance(value, (int, float)) and value < minimum:
                    errors.append(f'"{prop_path}" must be >= {minimum}')

                maximum = prop_schema.get("maximum")
                if maximum is not None and isinstance(value, (int, float)) and value > maximum:
                    errors.append(f'"{prop_path}" must be <= {maximum}')

        if errors:
            return {"valid": False, "resource_id": matched_id, "errors": errors}

        return {"valid": True, "resource_id": matched_id, "kind": kind, "errors": None}

    def list_resources(self) -> list[dict]:
        return [
            {"id": rid, "kind": s.kind, "api_version": s.api_version}
            for rid, s in self.resources.items()
        ]


def _nested_get(d: dict, path: str) -> Any:
    parts = path.split(".")
    current = d
    for part in parts:
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def _type_check(value: Any, expected: str) -> bool:
    type_map = {
        "string": str, "integer": int, "number": (int, float),
        "boolean": bool, "array": list, "object": dict,
    }
    t = type_map.get(expected)
    return isinstance(value, t) if t else True


# ---------------------------------------------------------------------------
# Pre-built registry: Kubernetes resources
# ---------------------------------------------------------------------------

def create_k8s_registry() -> IaCRegistry:
    registry = IaCRegistry()

    registry.register("k8s_deployment", ResourceSchema(
        kind="Deployment",
        api_version="apps/v1",
        required_fields=[
            "metadata.name",
            "spec.replicas",
            "spec.selector.matchLabels",
            "spec.template.spec.containers",
        ],
        properties={
            "spec.replicas": {"type": "integer", "minimum": 1, "maximum": 100},
            "metadata.namespace": {"type": "string"},
            "metadata.name": {"type": "string"},
        },
        forbidden_fields=["spec.template.spec.hostNetwork"],
        constraints=[
            "Replicas must be between 1 and 100",
            "hostNetwork is forbidden for security",
        ],
    ))

    registry.register("k8s_service", ResourceSchema(
        kind="Service",
        api_version="v1",
        required_fields=["metadata.name", "spec.selector", "spec.ports"],
        properties={
            "spec.type": {"type": "string", "enum": ["ClusterIP", "NodePort", "LoadBalancer"]},
            "metadata.name": {"type": "string"},
        },
        constraints=["Service type must be ClusterIP, NodePort or LoadBalancer"],
    ))

    registry.register("k8s_configmap", ResourceSchema(
        kind="ConfigMap",
        api_version="v1",
        required_fields=["metadata.name"],
        properties={
            "metadata.name": {"type": "string"},
            "data": {"type": "object"},
        },
        forbidden_fields=["binaryData"],
        constraints=["binaryData is forbidden; use data only"],
    ))

    registry.register("k8s_ingress", ResourceSchema(
        kind="Ingress",
        api_version="networking.k8s.io/v1",
        required_fields=["metadata.name", "spec.rules"],
        properties={
            "metadata.name": {"type": "string"},
            "spec.tls": {"type": "array"},
        },
        constraints=["TLS should be configured for production"],
    ))

    return registry
