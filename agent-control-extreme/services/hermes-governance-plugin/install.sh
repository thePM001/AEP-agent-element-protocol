#!/bin/bash
# Install Hermes Governance Plugin
# Standalone. Zero dependencies. No GAP Runtime. No paid products.
#
# Usage: bash install.sh

set -euo pipefail

INSTALL_DIR="$HOME/.hermes/plugins/hermes-governance"

echo "Hermes Governance Plugin v0.1.0"
echo "================================"
echo "8 local policy checks. No GAP Runtime needed."
echo ""

mkdir -p "$INSTALL_DIR/hermes_governance"
cp hermes_governance/*.py "$INSTALL_DIR/hermes_governance/"
cp README.md "$INSTALL_DIR/"

# Verify installation
python3 -c "
import sys
sys.path.insert(0, '$HOME/.hermes/plugins')
from hermes_governance import GovernancePlugin, PolicyChecks
p = PolicyChecks()
# Quick smoke test
result = p.check_all('This uses MIT License and 0.0.0.0 bind -- bad')
assert len(result) >= 3, 'Expected at least 3 violations'
print('Plugin loaded. 8 checks active.')
print(f'Smoke test: {len(result)} violations detected (expected 3+)')
print('Governance plugin is ACTIVE.')
" 2>&1

echo ""
echo "Installed to: $INSTALL_DIR"
echo ""
echo "Usage:"
echo "  Hermes will auto-load the plugin on startup."
echo "  Or add to your Hermes config:"
echo "    plugins:"
echo "      - hermes-governance"
echo ""
echo "Optional (not required, paid product):"
echo "  GAP Bridge addon for deep governance: hermes plugins install gap-bridge"
