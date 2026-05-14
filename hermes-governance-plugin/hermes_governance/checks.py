"""8 local policy checks. Zero dependencies. No network. No external services.

Embedded directly in the Hermes plugin for instant enforcement.
All checks are configurable via environment variables.
"""

import os
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
    """Configurable local policy checks. No external dependencies.

    Environment variables for customization:
      POLICY_NETWORK_BIND:    regex for forbidden bind addresses (default: 0.0.0.0)
      POLICY_GRAY_TEXT:       regex for gray text detection
      POLICY_DOUBLE_HYPHEN:   regex for double-hyphen word separators
      POLICY_EM_DASH:         regex for em-dash Unicode
      POLICY_SECRETS:         regex for secret patterns
      POLICY_DOMAIN:          allowlisted domain pattern (default: none)
      POLICY_LICENSE:         forbidden license pattern (default: none)
      POLICY_RAW_IP:          regex for raw IP URLs
    """

    @classmethod
    def _get_pattern(cls, name: str, default: str) -> Optional[re.Pattern]:
        val = os.environ.get(f"POLICY_{name.upper()}", default)
        if val:
            flags = re.IGNORECASE if "secret" in name or "license" in name else 0
            return re.compile(val, flags)
        return None

    @classmethod
    def check_all(cls, text: str) -> List[PolicyViolation]:
        """Run all configured checks against text. Returns list of violations."""
        violations = []

        # Check 1: Forbidden bind addresses
        pat = cls._get_pattern("network_bind", r"0\.0\.0\.0")
        if pat and pat.search(text):
            m = pat.search(text)
            violations.append(PolicyViolation(
                "network_bind",
                "forbidden bind address detected",
                m.group(0) if m else text[:80]
            ))

        # Check 2: Gray text
        pat = cls._get_pattern("gray_text", r"#[0-8a-fA-F]{3}[^0-9a-fA-F]")
        if pat and pat.search(text):
            violations.append(PolicyViolation(
                "gray_text",
                "possible gray text (low brightness color)",
                ""
            ))

        # Check 3: Double-hyphens as word separators
        pat = cls._get_pattern("double_hyphen", r" -- |^-- | --$")
        if pat and pat.search(text):
            violations.append(PolicyViolation(
                "double_hyphen",
                "double-hyphen word separator (use single hyphen)",
                ""
            ))

        # Check 4: Em-dashes
        pat = cls._get_pattern("em_dash", r"[\u2013\u2014]")
        if pat and pat.search(text):
            violations.append(PolicyViolation(
                "em_dash",
                "em-dash or en-dash detected",
                ""
            ))

        # Check 5: Secret leakage
        pat = cls._get_pattern("secrets",
            r"(ghp_|gho_|ghu_|ghs_|ghr_|sk-live-|sk-ant-|"
            r"AKIA[A-Z0-9]{16}|xai-[A-Za-z0-9]{40,})")
        if pat and pat.search(text):
            m = pat.search(text)
            violations.append(PolicyViolation(
                "secrets",
                "possible secret in output",
                m.group(0)[:40] if m else ""
            ))

        # Check 6: Domain policy (configurable allowlist)
        domain_pat = os.environ.get("POLICY_DOMAIN_ALLOWLIST", "")
        if domain_pat:
            # If allowlist is set, flag domains NOT on the list
            if re.search(r"https?://[^\s]+", text):
                allowed = [d.strip() for d in domain_pat.split(",")]
                urls = re.findall(r"https?://[^\s\"'>]+", text)
                for url in urls:
                    if not any(d in url for d in allowed):
                        violations.append(PolicyViolation(
                            "deploy_domain",
                            f"domain not in allowlist: {url}",
                            url[:80]
                        ))

        # Check 7: Forbidden license
        pat = cls._get_pattern("license", "")
        if pat and pat.search(text):
            violations.append(PolicyViolation(
                "license",
                "forbidden license reference detected",
                ""
            ))

        # Check 8: Raw IP URLs
        pat = cls._get_pattern("raw_ip", r"https?://\d+\.\d+\.\d+\.\d+")
        if pat and pat.search(text):
            m = pat.search(text)
            violations.append(PolicyViolation(
                "raw_ip_url",
                "raw IP URL in content (use domain name)",
                m.group(0) if m else ""
            ))

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
            return "PASSED - all policy checks clear"
        lines = [f"{len(violations)} violation(s) found:"]
        for v in violations:
            lines.append(f"  [{v.check}] {v.message}")
            if v.matched:
                lines.append(f"    matched: {v.matched}")
        return "\n".join(lines)
