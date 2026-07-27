#!/usr/bin/env bash
# ===========================================================================
# OPT-002: Build Unified OPA WASM Bundle
# Compiles all three policy files into a single WASM bundle with three
# entrypoints: aep/forbidden, dynaep/temporal, dynaep/perception.
# Requires: opa >= 0.60.0
# ===========================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
POLICY_DIR="$ROOT_DIR/policies"
OUTPUT_DIR="$POLICY_DIR"

# Policy files
STRUCTURAL="$POLICY_DIR/aep-policy.rego"
TEMPORAL="$POLICY_DIR/temporal-policy.rego"
PERCEPTION="$POLICY_DIR/perception-policy.rego"

# Output
UNIFIED_BUNDLE="$OUTPUT_DIR/aep-unified-bundle.tar.gz"

# Check OPA is available
if ! command -v opa &> /dev/null; then
  echo "ERROR: opa binary not found. Install from https://www.openpolicyagent.org/docs/latest/#1-download-opa"
  echo "Skipping WASM bundle build. Precompiled evaluation will be used as fallback."
  exit 0
fi

OPA_VERSION=$(opa version 2>/dev/null | head -1 | grep -oP 'Version:\s+\K\S+' || echo "unknown")
echo "OPA version: $OPA_VERSION"

# Validate policies compile
echo "Validating policies..."
opa check "$STRUCTURAL" "$TEMPORAL" "$PERCEPTION"
echo "  All policies valid."

# Build unified WASM bundle with three entrypoints
echo "Building unified WASM bundle..."
opa build \
  -t wasm \
  --bundle \
  -e "aep/forbidden/deny" \
  -e "dynaep/temporal/deny" \
  -e "dynaep/temporal/warn" \
  -e "dynaep/temporal/escalate" \
  -e "dynaep/perception/deny" \
  -e "dynaep/perception/warn" \
  -e "dynaep/perception/escalate" \
  -o "$UNIFIED_BUNDLE" \
  "$STRUCTURAL" "$TEMPORAL" "$PERCEPTION"

if [ -f "$UNIFIED_BUNDLE" ]; then
  SIZE=$(stat -c%s "$UNIFIED_BUNDLE" 2>/dev/null || stat -f%z "$UNIFIED_BUNDLE" 2>/dev/null)
  echo "  Unified bundle: $UNIFIED_BUNDLE ($SIZE bytes)"
  echo "  Entrypoints: aep/forbidden/deny, dynaep/temporal/{deny,warn,escalate}, dynaep/perception/{deny,warn,escalate}"
  echo "BUILD SUCCESS"
else
  echo "ERROR: Bundle not created"
  exit 1
fi
