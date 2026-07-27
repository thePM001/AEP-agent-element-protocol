package aep.forbidden

# ===========================================================================
# AEP Forbidden Patterns Policy
# Evaluated by Open Policy Agent (OPA)
# Usage: opa eval -i input.json -d aep-policy.rego "data.aep.forbidden.deny"
#
# input.json must contain:
#   { "scene": { ... }, "registry": { ... }, "theme": { ... } }
# ===========================================================================

# --- Modals must always render above data grids ---
deny[msg] {
  some m
  startswith(m, "MD")
  some g
  startswith(g, "CZ")
  input.scene[m].z <= input.scene[g].z
  msg := sprintf("Modal %v (z=%v) must render above grid %v (z=%v)", [m, input.scene[m].z, g, input.scene[g].z])
}

# --- Tooltips must always render above modals ---
deny[msg] {
  some tt
  startswith(tt, "TT")
  some md
  startswith(md, "MD")
  input.scene[tt].z <= input.scene[md].z
  msg := sprintf("Tooltip %v (z=%v) must render above modal %v (z=%v)", [tt, input.scene[tt].z, md, input.scene[md].z])
}

# --- Every element must have a parent that exists (except root shells) ---
deny[msg] {
  some id
  input.scene[id].parent != null
  not input.scene[input.scene[id].parent]
  msg := sprintf("Orphan element: %v references non-existent parent %v", [id, input.scene[id].parent])
}

# --- Every scene element must have a registry entry (or be a template instance) ---
deny[msg] {
  some id
  input.scene[id]
  not input.registry[id]
  not is_template_instance(id)
  msg := sprintf("Unregistered element: %v exists in scene but has no registry entry", [id])
}

# --- Every skin_binding must resolve to a component_styles block ---
deny[msg] {
  some id
  input.registry[id].skin_binding
  binding := input.registry[id].skin_binding
  not input.theme.component_styles[binding]
  msg := sprintf("Unresolved skin_binding: %v references '%v' which does not exist in theme component_styles", [id, binding])
}

# --- z-index must fall within the correct band for the element prefix ---
deny[msg] {
  some id
  z := input.scene[id].z
  prefix := substring(id, 0, 2)
  band := z_bands[prefix]
  z < band.min
  msg := sprintf("z-band violation: %v has z=%v, below minimum %v for prefix %v", [id, z, band.min, prefix])
}

deny[msg] {
  some id
  z := input.scene[id].z
  prefix := substring(id, 0, 2)
  band := z_bands[prefix]
  z > band.max
  msg := sprintf("z-band violation: %v has z=%v, above maximum %v for prefix %v", [id, z, band.max, prefix])
}

# --- Children referenced in children arrays must exist in the scene ---
deny[msg] {
  some id
  some i
  child := input.scene[id].children[i]
  not input.scene[child]
  msg := sprintf("Missing child: %v declares child %v which does not exist in scene", [id, child])
}

# --- Anchor targets must reference existing elements ---
deny[msg] {
  some id
  input.scene[id].layout.anchors
  some direction
  anchor := input.scene[id].layout.anchors[direction]
  target_id := split(anchor, ".")[0]
  target_id != "viewport"
  not input.scene[target_id]
  msg := sprintf("Invalid anchor: %v anchors %v to non-existent element %v", [id, direction, target_id])
}

# --- Version headers must be present ---
deny[msg] {
  not input.scene.aep_version
  msg := "Missing aep_version in scene config"
}

deny[msg] {
  not input.registry.aep_version
  msg := "Missing aep_version in registry config"
}

deny[msg] {
  not input.theme.aep_version
  msg := "Missing aep_version in theme config"
}

# --- Version consistency across all three config files ---
deny[msg] {
  input.scene.aep_version != input.registry.aep_version
  msg := sprintf("Version mismatch: scene is %v but registry is %v", [input.scene.aep_version, input.registry.aep_version])
}

deny[msg] {
  input.scene.aep_version != input.theme.aep_version
  msg := sprintf("Version mismatch: scene is %v but theme is %v", [input.scene.aep_version, input.theme.aep_version])
}

# --- Forbidden: text elements must not use opacity <= 0.3 ---
deny[msg] {
  some id
  entry := input.registry[id]
  entry.skin_binding
  style := input.theme.component_styles[entry.skin_binding]
  style.opacity
  to_number(style.opacity) <= 0.3
  style.color
  msg := sprintf("Forbidden: %v uses skin binding '%v' with opacity <= 0.3 on text. Text below 30%% opacity is unreadable and prohibited.", [id, entry.skin_binding])
}

# ===========================================================================
# HELPER RULES
# ===========================================================================

is_template_instance(id) {
  prefix := substring(id, 0, 2)
  some tmpl
  input.registry[tmpl].instance_prefix == prefix
}

z_bands := {
  "SH": {"min": 0, "max": 9},
  "PN": {"min": 10, "max": 19},
  "NV": {"min": 10, "max": 19},
  "CP": {"min": 20, "max": 29},
  "FM": {"min": 20, "max": 29},
  "IC": {"min": 20, "max": 29},
  "CZ": {"min": 30, "max": 39},
  "CN": {"min": 30, "max": 39},
  "TB": {"min": 40, "max": 49},
  "WD": {"min": 50, "max": 59},
  "OV": {"min": 60, "max": 69},
  "MD": {"min": 70, "max": 79},
  "DD": {"min": 70, "max": 79},
  "TT": {"min": 80, "max": 89},
}
