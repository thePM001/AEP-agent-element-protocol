# @PAD: /root/dynAEP/sdk/python/dynaep/lattice/feature_extractor.py
# ===========================================================================
# dynaep.lattice.feature_extractor - Feature Extraction for Attractor LSH
# OPT-007: Converts proposals/attractors into fixed-dimension feature vectors.
# ===========================================================================

from __future__ import annotations
import math
from typing import Dict, Any, List
import array

FEATURE_DIMENSION = 48

ELEMENT_TYPES: List[str] = [
    "SH", "PN", "CP", "NV", "CZ", "CN", "TB", "WD",
    "OV", "MD", "DD", "TT", "FM", "IC",
]

MUTATION_TYPES: List[str] = [
    "create", "update", "delete", "move", "reparent",
    "restyle", "reorder", "state_change",
]


def _string_hash(s: str) -> float:
    h = 0
    for c in s:
        h = ((h << 5) - h + ord(c)) & 0xFFFFFFFF
    return (h % 10000) / 10000


def extract_features(source: Dict[str, Any]) -> array.array:
    """Extract a 48-dimensional feature vector from a proposal/attractor dict."""
    features = array.array("f", [0.0] * FEATURE_DIMENSION)

    # Element type one-hot [0-13]
    elem_type = source.get("elementType") or source.get("element_type", "")
    if not elem_type and "id" in source:
        elem_type = str(source["id"])[:2]
    if elem_type:
        prefix = elem_type[:2].upper()
        if prefix in ELEMENT_TYPES:
            features[ELEMENT_TYPES.index(prefix)] = 1.0

    # Z-band [14]
    z_band = source.get("zBand", source.get("z_band"))
    if z_band is not None:
        features[14] = min(1.0, max(0.0, z_band / 1000))

    # Parent type one-hot [15-28]
    parent_type = source.get("parentType", source.get("parent_type", ""))
    if parent_type:
        prefix = parent_type[:2].upper()
        if prefix in ELEMENT_TYPES:
            features[15 + ELEMENT_TYPES.index(prefix)] = 1.0

    # Mutation type one-hot [29-36]
    mut_type = source.get("mutationType", source.get("mutation_type", ""))
    if mut_type and mut_type.lower() in MUTATION_TYPES:
        features[29 + MUTATION_TYPES.index(mut_type.lower())] = 1.0

    # Constraint count [37]
    cc = source.get("constraintCount", source.get("constraint_count"))
    if cc is not None:
        features[37] = min(1.0, cc / 20)

    # Skin binding [38]
    sb = source.get("skinBinding", source.get("skin_binding"))
    if sb:
        features[38] = _string_hash(str(sb))

    # State count [39]
    sc = source.get("stateCount", source.get("state_count"))
    if sc is not None:
        features[39] = min(1.0, sc / 10)

    # Has children [40]
    hc = source.get("hasChildren", source.get("has_children"))
    if hc is not None:
        features[40] = 1.0 if hc else 0.0

    # Depth [41]
    depth = source.get("depth")
    if depth is not None:
        features[41] = min(1.0, depth / 20)

    return features


def cosine_similarity(a: array.array, b: array.array) -> float:
    """Compute cosine similarity between two feature vectors."""
    length = min(len(a), len(b))
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for i in range(length):
        dot += a[i] * b[i]
        norm_a += a[i] * a[i]
        norm_b += b[i] * b[i]
    denom = math.sqrt(norm_a) * math.sqrt(norm_b)
    if denom == 0:
        return 0.0
    return dot / denom
