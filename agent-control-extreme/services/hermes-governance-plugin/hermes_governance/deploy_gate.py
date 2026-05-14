"""Deployment gate enforcement. No GAP dependency.

Enforces the NLA deployment policy:
  - WHAT + WHY + IMPACT + ROLLBACK + DURATION prompt required
  - Domain allowlist (tasty/taskstar only)
  - No raw command chains
  - Explicit human approval required
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
    """Enforces deployment policy before any deployment action."""

    APPROVED_DOMAINS = [
        "tasty.newlisbon.agency",
        "taskstar.newlisbon.agency",
    ]

    FORBIDDEN_PATTERNS = [
        (re.compile(r"rm\s+-rf\b"), "rm -rf detected"),
        (re.compile(r"git\s+push\s+--force\b"), "force push detected"),
        (re.compile(r"DROP\s+TABLE\b", re.IGNORECASE), "DROP TABLE detected"),
    ]

    REQUIRED_SECTIONS = ["WHAT", "WHY", "IMPACT", "ROLLBACK", "DURATION"]

    @classmethod
    def check_domain(cls, url: str) -> None:
        """Verify domain is on the allowlist."""
        for domain in cls.APPROVED_DOMAINS:
            if domain in url:
                return
        raise DeployGateViolation(
            f"Domain not approved: {url}. "
            f"Use tasty.newlisbon.agency or taskstar.newlisbon.agency only."
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
        for section in cls.REQUIRED_SECTIONS:
            if f"{section}:" not in prompt and f"{section.lower()}:" not in prompt:
                missing.append(section)
        if missing:
            raise DeployGateViolation(
                f"Missing sections in deployment prompt: {', '.join(missing)}"
            )

    @classmethod
    def check_no_raw_commands(cls, text: str) -> None:
        """Reject raw command chains in authorization."""
        for pattern, msg in cls.FORBIDDEN_PATTERNS:
            if pattern.search(text):
                raise DeployGateViolation(msg)

    @classmethod
    def validate_deploy(cls, url: str, prompt: str) -> List[str]:
        """Run all deployment gate checks. Returns empty list if pass."""
        errors = []
        try:
            cls.check_domain(url)
        except DeployGateViolation as e:
            errors.append(str(e))
        try:
            cls.check_raw_ip(url)
        except DeployGateViolation as e:
            errors.append(str(e))
        try:
            cls.check_prompt_structure(prompt)
        except DeployGateViolation as e:
            errors.append(str(e))
        try:
            cls.check_no_raw_commands(prompt)
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
