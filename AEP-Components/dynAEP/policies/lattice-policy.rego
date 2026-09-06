package dynaep.lattice

# ===========================================================================
# Lattice Governance Policy
# Enforces action lattice rules: GAP agent-may dimensions, partial-order
# validation, forbidden sequences, rate limits, and cross-modality
# constraints for output actions.
#
# Evaluated by Open Policy Agent (OPA) via @open-policy-agent/opa-wasm.
#
# Expected input fields (supplied by the TypeScript LatticeFilter bridge):
#   input.action_path       - Lattice path (e.g. "market:trade:execute")
#   input.agent_id          - Originating agent ID (string)
#   input.agent_may         - Agents granted this action (GAP dimension)
#   input.category          - Action category string
#   input.payload           - Event payload (object)
#   input.agent_id          - Originating agent ID (string)
#   input.satisfied_actions - Array of satisfied action paths (from bridge)
#   input.parents_of        - Array of parent paths for this action (from bridge)
#   input.is_root           - Boolean: true if this action has no parents (from bridge)
#   input.all_actions       - All known lattice action paths (from bridge)
#   input.simultaneous_outputs - Current count of active output actions
#   input.event_rate        - Events per second from this agent (for rate limit)
#
# CRITICAL: parent_of() and root_action() helpers have been REMOVED.
# The bridge now supplies parents_of, is_root, all_actions, and
# satisfied_actions directly. The Rego policy consumes these bridge-
# computed fields rather than duplicating the lattice registry.
# This eliminates the drift between aep-lattice.yaml and Rego policy.
# ===========================================================================

# ---------------------------------------------------------------------------
# HELPER RULES
# ---------------------------------------------------------------------------

# Agent-may: Agent A may X. No rank.
agent_is_granted {
    some i
    input.agent_may[i] == input.agent_id
    input.agent_id != ""
}

agent_is_granted {
    some i
    input.agent_may[i] == "*"
    input.agent_id != ""
}

# Critical action paths that require a granted agent
critical_actions := {
    "market:trade:execute",
    "agent:email:send",
}

# Output modalities (action paths that produce human-facing output)
output_actions := {
    "output:notify",
    "output:ui_mutation",
    "output:speech",
    "output:haptic",
}

# Forbidden action sequences (ordered pairs that must never appear)
# Each entry is [parent, child] meaning: parent MUST NOT be followed by child
forbidden_sequences := {
    {"system:shutdown", "agent:register"},
    {"system:shutdown", "agent:ready"},
    {"system:shutdown", "agent:propose_action"},
    {"agent:deregister", "agent:propose_action"},
    {"agent:deregister", "agent:interest:register"},
    {"market:trade:execute", "market:price:update"},
    {"agent:email:send", "email:incoming"},
}

# Path known helper (safe set membership)
path_in_lattice {
    some i
    input.all_actions[i] == input.action_path
}

satisfied_contains(sub) {
    some i
    contains(input.satisfied_actions[i], sub)
}

# ---------------------------------------------------------------------------
# HARD VIOLATIONS: Block the event entirely
# ---------------------------------------------------------------------------

# Rule 1: Unknown action paths are always rejected
deny_lattice[msg] {
    not path_in_lattice
    msg := sprintf(
        "Unknown action path: '%v' - not found in lattice registry",
        [input.action_path]
    )
}

# Rule 2: Who-may-do-what is GAP dimension Conjunction. Empty grants fail closed for agent_action.
deny_lattice[msg] {
    input.category == "agent_action"
    not agent_is_granted
    msg := sprintf(
        "GAP dimension agent_may closed: agent '%v' may not '%v'",
        [input.agent_id, input.action_path]
    )
}

# Rule 5: Partial-order violation
# Bridge provides input.parents_of (direct parents) and input.is_root.
# If NOT a root AND none of the parents are in satisfied_actions, reject.
deny_lattice[msg] {
    not input.is_root
    count(input.parents_of) > 0
    # None of the parent paths are in satisfied_actions
    count({p | p := input.parents_of[_]; p == input.satisfied_actions[_]}) == 0
    msg := sprintf(
        "Partial-order violation: none of the parent actions for '%v' have been satisfied (parents: %v)",
        [input.action_path, concat(", ", input.parents_of)]
    )
}

# Rule 6: Forbidden action sequences
deny_lattice[msg] {
    some parent_path
    some child_path
    forbidden_sequences[{parent_path, child_path}]
    parent_path == input.satisfied_actions[_]
    child_path == input.action_path
    msg := sprintf(
        "Forbidden sequence: '%v' must not follow '%v'",
        [input.action_path, parent_path]
    )
}

# Rule 7: Rate limit exceeded - max 10 events/second for agent_action
deny_lattice[msg] {
    input.category == "agent_action"
    input.event_rate > 10.0
    msg := sprintf(
        "Rate limit exceeded: agent '%v' at %v events/sec for agent_action category (max: 10)",
        [input.agent_id, input.event_rate]
    )
}

# Rule 8: Cross-modality ceiling - max 3 simultaneous output actions
deny_lattice[msg] {
    output_actions[input.action_path]
    input.simultaneous_outputs > 3
    msg := sprintf(
        "Cross-modality ceiling exceeded: %v simultaneous outputs active (max: 3) for action '%v'",
        [input.simultaneous_outputs, input.action_path]
    )
}

# Rule 9: output category also uses GAP agent-may. Empty grants fail closed.
deny_lattice[msg] {
    input.category == "output"
    not agent_is_granted
    msg := sprintf(
        "GAP dimension agent_may closed: agent '%v' may not '%v'",
        [input.agent_id, input.action_path]
    )
}

# ---------------------------------------------------------------------------
# SOFT VIOLATIONS: Warn but allow
# ---------------------------------------------------------------------------

warn_lattice[msg] {
    input.category == "agent_action"
    input.event_rate > 7.0
    input.event_rate <= 10.0
    msg := sprintf(
        "Agent '%v' approaching rate limit: %v events/sec (limit: 10)",
        [input.agent_id, input.event_rate]
    )
}

warn_lattice[msg] {
    output_actions[input.action_path]
    input.simultaneous_outputs == 3
    msg := "Cross-modality at ceiling: 3 simultaneous outputs active"
}


# ---------------------------------------------------------------------------
# ESCALATION: Require human approval
# ---------------------------------------------------------------------------

escalate_lattice[msg] {
    input.payload.repeated_violation == true
    input.event_rate > 10.0
    msg := sprintf(
        "Repeated rate-limit violation by agent '%v' at %v events/sec - human review recommended",
        [input.agent_id, input.event_rate]
    )
}

escalate_lattice[msg] {
    not path_in_lattice
    input.action_path != ""
    msg := sprintf(
        "Unknown action path '%v' detected - possible agent hallucination, manual review recommended",
        [input.action_path]
    )
}


# ---------------------------------------------------------------------------
# COMPOSITE VERDICT
# ---------------------------------------------------------------------------

default deny = false
deny = true { count(deny_lattice) > 0 }

default warn = false
warn = true { count(warn_lattice) > 0 }

default escalate = false
escalate = true { count(escalate_lattice) > 0 }
