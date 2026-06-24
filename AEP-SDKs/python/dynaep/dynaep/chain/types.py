# @PAD: /root/dynAEP/sdk/python/dynaep/chain/types.py
# ===========================================================================
# dynaep.chain.types - Chain Executor Types
# AEP v2.5 Section 3.3: 15-Step Evaluation Chain
# ===========================================================================

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, Optional, Protocol


StepMode = Literal["always", "active"]
StepVerdict = Literal["pass", "reject"]


@dataclass(frozen=True)
class StepResult:
    """Result of executing a single chain step."""
    step: int
    name: str
    mode: StepMode
    verdict: StepVerdict
    verdict_reason: str
    duration_us: float
    timestamp: str
    abort_reason: Optional[str] = None


@dataclass(frozen=True)
class ChainResult:
    """Complete result of the 15-step chain evaluation."""
    verdict: StepVerdict
    rejection_step: Optional[int]
    rejection_reason: Optional[str]
    ledger: list[StepResult]
    total_duration_us: float


@dataclass(frozen=True)
class ChainInput:
    """Input to the chain executor."""
    event: dict[str, Any]
    context: dict[str, Any]


@dataclass
class ChainExecutionConfig:
    """Chain execution configuration."""
    mode: Literal["parallel", "sequential"] = "parallel"


class StepExecutor(Protocol):
    """Interface for a single step executor."""

    @property
    def step(self) -> int: ...

    @property
    def name(self) -> str: ...

    @property
    def mode(self) -> StepMode: ...

    async def execute(
        self, input: ChainInput, context: dict[str, Any]
    ) -> StepResult: ...


class ChainExecutor(abc.ABC):
    """Interface for chain executors (parallel or sequential)."""

    @abc.abstractmethod
    async def execute(self, input: ChainInput) -> ChainResult: ...


CHAIN_STEP_COUNT = 15

STEP_DEFINITIONS: list[dict[str, str]] = [
    {"name": "config_lookup", "mode": "always"},      # 0
    {"name": "session_check", "mode": "always"},       # 1
    {"name": "ring_check", "mode": "always"},          # 2
    {"name": "counter_check", "mode": "always"},       # 3
    {"name": "rate_limit", "mode": "always"},          # 4
    {"name": "intent_drift", "mode": "active"},        # 5
    {"name": "escalation_check", "mode": "active"},    # 6
    {"name": "covenant_check", "mode": "always"},      # 7
    {"name": "rego_policy", "mode": "always"},         # 8
    {"name": "capability_trust", "mode": "always"},    # 9
    {"name": "scope_boundary", "mode": "active"},      # 10
    {"name": "mutation_guard", "mode": "active"},      # 11
    {"name": "temporal_fence", "mode": "active"},      # 12
    {"name": "knowledge_check", "mode": "active"},     # 13
    {"name": "content_scan", "mode": "always"},        # 14
]


def create_not_executed_entry(
    step: int,
    name: str,
    mode: StepMode,
    abort_reason: str,
) -> StepResult:
    """
    Create a not-executed ledger entry for steps skipped due to early abort.
    These entries count as PASS for ledger completeness but are clearly
    distinguishable from actual evaluations.
    """
    return StepResult(
        step=step,
        name=name,
        mode=mode,
        verdict="pass",
        verdict_reason="not_executed_early_abort",
        duration_us=0.0,
        timestamp=datetime.now(timezone.utc).isoformat(),
        abort_reason=abort_reason,
    )
