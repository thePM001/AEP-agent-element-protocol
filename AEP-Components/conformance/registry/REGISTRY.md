# AEP Conformance Registry

Public registry for AEP 2.9 compliance reports.

## Submitting a Report

1. Run the full suite from the repository root. It must end with `All conformance checks passed`:

```bash
./AEP-Components/conformance/runner/run.sh
```

2. Save the JSON report of the kernel checks:

```bash
cargo run --release -p aep-conformance > /tmp/aep29-report.json
```

3. Open a PR adding `registry/reports/<your-org>-<date>.json` with:

```json
{
 "submitter": "your-org",
 "implementation": "product-name",
 "aep_version": "2.9.0",
 "report_generated_at": "2026-06-15T00:00:00Z",
 "suite": "aep-2.8-public",
 "passed": 13,
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

A report claims only the checks in the `checks` list of `tests/manifest.json`. Checks in its `planned` list carry no claim and a report must not list them as passed.

## Name Policy

Per [`AEP-Components/dynAEP/NAME-POLICY.md`](../../dynAEP/NAME-POLICY.md), reserved names (`AEP-compliant`, `dynAEP`) require a passing report on file in this registry.