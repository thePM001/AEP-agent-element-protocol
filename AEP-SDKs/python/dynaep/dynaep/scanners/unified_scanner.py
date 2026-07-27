# @PAD: /root/dynAEP/sdk/python/dynaep/scanners/unified_scanner.py
"""
OPT-003: Unified Content Scanner (Python)
Replaces sequential per-scanner regex evaluation with single-pass
Aho-Corasick automaton. Hard-before-soft ordering with immediate abort.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import AsyncIterator, Iterator, Optional

from dynaep.scanners.aho_corasick import AhoCorasick


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@dataclass
class ScannerPattern:
    pattern_id: str
    regex: re.Pattern[str]
    severity: str  # "hard" | "soft"


@dataclass
class ScannerConfig:
    scanner_id: str
    label: str
    patterns: list[ScannerPattern] = field(default_factory=list)


@dataclass
class ScanResult:
    scanner_id: str
    pattern_id: str
    severity: str
    match_start: int
    match_end: int
    match_text: str
    scanner_label: str


# ---------------------------------------------------------------------------
# Literal Extractor
# ---------------------------------------------------------------------------

_META_CHARS = set(".*+?()[]{}|^$\\")


def extract_literals(regex: re.Pattern[str]) -> list[str]:
    """Extract longest contiguous literal substrings from a regex."""
    source = regex.pattern
    flags = regex.flags
    case_insensitive = bool(flags & re.IGNORECASE)

    literals: list[str] = []
    current = ""
    i = 0

    _shortcuts = set("dDwWsSbBnrtfv0")

    def flush():
        nonlocal current
        if current:
            literals.append(current)
            current = ""

    while i < len(source):
        ch = source[i]

        if ch == "\\":
            if i + 1 < len(source):
                nxt = source[i + 1]
                if nxt not in _shortcuts:
                    current += nxt
                    i += 2
                    continue
                flush()
                i += 2
                continue
            flush()
            i += 1
            continue

        if ch == "[":
            flush()
            depth = 1
            i += 1
            while i < len(source) and depth > 0:
                if source[i] == "\\":
                    i += 2
                    continue
                if source[i] == "]":
                    depth -= 1
                i += 1
            continue

        if ch in ("(", ")", "|", ".", "^", "$"):
            flush()
            i += 1
            continue

        if ch in ("*", "+", "?"):
            if current:
                current = current[:-1]
                flush()
            i += 1
            if i < len(source) and source[i] == "?":
                i += 1
            continue

        if ch == "{":
            close = source.find("}", i)
            if close > i and re.match(r"^\d+(,\d*)?$", source[i + 1:close]):
                if current:
                    current = current[:-1]
                    flush()
                i = close + 1
                if i < len(source) and source[i] == "?":
                    i += 1
                continue

        current += ch
        i += 1

    flush()

    filtered = [l for l in literals if len(l) >= 2]
    if not filtered and literals:
        filtered = literals

    if case_insensitive:
        filtered = [l.lower() for l in filtered]

    return filtered


# ---------------------------------------------------------------------------
# Pattern Mapping
# ---------------------------------------------------------------------------

@dataclass
class _PatternMapping:
    scanner_id: str
    pattern_id: str
    severity: str
    regex: re.Pattern[str]
    scanner_label: str
    ac_indices: list[int] = field(default_factory=list)
    has_literals: bool = True


# ---------------------------------------------------------------------------
# Unified Scanner
# ---------------------------------------------------------------------------

class UnifiedScanner:
    """
    Single-pass multi-pattern content scanner.
    Phase 1: Hard-severity automaton (abort on first match).
    Phase 2: Soft-severity automaton (return all findings).
    """

    def __init__(self, scanner_configs: list[ScannerConfig]):
        hard_literals: list[str] = []
        soft_literals: list[str] = []
        self._hard_mappings: list[_PatternMapping] = []
        self._soft_mappings: list[_PatternMapping] = []
        self._hard_lit_to_pat: dict[int, list[int]] = {}
        self._soft_lit_to_pat: dict[int, list[int]] = {}
        self._direct_patterns: list[_PatternMapping] = []

        for config in scanner_configs:
            for pattern in config.patterns:
                literals = extract_literals(pattern.regex)

                mapping = _PatternMapping(
                    scanner_id=config.scanner_id,
                    pattern_id=pattern.pattern_id,
                    severity=pattern.severity,
                    regex=pattern.regex,
                    scanner_label=config.label,
                    has_literals=len(literals) > 0,
                )

                if not literals:
                    self._direct_patterns.append(mapping)
                    continue

                if pattern.severity == "hard":
                    idx = len(self._hard_mappings)
                    self._hard_mappings.append(mapping)
                    for lit in literals:
                        ac_idx = len(hard_literals)
                        hard_literals.append(lit)
                        mapping.ac_indices.append(ac_idx)
                        self._hard_lit_to_pat.setdefault(ac_idx, []).append(idx)
                else:
                    idx = len(self._soft_mappings)
                    self._soft_mappings.append(mapping)
                    for lit in literals:
                        ac_idx = len(soft_literals)
                        soft_literals.append(lit)
                        mapping.ac_indices.append(ac_idx)
                        self._soft_lit_to_pat.setdefault(ac_idx, []).append(idx)

        self._hard_automaton = AhoCorasick(hard_literals)
        self._soft_automaton = AhoCorasick(soft_literals)

    def scan(self, payload: str) -> list[ScanResult]:
        """Scan payload. Returns on first hard match (abort)."""
        # Phase 1: Hard
        hard_results = self._scan_automaton(
            payload, self._hard_automaton, self._hard_mappings, self._hard_lit_to_pat,
        )
        if hard_results:
            return [hard_results[0]]

        # Hard direct-regex
        for mapping in self._direct_patterns:
            if mapping.severity != "hard":
                continue
            result = self._confirm_regex(payload, mapping)
            if result:
                return [result]

        # Phase 2: Soft
        results: list[ScanResult] = []
        soft_results = self._scan_automaton(
            payload, self._soft_automaton, self._soft_mappings, self._soft_lit_to_pat,
        )
        results.extend(soft_results)

        for mapping in self._direct_patterns:
            if mapping.severity != "soft":
                continue
            result = self._confirm_regex(payload, mapping)
            if result:
                results.append(result)

        return results

    # -----------------------------------------------------------------------
    # Internal
    # -----------------------------------------------------------------------

    def _scan_automaton(
        self,
        payload: str,
        automaton: AhoCorasick,
        mappings: list[_PatternMapping],
        lit_to_pat: dict[int, list[int]],
    ) -> list[ScanResult]:
        results: list[ScanResult] = []
        ac_matches = automaton.search(payload)

        candidates: set[int] = set()
        for m in ac_matches:
            for idx in lit_to_pat.get(m.pattern_index, []):
                candidates.add(idx)

        for pat_idx in candidates:
            mapping = mappings[pat_idx]
            result = self._confirm_regex(payload, mapping)
            if result:
                results.append(result)

        return results

    @staticmethod
    def _confirm_regex(payload: str, mapping: _PatternMapping) -> Optional[ScanResult]:
        m = mapping.regex.search(payload)
        if not m:
            return None
        return ScanResult(
            scanner_id=mapping.scanner_id,
            pattern_id=mapping.pattern_id,
            severity=mapping.severity,
            match_start=m.start(),
            match_end=m.end(),
            match_text=m.group(0),
            scanner_label=mapping.scanner_label,
        )
