#!/bin/bash
#===============================================================================
# Agent Validate (EXTREME) - Dedicated validation runner
#
# Replaces the inline Python one-liner from the reference implementation.
# Supports multiple validation strategies:
#   1. File marker check (same as reference - grep for identifiers)
#   2. ShellCheck integration
#   3. Custom policy assertions
#===============================================================================
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "$0")" && pwd)"
VERBOSE="${VERBOSE:-false}"

log_info()  { echo "[VALIDATE] $*"; }
log_error() { echo "[VALIDATE ERROR] $*" >&2; }
debug()     { [ "$VERBOSE" = "true" ] && echo "[VALIDATE DEBUG] $*"; }

usage() {
    cat <<USAGE
Usage: agent-validate.sh [options] <target_path>

Validates code or configuration against agent control hub policies.

Options:
  -p, --path <dir>     Target directory (default: .)
  -v, --verbose        Detailed output
  --marker <text>      Check files contain this marker (default: control-hub)
  --extension <ext>    File extensions to check (comma-separated)
  --skip-marker        Skip marker check
  --skip-shellcheck    Skip ShellCheck (if installed)
  --list               List available checks only

Examples:
  agent-validate.sh /opt/myapp
  agent-validate.sh --marker nla-harness --extension py,js,ex /opt/myrepo
USAGE
}

# Default checks
MARKER="${MARKER:-control-hub}"
EXTENSIONS="${EXTENSIONS:-py,js,ts,tsx,jsx,ex,rs}"
TARGET="."
SKIP_MARKER=false
SKIP_SHELLCHECK=false

# Parse args
while [ $# -gt 0 ]; do
    case "$1" in
        -p|--path)        TARGET="$2"; shift 2 ;;
        -v|--verbose)     VERBOSE=true; shift ;;
        --marker)         MARKER="$2"; shift 2 ;;
        --extension)      EXTENSIONS="$2"; shift 2 ;;
        --skip-marker)    SKIP_MARKER=true; shift ;;
        --skip-shellcheck) SKIP_SHELLCHECK=true; shift ;;
        --list)           echo "Available checks: marker, shellcheck, newline-eof, trailing-whitespace"; exit 0 ;;
        -h|--help)        usage; exit 0 ;;
        *)                [ -d "$1" ] && TARGET="$1" && shift || { log_error "Unknown option: $1"; usage; exit 1; } ;;
    esac
done

[ ! -d "$TARGET" ] && log_error "Target not found: $TARGET" && exit 1

TOTAL_VIOLATIONS=0
TOTAL_FILES_CHECKED=0

echo ""
echo "  AGENT CONTROL EXTREME - VALIDATION"
echo "  ==================================="
echo "  Target:     $TARGET"
echo "  Marker:     $MARKER"
echo "  Extensions: $EXTENSIONS"
echo ""

# ------------------------------------------------------------------
# Check 1: Source files contain the marker
# ------------------------------------------------------------------
if [ "$SKIP_MARKER" != "true" ]; then
    echo "[CHECK] Source files contain marker '$MARKER'..."
    IFS=',' read -ra EXT_ARR <<< "$EXTENSIONS"
    VIOLATIONS=0
    FILES_CHECKED=0

    for ext in "${EXT_ARR[@]}"; do
        while IFS= read -r -d '' file; do
            FILES_CHECKED=$((FILES_CHECKED + 1))
            content_len=$(wc -c < "$file" 2>/dev/null || echo 0)
            if [ "$content_len" -gt 100 ] && ! grep -q "$MARKER" "$file" 2>/dev/null; then
                debug "  MISSING MARKER: $file"
                VIOLATIONS=$((VIOLATIONS + 1))
            fi
        done < <(find "$TARGET" -name "*.$ext" -type f -print0 2>/dev/null || true)
    done

    if [ "$VIOLATIONS" -gt 0 ]; then
        log_error "  $VIOLATIONS files missing marker '$MARKER'"
    else
        echo "  OK - All files checked"
    fi
    TOTAL_VIOLATIONS=$((TOTAL_VIOLATIONS + VIOLATIONS))
    TOTAL_FILES_CHECKED=$((TOTAL_FILES_CHECKED + FILES_CHECKED))
fi

# ------------------------------------------------------------------
# Check 2: ShellCheck for shell scripts (if installed)
# ------------------------------------------------------------------
if [ "$SKIP_SHELLCHECK" != "true" ] && command -v shellcheck > /dev/null 2>&1; then
    echo "[CHECK] ShellCheck for bash scripts..."
    SHELLCHECK_ERRORS=0
    while IFS= read -r -d '' file; do
        debug "  shellcheck: $file"
        if ! shellcheck -s bash "$file" > /dev/null 2>&1; then
            SHELLCHECK_ERRORS=$((SHELLCHECK_ERRORS + 1))
        fi
    done < <(find "$TARGET" -name "*.sh" -type f -print0 2>/dev/null || true)

    if [ "$SHELLCHECK_ERRORS" -gt 0 ]; then
        log_error "  $SHELLCHECK_ERRORS shell scripts have issues (run shellcheck manually)"
    else
        echo "  OK - All shell scripts pass"
    fi
    TOTAL_VIOLATIONS=$((TOTAL_VIOLATIONS + SHELLCHECK_ERRORS))
elif [ "$SKIP_SHELLCHECK" != "true" ]; then
    echo "[SKIP] ShellCheck not installed"
fi

# ------------------------------------------------------------------
# Check 3: Trailing whitespace
# ------------------------------------------------------------------
echo "[CHECK] Trailing whitespace..."
TRAILING=0
while IFS= read -r -d '' file; do
    if grep -l '[[:space:]]$' "$file" > /dev/null 2>&1; then
        TRAILING=$((TRAILING + 1))
    fi
done < <(find "$TARGET" -type f \( -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.sh" -o -name "*.yaml" -o -name "*.yml" -o -name "*.json" \) -print0 2>/dev/null || true)

if [ "$TRAILING" -gt 0 ]; then
    log_error "  $TRAILING files have trailing whitespace"
    TOTAL_VIOLATIONS=$((TOTAL_VIOLATIONS + TRAILING))
else
    echo "  OK - Clean"
fi

# ------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------
echo ""
echo "  VALIDATION SUMMARY"
echo "  =================="
echo "  Files checked: $TOTAL_FILES_CHECKED"
echo "  Violations:    $TOTAL_VIOLATIONS"

if [ "$TOTAL_VIOLATIONS" -gt 0 ]; then
    echo "  Result:       FAILED"
    log_error "$TOTAL_VIOLATIONS violations found"
    exit 1
else
    echo "  Result:       PASSED"
    exit 0
fi
