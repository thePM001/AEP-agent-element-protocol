# NLA Task Manifest Rego Policy
# Validates task manifest YAML before execution
# Applied via Hermes governance plugin pre_task hook

package nla.task_manifest

import future.keywords.in
import future.keywords.if

# ─── Manifest completeness ───────────────────────────────────────────

deny[msg] {
    not input.manifest_version
    msg := "manifest_version is required"
}

deny[msg] {
    not input.task
    msg := "task block is required"
}

deny[msg] {
    not input.task.id
    msg := "task.id is required"
}

deny[msg] {
    not input.task.type
    msg := "task.type is required"
}

deny[msg] {
    valid_types := {"code_change", "deployment", "config_update", "page_update", "component_creation", "infrastructure", "policy_update"}
    not valid_types[input.task.type]
    msg := sprintf("task.type must be one of %v, got %v", [valid_types, input.task.type])
}

deny[msg] {
    not input.task.description
    msg := "task.description is required"
}

deny[msg] {
    not input.task.environments
    msg := "task.environments is required"
}

deny[msg] {
    input.task.environments[_] == "production"
    not input.task.gate_approved
    msg := "production deployment requires explicit gate_approved = true"
}

# ─── Files and URLs ──────────────────────────────────────────────────

deny[msg] {
    not input.task.files_affected
    msg := "task.files_affected is required (even if empty array, declare it)"
}

deny[msg] {
    not input.task.urls_affected
    msg := "task.urls_affected is required (even if empty array, declare it)"
}

# ─── Verification ────────────────────────────────────────────────────

deny[msg] {
    not input.verification
    msg := "verification block is required"
}

deny[msg] {
    not input.verification.curl_checks
    msg := "verification.curl_checks is required (minimum one end-to-end check)"
}

deny[msg] {
    count(input.verification.curl_checks) == 0
    msg := "at least one curl_check must be defined"
}

deny[msg] {
    some check in input.verification.curl_checks
    not check.url
    msg := sprintf("curl_check missing url: %v", [check])
}

deny[msg] {
    some check in input.verification.curl_checks
    not check.expected_status
    msg := sprintf("curl_check missing expected_status: %v", [check])
}

# ─── Completion ──────────────────────────────────────────────────────

deny[msg] {
    not input.completion
    msg := "completion block is required"
}

deny[msg] {
    not input.completion.criteria
    msg := "completion.criteria is required"
}

# ─── Post-task check uses deny rule directly ─────────────────────────

# manifest is valid when no deny rules fire
manifest_valid {
    count(deny) == 0
}

# ─── Post-task: verify completion ────────────────────────────────────

post_deny[msg] {
    input.task.id
    input.completion.status != "verified"
    msg := sprintf("task %v is not verified - all completion criteria must pass", [input.task.id])
}

post_deny[msg] {
    input.completion.verified_at == null
    msg := "completion.verified_at must be set to ISO8601 timestamp"
}

post_deny[msg] {
    not input.completion.criteria.all_files_written
    msg := "all files must be written before marking complete"
}

post_deny[msg] {
    not input.completion.criteria.build_passes
    msg := "build must pass before marking complete"
}

post_deny[msg] {
    not input.completion.criteria.all_curl_checks_pass
    msg := "all curl checks must pass before marking complete"
}

post_deny[msg] {
    not input.completion.criteria.reference_audit_clean
    msg := "reference audit must be clean before marking complete"
}
