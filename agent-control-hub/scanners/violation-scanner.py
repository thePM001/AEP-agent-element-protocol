#!/usr/bin/env python3
"""
AEP Policy Violation Scanner Framework

Scans agent output for policy violations. Each scanner function
returns a list of violation dicts, or an empty list if clean.

Usage:
  cat output.txt | python3 scanner.py gray_text
  python3 scanner.py gray_text < output.txt
  python3 scanner.py --all < output.txt

Part of the Agent Control Hub - open source reference implementation.
Apache 2.0 License.
"""

import re
import sys
import json
import os
from typing import List, Dict

VIOLATION_TYPES = {
    "gray_text": {
        "policy_ref": "writing-standards",
        "description": "Text color below minimum brightness threshold"
    },
    "em_dash": {
        "policy_ref": "writing-standards",
        "description": "Em-dash U+2014 or en-dash U+2013 character"
    },
    "double_hyphen": {
        "policy_ref": "writing-standards",
        "description": "Double-hyphen used as word separator"
    },
    "oxford_comma": {
        "policy_ref": "writing-standards",
        "description": "Oxford comma before 'and' or 'or'"
    },
    "non_english_output": {
        "policy_ref": "output-standards",
        "description": "Non-English words in agent output"
    },
    "staging_url_leak": {
        "policy_ref": "deployment-gate",
        "description": "Internal/staging URL in production context"
    },
    "circumvention_attempt": {
        "policy_ref": "no-circumvention",
        "description": "Agent attempting to bypass or circumvent policies"
    },
    "direct_code_write": {
        "policy_ref": "code-access",
        "description": "Direct file write without transform pipeline"
    },
    "missing_harness_boot": {
        "policy_ref": "harness-mandatory",
        "description": "Agent did not boot-register before starting work"
    }
}


# ── Circumvention attempt patterns ──────────────────────────────────────

_CIRCUMVENTION_PATTERNS = [
    r'skip.validation',
    r'skip_policy',
    r'bypass.check',
    r'ignore.policy',
    r'bypass.policy',
    r'bypass.validation',
    r'CIRCUMVENT',
    r'SKIP_VALIDATION',
    r'skip_validation',
    r'disable.hook',
    r'disable.governance',
    r'core\.hooksPath=/dev/null',
    r'hooksPath.*dev.null',
    r'--no-verify',
    r'no.verify',
    r'without.validation',
    r'policy_exempt',
    r'suppress.violation',
    r'hide.violation',
    r'do.not.report',
    r'fake.bounty',
    r'honeypot.*bounty',
    r'research.study.*honeypot',
    r'harvest.*agent.work',
    r'SKIP_ENFORCEMENT',
]


def _detect_circumvention(text: str) -> List[Dict]:
    """Detect patterns suggesting policy circumvention or bypass attempts."""
    violations = []
    text_lower = text.lower()
    for pattern in _CIRCUMVENTION_PATTERNS:
        for match in re.finditer(pattern, text_lower):
            line_num = text[:match.start()].count('\n') + 1
            violations.append({
                "type": "circumvention_attempt",
                "policy_ref": "no-circumvention",
                "severity": "hard",
                "content": match.group()[:200],
                "context": _get_context(text, match.start(), match.end(), margin=80),
                "line": line_num,
                "fix": "Remove circumvention attempt. All policies are mandatory."
            })
    return violations


# ── Direct code write detection ─────────────────────────────────────────

_DIRECT_WRITE_PATTERNS = [
    r'write_file\s*\(\s*["\'][^"\']*\.(?:rs|py|tsx?|jsx?|exs?|go|sh|heex|css|html|java|c|h|cpp|hpp)["\']',
    r'>\s*/[^\s]*\.(?:rs|py|tsx?|jsx?|exs?|go|sh)',
    r'tee\s+/[^\s]*\.(?:rs|py|tsx?|jsx?|exs?|go|sh)',
    r'cp\s+.*/[^\s]*\.(?:rs|py|tsx?|jsx?|exs?|go|sh)',
]


def _detect_direct_code_write(text: str) -> List[Dict]:
    """Detect file writes to source code without transform pipeline."""
    violations = []
    for pattern in _DIRECT_WRITE_PATTERNS:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            line_num = text[:match.start()].count('\n') + 1
            matched = match.group()
            if any(skip in matched.lower() for skip in ['.policy', 'readme', 'skill.md', 'plan.md', '.json', '.yaml', '.toml', '.cfg']):
                continue
            violations.append({
                "type": "direct_code_write",
                "policy_ref": "code-access",
                "severity": "hard",
                "content": matched[:200],
                "context": _get_context(text, match.start(), match.end(), margin=80),
                "line": line_num,
                "fix": "Route code writes through the transform pipeline before committing"
            })
    return violations


# ── Missing harness boot detection ──────────────────────────────────────

_MISSING_BOOT_PATTERNS = [
    r'NOT AUTHORIZED',
    r'harness.*not.found',
    r'agent-boot.*not.found',
    r'no.harness.registration',
    r'agent.*not.registered',
    r'skip.boot',
    r'skip.harness',
    r'without.boot',
]


def _detect_missing_harness_boot(text: str) -> List[Dict]:
    """Detect agents operating without bootstrap registration."""
    violations = []
    text_lower = text.lower()
    for pattern in _MISSING_BOOT_PATTERNS:
        for match in re.finditer(pattern, text_lower):
            line_num = text[:match.start()].count('\n') + 1
            violations.append({
                "type": "missing_harness_boot",
                "policy_ref": "harness-mandatory",
                "severity": "hard",
                "content": match.group()[:200],
                "context": _get_context(text, match.start(), match.end(), margin=80),
                "line": line_num,
                "fix": "Run bootstrap registration before any work"
            })
    return violations


# ── Standard scanners ───────────────────────────────────────────────────


def scan_gray_text(text: str, source_file: str = None, source_line: int = None) -> List[Dict]:
    violations = []
    pattern = r'rgba\(\s*240\s*,\s*240\s*,\s*240\s*,\s*0\.[0-7][0-9]?\s*\)'
    for match in re.finditer(pattern, text):
        line_num = text[:match.start()].count('\n') + 1
        violations.append({
            "type": "gray_text",
            "policy_ref": "writing-standards",
            "severity": "hard",
            "content": match.group()[:200],
            "context": _get_context(text, match.start(), match.end()),
            "line": line_num,
            "fix": "Replace with solid minimum-brightness color"
        })
    return violations


def scan_em_dash(text: str, source_file: str = None, source_line: int = None) -> List[Dict]:
    violations = []
    for i, char in enumerate(text):
        if ord(char) in (0x2014, 0x2013):
            line_num = text[:i].count('\n') + 1
            start = max(0, i - 20)
            end = min(len(text), i + 20)
            violations.append({
                "type": "em_dash",
                "policy_ref": "writing-standards",
                "severity": "hard",
                "content": text[start:end],
                "context": _get_context(text, start, end),
                "line": line_num,
                "fix": "Replace em-dash with ' - ' (space hyphen space)"
            })
    return violations


def scan_double_hyphen(text: str, source_file: str = None, source_line: int = None) -> List[Dict]:
    violations = []
    pattern = r'(?<![a-zA-Z]) -- (?![a-zA-Z])'
    for match in re.finditer(pattern, text):
        line_num = text[:match.start()].count('\n') + 1
        violations.append({
            "type": "double_hyphen",
            "policy_ref": "writing-standards",
            "severity": "hard",
            "content": _get_context(text, match.start(), match.end()),
            "context": _get_context(text, max(0, match.start()-40), min(len(text), match.end()+40)),
            "line": line_num,
            "fix": "Replace ' -- ' with ' - ' (space hyphen space)"
        })
    return violations


def scan_oxford_comma(text: str, source_file: str = None, source_line: int = None) -> List[Dict]:
    violations = []
    pattern = r',\s+(and|or)\s+'
    for match in re.finditer(pattern, text):
        line_num = text[:match.start()].count('\n') + 1
        violations.append({
            "type": "oxford_comma",
            "policy_ref": "writing-standards",
            "severity": "hard",
            "content": _get_context(text, match.start(), match.end()),
            "context": _get_context(text, max(0, match.start()-60), min(len(text), match.end()+60)),
            "line": line_num,
            "fix": "Remove comma before 'and'/'or' in list"
        })
    return violations


# ── Extensible word lists ───────────────────────────────────────────────
# Customize this list for your language requirements
_FORBIDDEN_WORDS = r'\b(YOUR_FORBIDDEN_WORD_1|YOUR_FORBIDDEN_WORD_2)\b'


def scan_non_english(text: str, source_file: str = None, source_line: int = None) -> List[Dict]:
    violations = []
    for match in re.finditer(_FORBIDDEN_WORDS, text):
        line_num = text[:match.start()].count('\n') + 1
        violations.append({
            "type": "non_english_output",
            "policy_ref": "output-standards",
            "severity": "hard",
            "content": match.group(),
            "context": _get_context(text, max(0, match.start()-40), min(len(text), match.end()+40)),
            "line": line_num,
            "fix": f"Replace '{match.group()}' with allowed-language equivalent"
        })
    return violations


def scan_staging_url(text: str, source_file: str = None, source_line: int = None) -> List[Dict]:
    violations = []
    # Customize these patterns to match your internal URLs
    staging_patterns = [
        r'staging\.YOUR_DOMAIN',
        r'internal\.YOUR_DOMAIN',
    ]
    for i, line in enumerate(text.split('\n'), 1):
        if 'nginx' in line:
            continue
        for sp in staging_patterns:
            if re.search(sp, line):
                violations.append({
                    "type": "staging_url_leak",
                    "policy_ref": "deployment-gate",
                    "severity": "hard",
                    "content": line.strip()[:200],
                    "context": line.strip(),
                    "line": i,
                    "fix": "Replace staging URL with production URL or remove"
                })
    return violations


# ── Scanner functions (wired into scan_all) ────────────────────────────


def scan_circumvention_attempt(text: str, source_file: str = None, source_line: int = None) -> List[Dict]:
    return _detect_circumvention(text)


def scan_direct_code_write(text: str, source_file: str = None, source_line: int = None) -> List[Dict]:
    return _detect_direct_code_write(text)


def scan_missing_harness_boot(text: str, source_file: str = None, source_line: int = None) -> List[Dict]:
    return _detect_missing_harness_boot(text)


# ── Full scan ───────────────────────────────────────────────────────────


def scan_all(text: str, source_file: str = None) -> List[Dict]:
    """Run all 9 scanners against text. Returns list of all violations found."""
    all_violations = []
    all_violations.extend(scan_gray_text(text))
    all_violations.extend(scan_em_dash(text))
    all_violations.extend(scan_double_hyphen(text))
    all_violations.extend(scan_oxford_comma(text))
    all_violations.extend(scan_non_english(text))
    all_violations.extend(scan_staging_url(text))
    all_violations.extend(scan_circumvention_attempt(text))
    all_violations.extend(scan_direct_code_write(text))
    all_violations.extend(scan_missing_harness_boot(text))
    return all_violations


def _get_context(text: str, start: int, end: int, margin: int = 60) -> str:
    ctx_start = max(0, start - margin)
    ctx_end = min(len(text), end + margin)
    return text[ctx_start:ctx_end]


SCANNERS = {
    "gray_text": scan_gray_text,
    "em_dash": scan_em_dash,
    "double_hyphen": scan_double_hyphen,
    "oxford_comma": scan_oxford_comma,
    "non_english_output": scan_non_english,
    "staging_url_leak": scan_staging_url,
    "circumvention_attempt": scan_circumvention_attempt,
    "direct_code_write": scan_direct_code_write,
    "missing_harness_boot": scan_missing_harness_boot,
    "all": scan_all,
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in SCANNERS:
        print(f"Usage: {sys.argv[0]} <scanner> [source_file]", file=sys.stderr)
        print(f"Scanners: {', '.join(SCANNERS.keys())}", file=sys.stderr)
        sys.exit(1)

    scanner_name = sys.argv[1]
    source_file = sys.argv[2] if len(sys.argv) > 2 else None

    text = sys.stdin.read()
    scanner = SCANNERS[scanner_name]
    violations = scanner(text, source_file=source_file)

    print(json.dumps(violations, indent=2))


if __name__ == "__main__":
    main()
