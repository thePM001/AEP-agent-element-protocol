#!/usr/bin/env bash
# Pairing of the CAW with the EDE: a coding agent builds and tests a crate inside a
# sandbox whose workspace is the tree of a draft. What belongs to the EDE is out of
# reach of the sandbox.
# Usage: ede-pairing.sh <runsc> <caw-run-proof> <draft profile record> <aep-caw-init> <rust toolchain folder>
# The script lays out a folder the way the EDE lays out a draft: the tree the agent
# edits with its git folder beside it, a record root and key files. It does not run
# the EDE itself.
# Runs as a user that is not root. A root caller is handed over to the user nobody.
# Prints one line per check: CHECK <name> PASS|FAIL <detail>. Exit 0 only when every
# check holds.
set -uo pipefail

RUNSC="${1:?path to runsc}"
PROOF="${2:?path to caw-run-proof}"
RECORD="${3:?draft profile record}"
INIT="${4:?path to aep-caw-init}"
TOOLCHAIN="${5:?rust toolchain folder}"
# A relative path becomes absolute, so a path that lands in caw.toml or in a sandbox
# bundle holds from any folder. A bare program name stays a name for the PATH lookup.
abs() { case "$1" in "" | /*) printf '%s' "$1" ;; */*) printf '%s/%s' "$PWD" "$1" ;; *) printf '%s' "$1" ;; esac; }
RUNSC="$(abs "$RUNSC")"
PROOF="$(abs "$PROOF")"
RECORD="$(abs "$RECORD")"
INIT="$(abs "$INIT")"
TOOLCHAIN="$(abs "$TOOLCHAIN")"

# A root caller hands over to the user nobody. A toolchain in the home folder of
# root is readable by root alone, so the script then copies it into its work folder.
if [ "$(id -u)" = 0 ]; then
  W="$(mktemp -d /var/tmp/caw-pair.XXXXXX)"
  if ! setpriv --reuid=65534 --regid=65534 --clear-groups test -r "$TOOLCHAIN/bin/cargo" 2> /dev/null; then
    echo "NOTE the user nobody cannot read $TOOLCHAIN, the script works on a copy"
    cp -a "$TOOLCHAIN" "$W/toolchain"
    TOOLCHAIN="$W/toolchain"
  fi
  cp "$0" "$W/ede-pairing.sh"
  cp "$PROOF" "$W/caw-run-proof"
  cp "$RECORD" "$W/record.json"
  cp "$INIT" "$W/aep-caw-init"
  chown -R 65534:65534 "$W"
  setpriv --reuid=65534 --regid=65534 --clear-groups \
    env HOME="$W" CAW_PAIR_WORK="$W" PATH="$PATH" \
    bash "$W/ede-pairing.sh" "$RUNSC" "$W/caw-run-proof" "$W/record.json" "$W/aep-caw-init" "$TOOLCHAIN"
  code=$?
  rm -rf "$W"
  exit "$code"
fi

W="${CAW_PAIR_WORK:-$(mktemp -d /var/tmp/caw-pair.XXXXXX)}"
cleanup() {
  if [ -z "${CAW_PAIR_WORK:-}" ]; then rm -rf "$W"; fi
}
trap cleanup EXIT

# The layout of one draft, with a draft id of the real form.
DRAFT="$W/drafts/ede-1794800000-0123456789abcdef0123456789abcdef"
TREE="$DRAFT/tree"
mkdir -p "$TREE/src" "$DRAFT/git" "$W/records" "$W/operator"
printf '[core]\n\trepositoryformatversion = 0\n' > "$DRAFT/git/config"
echo "ledger-of-the-ede" > "$W/records/ledger"
echo "ede-key-material" > "$W/operator/ede.key"
echo "agent-sign-seed" > "$W/agent.seed"
cat > "$TREE/Cargo.toml" <<'MANIFEST'
[package]
name = "draft-crate"
version = "0.1.0"
edition = "2021"

[workspace]
MANIFEST
cat > "$TREE/src/lib.rs" <<'SOURCE'
pub fn double(n: u32) -> u32 {
    n * 2
}

#[cfg(test)]
mod tests {
    #[test]
    fn doubles() {
        assert_eq!(super::double(21), 42);
    }
}
SOURCE

FAILED=0
N=0
# run <name> <want exit> <want deny count or -> <text that must not appear or -> <text that must appear or -> <command...>
run() {
  local name="$1" want_exit="$2" want_deny="$3" forbidden="$4" wanted="$5"
  shift 5
  N=$((N + 1))
  local out="$W/out$N.txt"
  CAW_PROOF_HOME="$W/home" CAW_PROOF_INIT="$INIT" CAW_PROOF_TIME_LIMIT=900 \
    CAW_PROOF_VAR_RUST_TOOLCHAIN="$TOOLCHAIN" \
    "$PROOF" "$RUNSC" "$RECORD" "$TREE" "$W/work$N" "$@" > "$out" 2>&1
  local code=$?
  local deny problem=""
  deny="$(grep -c '^DENY ' "$out")"
  grep -q '^RESULT .* dropped=0 complete=true$' "$out" || problem="no complete result"
  [ -n "$problem" ] || [ "$code" = "$want_exit" ] || problem="exit $code, want $want_exit"
  [ -n "$problem" ] || [ "$want_deny" = - ] || [ "$deny" = "$want_deny" ] || problem="$deny deny events, want $want_deny"
  [ -n "$problem" ] || [ "$forbidden" = - ] || ! grep -q -F -- "$forbidden" "$out" || problem="the output holds: $forbidden"
  [ -n "$problem" ] || [ "$wanted" = - ] || grep -q -F -- "$wanted" "$out" || problem="the output lacks: $wanted"
  if [ -z "$problem" ]; then
    echo "CHECK $name PASS exit $code with $deny deny events"
  else
    FAILED=$((FAILED + 1))
    echo "CHECK $name FAIL $problem"
    sed 's/^/    /' "$out" | tail -25
  fi
}

# cargo looks for a configuration file in every folder above the workspace. Each of
# those folders is outside of the plan, so each lookup is a deny event. The two build
# checks take any number of them and the check after them makes sure that the build
# left no other deny event.
run toolchain-is-in-the-sandbox 0 - - "cargo " \
  sh -c "cargo --version && rustc --version && cc --version"
run build-and-test-in-the-draft-tree 0 - - "test result: ok. 1 passed" \
  sh -c "cd $TREE && cargo test --offline"
if grep '^DENY ' "$W/out1.txt" "$W/out2.txt" | grep -v -q '/\.cargo/config '; then
  FAILED=$((FAILED + 1))
  echo "CHECK build-leaves-only-the-config-lookups-of-cargo FAIL another deny event"
  grep -h '^DENY ' "$W/out1.txt" "$W/out2.txt" | grep -v '/\.cargo/config ' | sed 's/^/    /' | head -6
else
  echo "CHECK build-leaves-only-the-config-lookups-of-cargo PASS"
fi
if [ -d "$TREE/target/debug" ]; then
  echo "CHECK build-output-is-in-the-draft-tree PASS"
else
  FAILED=$((FAILED + 1))
  echo "CHECK build-output-is-in-the-draft-tree FAIL the host tree has no target/debug folder"
fi
run git-folder-beside-the-tree 7 1 "repositoryformatversion" "target=$DRAFT/git/config " \
  sh -c "(exec < $TREE/../git/config) 2> /dev/null; ls $DRAFT; exit 7"
run record-root-of-the-ede 7 1 "ledger-of-the-ede" "kind=file-outside" \
  sh -c "head -c 64 $W/records/ledger; exit 7"
run key-of-the-ede 7 1 "ede-key-material" "kind=file-outside" \
  sh -c "head -c 64 $W/operator/ede.key; exit 7"
run sign-key-of-the-agent 7 1 "agent-sign-seed" "kind=file-outside" \
  sh -c "head -c 64 $W/agent.seed; exit 7"
run toolchain-is-read-only 7 - "toolchain-written" - \
  sh -c "echo x > /usr/local/rust/bin/planted && echo toolchain-written; echo x > /usr/lib/gcc/planted && echo toolchain-written; exit 7"
run no-network-for-the-build 7 - "host-device-present" - \
  sh -c "ls /sys/class/net 2> /dev/null; cat /proc/net/dev; exit 7"

if [ "$(cat "$W/records/ledger")" = "ledger-of-the-ede" ] && [ "$(cat "$DRAFT/git/config" | head -1)" = "[core]" ]; then
  echo "CHECK files-of-the-ede-are-unchanged PASS"
else
  FAILED=$((FAILED + 1))
  echo "CHECK files-of-the-ede-are-unchanged FAIL"
fi

echo
if [ "$FAILED" = 0 ]; then
  echo "ede-pairing: every check holds"
  exit 0
fi
echo "ede-pairing: $FAILED check or checks do not hold"
exit 1
