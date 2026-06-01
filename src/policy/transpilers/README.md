# AEP Policy Transpilers

Bidirectional transpilation between GAP, OPA Rego and Cedar policy formats.

## Transpilers

### Rego-to-GAP
Converts OPA Rego policies to GAP format.
Preserves constraints, invariants and severity levels.

### Cedar-to-GAP
Converts AWS Cedar policies to GAP format.
Maps Cedar effect (forbid/permit) to GAP action pipeline.

### GAP-to-Rego
Exports GAP policies to OPA Rego format.
Generates valid Rego package with deny/allow rules.

### GAP-to-Cedar
Exports GAP policies to AWS Cedar format.
Generates valid Cedar policy statements.

## Usage

```bash
aep transpile input.rego --from rego --to gap --output policy.gap
aep transpile input.cedar --from cedar --to gap --output policy.gap
```
