#!/usr/bin/env bash
# CI: leftover instruction crates live under retired-archive/instruction-crates.
# AEP28-ENV-073
# @PAD: aep28-env-073-leftover-instruction-crates-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LEFTOVERS=(
  admit-no-trust-tier
  admit-opa-sole
  admit-parity
  admit-trust-floor
  agent-sign-key-provision
  caw-wrapenv-failclosed
  client-trust-tier-ignore
  connector-ucb-clients
  dynaep-live-crossing-e2e
  empty-lattice-close
  envelope-algebra
  envelope-algebra-ci
  envelope-journals-drop
  envelope-product-copy
  envelope-wrap-disabled
  envelope-wrap-journals
  eu-ai-act-checker
  frame-header-binding
  gap-capability-dimensions
  hyperlattice-ssot
  kernel-pq-channel
  lattice-db-parent-guard
  lattice-log-record-admit
  library-layer-count
  live-crossing-admit-apply
  live-crossing-lab-off
  live-crossing-reject-copy
  live-entry-ci
  mesh-ca-secret-mode
  named-surfaces
  no-sequential-ts-deny
  one-admit-id
  one-evaluation-story
  one-live-entry-language
  potomitan-mesh-packet-plane
  process-event-admit-walls
  satisfied-actions-partition
  sdk-run-meet-park
  stream-hard-findings
  trust-score-isolation
  version-ssot
)

COMPANIONS=(
  aep-comm
  aepassist
  caw-framework
  cca
  coding-governance
  covenant
  datasets
  decomposition
  economics
  eval
  evidence-ledger
  fleet
  gap
  graph-engine
  hcse
  hyperlattice
  identity
  intent
  intent-ledger
  intercept
  knowledge-base
  mcp-security
  model-gateway
  optimization
  permissions
  policy-engine
  proof-bundle
  proxy
  recovery
  scanners
  semantic-topology
  session
  streaming
  telemetry
  verification
  wizard
  workflow
)

INV="$ROOT/retired-archive/instruction-crates/INVENTORY.gaplune"
if test -f "$INV"; then
  :
else
  echo "[gate-aep28-env-073] INVENTORY.gaplune missing" >&2
  exit 1
fi

if test -e "$ROOT/AEP-Components/trust-rings"; then
  echo "[gate-aep28-env-073] Trust Rings still under AEP-Components" >&2
  exit 1
fi

for name in "${LEFTOVERS[@]}"; do
  if test -e "$ROOT/AEP-Components/$name"; then
    echo "[gate-aep28-env-073] leftover still under AEP-Components: $name" >&2
    exit 1
  fi
  if test -d "$ROOT/retired-archive/instruction-crates/$name"; then
    :
  else
    echo "[gate-aep28-env-073] relocated crate missing: $name" >&2
    exit 1
  fi
  if grep -F -q "$name" "$INV"; then
    :
  else
    echo "[gate-aep28-env-073] INVENTORY missing crate: $name" >&2
    exit 1
  fi
  if grep -F -q "AEP-Components/$name/crate" "$ROOT/Cargo.toml"; then
    echo "[gate-aep28-env-073] leftover is a workspace member: $name" >&2
    exit 1
  fi
  if grep -F -q "retired-archive/instruction-crates/$name/crate" "$ROOT/Cargo.toml"; then
    echo "[gate-aep28-env-073] leftover is a workspace member: $name" >&2
    exit 1
  fi
done

for name in "${COMPANIONS[@]}"; do
  if test -d "$ROOT/AEP-Components/$name"; then
    :
  else
    echo "[gate-aep28-env-073] companion folder missing: $name" >&2
    exit 1
  fi
done

cargo test -p aep-base-node --test source_invariants leftover_instruction_crate_count_is_41
cargo test -p aep-base-node --test source_invariants leftover_instruction_crates_are_relocated
cargo test -p aep-base-node --test source_invariants folded_slogan_ci_gates

PROBE="$ROOT/AEP-Components/aep28-env-073-non-member-probe"
cleanup() {
  rm -rf "$PROBE"
}
trap cleanup EXIT
mkdir -p "$PROBE/crate"
printf '%s\n' '[package]' 'name = "aep28-env-073-non-member-probe"' 'version = "0.0.0"' 'edition = "2021"' > "$PROBE/crate/Cargo.toml"
set +e
cargo test -p aep-base-node --test source_invariants leftover_instruction_crates_are_relocated -- --exact
PROBE_EC=$?
set -e
if test "$PROBE_EC" -eq 0; then
  echo "[gate-aep28-env-073] non-member HAS_CRATE probe did not fail" >&2
  exit 1
fi
cleanup
trap - EXIT
cargo test -p aep-base-node --test source_invariants leftover_instruction_crates_are_relocated -- --exact
echo "[gate-aep28-env-073] OK leftover instruction crates relocated. Companions kept. Trust Rings absent."
