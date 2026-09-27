#!/bin/sh
# Ready probe for the AEP Base Node container.
#
# Ready means Data Dock GET /health answers HTTP 200 with a status other than
# error. GET /health needs no key and returns no ledger rows. With DATA_DOCK=0
# the probe runs aep-base-node --health instead and accepts ok or degraded,
# which are exit codes 0 and 1.
set -u

if [ "${DATA_DOCK:-1}" = "0" ]; then
  aep-base-node --health --config "${AEP_DATA:-/data/aep}/base-node.json" >/dev/null 2>&1
  code=$?
  [ "${code}" -lt 2 ]
  exit $?
fi

host="${DATA_DOCK_HOST:-127.0.0.1}"
case "${host}" in
  0.0.0.0) host="127.0.0.1" ;;
  "::" | "[::]") host="[::1]" ;;
  \[*) ;;
  *:*) host="[${host}]" ;;
esac

exec node -e '
const url = "http://" + process.argv[1] + ":" + process.argv[2] + "/health";
fetch(url)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http " + r.status))))
  .then((body) => process.exit(body.status !== "error" ? 0 : 1))
  .catch(() => process.exit(1));
' "${host}" "${DATA_DOCK_PORT:-8413}"
