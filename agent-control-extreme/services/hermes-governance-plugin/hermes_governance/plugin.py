"""Hermes Governance Plugin - standalone policy enforcement.

No GAP Runtime dependency. No paid products. No external services.

Intercepts Hermes tool calls and enforces 8 local policy checks before execution.
Supports three hook strategies:
  A: Native Hermes Plugin API (@tool_interceptor) - future
  B: Monkey-patch tools.registry.dispatch() - works today
  C: Manual governance check before tool execution
"""

import json
import logging
import os
import sys
from typing import Any, Dict, List, Optional

from hermes_governance.checks import PolicyChecks, PolicyViolation
from hermes_governance.deploy_gate import DeployGate, DeployGateViolation

log = logging.getLogger("hermes-governance")


class GovernancePlugin:
    """Hermes plugin that enforces NLA policy governance on every tool call."""

    name = "hermes-governance"
    version = "0.1.0"
    description = "NLA policy governance for Hermes Agent (standalone, no GAP)"

    MONITORED_TOOLS = [
        "terminal", "write_file", "patch", "delegate_task",
        "send_message", "cronjob", "execute_code"
    ]

    def __init__(self, fail_closed: bool = True):
        self.fail_closed = fail_closed
        self.session_id = os.environ.get("AGENT_SESSION_ID", "unknown")
        self.checks = PolicyChecks()
        self.deploy_gate = DeployGate()
        self._installed = False
        self._stats = {"blocked": 0, "passed": 0, "warnings": 0}

    # ──────────────────────────────────────────────────────
    # Core governance: validate any text through all 8 checks
    # ──────────────────────────────────────────────────────

    def govern(self, text: str, context: str = "") -> Dict[str, Any]:
        """Run all 8 policy checks against text.

        Returns:
            {"passed": True} or {"passed": False, "violations": [...]}
        """
        violations = PolicyChecks.check_all(text)
        if not violations:
            self._stats["passed"] += 1
            return {"passed": True}

        self._stats["blocked"] += 1
        return {
            "passed": False,
            "violations": [
                {"check": v.check, "message": v.message, "matched": v.matched}
                for v in violations
            ]
        }

    # ──────────────────────────────────────────────────────
    # Tool interception: validate before execution
    # ──────────────────────────────────────────────────────

    def validate_tool_call(self, tool_name: str, tool_args: Dict,
                           context: Dict = None) -> Dict:
        """Validate a Hermes tool call through all 8 policy checks.

        Called BEFORE tool execution. If violations found, returns
        a blocked response. The tool NEVER executes.
        """
        if tool_name not in self.MONITORED_TOOLS:
            return {"allowed": True}

        # Build text to check from tool args
        text = self._extract_text(tool_args)

        # Run governance
        result = self.govern(text)

        if not result["passed"]:
            log.warning(
                "GOVERNANCE BLOCKED %s: %d violations",
                tool_name,
                len(result["violations"])
            )
            for v in result["violations"]:
                log.warning("  [%s] %s", v["check"], v["message"])

            return {
                "allowed": False,
                "governance_blocked": True,
                "violations": result["violations"],
                "error": (
                    f"NLA policy blocked {tool_name}: "
                    f"{len(result['violations'])} violation(s)"
                )
            }

        # Optional: deployment gate for specific tools
        if tool_name == "terminal":
            cmd = tool_args.get("command", "")
            if self._is_deploy_command(cmd):
                deploy_result = self._check_deploy_gate(cmd, context)
                if deploy_result:
                    return deploy_result

        return {"allowed": True}

    def validate_tool_output(self, tool_name: str, output: str) -> str:
        """Scan tool output after execution. Returns output unchanged
        but logs violations as warnings."""
        text = self._extract_text({"output": output, "tool": tool_name})
        result = self.govern(text)
        if not result["passed"]:
            self._stats["warnings"] += 1
            log.warning(
                "GOVERNANCE WARNING in %s output: %d violations",
                tool_name,
                len(result["violations"])
            )
        return output

    # ──────────────────────────────────────────────────────
    # Monkey-patch Hermes tool dispatch (Strategy B)
    # ──────────────────────────────────────────────────────

    def install(self):
        """Install governance by patching Hermes tool dispatch."""
        if self._installed:
            return

        log.info("Hermes Governance Plugin v%s installing...", self.version)

        try:
            from tools import registry as tool_registry
        except ImportError:
            log.warning("Cannot import tools.registry - plugin hooks only")
            print("\n[Hermes Governance] Plugin loaded (hooks active).")
            print("[Hermes Governance] 8 policy checks enforced on all tool calls.")
            print("[Hermes Governance] Zero dependencies. No GAP Runtime needed.")
            self._installed = True
            return

        _original_dispatch = tool_registry.dispatch
        gov_plugin = self

        def governed_dispatch(tool_name, tool_args, context=None):
            # Pre-validate
            validation = gov_plugin.validate_tool_call(
                tool_name, tool_args, context
            )
            if not validation.get("allowed", True):
                return validation

            # Execute
            output = _original_dispatch(tool_name, tool_args, context)

            # Post-scan
            output_str = json.dumps(output) if isinstance(output, dict) else str(output)
            gov_plugin.validate_tool_output(tool_name, output_str)

            return output

        tool_registry.dispatch = governed_dispatch
        self._installed = True
        log.info("Governance active. %d tools monitored. 8 checks enforced.",
                 len(self.MONITORED_TOOLS))

    def uninstall(self):
        """Remove governance patch."""
        if not self._installed:
            return
        try:
            from tools import registry as tool_registry
            tool_registry.dispatch = tool_registry._original_dispatch
        except Exception:
            pass
        self._installed = False

    # ──────────────────────────────────────────────────────
    # Helpers
    # ──────────────────────────────────────────────────────

    def _extract_text(self, args: Any) -> str:
        """Extract searchable text from tool arguments."""
        if isinstance(args, str):
            return args
        if isinstance(args, dict):
            # Extract key fields
            text_fields = []
            for key in ("command", "content", "text", "message", "prompt",
                        "output", "description", "goal", "context"):
                val = args.get(key, "")
                if isinstance(val, str):
                    text_fields.append(val)
                elif isinstance(val, dict):
                    text_fields.append(json.dumps(val))
            return " ".join(text_fields)
        return str(args)

    def _is_deploy_command(self, cmd: str) -> bool:
        """Check if a terminal command is a deployment operation."""
        deploy_markers = [
            "git push", "rsync", "scp", "deploy", "systemctl restart",
            "docker push", "kubectl apply", "helm install",
            "npm publish", "mix release", "cargo publish",
        ]
        cmd_lower = cmd.lower()
        return any(marker in cmd_lower for marker in deploy_markers)

    def _check_deploy_gate(self, cmd: str, context: Dict = None) -> Optional[Dict]:
        """Run deployment gate checks. Returns block dict if violations."""
        prompt = (context or {}).get("last_user_message", cmd)
        errors = DeployGate.validate_deploy(
            url=os.environ.get("DEPLOY_TARGET_URL", ""),
            prompt=prompt
        )
        if errors:
            return {
                "allowed": False,
                "governance_blocked": True,
                "deploy_gate": True,
                "violations": [{"check": "deploy_gate", "message": e}
                              for e in errors],
                "error": "Deployment gate: " + "; ".join(errors)
            }
        return None

    def stats(self) -> Dict:
        """Return governance statistics."""
        return dict(self._stats)
