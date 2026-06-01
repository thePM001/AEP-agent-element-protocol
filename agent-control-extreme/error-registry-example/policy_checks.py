"""
Example policy check functions for an agent error registry.

Each function takes text and returns a list of finding dicts.
Add your own check functions and register them in CHECKS below.
"""

import re
from typing import List, Dict


def check_forbidden_chars(text: str) -> List[Dict]:
    """Detect forbidden unicode characters."""
    findings = []
    for i, char in enumerate(text):
        code = ord(char)
        if code == 0x2014 or code == 0x2013:
            line_num = text[:i].count('\n') + 1
            start = max(0, i - 30)
            end = min(len(text), i + 30)
            findings.append({
                "check": "forbidden_char",
                "detail": f"U+{code:04X}",
                "line": line_num,
                "snippet": text[start:end].strip(),
                "fix": "Replace with ' - ' (space hyphen space)"
            })
    return findings


def check_low_contrast(text: str) -> List[Dict]:
    """Detect rgba colors with opacity below threshold."""
    findings = []
    pattern = r'rgba\(\s*240\s*,\s*240\s*,\s*240\s*,\s*(0\.[0-7][0-9]?)\s*\)'
    for match in re.finditer(pattern, text):
        opacity = float(match.group(1))
        if opacity < 0.88:
            line_num = text[:match.start()].count('\n') + 1
            findings.append({
                "check": "low_contrast",
                "detail": f"opacity={opacity} (minimum 0.88)",
                "line": line_num,
                "snippet": match.group(),
                "fix": "Use solid #F0F0F0 or opacity >= 0.88"
            })
    return findings


def check_banned_words(text: str, word_list: List[str] = None) -> List[Dict]:
    """Detect banned words in agent output."""
    if word_list is None:
        word_list = ["example_banned_term_1", "example_banned_term_2"]
    findings = []
    text_lower = text.lower()
    for word in word_list:
        pattern = r'\b' + re.escape(word.lower()) + r'\b'
        for match in re.finditer(pattern, text_lower):
            line_num = text[:match.start()].count('\n') + 1
            findings.append({
                "check": "banned_word",
                "detail": word,
                "line": line_num,
                "snippet": match.group(),
                "fix": f"Remove or replace '{word}'"
            })
    return findings


def check_double_hyphen(text: str) -> List[Dict]:
    """Detect double-hyphen used as word separator."""
    findings = []
    pattern = r'(?<![a-zA-Z0-9-]) -- (?![a-zA-Z0-9-])'
    for match in re.finditer(pattern, text):
        line_num = text[:match.start()].count('\n') + 1
        start = max(0, match.start() - 40)
        end = min(len(text), match.end() + 40)
        findings.append({
            "check": "double_hyphen",
            "detail": "Word separator should be single hyphen",
            "line": line_num,
            "snippet": text[start:end].strip(),
            "fix": "Replace ' -- ' with ' - '"
        })
    return findings


def check_url_patterns(text: str, url_patterns: List[str] = None) -> List[Dict]:
    """Detect internal/staging URLs in output."""
    if url_patterns is None:
        url_patterns = [r'staging\.example\.com', r'internal\.example\.net']
    findings = []
    for pattern in url_patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            line_num = text[:match.start()].count('\n') + 1
            findings.append({
                "check": "internal_url",
                "detail": pattern,
                "line": line_num,
                "snippet": match.group(),
                "fix": "Replace with production URL or remove"
            })
    return findings


# Register your check functions here
CHECKS = {
    "forbidden_chars": check_forbidden_chars,
    "low_contrast": check_low_contrast,
    "banned_words": check_banned_words,
    "double_hyphen": check_double_hyphen,
    "url_patterns": check_url_patterns,
}
