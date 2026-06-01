# AEP 2.75 Reference Policy Lattice

This is the official AEP reference policy lattice. It provides baseline security, deployment, writing and governance policies that serve as a template for all AEP implementations.

## Lattice Structure

```
SYSTEM (most permissive - top of lattice)
  |
  +-- governance.gap (code access, browser sandbox, session registration, violation reporting)
  |
  +-- deployment.gap (human approval, domain restriction, rollback, evidence ledger)
  |
  +-- writing.gap (em-dash, en-dash, double-hyphen, Oxford comma, text brightness)
  |
  +-- security.gap (PII, secrets, injection, network bind, unicode)
  |
SANDBOX (most restrictive - bottom of lattice)
```

## Usage

Copy any policy to your project's policies/ directory and customize:
```bash
cp policies/reference/security.gap my-project/policies/
```

All policies are gapc-validated (290 GBNF rules, zero structural errors).

## Customization

1. Add your allowed domains to deployment.gap
2. Add your specific PII patterns to security.gap
3. Adjust trust rings per your agent hierarchy
4. Compose multiple policies via lattice join/meet operations

## Validation

```bash
aep lint-policy policies/reference/security.gap
aep lint-policy policies/reference/deployment.gap
aep lint-policy policies/reference/writing.gap
aep lint-policy policies/reference/governance.gap
```
