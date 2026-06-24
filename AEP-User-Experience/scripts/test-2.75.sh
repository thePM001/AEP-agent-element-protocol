#!/bin/bash
# AEP 2.75 Test Runner
# Runs all 2.75-specific tests and reports results.

set -e

PASS=0
FAIL=0
TESTS=(
    "AEP-NOSHIP/tests/cli.test.ts"
    "AEP-NOSHIP/tests/trust-rings.test.ts"
    "AEP-NOSHIP/tests/reference-lattice.test.ts"
    "AEP-NOSHIP/tests/merkle.test.ts"
    "AEP-NOSHIP/tests/transpilers.test.ts"
    "AEP-NOSHIP/tests/mcp-security.test.ts"
    "AEP-NOSHIP/tests/graph-engine.test.ts"
    "AEP-NOSHIP/tests/collaboration.test.ts"
)

echo "AEP 2.75 Test Suite"
echo "===================="
echo ""

for test in "${TESTS[@]}"; do
    if [ -f "$test" ]; then
        echo -n "  $test ... "
        if npx vitest run "$test" --reporter=verbose 2>&1 | grep -q "FAIL"; then
            echo "FAIL"
            FAIL=$((FAIL + 1))
        else
            echo "PASS"
            PASS=$((PASS + 1))
        fi
    else
        echo "  $test ... SKIP (not found)"
    fi
done

echo ""
echo "===================="
echo "Passed: $PASS  Failed: $FAIL"
echo "===================="

exit $FAIL
