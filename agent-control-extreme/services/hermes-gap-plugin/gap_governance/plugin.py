"""GAP Governance Plugin for Hermes Agent.

Two strategies for hooking into Hermes:

Strategy A (future): Native Hermes Plugin API.
  Uses @tool_interceptor decorator if the Hermes plugin system supports it.

Strategy B (today): Monkey-patch tool dispatch.
  Patches tools.registry.dispatch() to inject GAP validation before every tool call.
  Survives Hermes updates since dispatch() is stable internal API.

Strategy C (fallback): gap-wrap standalone wrapper.
  See scripts/gap-wrap -- wraps the full hermes process, zero code changes.
"""

import json
import logging
import os
import sys

from gap_governance.client import GAPClient, GAPViolation

log = logging.getLogger("gap-governance")


class GAPGovernancePlugin:
    """Hermes plugin that enforces GAP governance on every tool call."""

    name = "gap-governance"
    version = "0.1.0"
    description = "GAP Runtime governance for all Hermes tool calls"

    def __init__(self, gap_url: str = None, fail_closed: bool = True,
                 enabled_tools: list = None):
        self.gap = GAPClient(server_url=gap_url, fail_closed=fail_closed)
        self.enabled_tools = enabled_tools or [
            "terminal", "write_file", "patch", "delegate_task",
            "send_message", "cronjob"
        ]
        self.fail_closed = fail_closed
        self.session_id = os.environ.get("AGENT_SESSION_ID", "unknown")
        self._installed = False

    # ──────────────────────────────────────────────────────
    # Strategy A: Native Hermes Plugin hooks (future)
    # ──────────────────────────────────────────────────────

    def on_tool_pre_execute(self, tool_name: str, tool_args: dict,
                            context: dict = None) -> dict:
        """Validate tool call through GAP before execution.

        Called by Hermes plugin system if @tool_interceptor is supported.
        Returns modified tool_args or raises GAPViolation.
        """
        if tool_name not in self.enabled_tools:
            return tool_args

        context = context or {}
        prompt = context.get("last_user_message", "")

        try:
            self.gap.validate(
                action_type=tool_name,
                action_params=tool_args,
                session_id=self.session_id,
                prompt=prompt
            )
        except GAPViolation as e:
            log.error("GAP BLOCKED %s: %s", tool_name, e)
            # Return a blocked response instead of crashing
            return {
                "_gap_blocked": True,
                "_gap_violations": [v for v in e.violations],
                "error": str(e)
            }

        return tool_args

    def on_tool_post_execute(self, tool_name: str, tool_args: dict,
                             result: str, context: dict = None) -> str:
        """Scan tool output through GAP after execution."""
        if not self.gap.health():
            return result

        try:
            scan_result = self.gap.scan(
                text=json.dumps(result) if isinstance(result, dict) else str(result)
            )
            if not scan_result.get("passed", True):
                log.warning(
                    "GAP warnings in %s output: %s",
                    tool_name,
                    scan_result.get("soft_warnings", [])
                )
        except Exception as e:
            log.debug("GAP post-scan failed (non-fatal): %s", e)

        return result

    # ──────────────────────────────────────────────────────
    # Strategy B: Monkey-patch tool dispatch (works today)
    # ──────────────────────────────────────────────────────

    def install(self, target=None):
        """Install GAP governance into Hermes by patching tool dispatch.

        Call early, before any tool calls happen.
        """
        if self._installed:
            return

        log.info("GAP Governance Plugin v%s installing...", self.version)

        try:
            self._patch_hermes_dispatch()
            self._installed = True
            log.info("GAP governance active. %d tools monitored.",
                     len(self.enabled_tools))
        except Exception as e:
            log.error("Failed to install GAP plugin: %s", e)
            if self.fail_closed:
                log.critical("Fail-closed: GAP plugin install failed, blocking.")
                sys.exit(1)
            log.warning("Fail-open: continuing without GAP governance.")

    def _patch_hermes_dispatch(self):
        """Monkey-patch Hermes tool dispatch to inject GAP validation.

        Finds tools.registry and wraps dispatch() to call GAP pre/post.
        """
        try:
            from tools import registry as tool_registry
        except ImportError:
            log.warning("Cannot import tools.registry -- plugin hooks only")
            return

        _original_dispatch = tool_registry.dispatch
        gap_plugin = self  # capture for closure

        def governed_dispatch(tool_name, tool_args, context=None):
            # Pre-validate through GAP
            result = gap_plugin.on_tool_pre_execute(
                tool_name, tool_args, context
            )
            if isinstance(result, dict) and result.get("_gap_blocked"):
                return result

            # Execute real tool
            output = _original_dispatch(tool_name, tool_args, context)

            # Post-scan output
            gap_plugin.on_tool_post_execute(
                tool_name, tool_args, output, context
            )

            return output

        tool_registry.dispatch = governed_dispatch
        log.debug("Patched tools.registry.dispatch()")

    def uninstall(self):
        """Remove GAP governance patch."""
        if not self._installed:
            return
        try:
            from tools import registry as tool_registry
            tool_registry.dispatch = tool_registry._original_dispatch
        except Exception:
            pass
        self._installed = False


def init_plugin(gap_url=None, fail_closed=True, enabled_tools=None):
    """Initialize and install the GAP governance plugin.

    Call this from Hermes entry point or plugin loader.
    """
    plugin = GAPGovernancePlugin(
        gap_url=gap_url or os.environ.get("GAP_SERVER_URL"),
        fail_closed=fail_closed,
        enabled_tools=enabled_tools
    )
    plugin.install()
    return plugin
