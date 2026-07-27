# AEP Conformance Registry

Public registry for AEP 2.8 compliance reports.

## Submitting a Report

1. Run the full suite:

```bash
./conformance/runner/run.sh
```

2. Save the JSON report:

```bash
cd rust && cargo run --release -p aep-conformance > /tmp/aep28-report.json
```

3. Open a PR adding `registry/reports/<your-org>-<date>.json` with:

```json
{
 "submitter": "your-org",
 "implementation": "product-name",
 "aep_version": "2.8.0",
 "report_generated_at": "2026-06-15T00:00:00Z",
 "suite": "aep-2.8-public",
 "passed": 9,
 "failed": 0,
 "environment": {
 "os": "linux",
 "rust": "1.93.0",
 "node": "22.x"
 },
 "checks": []
}
```

4. Include the full `checks` array from the `aep-conformance` runner output.

## Name Policy

Per [`AEP-Components/dynAEP/NAME-POLICY.md`](../../dynAEP/NAME-POLICY.md), reserved names (`AEP-compliant`, `dynAEP`) require a passing report on file in this registry.