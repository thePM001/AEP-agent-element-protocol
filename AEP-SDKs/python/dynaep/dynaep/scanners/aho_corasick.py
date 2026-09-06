# @PAD: /root/dynAEP/sdk/python/dynaep/scanners/aho_corasick.py
"""
OPT-003: Aho-Corasick Multi-Pattern String Matching (Python)
Pure Python implementation. No external dependencies.
Falls back to pyahocorasick if available for better performance.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Optional

try:
    import ahocorasick as _pyac
    _HAS_PYAHOCORASICK = True
except ImportError:
    _HAS_PYAHOCORASICK = False


@dataclass
class AhoCorasickMatch:
    pattern_index: int
    start: int
    end: int
    text: str


class _TrieNode:
    __slots__ = ("children", "fail", "output", "depth")

    def __init__(self, depth: int = 0):
        self.children: dict[str, _TrieNode] = {}
        self.fail: Optional[_TrieNode] = None
        self.output: list[int] = []
        self.depth: int = depth


class AhoCorasick:
    """
    Pure Python Aho-Corasick automaton.
    Single-pass O(n + m) text scanning for all registered patterns.
    """

    def __init__(self, patterns: list[str], case_sensitive: bool = False):
        self._patterns = patterns
        self._case_sensitive = case_sensitive
        self._root = _TrieNode(0)
        self._root.fail = self._root
        self._build()

    def search(self, text: str) -> list[AhoCorasickMatch]:
        """Search text in a single pass. Returns all matches."""
        if not self._patterns:
            return []

        matches: list[AhoCorasickMatch] = []
        current = self._root
        search_text = text if self._case_sensitive else text.lower()

        for i, ch in enumerate(search_text):
            while current is not self._root and ch not in current.children:
                current = current.fail  # type: ignore

            if ch in current.children:
                current = current.children[ch]

            output_node: Optional[_TrieNode] = current
            while output_node is not None and output_node is not self._root:
                for pat_idx in output_node.output:
                    pat_len = len(self._patterns[pat_idx])
                    start = i - pat_len + 1
                    matches.append(AhoCorasickMatch(
                        pattern_index=pat_idx,
                        start=start,
                        end=i + 1,
                        text=text[start:i + 1],
                    ))
                output_node = output_node.fail
                if output_node is self._root:
                    break

        return matches

    @property
    def pattern_count(self) -> int:
        return len(self._patterns)

    def _build(self) -> None:
        self._build_trie()
        self._build_failure_links()

    def _build_trie(self) -> None:
        for i, pattern in enumerate(self._patterns):
            p = pattern if self._case_sensitive else pattern.lower()
            current = self._root
            for j, ch in enumerate(p):
                if ch not in current.children:
                    current.children[ch] = _TrieNode(j + 1)
                current = current.children[ch]
            current.output.append(i)

    def _build_failure_links(self) -> None:
        queue: deque[_TrieNode] = deque()

        for child in self._root.children.values():
            child.fail = self._root
            queue.append(child)

        while queue:
            current = queue.popleft()

            for ch, child in current.children.items():
                queue.append(child)

                fail_node = current.fail
                while fail_node is not self._root and ch not in fail_node.children:
                    fail_node = fail_node.fail  # type: ignore

                child.fail = fail_node.children.get(ch, self._root)
                if child.fail is child:
                    child.fail = self._root

                child.output = child.output + child.fail.output
