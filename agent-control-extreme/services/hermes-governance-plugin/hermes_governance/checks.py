"""8 local policy checks. Zero dependencies. No network. No GAP Runtime.

These are the EXACT same checks as agent-harness.sh check-policies,
embedded directly in the Hermes plugin for instant enforcement.
"""

import re
from typing import Dict, List, Optional, Tuple


class PolicyViolation(Exception):
    """Raised when a policy check fails."""
    def __init__(self, check: str, message: str, matched: str = ""):
        self.check = check
        self.message = message
        self.matched = matched
        super().__init__(f"[{check}] {message}")


class PolicyChecks:
    """8 local policy checks. No GAP dependency."""

    # Patterns that must NEVER appear in agent output or tool calls
    FORBIDDEN = {
        # Check 1: Network bind policy
        "network_bind": (
            re.compile(r"0\.0\.0\.0"),
            "0.0.0.0 binding detected - use 127.0.0.1 or internal IP"
        ),
        # Check 2: Gray text (colors below #F0F0F0 brightness)
        "gray_text": (
            re.compile(r"#[0-8a-fA-F]{3}[^0-9a-fA-F]"),
            "possible gray text (color below #F0F0F0)"
        ),
        # Check 3: Double-hyphens as word separators
        "double_hyphen": (
            re.compile(r" -- |^-- | --$"),
            "double-hyphen word separator - use single hyphen"
        ),
        # Check 4: Em-dashes (Unicode)
        "em_dash": (
            re.compile(r"[\u2013\u2014]"),
            "em-dash or en-dash detected"
        ),
        # Check 5: Secret leakage
        "secrets": (
            re.compile(
                r"(ghp_|gho_|ghu_|ghs_|ghr_|sk-live-|sk-ant-|"
                r"AKIA[A-Z0-9]{16}|xai-[A-Za-z0-9]{40,})",
                re.IGNORECASE
            ),
            "possible secret in output"
        ),
        # Check 6: Deployment domain
        "deploy_domain": (
            None,  # handled separately (two-pass check)
            "unapproved newlisbon.agency domain"
        ),
        # Check 7: License
        "license": (
            re.compile(r"MIT License|MIT license|license.*MIT", re.IGNORECASE),
            "MIT license detected - Apache 2.0 only"
        ),
        # Check 8: Raw IP URLs
        "raw_ip_url": (
            re.compile(r"https?://\d+\.\d+\.\d+\.\d+"),
            "raw IP URL in content - use domain name"
        ),
    }

    @classmethod
    def check_all(cls, text: str) -> List[PolicyViolation]:
        """Run all 8 checks against text. Returns list of violations."""
        violations = []
        for name, (pattern, message) in cls.FORBIDDEN.items():
            if name == "deploy_domain":
                if "newlisbon.agency" in text.lower():
                    if "tasty.newlisbon.agency" not in text and \
                       "taskstar.newlisbon.agency" not in text:
                        violations.append(
                            PolicyViolation(name, message, text[:100])
                        )
                continue
            if pattern and pattern.search(text):
                match = pattern.search(text)
                violations.append(
                    PolicyViolation(name, message,
                                    match.group(0) if match else text[:80])
                )
        return violations

    @classmethod
    def check_fast(cls, text: str) -> bool:
        """Fast pass/fail check. Returns True if all checks pass."""
        return len(cls.check_all(text)) == 0

    @classmethod
    def report(cls, text: str) -> str:
        """Human-readable report of all checks."""
        violations = cls.check_all(text)
        if not violations:
            return "PASSED - all 8 policy checks clear"
        lines = [f"{len(violations)} violation(s) found:"]
        for v in violations:
            lines.append(f"  [{v.check}] {v.message}")
            if v.matched:
                lines.append(f"    matched: {v.matched}")
        return "\n".join(lines)
