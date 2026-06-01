/**
 * AEP 2.75 Policy Builder  -  Policy Creation and Validation Example
 *
 * Demonstrates:
 *  1. Creating a SchemaBuilder and building a schema from data
 *  2. Detecting domain invariants from historical data
 *  3. Generating Rego deny rules from detected invariants
 *  4. Building a complete policy (invariants + rules + manifest)
 *  5. Validating policy coverage against a schema
 *  6. Computing spectral impact of proposed rules
 *
 * Run: npx tsx examples/typescript/basic-policy.ts
 */

import {
  SchemaBuilder,
  PolicyBuilder,
  InvariantDetector,
  RegoGenerator,
} from "@aep/core";

// --- Sample Data (orders domain) ---------------------------------------

const ordersData: Record<string, unknown>[] = [
  { order_id: "ORD-001", customer_id: "CUST-AA", amount: 150.00, tax: 12.00,
    status: "paid",      payment_method: "credit_card", created: "2026-05-01", shipped: "2026-05-02" },
  { order_id: "ORD-002", customer_id: "CUST-BB", amount: 200.00, tax: 16.00,
    status: "paid",      payment_method: "debit_card",  created: "2026-05-02", shipped: "2026-05-03" },
  { order_id: "ORD-003", customer_id: "CUST-CC", amount:  75.00, tax:  6.00,
    status: "pending",   payment_method: "paypal",       created: "2026-05-03", shipped: null },
  { order_id: "ORD-004", customer_id: "CUST-AA", amount: 300.00, tax: 24.00,
    status: "paid",      payment_method: "credit_card",  created: "2026-05-03", shipped: "2026-05-04" },
  { order_id: "ORD-005", customer_id: "CUST-DD", amount: 120.00, tax:  9.60,
    status: "cancelled", payment_method: "paypal",       created: "2026-05-04", shipped: null },
];

// --- Step 1: Build a schema from data ---------------------------------

console.log("=== Step 1: Build Schema from Data ===\n");

const schemaBuilder = new SchemaBuilder({
  confidenceLevel: 0.95,
  minSampleSize: 3,
});

const schema = schemaBuilder.buildFromData(ordersData, "orders", "orders-v1");

console.log(`Schema ID:      ${schema.schemaId}`);
console.log(`Domain:         ${schema.domain}`);
console.log(`Source:         ${schema.source}`);
console.log(`Properties:     ${Object.keys(schema.definition.properties as object).join(", ")}`);
console.log(`Required fields: ${(schema.definition.required as string[])?.join(", ") ?? "none"}`);

// Show MLE-derived constraints for key fields
const mle = schemaBuilder.mleEstimator.estimateFromData(ordersData, "orders", "orders-v1");
for (const field of mle.fields) {
  const info: string[] = [`  ${field.fieldName} (${field.fieldType})`];
  if (field.mleMin !== undefined) info.push(`min=${field.mleMin}`);
  if (field.mleMax !== undefined) info.push(`max=${field.mleMax}`);
  if (field.mleEnum) info.push(`enum=[${field.mleEnum.join(", ")}]`);
  if (field.mleMinLength !== undefined) info.push(`minLen=${field.mleMinLength}`);
  console.log(info.join(", "));
}

// --- Step 2: Validate the schema --------------------------------------

console.log("\n=== Step 2: Validate Schema ===\n");

const validation = schemaBuilder.validateSchema(schema, { historicalData: ordersData });

console.log(`Composite Score: ${validation.compositeScore}`);
console.log(`Decision:        ${validation.decision}`);
console.log(`MLE Divergence:  ${validation.mle.aggregateDivergence.toFixed(3)}`);
console.log(`Fiedler Value:   ${validation.spectral.fiedlerValue.toFixed(3)}`);
console.log(`Spectral Gap:    ${validation.spectral.spectralGap.toFixed(3)}`);
console.log(`Permissiveness:  ${validation.permissiveness.excessPermissiveness.toFixed(1)} bits excess`);
console.log(`Modularity:      ${validation.modularity.modularityScore.toFixed(3)}`);
console.log(`Diagnostics:`);
for (const d of validation.diagnostics) {
  console.log(`  - ${d}`);
}

// --- Step 3: Detect domain invariants from data -----------------------

console.log("\n=== Step 3: Detect Domain Invariants ===\n");

const policyBuilder = new PolicyBuilder({
  autoPropose: true,
  confidenceThreshold: 0.8,
  requireManifest: true,
});

const invariants = policyBuilder.invariantDetector.detectFromData(ordersData, "orders-v1");

console.log(`Detected ${invariants.length} invariants:`);
for (const inv of invariants) {
  console.log(`  [${inv.invariantType}] ${inv.id}: ${inv.description}`);
  if (inv.expression) console.log(`    Expression: ${inv.expression}`);
}

// --- Step 4: Generate Rego rules from invariants ----------------------

console.log("\n=== Step 4: Generate Rego Rules ===\n");

const rules = invariants.map(inv =>
  policyBuilder.regoGenerator.generateFromInvariant(
    inv,
    "orders-v1",
    "aep.schema.orders_v1"
  )
);

console.log(`Generated ${rules.length} Rego rules:`);
for (const rule of rules) {
  console.log(`\n  Rule: ${rule.ruleId}`);
  console.log(`  Confidence: ${rule.confidence}`);
  console.log(`  Derived from: ${rule.derivedFrom}`);
  console.log("  -----------------------------");
  console.log(rule.ruleSource.split("\n").map(l => `  ${l}`).join("\n"));
}

// --- Step 5: Build complete policy ------------------------------------

console.log("\n=== Step 5: Build Complete Policy ===\n");

const policy = policyBuilder.buildPolicy(schema, "orders", {
  historicalData: ordersData,
});

console.log(`Manifest: ${policy.manifest.invariants.length} invariants`);
console.log(`Rules:    ${policy.rules.length} total (invariants + MLE outliers + spectral gaps)`);
console.log(`Spectral: Fiedler=${policy.spectral.fiedlerValue.toFixed(3)}, Gap=${policy.spectral.spectralGap.toFixed(3)}`);

// --- Step 6: Validate policy coverage ---------------------------------

console.log("\n=== Step 6: Validate Policy Coverage ===\n");

// Simulate existing Rego rules covering only the membership invariant
const existingRegoRules: string[] = [
  `package aep.schema.orders_v1

deny[msg] {
  not input.payload.status in {"paid", "pending", "cancelled"}
  msg := "status must be one of: paid, pending, cancelled"
}`,
];

const coverage = policyBuilder.validatePolicy(schema, existingRegoRules, policy.manifest, {
  historicalData: ordersData,
});

console.log(`Coverage:  ${coverage.invariantsCovered}/${coverage.invariantsTotal} invariants`);
console.log(`Rate:      ${(coverage.coverageRate * 100).toFixed(1)}%`);
console.log(`Missing:   ${coverage.missingRules.length} invariants`);
for (const missing of coverage.missingRules) {
  console.log(`  - [${missing.invariantType}] ${missing.description}`);
}
console.log(`Proposed:  ${coverage.proposedRules.length} new rules`);
console.log(`Spectral Before: ${coverage.spectralImpact.fiedlerBefore.toFixed(3)}`);
console.log(`Spectral After:  ${coverage.spectralImpact.fiedlerAfter.toFixed(3)}`);
console.log(`Improvement:     ${((coverage.spectralImpact.fiedlerAfter - coverage.spectralImpact.fiedlerBefore) * 100).toFixed(1)}%`);

// --- Step 7: Detect invariants already covered by schema --------------

console.log("\n=== Step 7: Covered Invariants from Schema ===\n");

const coveredFromSchema = policyBuilder.invariantDetector.detectFromSchema(
  schema,
  existingRegoRules
);

console.log(`Covered by schema/enum definitions: ${coveredFromSchema.length} invariants`);
for (const ci of coveredFromSchema) {
  console.log(`  - [${ci.invariantType}] ${ci.description} (fields: ${ci.fields.join(", ")})`);
}

// --- Step 8: Compute coverage explicitly ------------------------------

console.log("\n=== Step 8: Explicit Coverage Computation ===\n");

const coverageResult = policyBuilder.invariantDetector.computeCoverage(
  policy.manifest,
  coveredFromSchema
);

console.log(`Total manifest invariants: ${policy.manifest.invariants.length}`);
console.log(`Covered:                   ${coverageResult.covered.length}`);
console.log(`Missing:                   ${coverageResult.missing.length}`);
console.log(`Coverage rate:             ${(coverageResult.coverageRate * 100).toFixed(1)}%`);

// --- Summary ----------------------------------------------------------

console.log("\n=== Summary ===\n");

const stats = schemaBuilder.getStats();
console.log(`Schema validations: ${stats.totalValidated}`);
console.log(`  Pass:   ${stats.passCount}`);
console.log(`  Review: ${stats.reviewCount}`);
console.log(`  Reject: ${stats.rejectCount}`);
console.log(`  Avg score: ${stats.averageCompositeScore}`);
