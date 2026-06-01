# Policy Builder (AEP 2.75 Capability 13)

Data-driven Rego policy generation and validation. Detects domain invariants from data, generates Rego deny rules, tracks coverage and projects spectral impact.

## Overview

The Policy Builder validates the governance layer itself. It scans historical data for domain invariants, generates Rego rules with confidence scores, checks coverage against invariant manifests and projects the Fiedler value improvement if proposed rules are adopted. AEP 2.75 extends governance to schemas and policies with the same mathematical rigour applied to agent outputs.

## Pipeline

```
Historical Data -> Invariant Detection -> Rego Generation -> Coverage Tracking -> Spectral Projection
```

## Invariant Types Detected

| Type | Description | Example |
|---|---|---|
| `equality` | Field pairs where values always match | `customer_id == billing_id` |
| `inequality` | Numeric fields with fixed relationship | `end_date >= start_date` |
| `membership` | Field values restricted to a fixed set | `status in ["active","pending","closed"]` |
| `exclusion` | Value pairs that never co-occur | `(role="admin" and dept="finance")` never observed |
| `conditional` | If field A = X then field B always in Y | If `type="refund"` then `amount <= 0` |
| `temporal` | Date fields with temporal relationship | `shipped_date >= order_date` |

## CLI Usage

```bash
# Build Rego policies from a schema and data
npx aep assist policy build <schema-file>

# Validate policy coverage against a schema
npx aep assist policy validate <schema-file> <rego-dir>

# Identify gaps between manifest and policy
npx aep assist policy gaps <schema-file> <manifest-file>
```

## Programmatic Usage

```typescript
import { PolicyBuilder, InvariantDetector, RegoGenerator } from "@aep/core";
import { SchemaBuilder } from "@aep/core";

// --- Setup ---
const policyBuilder = new PolicyBuilder({
  autoPropose: true,           // auto-generate rules for missing invariants (default)
  confidenceThreshold: 0.8,    // minimum confidence to accept a detected invariant (default)
  requireManifest: true,       // require an invariant manifest (default)
});

// --- Example 1: Detect invariants from data ---
const data = [
  { order_id: "ORD-001", amount: 150, status: "paid",     created: "2026-06-01", shipped: "2026-06-02" },
  { order_id: "ORD-002", amount: 200, status: "paid",     created: "2026-06-01", shipped: "2026-06-03" },
  { order_id: "ORD-003", amount:  75, status: "pending",  created: "2026-06-02", shipped: null },
  { order_id: "ORD-004", amount: 300, status: "paid",     created: "2026-06-02", shipped: "2026-06-04" },
  { order_id: "ORD-005", amount: 120, status: "cancelled",created: "2026-06-03", shipped: null },
];

const invariants = policyBuilder.invariantDetector.detectFromData(data, "orders-v1");
// -> [
//   { id: "inv_mem_1",  invariantType: "membership",   description: "status must be one of: paid, pending, cancelled", fields: ["status"] },
//   { id: "inv_ineq_1", invariantType: "inequality",   description: "amount must be >= 0", fields: ["amount"] },
//   { id: "inv_mem_2",  invariantType: "membership",   description: "order_id must be one of: ORD-001, ..., ORD-005", fields: ["order_id"] },
//   { id: "inv_temp_1", invariantType: "temporal",      description: "shipped is always on or after created (max 2 days)" },
//   { id: "inv_excl_1", invariantType: "exclusion",     description: "status=\"paid\" and shipped=null never co-occur" }
// ]

// --- Example 2: Generate Rego rules from invariants ---
const rego = policyBuilder.regoGenerator.generateFromInvariant(
  invariants[0],  // membership invariant
  "orders-v1",
  "aep.schema.orders_v1"
);
// -> {
//     ruleId: "reg_orders_v1_inv_mem_1",
//     packageName: "aep.schema.orders_v1",
//     ruleSource: "package aep.schema.orders_v1\n\ndeny[msg] {\n  not input.payload.status in {\"paid\", \"pending\", \"cancelled\"}\n  msg := \"status must be one of: paid, pending, cancelled\"\n}",
//     invariantId: "inv_mem_1",
//     confidence: 0.8,
//     derivedFrom: "mle"
//   }

// --- Example 3: Build a complete policy ---
const schemaBuilder = new SchemaBuilder();
const schema = schemaBuilder.buildFromData(data, "orders", "orders-v1");

const policy = policyBuilder.buildPolicy(schema, "orders", {
  historicalData: data,
});
// -> {
//     rules: RegoRuleProposal[] (one per invariant + MLE outliers + spectral gap rules),
//     manifest: { domain: "orders", schemaId: "orders-v1", invariants: [...] },
//     spectral: { fiedlerValue: 0.52, spectralGap: 0.19, spectralScore: 0.88, ... }
//   }

// --- Example 4: Validate policy coverage ---
const existingRegoRules = [
  `package aep.schema.orders_v1
   deny[msg] {
     not input.payload.status in {"paid", "pending", "cancelled"}
     msg := "status must be one of: paid, pending, cancelled"
   }`
];

const validation = policyBuilder.validatePolicy(schema, existingRegoRules, policy.manifest, {
  historicalData: data,
});
// -> {
//     schemaId: "orders-v1",
//     invariantsCovered: 1,        // only the membership rule is covered
//     invariantsTotal: 5,          // 5 invariants detected
//     coverageRate: 0.2,           // 20% coverage
//     missingRules: [inequality, membership2, temporal, exclusion],
//     proposedRules: [rule for each missing invariant],
//     spectralImpact: { fiedlerBefore: 0.31, fiedlerAfter: 0.52 }
//   }

// Full rules listing:
console.log(validation.proposedRules.map(r => r.ruleSource).join("\n\n"));
// Prints complete Rego package with all deny rules

// --- Example 5: Detect invariants already covered by schema ---
const coveredInvariants = policyBuilder.invariantDetector.detectFromSchema(
  schema,
  existingRegoRules
);
// -> Extracts invariants from enum definitions in the schema and field references in Rego rules

// --- Example 6: Compute coverage separately ---
const manifest = {
  domain: "orders",
  schemaId: "orders-v1",
  invariants: [...invariants],
};

const coverage = policyBuilder.invariantDetector.computeCoverage(manifest, coveredInvariants);
// -> { covered: [...], missing: [...], coverageRate: 0.2 }

// --- Example 7: Domain-specific gate generation ---
// The PolicyBuilder can generate gates per domain. For an ERP module:
// Gates: no-core-modification, module-isolation, super-call-required,
//        user-error-with-translation, multi-record-safe, no-raw-sql, manifest-completeness

// For a backend API:
// Gates: auth-required-on-protected, rate-limit-configured, input-validation,
//        no-sql-injection, no-hardcoded-secrets, error-response-standardized
```

## Invariant Manifest Format

```json
{
  "domain": "orders",
  "schemaId": "orders-v1",
  "invariants": [
    {
      "id": "inv_mem_1",
      "description": "status must be one of: paid, pending, cancelled",
      "fields": ["status"],
      "invariantType": "membership",
      "expression": "status in [\"paid\", \"pending\", \"cancelled\"]"
    },
    {
      "id": "inv_ineq_1",
      "description": "amount must be >= 0",
      "fields": ["amount"],
      "invariantType": "inequality",
      "expression": "amount >= 0"
    }
  ]
}
```

## Generated Rego Structure

Rules follow the AEP 2.75 Rego convention:

```rego
package aep.schema.orders_v1

# MLE-derived membership invariant
deny[msg] {
  not input.payload.status in {"paid", "pending", "cancelled"}
  msg := "status must be one of: paid, pending, cancelled"
}

# MLE-derived inequality invariant
deny[msg] {
  input.payload.amount < 0
  msg := "amount must be >= 0 (MLE mean: 169.00)"
}

# Spectral gap rule (coupling disconnected fields)
deny[msg] {
  input.payload.status == "shipped"
  not input.payload.shipped
  msg := "status shipped requires shipped date to be set"
}
```

## Configuration

```typescript
interface PolicyBuilderConfig {
  autoPropose: boolean;          // auto-generate rules for missing invariants (default: true)
  confidenceThreshold: number;   // minimum confidence for invariant detection (default: 0.8)
  requireManifest: boolean;      // require an invariant manifest (default: true)
}
```

## Types Reference

- `DomainInvariant` - a single detected constraint (equality, inequality, membership, exclusion, conditional, temporal)
- `InvariantManifest` - collection of all domain invariants for a schema
- `RegoRuleProposal` - a generated Rego deny rule with confidence and source tracking
- `PolicyValidationResult` - coverage report with spectral impact projection
- `PolicyBuilderConfig` - configurable thresholds

## Relationship to Schema Builder

The Policy Builder depends on the Schema Builder for spectral analysis. Together they form the governance validation pipeline:

1. **Schema Builder** validates schema definitions (MLE + spectral + permissiveness + modularity)
2. **Policy Builder** generates Rego rules from invariants and validates coverage
3. Both feed into the **15-step evaluation chain** which enforces policies at runtime

The Policy Builder uses `SpectralAnalyzer` from the schema-builder module to compute Fiedler values before and after proposed rules are adopted, quantifying the structural improvement of adding each rule.
