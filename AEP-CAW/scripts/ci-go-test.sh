#!/usr/bin/env bash
# Runs go test with the given arguments in JSON mode. The plain test output goes to
# the job log as usual. Each failing test, failing package and failing build also
# becomes a GitHub error annotation with the tail of its output, because the checks
# API serves annotations to readers that cannot fetch the job log.
# Usage: scripts/ci-go-test.sh [go test flags] packages
set -uo pipefail

report="$(mktemp "${RUNNER_TEMP:-/tmp}/go-test.XXXXXX.json")"
go test -json "$@" > "$report"
status=$?

# The job log keeps the readable form of the run.
jq -j 'select(.Action == "output" or .Action == "build-output") | .Output // ""' "$report"

# One annotation per failure. A test failure carries its own output, a build
# failure the compiler output and a package failure with neither (a timeout or a
# panic outside any test) the output outside its tests.
read -r -d '' program <<'JQ'
def escape: gsub("%"; "%25") | gsub("\r"; "%0D") | gsub("\n"; "%0A");
def tail: if length > 1500 then .[-1500:] else . end;
. as $events
| (
    [ $events[] | select(.Action == "fail" and .Test != null) | {p: .Package, t: .Test} ] | unique[]
    | . as $f
    | ([ $events[] | select(.Package == $f.p and .Test == $f.t and .Action == "output") | .Output ] | join("") | tail) as $out
    | "::error title=go test failed::\($f.p) \($f.t)%0A\($out | escape)"
  ),
  (
    ([ $events[] | select(.Action == "fail" and .Test != null) | .Package ]
      + [ $events[] | select(.Action == "build-fail") | .ImportPath | split(" ")[0] ]) as $covered
    | [ $events[] | select(.Action == "fail" and .Test == null and .Package != null) | .Package ] | unique[]
    | select(. as $p | $covered | index($p) | not)
    | . as $p
    | ([ $events[] | select(.Package == $p and .Test == null and .Action == "output") | .Output ] | join("") | tail) as $out
    | "::error title=go test package failed::\($p)%0A\($out | escape)"
  ),
  (
    [ $events[] | select(.Action == "build-fail") | .ImportPath ] | unique[]
    | . as $ip
    | ([ $events[] | select(.ImportPath == $ip and .Action == "build-output") | .Output ] | join("") | tail) as $out
    | "::error title=go build failed::\($ip)%0A\($out | escape)"
  )
JQ
jq -s -r "$program" "$report"

exit "$status"
