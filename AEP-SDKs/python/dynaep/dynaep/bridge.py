# @PAD: /root/dynAEP/sdk/python/dynaep/bridge.py
# ===========================================================================
# dynaep - dynAEP Python SDK
# Server-side validation bridge for AG-UI event streams against AEP configs.
# Agents NEVER mint IDs. The bridge mints all IDs.
# Agents NEVER own the clock. The bridge stamps all events.
# pip install dynaep aep pyyaml
# ===========================================================================

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from aep import (
    AEPConfig,
    AEPElement,
    AEPRegistryEntry,
    ValidationResult,
    validate_jit,
    prefix_from_id,
    z_band_for_prefix,
    AEPIDError,
)

# TA-1: Temporal Authority imports
from dynaep.temporal.clock import BridgeClock, ClockConfig
from dynaep.temporal.validator import TemporalValidator, TemporalValidatorConfig
from dynaep.temporal.causal import CausalOrderingEngine, CausalConfig, CausalEvent
from dynaep.temporal.forecast import ForecastSidecar, ForecastConfig
from dynaep.template.resolver import TemplateInstanceResolver
from dynaep.persistence.buffered_ledger import BufferedLedger

# OPT-002: Unified Rego evaluator with decision cache
from dynaep.rego.unified_evaluator import UnifiedRegoEvaluator, RegoConfig
from dynaep.rego.decision_cache import RegoResult

# OPT-003: Unified content scanner with Aho-Corasick
from dynaep.scanners.unified_scanner import UnifiedScanner, ScannerConfig, ScanResult

# OPT-004: Chain executor
from dynaep.chain.types import ChainExecutionConfig
from dynaep.chain.types import StepExecutor as StepExecutorProtocol
from dynaep.chain.parallel_executor import ParallelChainExecutor
from dynaep.chain.sequential_executor import SequentialChainExecutor

logger = logging.getLogger("dynaep.bridge")


# ---------------------------------------------------------------------------
# Prefix-to-Type Mapping
# ---------------------------------------------------------------------------

TYPE_TO_PREFIX: dict[str, str] = {
    "shell": "SH", "panel": "PN", "component": "CP", "navigation": "NV",
    "cell_zone": "CZ", "cell_node": "CN", "toolbar": "TB", "widget": "WD",
    "overlay": "OV", "modal": "MD", "dropdown": "DD", "tooltip": "TT",
    "form": "FM", "icon": "IC",
}


# ---------------------------------------------------------------------------
# Bridge Configuration
# ---------------------------------------------------------------------------

@dataclass
class DynAEPBridgeConfig:
    validation_mode: str = "strict"
    jit_on_every_delta: bool = True
    conflict_resolution: str = "last_write_wins"   # last_write_wins | optimistic_locking
    reflection_enabled: bool = True
    reflection_debounce_ms: int = 250
    approval_policy: dict[str, str] = field(default_factory=lambda: {
        "structure_mutations": "auto",
        "behaviour_mutations": "auto",
        "skin_mutations": "auto",
        "new_element_creation": "require_approval",
    })
    # TA-1: Temporal Authority configuration
    clock_config: Optional[ClockConfig] = None
    temporal_validator_config: Optional[TemporalValidatorConfig] = None
    causal_config: Optional[CausalConfig] = None
    forecast_config: Optional[ForecastConfig] = None
    # OPT-002: Unified Rego evaluator configuration
    rego_config: Optional[RegoConfig] = None
    # OPT-003: Unified content scanner configuration
    scanner_engine: str = "unified"  # unified | sequential
    scanner_configs: list[ScannerConfig] = field(default_factory=list)
    # OPT-004: Chain execution configuration
    chain_execution: Optional[ChainExecutionConfig] = None


# ---------------------------------------------------------------------------
# Rejection
# ---------------------------------------------------------------------------

@dataclass
class DynAEPRejection:
    target_id: str
    error: str
    original_event_timestamp: float

    def to_ag_ui_event(self) -> dict:
        return {
            "type": "CUSTOM",
            "dynaep_type": "DYNAEP_REJECTION",
            "target_id": self.target_id,
            "error": self.error,
            "original_event_timestamp": self.original_event_timestamp,
        }


# ---------------------------------------------------------------------------
# Tool Call Result
# ---------------------------------------------------------------------------

@dataclass
class ToolCallResult:
    success: bool
    element_id: Optional[str] = None
    result: Any = None
    errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Bridge
# ---------------------------------------------------------------------------

class DynAEPBridge:
    def __init__(self, config: AEPConfig, bridge_config: Optional[DynAEPBridgeConfig] = None):
        self.config = config
        self.bridge_config = bridge_config or DynAEPBridgeConfig()
        self.live_elements: dict[str, AEPElement] = {
            k: AEPElement(
                id=v.id, type=v.type, label=v.label, z=v.z,
                visible=v.visible, parent=v.parent, layout=dict(v.layout),
                children=list(v.children), spatial_rule=v.spatial_rule,
                direction=v.direction, responsive_matrix=v.responsive_matrix,
            )
            for k, v in config.elements.items()
        }
        self.element_versions: dict[str, int] = {k: 1 for k in self.live_elements}
        self.id_counters: dict[str, int] = {}

        # Initialise counters from existing elements
        for el_id in self.live_elements:
            try:
                prefix = prefix_from_id(el_id)
                num = int(el_id[3:])
                self.id_counters[prefix] = max(self.id_counters.get(prefix, 0), num)
            except (AEPIDError, ValueError):
                pass

        # TA-1: Initialise temporal authority subsystems
        clock_cfg = self.bridge_config.clock_config or ClockConfig(
            protocol="system",
            source="pool.ntp.org",
            sync_interval_ms=30000,
            max_drift_ms=50,
            bridge_is_authority=True,
        )
        self.bridge_clock = BridgeClock(clock_cfg)

        temporal_cfg = self.bridge_config.temporal_validator_config or TemporalValidatorConfig(
            max_drift_ms=clock_cfg.max_drift_ms,
            max_future_ms=500,
            max_staleness_ms=5000,
            overwrite_timestamps=clock_cfg.bridge_is_authority,
            log_rejections=True,
            mode=self.bridge_config.validation_mode,
        )
        self.temporal_validator = TemporalValidator(self.bridge_clock, temporal_cfg)

        causal_cfg = self.bridge_config.causal_config or CausalConfig(
            max_reorder_buffer_size=64,
            max_reorder_wait_ms=200,
            conflict_resolution=self.bridge_config.conflict_resolution,
            enable_vector_clocks=True,
            enable_element_history=True,
            history_depth=100,
        )
        self.causal_engine = CausalOrderingEngine(causal_cfg)

        forecast_cfg = self.bridge_config.forecast_config or ForecastConfig(
            enabled=False,
            timesfm_endpoint=None,
            timesfm_mode="local",
            context_window=64,
            forecast_horizon=12,
            anomaly_threshold=3.0,
            debounce_ms=250,
            max_tracked_elements=500,
        )
        self.forecast_sidecar = ForecastSidecar(forecast_cfg)

        # OPT-009: Template instance resolver for fast-exit
        self.template_resolver = TemplateInstanceResolver(config)

        # OPT-006: Buffered evidence ledger
        self.evidence_ledger = BufferedLedger(
            bridge_clock=self.bridge_clock,
            buffer_size=256,
            flush_interval_s=5.0,
            hash_chain_enabled=True,
        )

        # OPT-002: Initialise unified Rego evaluator
        rego_cfg = self.bridge_config.rego_config or RegoConfig(
            policy_path="./aep-policy.rego",
            evaluation="precompiled",
            bundle_mode="unified",
            decision_cache_size=5000,
            cache_invalidate_on_reload=True,
        )
        self.rego_evaluator = UnifiedRegoEvaluator(rego_cfg)

        # OPT-003: Initialise unified content scanner
        self.scanner_engine = self.bridge_config.scanner_engine
        self.content_scanner: Optional[UnifiedScanner] = None
        if self.scanner_engine == "unified" and self.bridge_config.scanner_configs:
            self.content_scanner = UnifiedScanner(self.bridge_config.scanner_configs)

        # Attempt initial clock sync
        try:
            self.bridge_clock.sync()
        except Exception as exc:
            logger.warning("Initial clock sync failed: %s, using system fallback", exc)

    # -----------------------------------------------------------------------
    # ID Minting
    # -----------------------------------------------------------------------

    def mint_element_id(self, element_type: str) -> str:
        prefix = TYPE_TO_PREFIX.get(element_type)
        if not prefix:
            raise ValueError(
                f'Unknown element type: "{element_type}". '
                f"Valid types: {', '.join(TYPE_TO_PREFIX.keys())}"
            )
        next_num = self.id_counters.get(prefix, 0) + 1
        self.id_counters[prefix] = next_num
        return f"{prefix}-{next_num:05d}"

    def get_next_available_id(self, prefix: str) -> str:
        next_num = self.id_counters.get(prefix, 0) + 1
        return f"{prefix}-{next_num:05d}"

    # -----------------------------------------------------------------------
    # Process Event
    # -----------------------------------------------------------------------

    def process_event(self, event: dict) -> dict | DynAEPRejection:
        # OPT-009: Template instance fast-exit. AOT-validated template
        # instances skip the entire runtime validation pipeline.
        target_id = event.get("target_id")
        if target_id:
            fast_exit = self.template_resolver.try_fast_exit(
                target_id,
                self.bridge_clock.now(),
            )
            if fast_exit.is_template_instance:
                # OPT-006: Record fast-exit in evidence ledger
                self.evidence_ledger.record(
                    "fast_exit_template",
                    target_id,
                    f"template={fast_exit.template_id}",
                )
                event["_temporal"] = {
                    "bridge_time_ms": fast_exit.stamped_at,
                    "fast_exit": True,
                    "template_id": fast_exit.template_id,
                }
                return event

        # TA-1 Step 1: Temporal stamp with bridge clock
        temporal_result = self.temporal_validator.validate(event)

        # TA-1 Step 2: Reject on temporal violations in strict mode
        if not temporal_result.accepted:
            violation_details = "; ".join(v.detail for v in temporal_result.violations)
            # OPT-006: Record temporal rejection in evidence ledger
            self.evidence_ledger.record(
                "rejected_temporal",
                event.get("target_id", event.get("dynaep_type", "unknown")),
                violation_details,
            )
            return DynAEPRejection(
                target_id=event.get("target_id", event.get("dynaep_type", "unknown")),
                error=f"Temporal rejection: {violation_details}",
                original_event_timestamp=event.get("timestamp", time.time()),
            )

        # TA-1 Step 3: Causal ordering check (for events with agent context)
        agent_id = event.get("_agentId")
        seq_number = event.get("_sequenceNumber")
        if agent_id is not None and seq_number is not None:
            causal_event = CausalEvent(
                event_id=event.get("_eventId", f"evt-{temporal_result.bridge_timestamp.bridge_time_ms}"),
                agent_id=agent_id,
                bridge_time_ms=temporal_result.bridge_timestamp.bridge_time_ms,
                target_element_id=event.get("target_id", ""),
                sequence_number=seq_number,
                vector_clock=event.get("_vectorClock", {}),
                causal_dependencies=event.get("_causalDependencies", []),
            )
            causal_result = self.causal_engine.process(causal_event)
            has_regression = any(
                v.type == "agent_clock_regression"
                for v in causal_result.violations
            )
            if not causal_result.ordered and has_regression:
                violation_details = "; ".join(v.detail for v in causal_result.violations)
                # OPT-006: Record causal rejection in evidence ledger
                self.evidence_ledger.record(
                    "rejected_causal",
                    event.get("target_id", "unknown"),
                    violation_details,
                )
                return DynAEPRejection(
                    target_id=event.get("target_id", "unknown"),
                    error=f"Causal rejection: {violation_details}",
                    original_event_timestamp=event.get("timestamp", time.time()),
                )

        # TA-1 Step 4: Ingest runtime coordinates for forecast tracking
        if (
            event.get("type") == "CUSTOM"
            and event.get("dynaep_type") == "AEP_RUNTIME_COORDINATES"
            and event.get("target_id")
            and event.get("coordinates")
        ):
            self.forecast_sidecar.ingest(event)

        # OPT-001: Synchronous O(1) anomaly check from prediction cache
        target_id = event.get("target_id")
        if target_id and self.bridge_config.forecast_config and self.bridge_config.forecast_config.enabled:
            anomaly_result = self.forecast_sidecar.check_anomaly(target_id, event.get("coordinates", {}))
            if anomaly_result is not None and anomaly_result.is_anomaly:
                # OPT-006: Record anomaly in evidence ledger
                self.evidence_ledger.record(
                    "anomaly_warned",
                    target_id,
                    f"score={anomaly_result.score:.2f}, rec={anomaly_result.recommendation}",
                )
                event["_anomaly"] = {
                    "score": anomaly_result.score,
                    "recommendation": anomaly_result.recommendation,
                }

        # OPT-002: Unified Rego policy evaluation (cached)
        rego_input: dict[str, Any] = {
            "scene": self._build_rego_scene(),
            "registry": self._build_rego_registry(),
            "theme": {"aep_version": getattr(self.config, "scene_aep_version", "1.1"), "component_styles": getattr(self.config, "component_styles", {})},
            "event": {
                "target_id": event.get("target_id", ""),
                "type": event.get("type", "CUSTOM"),
                "dynaep_type": event.get("dynaep_type", ""),
                "mutation": event.get("mutation", {}),
            },
        }

        # Attach temporal data if present
        if hasattr(temporal_result, "bridge_timestamp") and temporal_result.bridge_timestamp:
            rego_input["temporal"] = {
                "drift_ms": getattr(temporal_result.bridge_timestamp, "drift_ms", 0),
                "agent_time_ms": getattr(temporal_result.bridge_timestamp, "agent_time_ms", 0),
                "bridge_time_ms": temporal_result.bridge_timestamp.bridge_time_ms,
            }
            clock_cfg = self.bridge_config.clock_config
            temp_cfg = self.bridge_config.temporal_validator_config
            rego_input["config"] = {
                "timekeeping": {
                    "max_drift_ms": clock_cfg.max_drift_ms if clock_cfg else 50,
                    "max_future_ms": temp_cfg.max_future_ms if temp_cfg else 500,
                    "max_staleness_ms": temp_cfg.max_staleness_ms if temp_cfg else 5000,
                },
            }

        # Attach perception data if present
        if "_perception" in event:
            rego_input["perception"] = event["_perception"]

        rego_result = self.rego_evaluator.evaluate(rego_input)
        rego_denials = (
            rego_result.structural_deny
            + rego_result.temporal_deny
            + rego_result.perception_deny
        )

        if rego_denials and self.bridge_config.validation_mode == "strict":
            self.evidence_ledger.record(
                "rejected_rego",
                event.get("target_id", "unknown"),
                "; ".join(rego_denials),
            )
            return DynAEPRejection(
                target_id=event.get("target_id", "unknown"),
                error=f"Rego policy violation: {rego_denials[0]}",
                original_event_timestamp=event.get("timestamp", time.time()),
            )

        # OPT-003: Content scanner (scan payload text for secrets, injection, PII)
        if self.content_scanner and self.scanner_engine == "unified":
            text_payload = self._extract_text_payload(event)
            if text_payload:
                scan_results = self.content_scanner.scan(text_payload)
                hard_findings = [r for r in scan_results if r.severity == "hard"]
                if hard_findings:
                    finding = hard_findings[0]
                    self.evidence_ledger.record(
                        "rejected_scanner",
                        event.get("target_id", "unknown"),
                        f"{finding.scanner_id}:{finding.pattern_id} match=\"{finding.match_text}\"",
                    )
                    return DynAEPRejection(
                        target_id=event.get("target_id", "unknown"),
                        error=f"Content violation ({finding.scanner_label}): {finding.pattern_id} detected",
                        original_event_timestamp=event.get("timestamp", time.time()),
                    )
                if scan_results:
                    event["_scan_findings"] = [
                        {"scanner": r.scanner_id, "pattern": r.pattern_id, "severity": r.severity, "match": r.match_text}
                        for r in scan_results
                    ]

        # Proceed with structural validation (existing pipeline)
        event_type = event.get("type")

        if event_type == "STATE_DELTA":
            structural_result = self._process_state_delta(event)
        elif event_type == "CUSTOM" and isinstance(event.get("dynaep_type"), str):
            structural_result = self._process_dynaep_event(event)
        else:
            structural_result = event

        # OPT-006: Record structural validation outcome in evidence ledger
        if isinstance(structural_result, DynAEPRejection):
            self.evidence_ledger.record(
                "rejected_structural",
                event.get("target_id", "unknown"),
                structural_result.error,
            )
        else:
            self.evidence_ledger.record(
                "accepted",
                event.get("target_id", event.get("dynaep_type", "unknown")),
                event.get("type", "event"),
            )

        # TA-1 Step 5: Attach temporal metadata to accepted events
        if isinstance(structural_result, dict):
            structural_result["_temporal"] = {
                "bridge_time_ms": temporal_result.bridge_timestamp.bridge_time_ms,
                "agent_time_ms": temporal_result.bridge_timestamp.agent_time_ms,
                "drift_ms": temporal_result.bridge_timestamp.drift_ms,
                "source": temporal_result.bridge_timestamp.source,
                "synced_at": temporal_result.bridge_timestamp.synced_at,
            }

        return structural_result

    # -----------------------------------------------------------------------
    # STATE_DELTA: Three-layer routing
    # -----------------------------------------------------------------------

    def _process_state_delta(self, event: dict) -> dict | DynAEPRejection:
        if not self.bridge_config.jit_on_every_delta:
            return event

        deltas = event.get("delta")
        if not isinstance(deltas, list):
            return event

        for op in deltas:
            path = op.get("path", "")
            if not isinstance(path, str):
                continue
            parts = [p for p in path.split("/") if p]
            if len(parts) < 2:
                continue

            layer = parts[0]
            target_id = parts[1]
            field_name = parts[2] if len(parts) > 2 else None

            if layer == "elements":
                changes: dict[str, Any] = {}
                if field_name:
                    changes[field_name] = op.get("value")
                result = validate_jit(self.config, target_id, changes)
                if not result.valid:
                    return DynAEPRejection(
                        target_id=target_id,
                        error="; ".join(result.errors),
                        original_event_timestamp=event.get("timestamp", time.time()),
                    )

                # Optimistic locking
                if self.bridge_config.conflict_resolution == "optimistic_locking":
                    expected = event.get("expected_version")
                    if expected is not None:
                        current = self.element_versions.get(target_id, 0)
                        if expected != current:
                            return DynAEPRejection(
                                target_id=target_id,
                                error=f"Optimistic lock conflict: expected {expected} but current is {current}",
                                original_event_timestamp=event.get("timestamp", time.time()),
                            )

            elif layer == "registry":
                if target_id not in self.config.registry and not self.config.is_template_instance(target_id):
                    return DynAEPRejection(
                        target_id=target_id,
                        error=f"Cannot mutate behaviour: {target_id} has no registry entry",
                        original_event_timestamp=event.get("timestamp", time.time()),
                    )

        # Apply structure deltas
        for op in deltas:
            parts = [p for p in op.get("path", "").split("/") if p]
            if parts[0:1] == ["elements"] and len(parts) >= 3:
                el_id = parts[1]
                field_name = parts[2]
                el = self.live_elements.get(el_id)
                if el and hasattr(el, field_name):
                    setattr(el, field_name, op.get("value"))
                    self.element_versions[el_id] = self.element_versions.get(el_id, 0) + 1

        return event

    # -----------------------------------------------------------------------
    # Custom dynAEP events
    # -----------------------------------------------------------------------

    def _process_dynaep_event(self, event: dict) -> dict | DynAEPRejection:
        dt = event.get("dynaep_type")

        if dt == "AEP_MUTATE_STRUCTURE":
            return self._validate_structure_mutation(event)
        if dt == "AEP_MUTATE_BEHAVIOUR":
            return self._validate_behaviour_mutation(event)
        if dt == "AEP_MUTATE_SKIN":
            return self._validate_skin_mutation(event)
        if dt == "AEP_QUERY":
            return self._handle_query(event)

        return event

    def _validate_structure_mutation(self, event: dict) -> dict | DynAEPRejection:
        target_id = event.get("target_id", "")
        mutation = event.get("mutation", {})
        errors: list[str] = []

        if target_id not in self.live_elements and not self.config.is_template_instance(target_id):
            errors.append(f"Unknown element: {target_id}")

        parent = mutation.get("parent")
        if parent and parent not in self.live_elements:
            errors.append(f"Cannot move {target_id}: parent {parent} does not exist")

        anchors = mutation.get("anchors", {})
        if isinstance(anchors, dict):
            for direction, anchor in anchors.items():
                if not isinstance(anchor, str):
                    continue
                anchor_target = anchor.split(".")[0]
                if anchor_target != "viewport" and anchor_target not in self.live_elements:
                    errors.append(f"Invalid anchor: {target_id} {direction} -> {anchor_target}")

        sb = mutation.get("skin_binding")
        if sb and sb not in self.config.component_styles:
            errors.append(f'{target_id} skin_binding "{sb}" not found in theme')

        if errors:
            return DynAEPRejection(
                target_id=target_id,
                error="; ".join(errors),
                original_event_timestamp=event.get("timestamp", time.time()),
            )

        # Apply
        el = self.live_elements.get(target_id)
        if el and parent:
            if el.parent and el.parent in self.live_elements:
                old_parent = self.live_elements[el.parent]
                if target_id in old_parent.children:
                    old_parent.children.remove(target_id)
            el.parent = parent
            new_parent_el = self.live_elements.get(parent)
            if new_parent_el and target_id not in new_parent_el.children:
                new_parent_el.children.append(target_id)

        if el and anchors:
            el.layout["anchors"] = anchors

        if target_id in self.element_versions:
            self.element_versions[target_id] += 1

        return event

    def _validate_behaviour_mutation(self, event: dict) -> dict | DynAEPRejection:
        target_id = event.get("target_id", "")
        if target_id not in self.config.registry and not self.config.is_template_instance(target_id):
            return DynAEPRejection(
                target_id=target_id,
                error=f"Cannot mutate behaviour: {target_id} has no registry entry",
                original_event_timestamp=event.get("timestamp", time.time()),
            )
        return event

    def _validate_skin_mutation(self, event: dict) -> dict | DynAEPRejection:
        target_id = event.get("target_id", "")
        if target_id not in self.config.component_styles:
            return DynAEPRejection(
                target_id=target_id,
                error=f'Cannot mutate skin: "{target_id}" not in component_styles',
                original_event_timestamp=event.get("timestamp", time.time()),
            )
        return event

    def _handle_query(self, event: dict) -> dict:
        query = event.get("query", "")
        target_id = event.get("target_id", "")
        result: Any = None
        el = self.live_elements.get(target_id)

        if query == "children_of":
            result = el.children if el else []
        elif query == "parent_of":
            result = el.parent if el else None
        elif query == "z_band_of":
            try:
                result = list(z_band_for_prefix(prefix_from_id(target_id)))
            except AEPIDError:
                result = [0, 99]
        elif query == "visible_at_breakpoint":
            result = el.responsive_matrix if el and el.responsive_matrix else {"all": el.visible if el else False}
        elif query == "full_element":
            entry = self.config.registry.get(target_id)
            result = {
                "scene": {"id": el.id, "z": el.z, "parent": el.parent, "children": el.children} if el else None,
                "registry": {"label": entry.label, "skin_binding": entry.skin_binding} if entry else None,
                "version": self.element_versions.get(target_id, 0),
            }
        elif query == "next_available_id":
            result = self.get_next_available_id(target_id)

        return {
            "type": "CUSTOM",
            "dynaep_type": "AEP_QUERY_RESULT",
            "target_id": target_id,
            "result": result,
        }

    # -----------------------------------------------------------------------
    # Tool Call Handler
    # -----------------------------------------------------------------------

    def handle_tool_call(self, tool_name: str, args: dict) -> ToolCallResult:
        if tool_name == "aep_add_element":
            return self._handle_add_element(args)
        if tool_name == "aep_move_element":
            return self._handle_move_element(args)
        if tool_name == "aep_query_graph":
            r = self._handle_query({
                "type": "CUSTOM", "dynaep_type": "AEP_QUERY",
                "query": args.get("query_type", ""), "target_id": args.get("target_id", ""),
            })
            return ToolCallResult(success=True, result=r.get("result"))
        if tool_name == "aep_swap_theme":
            return ToolCallResult(success=True, result=f"Theme swap to \"{args.get('theme_name')}\" requested")
        return ToolCallResult(success=False, errors=[f"Unknown tool: {tool_name}"])

    def _handle_add_element(self, args: dict) -> ToolCallResult:
        el_type = args.get("type", "")
        parent = args.get("parent", "")
        z = args.get("z")
        skin_binding = args.get("skin_binding", "")
        label = args.get("label", "")

        errors: list[str] = []

        if el_type not in TYPE_TO_PREFIX:
            errors.append(f'Unknown element type: "{el_type}"')
            return ToolCallResult(success=False, errors=errors)

        if parent not in self.live_elements:
            errors.append(f"Parent {parent} does not exist")
            return ToolCallResult(success=False, errors=errors)

        if skin_binding not in self.config.component_styles:
            errors.append(f'skin_binding "{skin_binding}" not found in theme')
            return ToolCallResult(success=False, errors=errors)

        prefix = TYPE_TO_PREFIX[el_type]
        min_z, max_z = z_band_for_prefix(prefix)
        if not isinstance(z, int) or z < min_z or z > max_z:
            errors.append(f"z={z} outside band {min_z}-{max_z} for prefix {prefix}")
            return ToolCallResult(success=False, errors=errors)

        new_id = self.mint_element_id(el_type)

        new_el = AEPElement(
            id=new_id, type=el_type, label=label or new_id, z=z,
            visible=True, parent=parent,
            layout=args.get("layout") or {}, children=[],
        )

        self.live_elements[new_id] = new_el
        self.element_versions[new_id] = 1

        parent_el = self.live_elements.get(parent)
        if parent_el and new_id not in parent_el.children:
            parent_el.children.append(new_id)
            self.element_versions[parent] = self.element_versions.get(parent, 0) + 1

        return ToolCallResult(success=True, element_id=new_id)

    def _handle_move_element(self, args: dict) -> ToolCallResult:
        el_id = args.get("id", "")
        new_parent = args.get("new_parent")

        if el_id not in self.live_elements:
            return ToolCallResult(success=False, errors=[f"Element {el_id} not found"])

        el = self.live_elements[el_id]

        if new_parent:
            if new_parent not in self.live_elements:
                return ToolCallResult(success=False, errors=[f"Parent {new_parent} not found"])

            if el.parent and el.parent in self.live_elements:
                old = self.live_elements[el.parent]
                if el_id in old.children:
                    old.children.remove(el_id)
                    self.element_versions[el.parent] = self.element_versions.get(el.parent, 0) + 1

            el.parent = new_parent
            np = self.live_elements[new_parent]
            if el_id not in np.children:
                np.children.append(el_id)
                self.element_versions[new_parent] = self.element_versions.get(new_parent, 0) + 1

        anchors = args.get("anchors")
        if anchors:
            el.layout["anchors"] = anchors

        self.element_versions[el_id] = self.element_versions.get(el_id, 0) + 1
        return ToolCallResult(success=True, element_id=el_id)

    # -----------------------------------------------------------------------
    # Schema Reload
    # -----------------------------------------------------------------------

    def reload_config(self, new_config: AEPConfig) -> dict:
        old_rev = self.config.reg_schema_revision
        self.config = new_config
        self.live_elements = {
            k: AEPElement(
                id=v.id, type=v.type, label=v.label, z=v.z,
                visible=v.visible, parent=v.parent, layout=dict(v.layout),
                children=list(v.children), spatial_rule=v.spatial_rule,
                direction=v.direction, responsive_matrix=v.responsive_matrix,
            )
            for k, v in new_config.elements.items()
        }

        # OPT-002: Invalidate Rego decision cache on schema reload
        try:
            self.rego_evaluator.reload([])
        except Exception as exc:
            logger.warning("Rego cache invalidation on reload failed: %s", exc)

        # TA-1: Reset causal ordering on schema reload
        self.causal_engine.reset()

        # Prune forecast tracking for removed elements
        active_ids = list(self.live_elements.keys())
        self.forecast_sidecar.prune(active_ids)

        return {
            "type": "CUSTOM",
            "dynaep_type": "DYNAEP_SCHEMA_RELOAD",
            "old_revision": old_rev,
            "new_revision": new_config.reg_schema_revision,
            "aep_version": new_config.scene_aep_version,
        }

    # -----------------------------------------------------------------------
    # OPT-002: Rego Scene/Registry Builders
    # -----------------------------------------------------------------------

    def _build_rego_scene(self) -> dict:
        scene: dict[str, Any] = {"aep_version": getattr(self.config, "scene_aep_version", "1.1")}
        for el_id, el in self.live_elements.items():
            scene[el_id] = {
                "z": el.z,
                "parent": el.parent,
                "children": list(el.children),
                "visible": el.visible,
            }
        return scene

    def _build_rego_registry(self) -> dict:
        registry: dict[str, Any] = {"aep_version": getattr(self.config, "scene_aep_version", "1.1")}
        for el_id in self.config.registry:
            entry = self.config.registry[el_id]
            registry[el_id] = {"skin_binding": getattr(entry, "skin_binding", "")}
        return registry

    # -----------------------------------------------------------------------
    # OPT-003: Text Payload Extraction for Content Scanning
    # -----------------------------------------------------------------------

    def _extract_text_payload(self, event: dict) -> str:
        parts: list[str] = []
        mutation = event.get("mutation")
        if isinstance(mutation, dict):
            for v in mutation.values():
                if isinstance(v, str):
                    parts.append(v)
        delta = event.get("delta")
        if isinstance(delta, list):
            for op in delta:
                if isinstance(op, dict) and isinstance(op.get("value"), str):
                    parts.append(op["value"])
        query = event.get("query")
        if isinstance(query, str):
            parts.append(query)
        for key in ("text", "content", "body", "label", "code", "html", "css", "script"):
            val = event.get(key)
            if isinstance(val, str):
                parts.append(val)
        return " ".join(parts)

    # -----------------------------------------------------------------------
    # OPT-002/003: Accessors
    # -----------------------------------------------------------------------

    def get_rego_evaluator(self) -> UnifiedRegoEvaluator:
        return self.rego_evaluator

    def get_content_scanner(self) -> Optional[UnifiedScanner]:
        return self.content_scanner

    # -----------------------------------------------------------------------
    # TA-1: Temporal Authority Accessors
    # -----------------------------------------------------------------------

    def get_clock(self) -> BridgeClock:
        return self.bridge_clock

    def get_temporal_validator(self) -> TemporalValidator:
        return self.temporal_validator

    def get_causal_engine(self) -> CausalOrderingEngine:
        return self.causal_engine

    def get_forecast_sidecar(self) -> ForecastSidecar:
        return self.forecast_sidecar

    def get_evidence_ledger(self) -> BufferedLedger:
        return self.evidence_ledger

    # -----------------------------------------------------------------------
    # OPT-004: Chain Executor Factory
    # -----------------------------------------------------------------------

    def create_chain_executor(
        self, steps: list[StepExecutorProtocol]
    ) -> "SequentialChainExecutor | ParallelChainExecutor":
        """
        Create a chain executor based on the configured execution mode.
        "parallel" uses 5-stage concurrent execution (OPT-004).
        "sequential" preserves the original step-by-step evaluation.
        """
        chain_cfg = self.bridge_config.chain_execution
        mode = chain_cfg.mode if chain_cfg else "sequential"
        if mode == "parallel":
            return ParallelChainExecutor(steps)
        return SequentialChainExecutor(steps)


# ---------------------------------------------------------------------------
# AG-UI Middleware
# ---------------------------------------------------------------------------

def create_ag_ui_middleware(
    config: AEPConfig,
    bridge_config: Optional[DynAEPBridgeConfig] = None,
):
    """
    Returns a middleware function that validates AG-UI events against AEP.

    Usage:
        middleware = create_ag_ui_middleware(config)

        @app.post("/api/agent")
        async def agent_endpoint(request):
            for event in run_agent(request):
                validated = middleware(event)
                if isinstance(validated, DynAEPRejection):
                    yield validated.to_ag_ui_event()
                else:
                    yield validated
    """
    bridge = DynAEPBridge(config, bridge_config)

    def middleware(event: dict) -> dict | DynAEPRejection:
        return bridge.process_event(event)

    return middleware
