#!/bin/bash
#===============================================================================
# Agent Control Harness - Master control script
#===============================================================================
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "$0")" && pwd)"

log()  { echo "[AGENT-HARNESS] $*"; }
err()  { echo "[AGENT-HARNESS ERROR] $*" >&2; exit 1; }

case "${1:-help}" in
  boot)
    shift
    "$HARNESS_DIR/agent-bootstrap.sh" "$@"
    ;;
  register)
    shift
    kind="${1:-}"; id="${2:-}"; desc="${3:-}"
    [ -z "$kind" ] && err "Usage: agent-harness register --kind <type> --id <name>"
    log "Registering component: kind=$kind id=$id"
    echo "  Implementation: update your own component registry here"
    ;;
  validate)
    shift
    target="${1:-.}"
    log "Validating $target..."
    python3 -c "
import os
violations = []
for root, dirs, files in os.walk('$target'):
    for f in files:
        if f.endswith(('.py', '.js', '.ts', '.tsx', '.jsx', '.ex', '.rs')):
            path = os.path.join(root, f)
            try:
                with open(path) as fh:
                    content = fh.read()
                    if 'control-hub' not in content and len(content) > 100:
                        violations.append(path)
            except: pass
if violations:
    print('  Files without control-hub markers:')
    for v in violations[:5]:
        print(f'    - {v}')
"
    log "Validation complete."
    ;;
  policies)
    log "Active Policies:"
    for f in "$HARNESS_DIR/../policies"/*.policy; do
      name=$(basename "$f")
      guard=$(grep 'guard:' "$f" | head -1 | sed 's/.*guard: "//;s/"$//')
      echo "  [ACTIVE] $name"
      echo "    ${guard:0:80}..."
    done
    ;;
  status)
    echo "Agent Control Hub Status:"
    echo "  Bootstrap: $HARNESS_DIR/agent-bootstrap.sh"
    echo "  Policies: $(ls "$HARNESS_DIR/../policies"/*.policy 2>/dev/null | wc -l) active"
    echo "  Sessions: $HARNESS_DIR/../registry/agent-sessions.json"
    ;;
  help|*)
    echo "Usage:"
    echo "  agent-harness boot <name> <type> <version>   # Boot registration"
    echo "  agent-harness register --kind <t> --id <n>   # Register component"
    echo "  agent-harness validate [--path <dir>]        # Validate code"
    echo "  agent-harness policies                       # List policies"
    echo "  agent-harness status                         # Show status"
    ;;
esac
