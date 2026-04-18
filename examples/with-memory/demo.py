#!/usr/bin/env python3
"""
AEP v2.0 Lattice Memory Demo
Demonstrates recording validation results and querying memory.
"""

import sys
import os

# Add SDK directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "sdk"))

from importlib.util import spec_from_file_location, module_from_spec

sdk_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "sdk")
mem_spec = spec_from_file_location("sdk_aep_memory", os.path.join(sdk_dir, "sdk-aep-memory.py"))
mem_mod = module_from_spec(mem_spec)
sys.modules["sdk_aep_memory"] = mem_mod
mem_spec.loader.exec_module(mem_mod)

InMemoryFabric = mem_mod.InMemoryFabric
create_memory_entry = mem_mod.create_memory_entry


def main():
    print("=" * 60)
    print("AEP v2.0 Lattice Memory Demo")
    print("=" * 60)

    # Create an in-memory fabric
    fabric = InMemoryFabric()
    print("\n[1] Created InMemoryFabric")

    # Record an accepted proposal
    entry1 = create_memory_entry(
        element_id="CP-00001",
        domain="ui",
        proposal={"type": "component", "z": 20, "parent": "PN-00001", "skin_binding": "logo"},
        result="accepted",
        errors=[],
        traversal_path=["z_band", "parent_check", "registry_lookup", "skin_binding"],
        embedding=[0.1, 0.8, 0.3, 0.5, 0.2],
    )
    fabric.record(entry1)
    print(f"\n[2] Recorded ACCEPTED proposal for CP-00001 (id: {entry1.id[:8]}...)")

    # Record a rejected proposal
    entry2 = create_memory_entry(
        element_id="CP-00002",
        domain="ui",
        proposal={"type": "component", "z": 5, "parent": "PN-00001"},
        result="rejected",
        errors=["CP-00002 z=5 outside band 20-29"],
        traversal_path=["z_band"],
        embedding=[0.9, 0.1, 0.7, 0.2, 0.4],
    )
    fabric.record(entry2)
    print(f"    Recorded REJECTED proposal for CP-00002 (id: {entry2.id[:8]}...)")

    # Record another accepted proposal
    entry3 = create_memory_entry(
        element_id="CP-00003",
        domain="ui",
        proposal={"type": "component", "z": 22, "parent": "PN-00001", "skin_binding": "button_primary"},
        result="accepted",
        errors=[],
        traversal_path=["z_band", "parent_check", "registry_lookup", "skin_binding"],
        embedding=[0.15, 0.85, 0.28, 0.48, 0.22],
    )
    fabric.record(entry3)
    print(f"    Recorded ACCEPTED proposal for CP-00003 (id: {entry3.id[:8]}...)")

    # Record a workflow rejection
    entry4 = create_memory_entry(
        element_id="WF-step-1",
        domain="workflow",
        proposal={"action": "approve", "payload": {"task_id": "T-001"}},
        result="rejected",
        errors=["Invalid transition: cannot go from 'create_task' to 'approve'"],
        traversal_path=["workflow_registry"],
    )
    fabric.record(entry4)
    print(f"    Recorded REJECTED workflow step (id: {entry4.id[:8]}...)")

    # Query nearest attractor by embedding
    print("\n[3] Finding nearest attractor to embedding [0.12, 0.82, 0.29, 0.49, 0.21]...")
    attractors = fabric.find_nearest_attractor([0.12, 0.82, 0.29, 0.49, 0.21], limit=3)
    for i, a in enumerate(attractors):
        print(f"    Match {i+1}: {a.element_id} (result: {a.result})")

    # Query rejection history for a specific element
    print("\n[4] Rejection history for CP-00002:")
    rejections = fabric.get_rejection_history("CP-00002")
    for r in rejections:
        print(f"    {r.timestamp} - errors: {r.errors}")

    # Query acceptance history
    print("\n[5] Acceptance history for CP-00001:")
    acceptances = fabric.get_acceptance_history("CP-00001")
    for a in acceptances:
        print(f"    {a.timestamp} - traversal: {a.traversal_path}")

    # Validation count
    print(f"\n[6] Total validations for CP-00001: {fabric.get_validation_count('CP-00001')}")
    print(f"    Total validations for CP-00002: {fabric.get_validation_count('CP-00002')}")

    # Fast-path hit (exact match)
    print("\n[7] Fast-path check with exact embedding [0.1, 0.8, 0.3, 0.5, 0.2]...")
    hit = fabric.get_fast_path_hit([0.1, 0.8, 0.3, 0.5, 0.2], threshold=0.95)
    if hit:
        print(f"    Fast-path HIT: {hit.element_id} (id: {hit.id[:8]}...)")
    else:
        print("    No fast-path hit")

    # Fast-path miss (distant embedding)
    print("\n[8] Fast-path check with distant embedding [0.9, 0.1, 0.9, 0.1, 0.9]...")
    miss = fabric.get_fast_path_hit([0.9, 0.1, 0.9, 0.1, 0.9], threshold=0.95)
    if miss:
        print(f"    Fast-path HIT: {miss.element_id}")
    else:
        print("    No fast-path hit (as expected for distant embedding)")

    # Export full history
    print(f"\n[9] Full audit trail ({len(fabric.export_history())} entries):")
    for e in fabric.export_history():
        print(f"    {e.element_id:12s} | {e.domain:10s} | {e.result:8s} | errors: {len(e.errors)}")

    print("\n" + "=" * 60)
    print("Demo complete.")
    print("=" * 60)


if __name__ == "__main__":
    main()
