package aep.memory

# ===========================================================================
# AEP Memory Policy
# Validates memory entries against registry and protocol rules.
# Usage: opa eval -i input.json -d aep-memory-policy.rego "data.aep.memory.deny"
#
# input.json must contain:
#   { "memory_entries": [...], "registry": { ... } }
# ===========================================================================

# --- Memory entry result must be "accepted" or "rejected" ---
deny[msg] {
  some entry
  entry := input.memory_entries[_]
  not entry.result == "accepted"
  not entry.result == "rejected"
  msg := sprintf("Invalid memory entry result: %v (must be 'accepted' or 'rejected')", [entry.result])
}

# --- UI domain entries must reference registered elements ---
deny[msg] {
  some entry
  entry := input.memory_entries[_]
  entry.domain == "ui"
  not input.registry[entry.element_id]
  not is_template_instance(entry.element_id)
  msg := sprintf("Memory entry references unregistered element: %v", [entry.element_id])
}

# --- Accepted entries must have zero errors ---
deny[msg] {
  some entry
  entry := input.memory_entries[_]
  entry.result == "accepted"
  count(entry.errors) > 0
  msg := sprintf("Accepted memory entry %v has %v errors (must be 0)", [entry.id, count(entry.errors)])
}

# ===========================================================================
# HELPER RULES
# ===========================================================================

is_template_instance(id) {
  prefix := substring(id, 0, 2)
  some template
  template := input.registry[_]
  template.instance_prefix == prefix
}
