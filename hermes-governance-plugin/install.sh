#!/bin/bash
# Install Hermes Governance Plugin
# Standalone. Zero dependencies. No paid products. Fully configurable.
#
# Usage: bash install.sh

set -euo pipefail

INSTALL_DIR="$HOME/.hermes/plugins/hermes-governance"

echo "Hermes Governance Plugin v0.1.0"
echo "================================"
echo "Configurable policy checks. No external dependencies."
echo ""

mkdir -p "$INSTALL_DIR/hermes_governance"
cp hermes_governance/*.py "$INSTALL_DIR/hermes_governance/"
cp README.md "$INSTALL_DIR/"

# Verify installation
python3 -c "
import sys
sys.path.insert(0, '$HOME/.hermes/plugins')
from hermes_governance import GovernancePlugin, PolicyChecks
# Smoke test
result = PolicyChecks.check_all('test text with 0.0.0.0 bind and -- bad hyphen')
assert len(result) >= 2, f'Expected 2+ violations, got {len(result)}'
print('Plugin loaded. Policy checks active.')
print(f'Smoke test: {len(result)} violations detected')
print('All checks configurable via POLICY_* environment variables.')
" 2>&1

echo ""
echo "Installed to: $INSTALL_DIR"
echo ""
echo "Configuration via environment variables:"
echo "  POLICY_NETWORK_BIND       Forbidden bind addresses"
echo "  POLICY_DOMAIN_ALLOWLIST   Comma-separated allowed domains"
echo "  POLICY_LICENSE            Forbidden license pattern"
echo "  POLICY_REQUIRED_SECTIONS  Deploy prompt sections"
echo "  POLICY_FORBIDDEN_COMMANDS Blocked command patterns"
echo ""
echo "See README.md for all options."
