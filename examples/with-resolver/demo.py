#!/usr/bin/env python3
"""
AEP v2.0 Basic Resolver Demo
Demonstrates routing proposals through the resolver with optional memory integration.
"""

import sys
import os

# Add SDK directory to path
sdk_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "sdk")
sys.path.insert(0, sdk_dir)

from importlib.util import spec_from_file_location, module_from_spec

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


def main():
    print("=" * 60)
    print("AEP v2.0 Basic Resolver Demo")
    print("=" * 60)

    # Create a memory fabric and seed it
    fabric = InMemoryFabric()
    seed_entry = create_memory_entry(
        element_id="CP-00005",
        domain="ui",
        proposal={"type": "component", "z": 20, "parent": "TB-00001"},
        result="accepted",
        errors=[],
        traversal_path=["z_band", "parent_check", "registry_lookup"],
        embedding=[0.3, 0.7, 0.5, 0.1],
    )
    fabric.record(seed_entry)
    print("\n[1] Created InMemoryFabric with 1 seed entry")

    # Create resolver (no AEP config for simplicity, shows graceful degradation)
    resolver = BasicResolver(config=None, memory=fabric)
    print("[2] Created BasicResolver (no config, with memory)")

    # Route a UI element proposal
    print("\n[3] Routing UI element proposal...")
    request = ResolveRequest(
        proposal_type="ui_element",
        element_id="CP-00003",
        payload={"z": 20, "parent": "PN-00001", "skin_binding": "button_primary"},
    )
    result = resolver.resolve(request)
    print(f"    Route:       {result.route}")
    print(f"    Constraints: {result.constraints}")
    print(f"    Fast path:   {result.fast_path}")
    print(f"    Attractor:   {result.nearest_attractor.element_id if result.nearest_attractor else 'None'}")

    # Route a workflow step proposal
    print("\n[4] Routing workflow step proposal...")
    request = ResolveRequest(
        proposal_type="workflow_step",
        action="assign",
        payload={"task_id": "T-001", "assignee": "agent-1"},
        current_state="create_task",
    )
    result = resolver.resolve(request)
    print(f"    Route:             {result.route}")
    print(f"    Available actions: {result.available_actions}")
    print(f"    Constraints:       {result.constraints}")

    # Route an API call proposal
    print("\n[5] Routing API call proposal...")
    request = ResolveRequest(
        proposal_type="api_call",
        payload={"method": "POST", "path": "/api/tasks", "body": {"title": "New task"}},
        agent_id="agent-frontend",
    )
    result = resolver.resolve(request)
    print(f"    Route:       {result.route}")
    print(f"    Constraints: {result.constraints}")
    print(f"    Agent:       {request.agent_id}")

    # Route an event proposal
    print("\n[6] Routing event proposal...")
    request = ResolveRequest(
        proposal_type="event",
        payload={"topic": "tasks", "event_id": "task.created"},
    )
    result = resolver.resolve(request)
    print(f"    Route:       {result.route}")
    print(f"    Constraints: {result.constraints}")

    # Route an IaC resource proposal
    print("\n[7] Routing IaC resource proposal...")
    request = ResolveRequest(
        proposal_type="iac_resource",
        payload={"kind": "Deployment", "api_version": "apps/v1"},
    )
    result = resolver.resolve(request)
    print(f"    Route:       {result.route}")
    print(f"    Constraints: {result.constraints}")

    # Show available routes
    print(f"\n[8] Available routes: {resolver.get_available_routes()}")

    # Show how fast-path works with matching embedding
    print("\n[9] Fast-path demo with matching embedding...")
    request = ResolveRequest(
        proposal_type="ui_element",
        element_id="CP-00005",
        payload={
            "type": "component", "z": 20, "parent": "TB-00001",
            "_embedding": [0.3, 0.7, 0.5, 0.1],
        },
    )
    result = resolver.resolve(request)
    print(f"    Route:     {result.route}")
    print(f"    Fast path: {result.fast_path}")
    if result.nearest_attractor:
        print(f"    Attractor: {result.nearest_attractor.element_id} ({result.nearest_attractor.result})")

    print("\n" + "=" * 60)
    print("Demo complete.")
    print("=" * 60)


if __name__ == "__main__":
    main()
