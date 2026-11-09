#!/bin/sh
# Fake snyk-agent-scan: fails with no JSON on stdout.
echo 'snyk-agent-scan: internal error' >&2
exit 2
