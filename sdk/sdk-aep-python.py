# ===========================================================================
# @aep/python - AEP Python SDK
# Loader, validator, resolver and types for the Agent Element Protocol.
# pip install aep pyyaml
# ===========================================================================

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class AEPError(Exception):
    """Base exception for all AEP SDK errors."""
    pass


class AEPLoadError(AEPError):
    """Raised when AEP config files cannot be loaded or parsed."""
    pass


class AEPIDError(AEPError):
    """Raised when an AEP element ID is malformed."""
    pass


# ---------------------------------------------------------------------------
# Z-Band Constants
# ---------------------------------------------------------------------------

Z_BANDS: dict[str, tuple[int, int]] = {
    "SH": (0, 9),   "PN": (10, 19), "NV": (10, 19),
    "CP": (20, 29), "FM": (20, 29), "IC": (20, 29),
    "CZ": (30, 39), "CN": (30, 39),
    "TB": (40, 49), "WD": (50, 59), "OV": (60, 69),
    "MD": (70, 79), "DD": (70, 79), "TT": (80, 89),
}


def z_band_for_prefix(prefix: str) -> tuple[int, int]:
    return Z_BANDS.get(prefix, (0, 99))


def prefix_from_id(element_id: str) -> str:
    if not isinstance(element_id, str) or len(element_id) < 2:
        raise AEPIDError(
            f'Invalid AEP ID: "{element_id}" must be at least 2 characters (XX-NNNNN)'
        )
    return element_id[:2]


# ---------------------------------------------------------------------------
# Data Classes
# ---------------------------------------------------------------------------

@dataclass
class AEPElement:
    id: str
    type: str
    label: str
    z: int
    visible: bool
    parent: Optional[str]
    layout: dict[str, Any]
    children: list[str] = field(default_factory=list)
    spatial_rule: Optional[str] = None
    direction: Optional[str] = None
    responsive_matrix: Optional[dict] = None

    def __repr__(self) -> str:
        return f"AEPElement({self.id}, type={self.type}, z={self.z}, parent={self.parent})"


@dataclass
class AEPRegistryEntry:
    label: str
    category: str
    function: str
    component_file: str
    parent: str
    skin_binding: str
    states: dict[str, str] = field(default_factory=dict)
    constraints: list[str] = field(default_factory=list)
    actions: list[str] = field(default_factory=list)
    events: dict[str, str] = field(default_factory=dict)
    instance_prefix: Optional[str] = None
    instance_range: Optional[str] = None

    def __repr__(self) -> str:
        return f"AEPRegistryEntry({self.label}, skin={self.skin_binding})"


@dataclass
class ValidationResult:
    valid: bool
    errors: list[str]
    warnings: list[str] = field(default_factory=list)

    def __repr__(self) -> str:
        status = "PASS" if self.valid else f"FAIL ({len(self.errors)} errors)"
        return f"ValidationResult({status})"

    def print_report(self) -> None:
        if self.valid:
            print(f"PASS: 0 errors, {len(self.warnings)} warning(s)")
        else:
            print(f"FAIL: {len(self.errors)} error(s), {len(self.warnings)} warning(s)")
        for e in self.errors:
            print(f"  ERROR: {e}")
        for w in self.warnings:
            print(f"  WARN:  {w}")


# ---------------------------------------------------------------------------
# Registry Parser
# YAML registry files mix metadata (aep_version, schema_revision,
# forbidden_patterns) with element entries (CP-00001, PN-00001 etc).
# This strips metadata and returns only typed entries.
# ---------------------------------------------------------------------------

_REGISTRY_META_KEYS = {"aep_version", "schema_revision", "forbidden_patterns"}

_REQUIRED_REGISTRY_FIELDS = {"label", "skin_binding"}


def _parse_registry_yaml(
    raw: dict,
) -> tuple[dict[str, AEPRegistryEntry], str, int, list[dict]]:
    entries: dict[str, AEPRegistryEntry] = {}
    aep_version = str(raw.get("aep_version", "1.1"))
    schema_revision = int(raw.get("schema_revision", 1))
    forbidden_patterns: list[dict] = raw.get("forbidden_patterns") or []

    for key, value in raw.items():
        if key in _REGISTRY_META_KEYS:
            continue
        if not isinstance(value, dict):
            continue
        entries[key] = AEPRegistryEntry(
            label=value.get("label", ""),
            category=value.get("category", "layout"),
            function=value.get("function", ""),
            component_file=value.get("component_file", ""),
            parent=value.get("parent") or "",
            skin_binding=value.get("skin_binding", ""),
            states=value.get("states") or {},
            constraints=value.get("constraints") or [],
            actions=value.get("actions") or [],
            events=value.get("events") or {},
            instance_prefix=value.get("instance_prefix"),
            instance_range=value.get("instance_range"),
        )

    return entries, aep_version, schema_revision, forbidden_patterns


# ---------------------------------------------------------------------------
# Element Parser
# ---------------------------------------------------------------------------

_REQUIRED_ELEMENT_FIELDS = {"type", "z"}


def _parse_elements(raw: dict) -> dict[str, AEPElement]:
    elements: dict[str, AEPElement] = {}
    for key, value in raw.items():
        if not isinstance(value, dict):
            continue
        elements[key] = AEPElement(
            id=value.get("id", key),
            type=value.get("type", ""),
            label=value.get("label", ""),
            z=value.get("z", 0),
            visible=value.get("visible", True),
            parent=value.get("parent"),
            layout=value.get("layout") or {},
            children=value.get("children") or [],
            spatial_rule=value.get("spatial_rule"),
            direction=value.get("direction"),
            responsive_matrix=value.get("responsive_matrix"),
        )
    return elements


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------

class AEPConfig:
    def __init__(
        self,
        elements: dict[str, AEPElement],
        registry: dict[str, AEPRegistryEntry],
        theme: dict,
        scene_raw: dict,
        reg_aep_version: str,
        reg_schema_revision: int,
        forbidden_patterns: list[dict],
    ):
        self.elements = elements
        self.registry = registry
        self.theme = theme
        self.scene_raw = scene_raw
        self.component_styles: dict[str, dict] = theme.get("component_styles", {})
        self.viewport_breakpoints: dict = scene_raw.get("viewport_breakpoints", {})
        self.scene_aep_version: str = str(scene_raw.get("aep_version", "1.1"))
        self.scene_schema_revision: int = int(scene_raw.get("schema_revision", 1))
        self.theme_aep_version: str = str(theme.get("aep_version", "1.1"))
        self.theme_schema_revision: int = int(theme.get("schema_revision", 1))
        self.reg_aep_version = reg_aep_version
        self.reg_schema_revision = reg_schema_revision
        self.forbidden_patterns = forbidden_patterns

        # Pre-compute template prefixes for O(1) lookup
        self._template_prefixes: set[str] = set()
        for entry in registry.values():
            if entry.instance_prefix:
                self._template_prefixes.add(entry.instance_prefix)

    def is_template_instance(self, element_id: str) -> bool:
        try:
            prefix = prefix_from_id(element_id)
        except AEPIDError:
            return False
        return prefix in self._template_prefixes

    @classmethod
    def load(cls, config_dir: str | Path) -> "AEPConfig":
        config_dir = Path(config_dir)

        try:
            import yaml
        except ImportError:
            raise AEPLoadError("pyyaml is required: pip install pyyaml")

        scene_path = config_dir / "aep-scene.json"
        registry_path = config_dir / "aep-registry.yaml"
        theme_path = config_dir / "aep-theme.yaml"

        # Load scene
        try:
            with open(scene_path, "r", encoding="utf-8") as f:
                scene_raw = json.load(f)
        except FileNotFoundError:
            raise AEPLoadError(f"Scene file not found: {scene_path}")
        except json.JSONDecodeError as e:
            raise AEPLoadError(f"Invalid JSON in scene file: {e}")

        # Load registry
        try:
            with open(registry_path, "r", encoding="utf-8") as f:
                registry_raw = yaml.safe_load(f)
        except FileNotFoundError:
            raise AEPLoadError(f"Registry file not found: {registry_path}")
        except yaml.YAMLError as e:
            raise AEPLoadError(f"Invalid YAML in registry file: {e}")

        if not isinstance(registry_raw, dict):
            raise AEPLoadError(f"Registry file must be a YAML mapping, got {type(registry_raw).__name__}")

        # Load theme
        try:
            with open(theme_path, "r", encoding="utf-8") as f:
                theme = yaml.safe_load(f)
        except FileNotFoundError:
            raise AEPLoadError(f"Theme file not found: {theme_path}")
        except yaml.YAMLError as e:
            raise AEPLoadError(f"Invalid YAML in theme file: {e}")

        if not isinstance(theme, dict):
            raise AEPLoadError(f"Theme file must be a YAML mapping, got {type(theme).__name__}")

        elements = _parse_elements(scene_raw.get("elements", {}))
        entries, reg_ver, reg_rev, forbidden = _parse_registry_yaml(registry_raw)

        return cls(
            elements=elements,
            registry=entries,
            theme=theme,
            scene_raw=scene_raw,
            reg_aep_version=reg_ver,
            reg_schema_revision=reg_rev,
            forbidden_patterns=forbidden,
        )

    @classmethod
    def from_dicts(cls, scene: dict, registry_raw: dict, theme: dict) -> "AEPConfig":
        elements = _parse_elements(scene.get("elements", {}))
        entries, reg_ver, reg_rev, forbidden = _parse_registry_yaml(registry_raw)
        return cls(
            elements=elements,
            registry=entries,
            theme=theme,
            scene_raw=scene,
            reg_aep_version=reg_ver,
            reg_schema_revision=reg_rev,
            forbidden_patterns=forbidden,
        )

    def __repr__(self) -> str:
        return (
            f"AEPConfig(elements={len(self.elements)}, "
            f"registry={len(self.registry)}, "
            f"styles={len(self.component_styles)}, "
            f"version={self.scene_aep_version})"
        )


# ---------------------------------------------------------------------------
# Style Resolver
# ---------------------------------------------------------------------------

def resolve_styles(skin_binding: str, theme: dict) -> dict[str, Any]:
    styles = theme.get("component_styles", {}).get(skin_binding, {})
    if not isinstance(styles, dict):
        return {}
    return _resolve_template_vars(styles, theme)


def _resolve_template_vars(obj: dict, theme: dict) -> dict:
    result = {}
    for key, value in obj.items():
        if isinstance(value, str) and "{" in value:
            result[key] = re.sub(
                r"\{([^}]+)\}",
                lambda m: str(_resolve_path(theme, m.group(1))),
                value,
            )
        elif isinstance(value, list):
            result[key] = [
                _resolve_single_value(item, theme) for item in value
            ]
        elif isinstance(value, dict):
            result[key] = _resolve_template_vars(value, theme)
        else:
            result[key] = value
    return result


def _resolve_single_value(value: Any, theme: dict) -> Any:
    if isinstance(value, str) and "{" in value:
        return re.sub(
            r"\{([^}]+)\}",
            lambda m: str(_resolve_path(theme, m.group(1))),
            value,
        )
    if isinstance(value, dict):
        return _resolve_template_vars(value, theme)
    if isinstance(value, list):
        return [_resolve_single_value(item, theme) for item in value]
    return value


def _resolve_path(obj: Any, path: str) -> Any:
    current = obj
    for part in path.split("."):
        if current is None or not isinstance(current, dict):
            return ""
        current = current.get(part)
    return current if current is not None else ""


# ---------------------------------------------------------------------------
# AOT Validator (full structural proof at build time)
# ---------------------------------------------------------------------------

def validate_aot(config: AEPConfig) -> ValidationResult:
    errors: list[str] = []
    warnings: list[str] = []

    # --- Version consistency ---
    if config.scene_aep_version != config.reg_aep_version:
        errors.append(
            f"Version mismatch: scene={config.scene_aep_version} registry={config.reg_aep_version}"
        )
    if config.scene_aep_version != config.theme_aep_version:
        errors.append(
            f"Version mismatch: scene={config.scene_aep_version} theme={config.theme_aep_version}"
        )

    # --- Schema revision consistency ---
    if config.scene_schema_revision != config.reg_schema_revision:
        errors.append(
            f"Schema revision mismatch: scene={config.scene_schema_revision} "
            f"registry={config.reg_schema_revision}"
        )
    if config.scene_schema_revision != config.theme_schema_revision:
        errors.append(
            f"Schema revision mismatch: scene={config.scene_schema_revision} "
            f"theme={config.theme_schema_revision}"
        )

    # --- Root element validation ---
    root_shells = [
        el_id for el_id, el in config.elements.items()
        if el.parent is None
    ]
    if len(root_shells) == 0:
        errors.append("No root element found (exactly one element must have parent: null)")
    elif len(root_shells) > 1:
        errors.append(f"Multiple root elements found: {root_shells} (only one allowed)")
    else:
        root_id = root_shells[0]
        try:
            root_prefix = prefix_from_id(root_id)
            if root_prefix != "SH":
                warnings.append(
                    f'Root element {root_id} has prefix "{root_prefix}" (expected "SH")'
                )
        except AEPIDError:
            errors.append(f"Root element has invalid ID: {root_id}")

    for el_id, el in config.elements.items():

        # --- ID format ---
        try:
            prefix = prefix_from_id(el_id)
        except AEPIDError as e:
            errors.append(str(e))
            continue

        # --- Required fields ---
        if not el.type:
            errors.append(f"{el_id} missing required field: type")
        if el.z is None:
            errors.append(f"{el_id} missing required field: z")

        # --- Registry entry exists ---
        if el_id not in config.registry and not config.is_template_instance(el_id):
            errors.append(f"Orphan element: {el_id} exists in scene but not in registry")

        # --- Parent exists ---
        if el.parent and el.parent not in config.elements:
            errors.append(f"{el_id} references non-existent parent {el.parent}")

        # --- Z-band compliance ---
        min_z, max_z = z_band_for_prefix(prefix)
        if el.z < min_z or el.z > max_z:
            errors.append(f"{el_id} z={el.z} outside band {min_z}-{max_z}")

        # --- Children exist ---
        for child_id in el.children:
            if child_id not in config.elements:
                errors.append(f"{el_id} declares child {child_id} which does not exist")

        # --- Bidirectional A: parent lists child, child's parent must match ---
        for child_id in el.children:
            child = config.elements.get(child_id)
            if child and child.parent != el_id:
                errors.append(
                    f'{child_id} parent is "{child.parent}" but {el_id} lists it as child'
                )

        # --- Bidirectional B: child declares parent, parent must list child ---
        if el.parent and el.parent in config.elements:
            parent_el = config.elements[el.parent]
            if el_id not in parent_el.children:
                errors.append(
                    f"{el_id} declares parent {el.parent} but parent does not list it as child"
                )

        # --- Anchor targets exist ---
        anchors = el.layout.get("anchors", {}) if isinstance(el.layout, dict) else {}
        for direction, anchor in anchors.items():
            if not isinstance(anchor, str):
                errors.append(f"{el_id} anchor {direction} must be a string, got {type(anchor).__name__}")
                continue
            target_id = anchor.split(".")[0]
            if target_id != "viewport" and target_id not in config.elements:
                errors.append(f"{el_id} anchors {direction} to non-existent {target_id}")

        # --- Responsive breakpoints match declarations ---
        if el.responsive_matrix:
            for bp in el.responsive_matrix:
                if bp != "base" and bp not in config.viewport_breakpoints:
                    warnings.append(f'{el_id} responsive_matrix uses undeclared breakpoint "{bp}"')

    # --- Skin bindings resolve ---
    for entry_id, entry in config.registry.items():
        if entry.skin_binding and entry.skin_binding not in config.component_styles:
            errors.append(f'{entry_id} skin_binding "{entry.skin_binding}" not found in theme')

    # --- Duplicate child references ---
    seen: set[str] = set()
    for el in config.elements.values():
        for ref in el.children:
            if ref in seen:
                errors.append(f"Duplicate child reference: {ref} appears in multiple parents")
            seen.add(ref)

    return ValidationResult(valid=len(errors) == 0, errors=errors, warnings=warnings)


# ---------------------------------------------------------------------------
# JIT Validator (single element mutation at runtime)
# ---------------------------------------------------------------------------

def validate_jit(
    config: AEPConfig,
    element_id: str,
    changes: dict[str, Any],
) -> ValidationResult:
    errors: list[str] = []
    warnings: list[str] = []

    # ID format
    try:
        prefix = prefix_from_id(element_id)
    except AEPIDError as e:
        return ValidationResult(valid=False, errors=[str(e)], warnings=[])

    # Template instances exempt (mould proven safe by AOT)
    if config.is_template_instance(element_id):
        return ValidationResult(valid=True, errors=[], warnings=[])

    # Element must exist
    if element_id not in config.elements and element_id not in config.registry:
        errors.append(f"Unknown element: {element_id}")
        return ValidationResult(valid=False, errors=errors, warnings=[])

    # Z-band compliance
    if "z" in changes:
        min_z, max_z = z_band_for_prefix(prefix)
        z = changes["z"]
        if not isinstance(z, int):
            errors.append(f"{element_id} z must be an integer, got {type(z).__name__}")
        elif z < min_z or z > max_z:
            errors.append(f"{element_id} z={z} outside band {min_z}-{max_z}")

    # Parent exists
    if "parent" in changes and changes["parent"] is not None:
        if changes["parent"] not in config.elements:
            errors.append(f"{element_id} references non-existent parent {changes['parent']}")

    # Skin binding resolves
    if "skin_binding" in changes:
        binding = changes["skin_binding"]
        if binding not in config.component_styles:
            errors.append(f'{element_id} skin_binding "{binding}" not found in theme')

    # Anchor targets exist
    layout = changes.get("layout")
    if isinstance(layout, dict):
        anchors = layout.get("anchors", {})
        if isinstance(anchors, dict):
            for direction, anchor in anchors.items():
                if not isinstance(anchor, str):
                    errors.append(
                        f"{element_id} anchor {direction} must be a string"
                    )
                    continue
                target_id = anchor.split(".")[0]
                if target_id != "viewport" and target_id not in config.elements:
                    errors.append(
                        f"{element_id} anchors {direction} to non-existent {target_id}"
                    )

    return ValidationResult(valid=len(errors) == 0, errors=errors, warnings=warnings)


# ---------------------------------------------------------------------------
# Typed Helpers
# ---------------------------------------------------------------------------

def get_element(config: AEPConfig, element_id: str) -> Optional[AEPElement]:
    return config.elements.get(element_id)


def get_children(config: AEPConfig, element_id: str) -> list[str]:
    el = config.elements.get(element_id)
    return el.children if el else []


def get_parent(config: AEPConfig, element_id: str) -> Optional[str]:
    el = config.elements.get(element_id)
    return el.parent if el else None


def get_registry_entry(config: AEPConfig, element_id: str) -> Optional[AEPRegistryEntry]:
    return config.registry.get(element_id)


def get_resolved_styles(config: AEPConfig, element_id: str) -> dict[str, Any]:
    entry = config.registry.get(element_id)
    if not entry or not entry.skin_binding:
        return {}
    return resolve_styles(entry.skin_binding, config.theme)
