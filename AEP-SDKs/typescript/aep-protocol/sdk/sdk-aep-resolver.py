# ===========================================================================
# @aep/resolver - AEP Basic Resolver v2.0
# Deterministic routing of agent proposals to the correct validator pipeline.
#
# Read-only, stateless resolver. Never modifies scene graph, registries or
# memory. All state is passed in through ResolveRequest and constructor args.
#
# Usage:
#   from sdk_aep_resolver import BasicResolver, ResolveRequest
#   resolver = BasicResolver(config=aep_config, workflow_registry=wf_reg)
#   result = resolver.resolve(ResolveRequest(
#       proposal_type="workflow_step",
#       action="create_task",
#       payload={"title": "Fix bug"},
#   ))
# ===========================================================================

from __future__ import annotations

import sys
import os
from dataclasses import dataclass, field
from typing import Any, Literal, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------------------
# Dynamic imports from sibling SDK modules (hyphenated filenames)
# ---------------------------------------------------------------------------

try:
    from importlib.util import spec_from_file_location, module_from_spec
    _sdk_dir = os.path.dirname(os.path.abspath(__file__))

    # Import from sdk-aep-protocols.py
    _proto_spec = spec_from_file_location(
        "sdk_aep_protocols", os.path.join(_sdk_dir, "sdk-aep-protocols.py")
    )
    _proto_mod = module_from_spec(_proto_spec)
    _proto_spec.loader.exec_module(_proto_mod)
    WorkflowRegistry = _proto_mod.WorkflowRegistry
    APIRegistry = _proto_mod.APIRegistry
    EventRegistry = _proto_mod.EventRegistry
    IaCRegistry = _proto_mod.IaCRegistry
    ValidationResult = _proto_mod.ValidationResult

    # Import from sdk-aep-python.py
    _py_spec = spec_from_file_location(
        "sdk_aep_python", os.path.join(_sdk_dir, "sdk-aep-python.py")
    )
    _py_mod = module_from_spec(_py_spec)
    _py_spec.loader.exec_module(_py_mod)
    AEPConfig = _py_mod.AEPConfig
    prefix_from_id = _py_mod.prefix_from_id
    z_band_for_prefix = _py_mod.z_band_for_prefix
except Exception:
    # Graceful degradation if imports fail
    WorkflowRegistry = None
    APIRegistry = None
    EventRegistry = None
    IaCRegistry = None
    AEPConfig = None
    prefix_from_id = None
    z_band_for_prefix = None
    ValidationResult = None

try:
    _mem_spec = spec_from_file_location(
        "sdk_aep_memory", os.path.join(_sdk_dir, "sdk-aep-memory.py")
    )
    _mem_mod = module_from_spec(_mem_spec)
    _mem_spec.loader.exec_module(_mem_mod)
    MemoryFabric = _mem_mod.MemoryFabric
    MemoryEntry = _mem_mod.MemoryEntry
except Exception:
    MemoryFabric = None
    MemoryEntry = None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

__all__ = [
    "ResolveRequest",
    "ResolveResult",
    "BasicResolver",
]


# ---------------------------------------------------------------------------
# Route Constants
# ---------------------------------------------------------------------------

_PROPOSAL_ROUTE_MAP: dict[str, str] = {
    "ui_element": "ui",
    "workflow_step": "workflow",
    "api_call": "api",
    "event": "event",
    "iac_resource": "iac",
}

_VALID_ROUTES = frozenset(_PROPOSAL_ROUTE_MAP.values())


# ---------------------------------------------------------------------------
# Data Classes
# ---------------------------------------------------------------------------

@dataclass
class ResolveRequest:
    """An agent's proposal to be routed to the correct validator pipeline.

    Attributes:
        proposal_type: Domain of the proposal. Determines which validator
            pipeline the resolver routes to.
        element_id: AEP element ID (required for ui_element proposals).
        action: Action name (required for workflow_step proposals).
        payload: Arbitrary payload dict passed to the domain validator.
        current_state: Current workflow state for transition validation.
        agent_id: Identifier of the proposing agent (used for event
            producer checks and memory attractor lookups).
    """

    proposal_type: Literal[
        "ui_element", "workflow_step", "api_call", "event", "iac_resource"
    ]
    element_id: Optional[str] = None
    action: Optional[str] = None
    payload: dict = field(default_factory=dict)
    current_state: Optional[str] = None
    agent_id: Optional[str] = None


@dataclass
class ResolveResult:
    """The resolver's routing decision and associated metadata.

    Attributes:
        route: Target validator domain ("ui", "workflow", "api", "event",
            "iac").
        constraints: List of constraint strings applicable to this proposal
            from the relevant registry.
        policy_pass: Whether the proposal passes initial policy checks.
            False does not block dispatch; it signals that the downstream
            validator is expected to reject.
        policy_errors: Specific policy violations detected during routing.
        available_actions: For workflow proposals, the set of valid next
            actions from the current state. For UI proposals, the actions
            registered on the element.
        nearest_attractor: If memory is available, the closest matching
            MemoryEntry for fast-path resolution.
        fast_path: True if a memory attractor was found, indicating the
            proposal matches a previously validated pattern.
    """

    route: str
    constraints: list[str] = field(default_factory=list)
    policy_pass: bool = True
    policy_errors: list[str] = field(default_factory=list)
    available_actions: list[str] = field(default_factory=list)
    nearest_attractor: Optional[Any] = None
    fast_path: bool = False

    def __repr__(self) -> str:
        fp = " FAST-PATH" if self.fast_path else ""
        status = "PASS" if self.policy_pass else f"FAIL ({len(self.policy_errors)} errors)"
        return f"ResolveResult(route={self.route}, {status}{fp})"


# ---------------------------------------------------------------------------
# BasicResolver
# ---------------------------------------------------------------------------

class BasicResolver:
    """Deterministic, stateless, read-only resolver for AEP agent proposals.

    Routes each proposal to the correct validator domain (UI, workflow, API,
    event, IaC) and collects constraints, available actions, and policy
    pre-checks from the relevant registries. Optionally queries a
    MemoryFabric for fast-path attractor hits.

    Design invariants:
        - NEVER modifies scene graph, registries, or memory.
        - Fully stateless: all state comes from constructor args and the
          ResolveRequest.
        - Graceful degradation: missing registries or memory produce empty
          constraints, not errors.
    """

    def __init__(
        self,
        config: Optional[Any] = None,
        memory: Optional[Any] = None,
        workflow_registry: Optional[Any] = None,
        api_registry: Optional[Any] = None,
        event_registry: Optional[Any] = None,
        iac_registry: Optional[Any] = None,
    ):
        """Initialize the resolver with optional registries and memory.

        Args:
            config: An AEPConfig instance for UI element lookups (registry,
                elements, z-bands).
            memory: A MemoryFabric instance for fast-path attractor lookups.
            workflow_registry: A WorkflowRegistry for workflow step validation.
            api_registry: An APIRegistry for API call validation.
            event_registry: An EventRegistry for event validation.
            iac_registry: An IaCRegistry for infrastructure resource validation.
        """
        self._config = config
        self._memory = memory
        self._workflow_registry = workflow_registry
        self._api_registry = api_registry
        self._event_registry = event_registry
        self._iac_registry = iac_registry

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def resolve(self, request: ResolveRequest) -> ResolveResult:
        """Route a proposal to the correct validator pipeline.

        Steps:
            1. Map proposal_type to a route string.
            2. Delegate to the domain-specific resolver method.
            3. If memory is available, query for a fast-path attractor.
            4. Return the assembled ResolveResult.

        Args:
            request: The agent's proposal to resolve.

        Returns:
            A ResolveResult with routing decision, constraints, policy
            pre-check results, available actions, and optional attractor.
        """
        route = _PROPOSAL_ROUTE_MAP.get(request.proposal_type)
        if route is None:
            return ResolveResult(
                route="unknown",
                policy_pass=False,
                policy_errors=[
                    f'Unknown proposal_type: "{request.proposal_type}". '
                    f"Valid types: {sorted(_PROPOSAL_ROUTE_MAP.keys())}"
                ],
            )

        # Dispatch to domain-specific resolver
        if route == "ui":
            result = self._resolve_ui(request)
        elif route == "workflow":
            result = self._resolve_workflow(request)
        elif route == "api":
            result = self._resolve_api(request)
        elif route == "event":
            result = self._resolve_event(request)
        elif route == "iac":
            result = self._resolve_iac(request)
        else:
            result = ResolveResult(route=route)

        # Memory attractor lookup (read-only, optional)
        self._apply_memory_attractor(request, result)

        return result

    def get_available_routes(self) -> list[str]:
        """Return the list of domains that have loaded registries.

        A route is considered available if its corresponding registry or
        config was provided at construction time.

        Returns:
            Sorted list of available route strings.
        """
        routes: list[str] = []
        if self._config is not None:
            routes.append("ui")
        if self._workflow_registry is not None:
            routes.append("workflow")
        if self._api_registry is not None:
            routes.append("api")
        if self._event_registry is not None:
            routes.append("event")
        if self._iac_registry is not None:
            routes.append("iac")
        return sorted(routes)

    def get_ui_constraints(self, element_id: str) -> list[str]:
        """Get UI constraints for a specific element from the registry.

        Args:
            element_id: The AEP element ID to look up.

        Returns:
            List of constraint strings from the registry entry. Empty list
            if no config is loaded or the element is not found.
        """
        if self._config is None:
            return []

        entry = self._config.registry.get(element_id)
        if entry is None:
            return []

        return list(entry.constraints)

    # ------------------------------------------------------------------
    # Domain-specific resolvers (private, read-only)
    # ------------------------------------------------------------------

    def _resolve_ui(self, request: ResolveRequest) -> ResolveResult:
        """Resolve a ui_element proposal.

        Validates:
            - element_id is provided and well-formed
            - Prefix maps to a valid z-band
            - Element exists in the config registry
            - Collects constraints and actions from the registry entry
        """
        result = ResolveResult(route="ui")

        if not request.element_id:
            result.policy_pass = False
            result.policy_errors.append(
                "ui_element proposal requires element_id"
            )
            return result

        if self._config is None:
            result.constraints.append(
                "No AEP config loaded; UI constraints unavailable"
            )
            return result

        # Validate element ID format and extract prefix
        if prefix_from_id is not None:
            try:
                prefix = prefix_from_id(request.element_id)
            except Exception as exc:
                result.policy_pass = False
                result.policy_errors.append(str(exc))
                return result
        else:
            # Fallback: extract first two characters
            if len(request.element_id) < 2:
                result.policy_pass = False
                result.policy_errors.append(
                    f'Invalid AEP ID: "{request.element_id}" '
                    f"must be at least 2 characters"
                )
                return result
            prefix = request.element_id[:2]

        # Z-band validation
        if z_band_for_prefix is not None:
            min_z, max_z = z_band_for_prefix(prefix)
            result.constraints.append(
                f"z-band for {prefix}: {min_z}-{max_z}"
            )

        # Registry lookup
        entry = self._config.registry.get(request.element_id)
        if entry is not None:
            result.constraints.extend(entry.constraints)
            result.available_actions.extend(entry.actions)
        else:
            # Check if it is a template instance
            is_template = False
            if hasattr(self._config, "is_template_instance"):
                is_template = self._config.is_template_instance(
                    request.element_id
                )

            if not is_template:
                result.policy_pass = False
                result.policy_errors.append(
                    f'Element "{request.element_id}" not found in registry'
                )

        return result

    def _resolve_workflow(self, request: ResolveRequest) -> ResolveResult:
        """Resolve a workflow_step proposal.

        Validates:
            - action is provided
            - Workflow registry is loaded
            - Action exists in the registry
            - Collects available transitions from current state
        """
        result = ResolveResult(route="workflow")

        if not request.action:
            result.policy_pass = False
            result.policy_errors.append(
                "workflow_step proposal requires action"
            )
            return result

        if self._workflow_registry is None:
            result.constraints.append(
                "No workflow registry loaded; workflow constraints unavailable"
            )
            return result

        # Check action exists
        if hasattr(self._workflow_registry, "steps"):
            if request.action not in self._workflow_registry.steps:
                result.policy_pass = False
                result.policy_errors.append(
                    f'Unknown workflow action: "{request.action}". '
                    f"Registered: {sorted(self._workflow_registry.steps.keys())}"
                )
                return result

            step = self._workflow_registry.steps[request.action]

            # Collect constraints from step schema
            if step.requires_approval:
                result.constraints.append(
                    f'Action "{request.action}" requires approval'
                )
            result.constraints.append(
                f"timeout: {step.timeout_ms}ms, max_retries: {step.max_retries}"
            )

            # Validate state transition (read-only check)
            if request.current_state and request.current_state in self._workflow_registry.steps:
                allowed = self._workflow_registry.steps[request.current_state].allowed_transitions
                if allowed and request.action not in allowed:
                    result.policy_pass = False
                    result.policy_errors.append(
                        f'Invalid transition: cannot go from '
                        f'"{request.current_state}" to "{request.action}". '
                        f"Allowed: {allowed}"
                    )

        # Get available actions from current state
        if hasattr(self._workflow_registry, "get_available_actions"):
            result.available_actions = self._workflow_registry.get_available_actions(
                request.current_state
            )

        return result

    def _resolve_api(self, request: ResolveRequest) -> ResolveResult:
        """Resolve an api_call proposal.

        Validates:
            - API registry is loaded
            - Collects list of registered endpoints for reference
        """
        result = ResolveResult(route="api")

        if self._api_registry is None:
            result.constraints.append(
                "No API registry loaded; API constraints unavailable"
            )
            return result

        # Expose available endpoints as actions
        if hasattr(self._api_registry, "list_endpoints"):
            endpoints = self._api_registry.list_endpoints()
            result.available_actions = [
                f"{ep['method']} {ep['path']}" for ep in endpoints
            ]

        return result

    def _resolve_event(self, request: ResolveRequest) -> ResolveResult:
        """Resolve an event proposal.

        Validates:
            - Event registry is loaded
            - If action (event_id) provided, checks it exists
            - Collects list of registered events for reference
        """
        result = ResolveResult(route="event")

        if self._event_registry is None:
            result.constraints.append(
                "No event registry loaded; event constraints unavailable"
            )
            return result

        # If a specific event ID is given via action, validate it exists
        if request.action and hasattr(self._event_registry, "events"):
            if request.action not in self._event_registry.events:
                result.policy_pass = False
                result.policy_errors.append(
                    f'Unknown event: "{request.action}". '
                    f"Registered: {sorted(self._event_registry.events.keys())}"
                )
                return result

            schema = self._event_registry.events[request.action]
            if schema.requires_correlation_id:
                result.constraints.append(
                    f'Event "{request.action}" requires correlation_id'
                )
            if schema.allowed_producers:
                result.constraints.append(
                    f"Allowed producers: {schema.allowed_producers}"
                )
            result.constraints.append(
                f"Max payload: {schema.max_payload_bytes} bytes"
            )

        # Expose available events as actions
        if hasattr(self._event_registry, "list_events"):
            events = self._event_registry.list_events()
            result.available_actions = [ev["id"] for ev in events]

        return result

    def _resolve_iac(self, request: ResolveRequest) -> ResolveResult:
        """Resolve an iac_resource proposal.

        Validates:
            - IaC registry is loaded
            - If action (resource kind) provided, checks it exists
            - Collects constraints from matching resource schema
        """
        result = ResolveResult(route="iac")

        if self._iac_registry is None:
            result.constraints.append(
                "No IaC registry loaded; IaC constraints unavailable"
            )
            return result

        # If a specific resource kind is given via action, validate it
        if request.action and hasattr(self._iac_registry, "resources"):
            matched = None
            for _rid, schema in self._iac_registry.resources.items():
                if schema.kind == request.action:
                    matched = schema
                    break

            if matched is None:
                kinds = sorted(
                    set(s.kind for s in self._iac_registry.resources.values())
                )
                result.policy_pass = False
                result.policy_errors.append(
                    f'Unknown resource kind: "{request.action}". '
                    f"Registered: {kinds}"
                )
            else:
                result.constraints.extend(matched.constraints)
                if matched.forbidden_fields:
                    result.constraints.append(
                        f"Forbidden fields: {matched.forbidden_fields}"
                    )

        # Expose available resource kinds as actions
        if hasattr(self._iac_registry, "list_resources"):
            resources = self._iac_registry.list_resources()
            result.available_actions = [r["kind"] for r in resources]

        return result

    # ------------------------------------------------------------------
    # Memory attractor lookup (private, read-only)
    # ------------------------------------------------------------------

    def _apply_memory_attractor(
        self, request: ResolveRequest, result: ResolveResult
    ) -> None:
        """Query memory for a fast-path attractor hit.

        If a MemoryFabric is available and has a get_fast_path_hit method,
        query it with the request context. On a hit, set fast_path=True and
        attach the nearest attractor to the result.

        This method never modifies the memory fabric.
        """
        if self._memory is None:
            return

        try:
            # Extract embedding from payload (convention: _embedding key)
            embedding = request.payload.get("_embedding") if request.payload else None
            if embedding is not None and hasattr(self._memory, "get_fast_path_hit"):
                attractor = self._memory.get_fast_path_hit(embedding)
                if attractor is not None:
                    result.nearest_attractor = attractor
                    result.fast_path = True
        except Exception:
            # Memory lookup failures are non-fatal; skip silently
            pass

    # ------------------------------------------------------------------
    # Representation
    # ------------------------------------------------------------------

    def __repr__(self) -> str:
        routes = self.get_available_routes()
        mem = "memory=active" if self._memory is not None else "memory=none"
        return f"BasicResolver(routes={routes}, {mem})"
