# AEP 2.75 Policy Lattice - Quick Setup

## 1. Initialize your policy lattice
```bash
aep policy-init ./my-policies
```
This creates a policy lattice with the reference policies as templates.

## 2. Add your policies
Create YAML policy files in `./my-policies/custom/`:
```yaml
version: "2.75"
domain: security
patterns:
  - name: block_production_deletes
    guard: action == "delete" AND environment == "production"
    effect: deny
    severity: hard
```

## 3. Validate your lattice
```bash
aep verify ./my-policies/
aep lint-policy ./my-policies/custom/my-policy.yaml
```

## 4. Test against inputs
```bash
aep red-team
```

## Lattice Structure
```
my-policies/
  |-- lattice.yaml          # Lattice configuration
  |-- reference/            # Gapc-validated reference policies (read-only)
  |   |-- security.gap
  |   |-- deployment.gap
  |   |-- writing.gap
  |   |-- governance.gap
  |-- custom/               # Your custom policies
      |-- my-policy.yaml
```

## Policy Format
Policies use YAML format with these fields:
- `version`: AEP version (2.75)
- `domain`: security, deployment, writing, governance, or custom
- `patterns`: list of policy rules with guard, effect, severity
- `covenants`: human-readable policy descriptions

## Composition
Policies compose via conjunction: all must pass for action to be allowed.
The lattice structure guarantees that composed policies have well-defined results.
