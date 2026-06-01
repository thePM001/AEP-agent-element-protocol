#!/usr/bin/env python3
"""
NLA Task Manifest Governance Plugin for Hermes Agent
Plugin hooks: pre_task, post_task
Validates task manifests against Rego policies before and after execution.

Install: copy to ~/.hermes/plugins/nla-task-manifest-plugin.py
Enable: hermes plugins enable nla-task-manifest-plugin
"""

from __future__ import annotations
import json
import os
import sys
import subprocess
import yaml
from datetime import datetime, timezone
from pathlib import Path

PLUGIN_NAME = "nla-task-manifest"
MANIFEST_DIR = Path(os.path.expanduser("~/.hermes/task-manifests"))
SCHEMA_PATH = Path("/opt/nla-website/docs/task-manifest-schema.yaml")
REGO_PATH = Path("/opt/nla-website/docs/nla-task-manifest.rego")
MANIFEST_LOG = Path(os.path.expanduser("~/.hermes/logs/task-manifest-log.jsonl"))


def load_manifest(task_context: dict) -> dict | None:
    """Load task manifest from context or file."""
    # First: check if manifest is in task_context payload
    manifest = task_context.get("task_manifest")
    if manifest:
        return manifest

    # Second: look for manifest file by task id
    task_id = task_context.get("task", {}).get("id") or task_context.get("task_id")
    if task_id:
        manifest_file = MANIFEST_DIR / f"{task_id}.yaml"
        if manifest_file.exists():
            with open(manifest_file) as f:
                return yaml.safe_load(f)

    return None


def validate_with_rego(manifest: dict) -> tuple[bool, list[str]]:
    """Validate manifest against Rego policy using OPA."""
    try:
        result = subprocess.run(
            ["opa", "eval", "--format", "json", "--data", str(REGO_PATH),
             "--input", "/dev/stdin", "data.nla.task_manifest.deny"],
            input=json.dumps(manifest),
            capture_output=True, text=True, timeout=15
        )
        if result.returncode != 0:
            return False, [f"OPA eval failed: {result.stderr}"]

        violations_raw = json.loads(result.stdout)
        # OPA returns {"result": [{"expressions": [{"value": [...]}]}]}
        try:
            violation_msgs = violations_raw["result"][0]["expressions"][0]["value"]
        except (KeyError, IndexError, TypeError):
            violation_msgs = []

        if not violation_msgs:
            return True, []

        return False, violation_msgs
    except FileNotFoundError:
        return False, ["OPA not installed - skipping Rego validation"]
    except Exception as e:
        return False, [f"Rego validation error: {e}"]


def pre_task(context: dict) -> dict:
    """PRE_TASK hook: validate manifest before execution."""
    task_id = context.get("task", {}).get("id") or context.get("task_id") or "unknown"
    user_prompt = context.get("user_prompt", "")[:100]

    manifest = load_manifest(context)
    if not manifest:
        return {
            "action": "reject",
            "reason": f"NO TASK MANIFEST for task '{task_id}'. "
                      f"Every task must declare a manifest. "
                      f"Create one at {MANIFEST_DIR}/{task_id}.yaml "
                      f"using the schema at {SCHEMA_PATH}.",
            "manifest_required": True,
            "schema_path": str(SCHEMA_PATH),
            "manifest_dir": str(MANIFEST_DIR),
        }

    # Validate with Rego
    valid, violations = validate_with_rego(manifest)
    if not valid:
        return {
            "action": "reject",
            "reason": f"TASK MANIFEST INVALID for '{task_id}': {'; '.join(violations)}",
            "violations": violations,
            "manifest": manifest,
        }

    # Log manifest acceptance
    os.makedirs(MANIFEST_LOG.parent, exist_ok=True)
    with open(MANIFEST_LOG, "a") as f:
        f.write(json.dumps({
            "event": "manifest_accepted",
            "task_id": task_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "manifest": manifest,
        }) + "\n")

    # Inject manifest into context for downstream hooks
    context["task_manifest"] = manifest
    return {"action": "allow", "manifest_valid": True, "manifest": manifest}


def post_task(result: dict, context: dict) -> dict:
    """POST_TASK hook: verify all completion criteria passed."""
    task_id = context.get("task", {}).get("id") or context.get("task_id") or "unknown"
    manifest = context.get("task_manifest") or load_manifest(context)

    if not manifest:
        return {
            "action": "warn",
            "reason": f"No manifest found for post-task verification of '{task_id}'.",
        }

    completion = manifest.get("completion", {})
    criteria = completion.get("criteria", {})
    failed = []

    if not criteria.get("all_files_written", False):
        failed.append("all_files_written")
    if not criteria.get("build_passes", False):
        failed.append("build_passes")
    if not criteria.get("all_curl_checks_pass", False):
        failed.append("all_curl_checks_pass")
    if not criteria.get("reference_audit_clean", False):
        failed.append("reference_audit_clean")
    if not criteria.get("component_registration_done", False):
        failed.append("component_registration_done")

    if failed:
        return {
            "action": "reject",
            "reason": f"TASK '{task_id}' INCOMPLETE. Failed criteria: {failed}. "
                      f"Task is NOT done. Complete all criteria before marking verified.",
            "failed_criteria": failed,
            "manifest": manifest,
        }

    # All criteria passed - log verification
    os.makedirs(MANIFEST_LOG.parent, exist_ok=True)
    with open(MANIFEST_LOG, "a") as f:
        f.write(json.dumps({
            "event": "task_verified",
            "task_id": task_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }) + "\n")

    return {"action": "allow", "task_verified": True, "manifest": manifest}


# Hermes plugin interface
HOOKS = {
    "pre_task": pre_task,
    "post_task": post_task,
}

# Self-test
if __name__ == "__main__":
    test_manifest = {
        "manifest_version": "1.0",
        "task": {
            "id": "test-2026-06-01",
            "type": "page_update",
            "description": "Test task manifest validation",
            "environments": ["staging"],
            "files_affected": ["/tmp/test.tsx"],
            "urls_affected": ["https://tasty.newlisbon.agency/aep"],
        },
        "verification": {
            "build": {"must_pass": True},
            "curl_checks": [{"url": "https://127.0.0.1/aep", "expected_status": 200}],
        },
        "completion": {
            "criteria": {
                "all_files_written": True,
                "build_passes": True,
                "all_curl_checks_pass": True,
                "reference_audit_clean": True,
                "component_registration_done": True,
            },
            "status": "verified",
            "verified_at": datetime.now(timezone.utc).isoformat(),
        },
    }

    print("=== PRE_TASK test ===")
    result = pre_task({"task": {"id": "test-2026-06-01"}})
    print(json.dumps(result, indent=2))

    print("\n=== POST_TASK test ===")
    context = {"task_manifest": test_manifest, "task": {"id": "test-2026-06-01"}}
    result = post_task({}, context)
    print(json.dumps(result, indent=2))
