# @PAD: /root/dynAEP/sdk/python/dynaep/lattice/attractor_index.py
# ===========================================================================
# dynaep.lattice.attractor_index - Attractor Index with LSH
# OPT-007: O(1) expected-time attractor matching with LRU eviction.
# TLA+ invariant MemoryDoesNotAffectDecision preserved.
# ===========================================================================

from __future__ import annotations
import time
from dataclasses import dataclass, field
from typing import Dict, Any, Optional

from .lsh_index import LSHIndex
from .feature_extractor import extract_features, cosine_similarity, FEATURE_DIMENSION

import array


@dataclass
class LedgerAttractor:
    id: str
    features: Dict[str, Any]
    verdict: str  # "accepted" | "rejected"
    inserted_at: float = 0.0
    last_matched_at: float = 0.0


@dataclass
class AttractorStats:
    size: int
    inserts: int
    matches: int
    misses: int
    evictions: int
    avg_candidates: float


class AttractorIndex:
    """Attractor index using LSH for O(1) expected matching."""

    def __init__(
        self,
        max_attractors: int = 2000,
        similarity_threshold: float = 0.95,
        index_type: str = "lsh",
        lsh_tables: int = 8,
        lsh_hash_dimension: int = 4,
    ) -> None:
        self._max = max_attractors
        self._threshold = similarity_threshold
        self._index_type = index_type

        if index_type == "lsh":
            self._lsh: Optional[LSHIndex[str]] = LSHIndex(lsh_tables, lsh_hash_dimension, FEATURE_DIMENSION)
        else:
            self._lsh = None

        self._attractors: Dict[str, LedgerAttractor] = {}
        self._feature_vectors: Dict[str, array.array] = {}
        self._access_order: Dict[str, int] = {}
        self._access_counter = 0

        self._stat_inserts = 0
        self._stat_matches = 0
        self._stat_misses = 0
        self._stat_evictions = 0
        self._total_candidates = 0
        self._total_queries = 0

    def insert(self, attractor: LedgerAttractor) -> None:
        if len(self._attractors) >= self._max:
            self._evict_lru()
        features = extract_features(attractor.features)
        self._attractors[attractor.id] = attractor
        self._feature_vectors[attractor.id] = features
        self._access_order[attractor.id] = self._access_counter
        self._access_counter += 1
        if self._lsh:
            self._lsh.insert(attractor.id, features, attractor.id)
        self._stat_inserts += 1

    def find_match(self, proposal: Dict[str, Any]) -> Optional[LedgerAttractor]:
        proposal_features = extract_features(proposal)
        self._total_queries += 1

        if self._lsh:
            candidates = self._lsh.query(proposal_features)
        else:
            candidates = list(self._attractors.keys())

        self._total_candidates += len(candidates)

        best: Optional[LedgerAttractor] = None
        best_sim = -1.0
        for cid in candidates:
            cf = self._feature_vectors.get(cid)
            if cf is None:
                continue
            sim = cosine_similarity(proposal_features, cf)
            if sim >= self._threshold and sim > best_sim:
                best_sim = sim
                best = self._attractors.get(cid)

        if best:
            best.last_matched_at = time.time()
            self._access_order[best.id] = self._access_counter
            self._access_counter += 1
            self._stat_matches += 1
        else:
            self._stat_misses += 1
        return best

    def remove(self, attractor_id: str) -> None:
        self._attractors.pop(attractor_id, None)
        self._feature_vectors.pop(attractor_id, None)
        self._access_order.pop(attractor_id, None)
        if self._lsh:
            self._lsh.remove(attractor_id)

    def size(self) -> int:
        return len(self._attractors)

    def stats(self) -> AttractorStats:
        return AttractorStats(
            size=len(self._attractors),
            inserts=self._stat_inserts,
            matches=self._stat_matches,
            misses=self._stat_misses,
            evictions=self._stat_evictions,
            avg_candidates=self._total_candidates / self._total_queries if self._total_queries else 0,
        )

    def _evict_lru(self) -> None:
        if not self._access_order:
            return
        oldest_id = min(self._access_order, key=self._access_order.get)  # type: ignore
        self.remove(oldest_id)
        self._stat_evictions += 1
