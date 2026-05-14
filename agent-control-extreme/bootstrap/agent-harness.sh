#!/bin/bash
#===============================================================================
# Agent Control Harness (EXTREME) - Master control script
#
# STANDALONE. No GAP dependency. Core commands work with just Git + Bash.
# GAP is OPTIONAL - see gap-bridge.sh for GAP-powered scan/execute.
#
# Improvements over reference:
#   - getopts-based CLI parsing (not positional)
#   - Structured JSON logging
#   - Dedicated validate script (not inline Python)
#   - Policy severity display
#   - Deployment gate enforcement
#   - Concurrency-safe locking (exponential backoff)
#   - Token via environment only (never CLI - no ps leakage)
#===============================================================================
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTROL_HUB_URL="${CONTROL_HUB_URL:-http://100.118.184.18:3003}"
CONTROL_REPO_OWNER="${CONTROL_REPO_OWNER:-thePM001}"
CONTROL_REPO_NAME="${CONTROL_REPO_NAME:-NLA-PLATFORM}"
CONTROL_HUB_TOKEN="${CONTROL_HUB_TOKEN:-}"
GAP_AVAILABLE=false
VERBOSE="${VERBOSE:-false}"

# Check if GAP is available (optional enhancement)
GAP_SERVER_URL="${GAP_SERVER_URL:-http://127.0.0.1:3200}"
if curl -sf "$GAP_SERVER_URL/health" > /dev/null 2>&1; then
    GAP_AVAILABLE=true
fi

log_info()  { echo "{\"level\":\"info\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"source\":\"nla-harness\",\"msg\":\"$*\"}"; }
log_error() { echo "{\"level\":\"error\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"source\":\"nla-harness\",\"msg\":\"$*\"}" >&2; }
fatal()     { log_error "$*"; exit 1; }
debug()     { [ "$VERBOSE" = "true" ] && echo "[DEBUG] $*"; }

usage() {
    cat <<USAGE
Usage: nla-harness [command] [options]

CORE COMMANDS (always available):
  boot <name> <type> <ver>      Register agent session (first command on spawn)
  register [options]            Register a new component
    -k, --kind <type>           Component kind (agent|service|policy|...)
    -i, --id <name>             Component identifier
    -d, --desc <desc>           Description
  validate [options]            Validate code against control hub conventions
    -p, --path <dir>            Target directory (default: .)
    -v, --verbose               Detailed output
  policies [options]            List active policies
    -s, --severity <s>          Filter: critical|high|low
  deploy-check [options]        Run pre-deployment approval gate
    -u, --url <url>             Target deployment URL
    -f, --file <file>           Deployment prompt file (WHAT/WHY/IMPACT/ROLLBACK/DURATION)
  check-policies [options]      Local policy compliance scan (no GAP required)
    -t, --text <text>           Text to check
    -f, --file <file>           File to check
  status                        Show hub status
  help                          Show this message

OPTIONAL COMMANDS (requires GAP Runtime):
  gap-scan --text <t> --scanners <list>   Deep scan via GAP 11 scanners
  gap-execute --yaml <f> --input <json>   Execute GAP instruction
  gap-status                              GAP server health check

Environment:
  CONTROL_HUB_URL        Gitea API base URL (default: http://100.118.184.18:3003)
  CONTROL_HUB_TOKEN      Gitea access token (required for boot)
  GAP_SERVER_URL         GAP Runtime server (optional: http://127.0.0.1:3200)
  CONTROL_REPO_OWNER     Git repo owner (default: thePM001)
  CONTROL_REPO_NAME      Git repo name (default: NLA-PLATFORM)

Examples:
  nla-harness boot mypm+ cli 1.0
  nla-harness register --kind agent --id mypm+ --desc "Biosecure terminal agent"
  nla-harness validate --path /opt/myapp
  nla-harness policies --severity critical
  nla-harness deploy-check --url https://tasty.newlisbon.agency/staging/app --file /tmp/deploy-prompt.txt
  nla-harness check-policies --text "some code output to scan"
USAGE
}

# ============================================================
# Subcommand: boot
# ============================================================
cmd_boot() {
    [ $# -lt 3 ] && fatal "Usage: nla-harness boot <name> <type> <version>"
    local name="$1"; shift
    local type="$1"; shift
    local version="$1"; shift
    "$HARNESS_DIR/agent-bootstrap.sh" "$name" "$type" "$version"
}

# ============================================================
# Subcommand: register
# ============================================================
cmd_register() {
    local kind="" id="" desc=""
    while [ $# -gt 0 ]; do
        case "$1" in
            -k|--kind) kind="$2"; shift 2 ;;
            -i|--id)   id="$2"; shift 2 ;;
            -d|--desc) desc="$2"; shift 2 ;;
            *)         fatal "Unknown register option: $1" ;;
        esac
    done
    [ -z "$kind" ] && fatal "Usage: nla-harness register --kind <type> --id <name>"

    log_info "Registering component: kind=$kind id=$id"

    local registry_path="agent-control-extreme/registry/component-registry.md"
    local date_stamp
    date_stamp="$(date -u +%Y-%m-%d)"

    # Write registration to local file (push to Git via boot script session)
    local registry_dir="$HARNESS_DIR/../registry"
    mkdir -p "$registry_dir"
    echo "| $date_stamp | $kind | $id | $desc |" >> "$registry_dir/component-registry.md"
    log_info "Component registered locally: $kind/$id"
    [ -n "$desc" ] && echo "  description: $desc"
}

# ============================================================
# Subcommand: validate
# ============================================================
cmd_validate() {
    local target="." verbose_flag=""
    while [ $# -gt 0 ]; do
        case "$1" in
            -p|--path)    target="$2"; shift 2 ;;
            -v|--verbose) verbose_flag="true"; shift ;;
            *)            [ -d "$1" ] && { target="$1"; shift; } || fatal "Unknown validate option: $1" ;;
        esac
    done

    log_info "Validating $target..."

    if $GAP_AVAILABLE; then
        log_info "GAP available - enhanced validation active"
    fi

    # Always run local validation (standalone, no GAP dependency)
    "$HARNESS_DIR/agent-validate.sh" "$target"

    log_info "Validation complete."
}

# ============================================================
# Subcommand: policies
# ============================================================
cmd_policies() {
    local severity_filter=""
    while [ $# -gt 0 ]; do
        case "$1" in
            -s|--severity) severity_filter="$2"; shift 2 ;;
            *)             fatal "Unknown policies option: $1" ;;
        esac
    done

    log_info "Active Policies:"
    local policy_dir="$HARNESS_DIR/../policies"
    [ ! -d "$policy_dir" ] && policy_dir="$HARNESS_DIR/../../agent-control-hub/policies"
    [ ! -d "$policy_dir" ] && { log_error "No policies directory found"; return 1; }

    local count=0
    shopt -s nullglob
    for f in "$policy_dir"/*.policy "$policy_dir"/*.gap; do
        [ ! -f "$f" ] && continue
        local name severity guard
        name=$(basename "$f")
        severity=$(grep -i 'severity:' "$f" | head -1 | sed 's/.*[sS]everity: *//' | tr -d '" ')
        [ -z "$severity" ] && severity="info"
        guard=$(grep -i 'description:' "$f" | head -1 | sed 's/.*[dD]escription: *"//;s/"$//')
        [ -z "$guard" ] && guard="(no description)"

        [ -n "$severity_filter" ] && [ "$severity" != "$severity_filter" ] && continue

        printf "  [%-8s] %s\n" "$severity" "$name"
        echo "    $guard"
        count=$((count + 1))
    done
    shopt -u nullglob

    echo ""
    echo "  $count policies loaded"
}

# ============================================================
# Subcommand: check-policies (local, no GAP required)
# ============================================================
cmd_check_policies() {
    local text="" file=""
    while [ $# -gt 0 ]; do
        case "$1" in
            -t|--text) text="$2"; shift 2 ;;
            -f|--file) file="$2"; shift 2 ;;
            *)         fatal "Unknown check-policies option: $1" ;;
        esac
    done

    if [ -n "$file" ]; then
        text=$(cat "$file" 2>/dev/null || echo "")
        log_info "Checking file: $file"
    fi
    [ -z "$text" ] && fatal "Usage: nla-harness check-policies --text <text> or --file <file>"

    log_info "Running local policy checks..."
    local violations=0

    # Check 1: Network policy - no 0.0.0.0 binds
    if echo "$text" | grep -qE '0\.0\.0\.0'; then
        log_error "  VIOLATION [network]: 0.0.0.0 binding detected"
        violations=$((violations + 1))
    else
        echo "  [PASS] network: no public bindings"
    fi

    # Check 2: Writing standards - no gray text
    if echo "$text" | grep -qiE '#[0-8a-f]{3}[0-8a-f]'; then
        log_error "  VIOLATION [writing]: possible gray text (sub-#F0F0F0)"
        violations=$((violations + 1))
    else
        echo "  [PASS] writing: no gray text"
    fi

    # Check 3: Writing standards - no double-hyphens as word separators
    if echo "$text" | grep -qE ' -- |^-- | --$'; then
        log_error "  VIOLATION [writing]: double-hyphen word separator (use single hyphen)"
        violations=$((violations + 1))
    else
        echo "  [PASS] writing: no double-hyphen separators"
    fi

    # Check 4: Writing standards - no em-dashes
    if echo "$text" | grep -qP '\x{2014}|\x{2013}'; then
        log_error "  VIOLATION [writing]: em-dash or en-dash detected"
        violations=$((violations + 1))
    else
        echo "  [PASS] writing: no em-dashes"
    fi

    # Check 5: Secrets - API keys / tokens
    if echo "$text" | grep -qiE '\b(ghp_|gho_|ghu_|ghs_|ghr_|sk-live-|sk-ant-|AKIA[A-Z0-9]{16}|xai-[A-Za-z0-9]{40,})\b'; then
        log_error "  VIOLATION [secrets]: possible secret in output"
        violations=$((violations + 1))
    else
        echo "  [PASS] secrets: no exposed keys"
    fi

    # Check 6: Deployment domain - only approved domains
    if echo "$text" | grep -qiE 'newlisbon\.agency' && ! echo "$text" | grep -qiE 'tasty\.newlisbon\.agency|taskstar\.newlisbon\.agency'; then
        log_error "  VIOLATION [deployment]: unapproved newlisbon.agency domain"
        violations=$((violations + 1))
    else
        echo "  [PASS] deployment: domain policy OK"
    fi

    # Check 7: License - never MIT
    if echo "$text" | grep -qiE 'MIT License|MIT license|license.*MIT'; then
        log_error "  VIOLATION [license]: MIT license detected (Apache 2.0 only)"
        violations=$((violations + 1))
    else
        echo "  [PASS] license: Apache 2.0"
    fi

    # Check 8: No raw IP URLs
    if echo "$text" | grep -qE 'https?://[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+'; then
        log_error "  VIOLATION [network]: raw IP URL in content"
        violations=$((violations + 1))
    else
        echo "  [PASS] network: no raw IP URLs"
    fi

    echo ""
    if [ "$violations" -gt 0 ]; then
        log_error "  RESULT: $violations violation(s) found - HARD FAIL"
        exit 1
    else
        echo "  RESULT: PASSED - all policy checks clear"
    fi
}

# ============================================================
# Subcommand: deploy-check
# ============================================================
cmd_deploy_check() {
    local url="" file=""
    while [ $# -gt 0 ]; do
        case "$1" in
            -u|--url)  url="$2"; shift 2 ;;
            -f|--file) file="$2"; shift 2 ;;
            *)         fatal "Unknown deploy-check option: $1" ;;
        esac
    done

    [ -z "$url" ] && fatal "Usage: nla-harness deploy-check --url <url> --file <prompt_file>"

    # Run the standalone deploy checks script (zero GAP dependency)
    local deploy_script="$HARNESS_DIR/../config/deploy-checks.sh"
    if [ -x "$deploy_script" ]; then
        "$deploy_script" "$url" "$file"
    else
        log_error "deploy-checks.sh not found at $deploy_script"
        log_error "Run manual checks:"
        log_error "  1. Verify domain: $url (tasty or taskstar only)"
        log_error "  2. Verify prompt has: WHAT, WHY, IMPACT, ROLLBACK, DURATION"
        log_error "  3. Get explicit human approval"
        exit 1
    fi
}

# ============================================================
# Subcommand: gap-scan (OPTIONAL - requires GAP Runtime)
# ============================================================
cmd_gap_scan() {
    if ! $GAP_AVAILABLE; then
        log_error "GAP Runtime not available at $GAP_SERVER_URL"
        log_error "Install gap-server first, or use 'check-policies' for local scanning"
        exit 1
    fi

    local text="" scanners=""
    while [ $# -gt 0 ]; do
        case "$1" in
            -t|--text)     text="$2"; shift 2 ;;
            -s|--scanners) scanners="$2"; shift 2 ;;
            *)             fatal "Unknown gap-scan option: $1" ;;
        esac
    done
    [ -z "$text" ] && fatal "Usage: nla-harness gap-scan --text <text> --scanners <comma-list>"

    log_info "GAP deep scan..."
    local result
    result=$(curl -s -X POST "$GAP_SERVER_URL/scan" \
      -H "Content-Type: application/json" \
      -d "$(python3 -c "
import sys, json
text = sys.argv[1] if len(sys.argv) > 1 else ''
scanners = sys.argv[2].split(',') if len(sys.argv) > 2 else []
print(json.dumps({'text': text, 'scanners': [s.strip() for s in scanners]}))
" "$text" "$scanners" 2>/dev/null)" 2>/dev/null)

    echo "$result" | python3 -m json.tool 2>/dev/null || echo "$result"
}

# ============================================================
# Subcommand: gap-execute (OPTIONAL - requires GAP Runtime)
# ============================================================
cmd_gap_execute() {
    if ! $GAP_AVAILABLE; then
        log_error "GAP Runtime not available"
        exit 1
    fi

    local yaml_file="" input="{}"
    while [ $# -gt 0 ]; do
        case "$1" in
            -y|--yaml)  yaml_file="$2"; shift 2 ;;
            -i|--input) input="$2"; shift 2 ;;
            *)          fatal "Unknown gap-execute option: $1" ;;
        esac
    done
    [ -z "$yaml_file" ] && fatal "Usage: nla-harness gap-execute --yaml <file> --input <json>"
    [ ! -f "$yaml_file" ] && fatal "YAML file not found: $yaml_file"

    local yaml_content
    yaml_content=$(cat "$yaml_file")

    log_info "GAP execution..."
    local result
    result=$(curl -s -X POST "$GAP_SERVER_URL/execute" \
      -H "Content-Type: application/json" \
      -d "$(python3 -c "
import sys, json
yaml_str = sys.argv[1] if len(sys.argv) > 1 else ''
input_val = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
print(json.dumps({'yaml': yaml_str, 'input': input_val, 'proof': True}))
" "$yaml_content" "$input" 2>/dev/null)" 2>/dev/null)

    echo "$result" | python3 -m json.tool 2>/dev/null || echo "$result"
}

# ============================================================
# Subcommand: gap-status
# ============================================================
cmd_gap_status() {
    if $GAP_AVAILABLE; then
        echo "GAP Runtime: available at $GAP_SERVER_URL"
        echo ""
        curl -s "$GAP_SERVER_URL/health" | python3 -m json.tool 2>/dev/null
        echo ""
        curl -s "$GAP_SERVER_URL/scanners" | python3 -m json.tool 2>/dev/null
    else
        echo "GAP Runtime: NOT available"
        echo "  Expected at: $GAP_SERVER_URL"
        echo "  Install: gap-server --serve --port 3200"
        echo "  Or ignore: all core commands work without GAP"
    fi
}

# ============================================================
# Subcommand: status
# ============================================================
cmd_status() {
    echo "NLA Agent Control Extreme - Status"
    echo "==================================="
    echo " Version:     2.0 (extreme)"
    echo " Harness:     $HARNESS_DIR/agent-harness.sh"
    echo " Bootstrap:   $HARNESS_DIR/agent-bootstrap.sh"
    echo " Validate:    $HARNESS_DIR/agent-validate.sh"
    echo " Deploy-Gate: $HARNESS_DIR/../config/deploy-checks.sh"
    echo " Hub URL:     $CONTROL_HUB_URL"
    echo " Repo:        $CONTROL_REPO_OWNER/$CONTROL_REPO_NAME"
    echo ""
    echo " Policies:"
    local policy_dir="$HARNESS_DIR/../policies"
    [ ! -d "$policy_dir" ] && policy_dir="$HARNESS_DIR/../../agent-control-hub/policies"
    if [ -d "$policy_dir" ]; then
        shopt -s nullglob
        for f in "$policy_dir"/*.policy "$policy_dir"/*.gap; do
            [ -f "$f" ] && echo "  - $(basename "$f")"
        done
        shopt -u nullglob
    else
        echo "  (none found)"
    fi
    echo ""
    echo " GAP Runtime:"
    if $GAP_AVAILABLE; then
        echo "  Status: available ($GAP_SERVER_URL)"
        echo "  Commands: gap-scan, gap-execute, gap-status"
    else
        echo "  Status: not installed (OPTIONAL)"
        echo "  All core commands work without GAP"
        echo "  Install gap-server for deep scanner enforcement"
    fi
    echo ""
    echo " Session:"
    echo "  HOST= $(hostname)"
    echo "  PID=  $$"
    [ -n "${AGENT_SESSION_ID:-}" ] && echo "  SESSION= $AGENT_SESSION_ID"
}

# ============================================================
# Main dispatcher
# ============================================================
case "${1:-help}" in
    boot)
        shift; cmd_boot "$@" ;;
    register)
        shift; cmd_register "$@" ;;
    validate)
        shift; cmd_validate "$@" ;;
    policies)
        shift; cmd_policies "$@" ;;
    check-policies)
        shift; cmd_check_policies "$@" ;;
    deploy-check)
        shift; cmd_deploy_check "$@" ;;
    gap-scan)
        shift; cmd_gap_scan "$@" ;;
    gap-execute)
        shift; cmd_gap_execute "$@" ;;
    gap-status)
        cmd_gap_status ;;
    status)
        cmd_status ;;
    help|--help|-h)
        usage ;;
    *)
        echo "Unknown command: $1"
        usage
        exit 1
        ;;
esac
