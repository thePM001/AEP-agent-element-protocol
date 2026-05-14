"""Deployment gate enforcement. No external dependencies.

Configurable via environment variables:
  POLICY_DOMAIN_ALLOWLIST:   Comma-separated allowed domains
  POLICY_REQUIRED_SECTIONS:  Comma-separated required prompt sections
  POLICY_FORBIDDEN_COMMANDS: Comma-separated forbidden command patterns
"""

import os
import re
from typing import Dict, List, Optional


class DeployGateViolation(Exception):
    """Raised when deployment gate check fails."""
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(f"Deployment gate: {reason}")


class DeployGate:
    """Configurable deployment policy enforcement."""

    @classmethod
    def _get_allowed_domains(cls) -> List[str]:
        val = os.environ.get("POLICY_DOMAIN_ALLOWLIST", "")
        return [d.strip() for d in val.split(",") if d.strip()]

    @classmethod
    def _get_required_sections(cls) -> List[str]:
        val = os.environ.get("POLICY_REQUIRED_SECTIONS",
                            "WHAT,WHY,IMPACT,ROLLBACK,DURATION")
        return [s.strip() for s in val.split(",") if s.strip()]

    @classmethod
    def _get_forbidden_patterns(cls) -> List[tuple]:
        val = os.environ.get("POLICY_FORBIDDEN_COMMANDS",
                            "rm -rf,git push --force,DROP TABLE")
        patterns = []
        for cmd in val.split(","):
            cmd = cmd.strip()
            if cmd:
                patterns.append((re.compile(re.escape(cmd), re.IGNORECASE),
                                f"forbidden: {cmd}"))
        return patterns

    @classmethod
    def check_domain(cls, url: str) -> None:
        """Verify domain is on the allowlist (if configured)."""
        allowed = cls._get_allowed_domains()
        if not allowed:
            return  # No allowlist configured, allow all
        for domain in allowed:
            if domain in url:
                return
        raise DeployGateViolation(
            f"Domain not in allowlist: {url}."
        )

    @classmethod
    def check_raw_ip(cls, url: str) -> None:
        """Reject raw IP URLs."""
        if re.match(r"https?://\d+\.\d+\.\d+\.\d+", url):
            raise DeployGateViolation(
                f"Raw IP URL forbidden: {url}. Use domain name."
            )

    @classmethod
    def check_prompt_structure(cls, prompt: str) -> None:
        """Verify deployment prompt has all required sections."""
        missing = []
        for section in cls._get_required_sections():
            if f"{section}:" not in prompt and f"{section.lower()}:" not in prompt:
                missing.append(section)
        if missing:
            raise DeployGateViolation(
                f"Missing sections: {', '.join(missing)}"
            )

    @classmethod
    def check_forbidden_commands(cls, text: str) -> None:
        """Reject forbidden command patterns in authorization."""
        for pattern, msg in cls._get_forbidden_patterns():
            if pattern.search(text):
                raise DeployGateViolation(msg)

    @classmethod
    def validate_deploy(cls, url: str, prompt: str) -> List[str]:
        """Run all deployment gate checks. Returns empty list if pass."""
        errors = []
        for check in [cls.check_domain, cls.check_raw_ip,
                      cls.check_prompt_structure, cls.check_forbidden_commands]:
            try:
                check(url) if check == cls.check_domain or check == cls.check_raw_ip \
                    else check(prompt)
            except DeployGateViolation as e:
                errors.append(str(e))
        return errors

    @classmethod
    def is_deploy_tool(cls, tool_name: str) -> bool:
        """Check if a tool call is a deployment action."""
        deploy_tools = {
            "terminal", "write_file", "patch",
            "send_message", "cronjob"
        }
        return tool_name in deploy_tools
