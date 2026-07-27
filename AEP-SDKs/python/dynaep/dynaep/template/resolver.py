# @PAD: /root/dynAEP/sdk/python/dynaep/template/resolver.py
# ===========================================================================
# dynaep.template.resolver - Template Instance Resolver
# Resolves whether a target element is an AOT-validated template instance.
# Template instances reference a template that passed compile-time
# validation. Runtime mutations targeting template instances skip the
# full validation pipeline (temporal, causal, forecast, structural).
#
# OPT-009: Template Node Validation Fast-Exit
# ===========================================================================

"""Template instance resolver for fast-exit validation."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class FastExitResult:
    """Result of a template fast-exit check."""
    is_template_instance: bool
    template_id: Optional[str]
    stamped_at: Optional[float]


class TemplateInstanceResolver:
    """Resolves template instances with a bounded LRU cache.

    Template instances carry the CN prefix and reference a template that
    has already passed AOT validation. When detected at the top of
    process_event, the full validation pipeline is skipped.
    """

    def __init__(
        self,
        config,  # AEPConfig with is_template_instance method
        max_cache_size: int = 10_000,
        stamp_fast_exit_events: bool = True,
    ) -> None:
        self._config = config
        self._max_cache_size = max_cache_size
        self._stamp_fast_exit_events = stamp_fast_exit_events
        self._cache: dict[str, bool] = {}
        self._fast_exit_count: int = 0
        self._full_pipeline_count: int = 0

    def resolve(self, target_id: str) -> bool:
        """Check whether a target element ID is an AOT-validated template
        instance. Uses a bounded cache for O(1) amortised lookups.

        Args:
            target_id: The element identifier to resolve.

        Returns:
            True if the element is a template instance.
        """
        cached = self._cache.get(target_id)
        if cached is not None:
            return cached

        result = self._config.is_template_instance(target_id)

        # LRU eviction: remove oldest entry if at capacity
        if len(self._cache) >= self._max_cache_size:
            first_key = next(iter(self._cache))
            del self._cache[first_key]

        self._cache[target_id] = result
        return result

    def try_fast_exit(
        self,
        target_id: str,
        bridge_time_ms: float,
    ) -> FastExitResult:
        """Attempt a fast-exit for the given event.

        If the event targets a template instance, returns a FastExitResult
        with is_template_instance=True and increments the fast-exit counter.
        Otherwise returns is_template_instance=False.

        Args:
            target_id: The element identifier from the event.
            bridge_time_ms: The current bridge-authoritative time in ms.

        Returns:
            The fast-exit resolution result.
        """
        is_template = self.resolve(target_id)

        if is_template:
            self._fast_exit_count += 1
            return FastExitResult(
                is_template_instance=True,
                template_id=self._find_template_id(target_id),
                stamped_at=bridge_time_ms if self._stamp_fast_exit_events else None,
            )

        self._full_pipeline_count += 1
        return FastExitResult(
            is_template_instance=False,
            template_id=None,
            stamped_at=None,
        )

    def _find_template_id(self, instance_id: str) -> Optional[str]:
        """Find the template ID that this instance derives from."""
        if hasattr(self._config, "registry"):
            registry = self._config.registry
            if instance_id in registry:
                return instance_id
            prefix = instance_id[:2]
            for key in registry:
                if key.startswith(prefix):
                    return key
        return None

    def get_stats(self) -> dict:
        """Return fast-exit statistics for monitoring."""
        total = self._fast_exit_count + self._full_pipeline_count
        return {
            "fast_exit_count": self._fast_exit_count,
            "full_pipeline_count": self._full_pipeline_count,
            "total_events": total,
            "fast_exit_ratio": self._fast_exit_count / total if total > 0 else 0.0,
            "cache_size": len(self._cache),
        }

    def reset(self) -> None:
        """Reset counters and cache."""
        self._cache.clear()
        self._fast_exit_count = 0
        self._full_pipeline_count = 0

    def prune(self, active_ids: list[str]) -> None:
        """Prune cache entries not in the given set of active element IDs."""
        active_set = set(active_ids)
        to_delete = [k for k in self._cache if k not in active_set]
        for k in to_delete:
            del self._cache[k]
