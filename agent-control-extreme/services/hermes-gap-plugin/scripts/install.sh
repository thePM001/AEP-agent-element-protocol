#!/bin/bash
# Install GAP Governance Plugin for Hermes Agent
# Usage: bash install.sh [gap_server_url]

set -euo pipefail

GAP_URL="${1:-http://127.0.0.1:3200}"
INSTALL_DIR="$HOME/.hermes/plugins/gap-governance"

echo "GAP Governance Plugin Installer"
echo "==============================="
echo ""

# Create directories
mkdir -p "$INSTALL_DIR/gap_governance"
mkdir -p "$INSTALL_DIR/scripts"
mkdir -p "$INSTALL_DIR/policies"

# Copy files
cp gap_governance/*.py "$INSTALL_DIR/gap_governance/"
cp scripts/gap-wrap "$INSTALL_DIR/scripts/"
chmod +x "$INSTALL_DIR/scripts/gap-wrap"

# Symlink gap-wrap to PATH
ln -sf "$INSTALL_DIR/scripts/gap-wrap" /usr/local/bin/gap-wrap 2>/dev/null || \
    echo "  (run with sudo to install gap-wrap globally)"

# Create config
cat > "$INSTALL_DIR/config.json" <<EOF
{
  "gap_server_url": "$GAP_URL",
  "fail_closed": true,
  "sync_interval": 300,
  "enabled_tools": ["terminal", "write_file", "patch", "delegate_task"]
}
EOF

echo ""
echo "Installed to: $INSTALL_DIR"
echo ""
echo "Usage:"
echo "  gap-wrap hermes chat              # Wrapped Hermes with GAP"
echo "  gap-wrap hermes chat -q '...'     # One-shot with governance"
echo ""
echo "Environment:"
echo "  export GAP_SERVER_URL=$GAP_URL"
echo "  export CONTROL_HUB_TOKEN=your-token"
echo "  export AGENT_SESSION_ID=your-session"
