# @PAD: /root/dynAEP/sdk/python/dynaep/chain/parallel_executor.py
# ===========================================================================
# dynaep.chain.parallel_executor - Parallel Chain Executor (OPT-004)
#
# Restructures the AEP v2.5 15-step evaluation chain into 5 parallel stages.
# Steps within a stage run concurrently via asyncio.gather().
# Stages execute sequentially.
#
# Stage structure (AEP v2.5 Section 3.3.5):
#   Stage A: Steps 0,1,2,3,4  (concurrent, independent reads)
#   Stage B: Steps 5,6,7,8,9  (concurrent, 5←1 session, 6←2 ring)
#   Stage C: Steps 10,11,12   (concurrent, active-mode checks)
#   Stage D: Step 13           (sequential, 13←7 covenant)
#   Stage E: Step 14           (sequential, content scanners)
#
# Estimated improvement: 30-50% cold-path latency reduction.
# ===========================================================================

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from dynaep.chain.types import (
    CHAIN_STEP_COUNT,
    ChainExecutor,
    ChainInput,
    ChainResult,
    StepExecutor,
    StepResult,
    create_not_executed_entry,
)


# ---------------------------------------------------------------------------
# Internal types
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _StageDefinition:
    label: str
    step_numbers: tuple[int, ...]


@dataclass
class _StageResult:
    rejected: bool
    rejection_step: Optional[int]
    rejection_reason: Optional[str]


# ---------------------------------------------------------------------------
# Stage topology (verified against AEP v2.5 Section 3.3.5)
# ---------------------------------------------------------------------------

_STAGES: tuple[_StageDefinition, ...] = (
    _StageDefinition(label="A", step_numbers=(0, 1, 2, 3, 4)),
    _StageDefinition(label="B", step_numbers=(5, 6, 7, 8, 9)),
    _StageDefinition(label="C", step_numbers=(10, 11, 12)),
    _StageDefinition(label="D", step_numbers=(13,)),
    _StageDefinition(label="E", step_numbers=(14,)),
)


# ---------------------------------------------------------------------------
# Executor
# ---------------------------------------------------------------------------

class ParallelChainExecutor(ChainExecutor):
    def __init__(self, steps: list[StepExecutor]) -> None:
        if len(steps) != CHAIN_STEP_COUNT:
            raise ValueError(
                f"Chain requires exactly {CHAIN_STEP_COUNT} steps, got {len(steps)}"
            )
        self._step_map: dict[int, StepExecutor] = {s.step: s for s in steps}

    async def execute(self, input: ChainInput) -> ChainResult:
        ledger: list[Optional[StepResult]] = [None] * CHAIN_STEP_COUNT
        context: dict[str, Any] = {}
        chain_start = time.perf_counter()

        for stage_idx, stage in enumerate(_STAGES):
            stage_result = await self._execute_stage(
                stage, input, context, ledger
            )

            if stage_result.rejected:
                # Fill all steps from subsequent stages with not-executed entries
                abort_reason = f"stage_{stage.label}_rejection"
                for future_idx in range(stage_idx + 1, len(_STAGES)):
                    for step_num in _STAGES[future_idx].step_numbers:
                        step = self._step_map.get(step_num)
                        ledger[step_num] = create_not_executed_entry(
                            step_num,
                            step.name if step else f"step_{step_num}",
                            step.mode if step else "always",
                            abort_reason,
                        )

                elapsed_us = (time.perf_counter() - chain_start) * 1_000_000
                # Type assertion: all entries are populated at this point
                final_ledger: list[StepResult] = [
                    e for e in ledger if e is not None
                ]
                return ChainResult(
                    verdict="reject",
                    rejection_step=stage_result.rejection_step,
                    rejection_reason=stage_result.rejection_reason,
                    ledger=final_ledger,
                    total_duration_us=elapsed_us,
                )

        elapsed_us = (time.perf_counter() - chain_start) * 1_000_000
        final_ledger = [e for e in ledger if e is not None]
        return ChainResult(
            verdict="pass",
            rejection_step=None,
            rejection_reason=None,
            ledger=final_ledger,
            total_duration_us=elapsed_us,
        )

    async def _execute_stage(
        self,
        stage: _StageDefinition,
        input: ChainInput,
        context: dict[str, Any],
        ledger: list[Optional[StepResult]],
    ) -> _StageResult:
        """
        Execute all steps in a stage concurrently via asyncio.gather().

        All steps within a stage MUST complete before any result is inspected.
        Exceptions are caught per-step and treated as hard rejections.
        """
        # Snapshot context for this stage (read-only within stage)
        stage_context = dict(context)

        async def _run_step(step_num: int) -> StepResult:
            step = self._step_map.get(step_num)
            if step is None:
                raise RuntimeError(f"Missing step executor for step {step_num}")
            try:
                return await step.execute(input, stage_context)
            except Exception as exc:
                return StepResult(
                    step=step_num,
                    name=step.name,
                    mode=step.mode,
                    verdict="reject",
                    verdict_reason=f"exception: {exc}",
                    duration_us=0.0,
                    timestamp=datetime.now(timezone.utc).isoformat(),
                )

        # Collect ALL results - do not short-circuit within a stage
        results = await asyncio.gather(
            *(_run_step(sn) for sn in stage.step_numbers)
        )

        # Place results into ledger at correct indices and update context
        for result in results:
            ledger[result.step] = result
            context[f"step_{result.step}_result"] = result

        # Check for any rejection verdict (lowest step number first)
        rejections = sorted(
            [r for r in results if r.verdict == "reject"],
            key=lambda r: r.step,
        )

        if rejections:
            return _StageResult(
                rejected=True,
                rejection_step=rejections[0].step,
                rejection_reason=rejections[0].verdict_reason,
            )

        return _StageResult(
            rejected=False,
            rejection_step=None,
            rejection_reason=None,
        )
