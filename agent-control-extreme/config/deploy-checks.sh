#!/bin/bash
#===============================================================================
# deploy-checks.sh - Pre-deployment validation gate
#
# Enforces the deployment gate policy:
#   - WHAT + WHY + IMPACT + ROLLBACK + DURATION prompt required
#   - Explicit human approval required
#   - NEVER raw command chains as authorization
#   - Logs every deployment action
#===============================================================================
set -euo pipefail

log_info()  { echo "[DEPLOY-GATE] $*"; }
log_error() { echo "[DEPLOY-GATE ERROR] $*" >&2; }
fatal()     { log_error "$*"; exit 1; }

# --- Check 1: Verify we are on an approved deployment domain ---
check_domain() {
    local target_url="${1:-}"
    [ -z "$target_url" ] && fatal "No target URL provided"

    # ONLY tasty.newlisbon.agency or taskstar.newlisbon.agency
    if echo "$target_url" | grep -qE "tasty\.newlisbon\.agency|taskstar\.newlisbon\.agency"; then
        log_info "Target domain approved: $target_url"
    else
        fatal "Domain NOT approved: $target_url. Use tasty.newlisbon.agency or taskstar.newlisbon.agency only."
    fi

    # NEVER raw IP
    if echo "$target_url" | grep -qE "https?://[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+"; then
        fatal "Raw IP URL forbidden. Use domain name."
    fi
}

# --- Check 2: Deployment prompt has ALL required fields ---
check_prompt() {
    local prompt_file="${1:-}"
    [ -z "$prompt_file" ] && fatal "No deployment prompt file"
    [ ! -f "$prompt_file" ] && fatal "Prompt file not found: $prompt_file"

    local content
    content=$(cat "$prompt_file")

    for field in "WHAT:" "WHY:" "IMPACT:" "ROLLBACK:" "DURATION:"; do
        if ! echo "$content" | grep -q "$field"; then
            fatal "Deployment prompt missing required field: $field"
        fi
    done

    log_info "Deployment prompt has all required fields"
}

# --- Check 3: No raw command chains in authorization ---
check_no_raw_commands() {
    local content="${1:-}"
    [ -z "$content" ] && fatal "No content to check"

    # Reject pipe chains
    if echo "$content" | grep -qE "\|.*\|"; then
        fatal "Raw command chains forbidden in authorization prompt"
    fi

    # Reject dangerous patterns in auth prompt
    if echo "$content" | grep -qE "\brm\s+-rf\b|\bgit\s+push\s+--force\b|\bDROP\s+TABLE\b"; then
        fatal "Dangerous patterns detected in authorization prompt"
    fi

    log_info "No raw command chains in authorization"
}

# --- Check 4: Human approval ---
request_approval() {
    local what="${1:-unknown}"
    local why="${2:-unknown}"
    local impact="${3:-unknown}"
    local rollback="${4:-unknown}"
    local duration="${5:-unknown}"

    echo ""
    echo "  ╔══════════════════════════════════════════════════════╗"
    echo "  ║      DEPLOYMENT GATE - HUMAN APPROVAL REQUIRED      ║"
    echo "  ╠══════════════════════════════════════════════════════╣"
    echo "  ║  WHAT:     $what"
    echo "  ║  WHY:      $why"
    echo "  ║  IMPACT:   $impact"
    echo "  ║  ROLLBACK: $rollback"
    echo "  ║  DURATION: $duration"
    echo "  ╚══════════════════════════════════════════════════════╝"
    echo ""
    echo -n "  Type 'yes' to approve deployment: "
    read -r response

    if [ "$response" != "yes" ]; then
        fatal "Deployment NOT approved by human"
    fi

    log_info "Human approval received"
}

# --- Check 5: Log the deployment request ---
log_deployment() {
    local log_file="/var/log/agent-control/deployments.log"
    mkdir -p "$(dirname "$log_file")"

    cat >> "$log_file" <<LOG
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "what": "${1:-}",
  "why": "${2:-}",
  "impact": "${3:-}",
  "rollback": "${4:-}",
  "duration": "${5:-}",
  "user": "${USER:-unknown}",
  "host": "$(hostname)"
}
LOG
    log_info "Deployment logged to $log_file"
}

# --- Main ---
main() {
    local target_url="${1:-}"
    local prompt_file="${2:-}"

    check_domain "$target_url"

    if [ -n "$prompt_file" ] && [ -f "$prompt_file" ]; then
        check_prompt "$prompt_file"
        local content
        content=$(cat "$prompt_file")
        check_no_raw_commands "$content"

        # Extract fields
        local what why impact rollback duration
        what=$(echo "$content" | grep "WHAT:" | sed 's/WHAT://' | xargs)
        why=$(echo "$content" | grep "WHY:" | sed 's/WHY://' | xargs)
        impact=$(echo "$content" | grep "IMPACT:" | sed 's/IMPACT://' | xargs)
        rollback=$(echo "$content" | grep "ROLLBACK:" | sed 's/ROLLBACK://' | xargs)
        duration=$(echo "$content" | grep "DURATION:" | sed 's/DURATION://' | xargs)

        request_approval "$what" "$why" "$impact" "$rollback" "$duration"
        log_deployment "$what" "$why" "$impact" "$rollback" "$duration"
    else
        log_error "No prompt file provided - cannot request human approval"
        exit 1
    fi

    log_info "Deployment gate PASSED"
    exit 0
}

main "$@"
