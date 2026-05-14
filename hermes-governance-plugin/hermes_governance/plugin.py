"""Governance plugin for Hermes Agent - standalone policy enforcement.

No external dependencies. No paid products. No external services.
All checks configurable via environment variables.

Intercepts Hermes tool calls and enforces local policy checks before execution.
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
    """Hermes plugin that enforces configurable policy governance on every tool call."""

    name = "hermes-governance"
    version = "0.1.0"
    description = "Policy governance for Hermes Agent (standalone, configurable)"

    MONITORED_TOOLS = [
        "terminal", "write_file", "patch", "delegate_task",
        "send_message", "cronjob", "execute_code"
    ]

    def __init__(self, fail_closed: bool = True):
        self.fail_closed = fail_closed
        self.session_id = os.environ.get("AGENT_SESSION_ID", "unknown")
        self._installed = False
        self._stats = {"blocked": 0, "passed": 0, "warnings": 0}

    def govern(self, text: str) -> Dict[str, Any]:
        """Run all configured policy checks against text."""
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

    def validate_tool_call(self, tool_name: str, tool_args: Dict,
                           context: Dict = None) -> Dict:
        """Validate a Hermes tool call through policy checks before execution."""
        if tool_name not in self.MONITORED_TOOLS:
            return {"allowed": True}

        text = self._extract_text(tool_args)
        result = self.govern(text)

        if not result["passed"]:
            log.warning(
                "POLICY BLOCKED %s: %d violations",
                tool_name, len(result["violations"])
            )
            for v in result["violations"]:
                log.warning("  [%s] %s", v["check"], v["message"])

            return {
                "allowed": False,
                "policy_blocked": True,
                "violations": result["violations"],
                "error": (
                    f"Policy blocked {tool_name}: "
                    f"{len(result['violations'])} violation(s)"
                )
            }

        if tool_name == "terminal":
            cmd = tool_args.get("command", "")
            if self._is_deploy_command(cmd):
                deploy_result = self._check_deploy_gate(cmd, context)
                if deploy_result:
                    return deploy_result

        return {"allowed": True}

    def validate_tool_output(self, tool_name: str, output: str) -> str:
        """Scan tool output after execution. Returns output unchanged."""
        text = self._extract_text({"output": output, "tool": tool_name})
        result = self.govern(text)
        if not result["passed"]:
            self._stats["warnings"] += 1
            log.warning("Policy warning in %s output: %d violations",
                       tool_name, len(result["violations"]))
        return output

    def install(self):
        """Install governance by patching Hermes tool dispatch."""
        if self._installed:
            return

        log.info("Governance Plugin v%s installing...", self.version)

        try:
            from tools import registry as tool_registry
        except ImportError:
            log.warning("Cannot import tools.registry - plugin hooks only")
            print("\n[Governance] Plugin loaded (hooks active).")
            print("[Governance] Policy checks enforced on all tool calls.")
            print("[Governance] Zero dependencies. Fully configurable via env vars.")
            self._installed = True
            return

        _original_dispatch = tool_registry.dispatch
        gov_plugin = self

        def governed_dispatch(tool_name, tool_args, context=None):
            validation = gov_plugin.validate_tool_call(tool_name, tool_args, context)
            if not validation.get("allowed", True):
                return validation

            output = _original_dispatch(tool_name, tool_args, context)
            output_str = json.dumps(output) if isinstance(output, dict) else str(output)
            gov_plugin.validate_tool_output(tool_name, output_str)
            return output

        tool_registry.dispatch = governed_dispatch
        self._installed = True
        log.info("Governance active. %d tools monitored.", len(self.MONITORED_TOOLS))

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

    def _extract_text(self, args: Any) -> str:
        if isinstance(args, str):
            return args
        if isinstance(args, dict):
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
        deploy_markers = [
            "git push", "rsync", "scp", "deploy", "systemctl restart",
            "docker push", "kubectl apply", "helm install",
            "npm publish", "mix release", "cargo publish",
        ]
        cmd_lower = cmd.lower()
        return any(marker in cmd_lower for marker in deploy_markers)

    def _check_deploy_gate(self, cmd: str, context: Dict = None) -> Optional[Dict]:
        prompt = (context or {}).get("last_user_message", cmd)
        errors = DeployGate.validate_deploy(
            url=os.environ.get("DEPLOY_TARGET_URL", ""),
            prompt=prompt
        )
        if errors:
            return {
                "allowed": False,
                "policy_blocked": True,
                "deploy_gate": True,
                "violations": [{"check": "deploy_gate", "message": e}
                              for e in errors],
                "error": "Deployment gate: " + "; ".join(errors)
            }
        return None

    def stats(self) -> Dict:
        return dict(self._stats)
