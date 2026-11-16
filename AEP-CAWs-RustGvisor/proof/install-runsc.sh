#!/usr/bin/env bash
# Installs the pinned gVisor package and the AppArmor profile that lets runsc create
# user namespaces as a user that is not root.
# Usage: sudo bash install-runsc.sh
# Needs root once per host. The CAW itself runs without root afterwards.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=runsc-pin.env
. "$HERE/runsc-pin.env"

if [ "$(id -u)" != 0 ]; then
  echo "install-runsc: run as root"
  exit 2
fi
if [ "$(uname -m)" != x86_64 ]; then
  echo "install-runsc: the pin covers amd64 only, this host is $(uname -m)"
  exit 2
fi

have_pin() {
  [ -x "$RUNSC_BIN" ] && [ "$(sha512sum "$RUNSC_BIN" | awk '{print $1}')" = "$RUNSC_BIN_SHA512" ]
}

if have_pin; then
  echo "install-runsc: $RUNSC_RELEASE is present"
else
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  curl -sSfL -m 600 -o "$work/runsc.deb" "$RUNSC_DEB_URL"
  echo "$RUNSC_DEB_SHA256  $work/runsc.deb" | sha256sum --check --strict
  dpkg -i "$work/runsc.deb"
  if ! have_pin; then
    echo "install-runsc: $RUNSC_BIN does not carry the pinned sha512"
    exit 1
  fi
  echo "install-runsc: installed $RUNSC_RELEASE"
fi

# Ubuntu restricts user namespaces to programs with an AppArmor profile. Without a
# profile a rootless runsc stops with: fork/exec /proc/self/exe: permission denied.
RESTRICT=/proc/sys/kernel/apparmor_restrict_unprivileged_userns
if [ -r "$RESTRICT" ] && [ "$(cat "$RESTRICT")" = 1 ] && command -v apparmor_parser >/dev/null 2>&1; then
  ABI=""
  for v in 5.0 4.0; do
    if [ -e "/etc/apparmor.d/abi/$v" ]; then ABI="$v"; break; fi
  done
  if [ -z "$ABI" ]; then
    echo "install-runsc: no AppArmor abi 4.0 or 5.0 on this host, the userns rule is not available"
    exit 1
  fi
  cat > /etc/apparmor.d/runsc <<PROFILE
# This profile allows everything and only exists to give runsc a name,
# so that it creates user namespaces as a user that is not root.

abi <abi/$ABI>,
include <tunables/global>

profile runsc $RUNSC_BIN flags=(unconfined) {
  userns,
  @{exec_path} mr,

  # Site-specific additions and overrides. See local/README for details.
  include if exists <local/runsc>
}
PROFILE
  apparmor_parser -r /etc/apparmor.d/runsc
  echo "install-runsc: AppArmor profile runsc loaded with abi $ABI"
else
  echo "install-runsc: this host does not restrict user namespaces through AppArmor, no profile written"
fi

"$RUNSC_BIN" --version | head -1
