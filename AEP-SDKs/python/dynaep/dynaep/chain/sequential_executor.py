# @PAD: /root/dynAEP/sdk/python/dynaep/chain/sequential_executor.py
# ===========================================================================
# dynaep.chain.sequential_executor - Sequential Chain Executor
# Executes all 15 steps in fixed order (Step 0 → Step 14).
# Preserves original AEP v2.5 behaviour for debugging and regression
# comparison against the parallel executor.
# ===========================================================================

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from dynaep.chain.types import (
    CHAIN_STEP_COUNT,
    ChainExecutor,
    ChainInput,
    ChainResult,
    StepExecutor,
    StepResult,
    create_not_executed_entry,
)


class SequentialChainExecutor(ChainExecutor):
    def __init__(self, steps: list[StepExecutor]) -> None:
        if len(steps) != CHAIN_STEP_COUNT:
            raise ValueError(
                f"Chain requires exactly {CHAIN_STEP_COUNT} steps, got {len(steps)}"
            )
        self._steps = sorted(steps, key=lambda s: s.step)

    async def execute(self, input: ChainInput) -> ChainResult:
        ledger: list[StepResult] = []
        context: dict[str, Any] = {}
        chain_start = time.perf_counter()

        for step in self._steps:
            try:
                result = await step.execute(input, context)
            except Exception as exc:
                result = StepResult(
                    step=step.step,
                    name=step.name,
                    mode=step.mode,
                    verdict="reject",
                    verdict_reason=f"exception: {exc}",
                    duration_us=0.0,
                    timestamp=datetime.now(timezone.utc).isoformat(),
                )

            ledger.append(result)
            context[f"step_{step.step}_result"] = result

            if result.verdict == "reject":
                # Fill remaining unexecuted steps
                for i in range(step.step + 1, CHAIN_STEP_COUNT):
                    remaining = next(
                        (s for s in self._steps if s.step == i), None
                    )
                    ledger.append(
                        create_not_executed_entry(
                            i,
                            remaining.name if remaining else f"step_{i}",
                            remaining.mode if remaining else "always",
                            f"step_{step.step}_rejection",
                        )
                    )

                elapsed_us = (time.perf_counter() - chain_start) * 1_000_000
                return ChainResult(
                    verdict="reject",
                    rejection_step=step.step,
                    rejection_reason=result.verdict_reason,
                    ledger=ledger,
                    total_duration_us=elapsed_us,
                )

        elapsed_us = (time.perf_counter() - chain_start) * 1_000_000
        return ChainResult(
            verdict="pass",
            rejection_step=None,
            rejection_reason=None,
            ledger=ledger,
            total_duration_us=elapsed_us,
        )
