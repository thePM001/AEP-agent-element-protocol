# /aep-validate

## AEP 2.8 Post-Edit Validation

### Step 1: Automated Validator

```bash
node harness/aep-validate.js
```

### Step 2: Base Node Preflight

```bash
node harness/aep-base-node-preflight.mjs
```

### Step 3: Conformance (release checks)

```bash
npm run conformance
```

### Step 4: Evidence Ledger

Review `.claude/aep-evidence.jsonl` for unresolved policy failures.

### Step 5: Declare

State: "AEP 2.8 validation complete. {N} violations. Base Node preflight passed."