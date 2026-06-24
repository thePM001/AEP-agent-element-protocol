# @PAD: /root/dynAEP/sdk/python/dynaep/lattice/lsh_index.py
# ===========================================================================
# dynaep.lattice.lsh_index - LSH Index with Random Hyperplane Projection
# OPT-007: O(1) expected-time candidate generation for attractor matching.
# ===========================================================================

from __future__ import annotations
import math
import array
from typing import TypeVar, Generic, Dict, List, Tuple, Optional

T = TypeVar("T")


class _SeededRNG:
    """Simple xorshift128+ PRNG for reproducible hyperplanes."""

    def __init__(self, seed: int) -> None:
        self._s0 = (seed & 0x7FFFFFFF) or 1
        self._s1 = ((seed * 2654435761) & 0x7FFFFFFF) or 1

    def next_float(self) -> float:
        s1 = self._s0
        s0 = self._s1
        self._s0 = s0
        s1 ^= (s1 << 23) & 0xFFFFFFFF
        s1 ^= (s1 >> 17)
        s1 ^= s0
        s1 ^= (s0 >> 26)
        self._s1 = s1
        return abs((self._s0 + self._s1) & 0x7FFFFFFF) / 2147483648.0

    def next_gaussian(self) -> float:
        u1 = self.next_float() or 0.0001
        u2 = self.next_float()
        return math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)


class _Entry(Generic[T]):
    __slots__ = ("key", "features", "value")

    def __init__(self, key: str, features: array.array, value: T) -> None:
        self.key = key
        self.features = features
        self.value = value


class LSHIndex(Generic[T]):
    """LSH index using random hyperplane projection."""

    def __init__(
        self,
        num_tables: int = 8,
        hash_dimension: int = 4,
        feature_dimension: int = 48,
        seed: int = 42,
    ) -> None:
        self._num_tables = num_tables
        self._hash_dim = hash_dimension
        self._feat_dim = feature_dimension

        rng = _SeededRNG(seed)
        self._hyperplanes: List[array.array] = []
        for _ in range(num_tables * hash_dimension):
            plane = array.array("f", [rng.next_gaussian() for _ in range(feature_dimension)])
            self._hyperplanes.append(plane)

        self._tables: List[Dict[str, List[_Entry[T]]]] = [{} for _ in range(num_tables)]
        self._key_to_entry: Dict[str, _Entry[T]] = {}

    def insert(self, key: str, features: array.array, value: T) -> None:
        if key in self._key_to_entry:
            self.remove(key)
        entry = _Entry(key, features, value)
        self._key_to_entry[key] = entry
        for t in range(self._num_tables):
            h = self._compute_hash(features, t)
            bucket = self._tables[t].setdefault(h, [])
            bucket.append(entry)

    def query(self, features: array.array) -> List[T]:
        seen = set()
        candidates = []
        for t in range(self._num_tables):
            h = self._compute_hash(features, t)
            bucket = self._tables[t].get(h)
            if bucket:
                for entry in bucket:
                    if entry.key not in seen:
                        seen.add(entry.key)
                        candidates.append(entry.value)
        return candidates

    def remove(self, key: str) -> None:
        entry = self._key_to_entry.pop(key, None)
        if not entry:
            return
        for t in range(self._num_tables):
            h = self._compute_hash(entry.features, t)
            bucket = self._tables[t].get(h)
            if bucket:
                self._tables[t][h] = [e for e in bucket if e.key != key]
                if not self._tables[t][h]:
                    del self._tables[t][h]

    def clear(self) -> None:
        self._key_to_entry.clear()
        for table in self._tables:
            table.clear()

    @property
    def size(self) -> int:
        return len(self._key_to_entry)

    def _compute_hash(self, features: array.array, table_idx: int) -> str:
        bits = []
        base = table_idx * self._hash_dim
        for h in range(self._hash_dim):
            plane = self._hyperplanes[base + h]
            dot = 0.0
            length = min(len(features), len(plane))
            for d in range(length):
                dot += features[d] * plane[d]
            bits.append("1" if dot >= 0 else "0")
        return "".join(bits)
