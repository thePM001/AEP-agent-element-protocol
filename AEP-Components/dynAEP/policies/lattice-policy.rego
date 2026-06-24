package dynaep.lattice

# ===========================================================================
# Lattice Governance Policy
# Enforces action lattice rules: trust-tier boundaries, partial-order
# validation, forbidden sequences, rate limits, and cross-modality
# constraints for output actions.
#
# Evaluated by Open Policy Agent (OPA) via @open-policy-agent/opa-wasm.
#
# Expected input fields (supplied by the TypeScript LatticeFilter bridge):
#   input.action_path       - Lattice path (e.g. "market:trade:execute")
#   input.trust_tier        - Agent trust tier (1-5)
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

# Categorise trust tiers
trust_tier_low(t)     { t >= 1; t <= 2 }
trust_tier_mid(t)     { t >= 3; t <= 4 }
trust_tier_high(t)    { t == 5 }

# Critical action paths that require maximum trust
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

# ---------------------------------------------------------------------------
# HARD VIOLATIONS: Block the event entirely
# ---------------------------------------------------------------------------

# Rule 1: Unknown action paths are always rejected
deny_lattice[msg] {
    not input.all_actions[_] == input.action_path
    msg := sprintf(
        "Unknown action path: '%v' - not found in lattice registry",
        [input.action_path]
    )
}

# Rule 2: Trust tier 1-2 can only handle external_event and system_event
deny_lattice[msg] {
    trust_tier_low(input.trust_tier)
    input.category != "external_event"
    input.category != "system_event"
    msg := sprintf(
        "Trust tier %v denied: tier 1-2 agents may only handle external_event or system_event (got '%v')",
        [input.trust_tier, input.category]
    )
}

# Rule 3: Trust tier 3-4 cannot execute critical actions
deny_lattice[msg] {
    trust_tier_mid(input.trust_tier)
    critical_actions[input.action_path]
    msg := sprintf(
        "Trust tier %v denied: critical action '%v' requires trust tier 5",
        [input.trust_tier, input.action_path]
    )
}

# Rule 4: Agent_action for trust_tier 1-2 is always blocked
deny_lattice[msg] {
    trust_tier_low(input.trust_tier)
    input.category == "agent_action"
    msg := sprintf(
        "Trust tier %v denied: agent_action category requires trust tier >= 3",
        [input.trust_tier]
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

# Rule 9: output category requires at least trust_tier 2
deny_lattice[msg] {
    input.category == "output"
    input.trust_tier < 2
    msg := sprintf(
        "Trust tier %v denied: output actions require trust tier >= 2",
        [input.trust_tier]
    )
}

# ---------------------------------------------------------------------------
# SOFT VIOLATIONS: Warn but allow
# ---------------------------------------------------------------------------

warn_lattice[msg] {
    trust_tier_mid(input.trust_tier)
    input.category == "agent_action"
    input.payload == {}
    msg := sprintf(
        "Trust tier %v agent_action has empty payload - recommend supplying action context",
        [input.trust_tier]
    )
}

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
    msg := sprintf(
        "Cross-modality at ceiling: 3 simultaneous outputs active",
    )
}

warn_lattice[msg] {
    trust_tier_mid(input.trust_tier)
    input.category == "agent_action"
    count(input.satisfied_actions) > 0
    count(input.satisfied_actions) < 2
    msg := sprintf(
        "Trust tier %v has only %v satisfied parent(s) - low trust-buffer for action '%v'",
        [input.trust_tier, count(input.satisfied_actions), input.action_path]
    )
}

warn_lattice[msg] {
    trust_tier_high(input.trust_tier)
    critical_actions[input.action_path]
    not contains(input.satisfied_actions[_], "validate")
    not contains(input.satisfied_actions[_], "review")
    msg := sprintf(
        "Critical action '%v' executed by trust tier %v without any prior validation or review step in satisfied actions",
        [input.action_path, input.trust_tier]
    )
}

# ---------------------------------------------------------------------------
# ESCALATION: Require human approval
# ---------------------------------------------------------------------------

escalate_lattice[msg] {
    trust_tier_high(input.trust_tier)
    critical_actions[input.action_path]
    count(input.satisfied_actions) == 0
    msg := sprintf(
        "Critical action '%v' attempted by trust tier %v with no satisfied parent actions - human approval required",
        [input.action_path, input.trust_tier]
    )
}

escalate_lattice[msg] {
    input.payload.repeated_violation == true
    input.event_rate > 10.0
    msg := sprintf(
        "Repeated rate-limit violation by agent '%v' at %v events/sec - human review recommended",
        [input.agent_id, input.event_rate]
    )
}

escalate_lattice[msg] {
    not input.all_actions[_] == input.action_path
    input.action_path != ""
    msg := sprintf(
        "Unknown action path '%v' detected - possible agent hallucination, manual review recommended",
        [input.action_path]
    )
}

escalate_lattice[msg] {
    trust_tier_high(input.trust_tier)
    input.category == "agent_action"
    input.payload.trust_tier_history == "direct_jump"
    msg := sprintf(
        "Trust tier jump detected: agent '%v' escalated directly to tier %v without mid-level validation steps",
        [input.agent_id, input.trust_tier]
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
