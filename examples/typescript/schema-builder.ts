/**
 * AEP 2.75 Schema Builder  -  Schema Building and Validation Example
 *
 * Demonstrates:
 *  1. Building a schema from raw data (MLE estimation)
 *  2. Validating a schema with all four analytical frameworks
 *  3. Comparing multiple schema candidates (human vs. MLE-derived)
 *  4. Proposing constraint tightening from MLE evidence
 *  5. Online estimation update with Welford's algorithm
 *  6. Individual component usage (SpectralAnalyzer, PermissivenessScorer, ModuleDetector)
 *  7. Weak schema detection and diagnostic generation
 *
 * Run: npx tsx examples/typescript/schema-builder.ts
 */

import {
  SchemaBuilder,
  MLEEstimator,
  SpectralAnalyzer,
  PermissivenessScorer,
  ModuleDetector,
} from "@aep/core";

// --- Sample Data ------------------------------------------------------

const employeeData: Record<string, unknown>[] = [
  { emp_id: "E001", name: "Alice Chen",    dept: "Engineering", level: "L4", salary: 125000, bonus: 15000, hired: "2024-03-15", manager: "E010" },
  { emp_id: "E002", name: "Bob Martinez",  dept: "Design",      level: "L3", salary:  95000, bonus: 10000, hired: "2024-06-01", manager: "E011" },
  { emp_id: "E003", name: "Carol Smith",   dept: "Engineering", level: "L5", salary: 160000, bonus: 30000, hired: "2023-09-10", manager: "E010" },
  { emp_id: "E004", name: "Dan Johnson",   dept: "Engineering", level: "L3", salary: 100000, bonus:  8000, hired: "2025-01-15", manager: "E003" },
  { emp_id: "E005", name: "Eve Williams",  dept: "Management",  level: "L6", salary: 200000, bonus: 50000, hired: "2022-04-01", manager: null },
  { emp_id: "E006", name: "Frank Brown",   dept: "Engineering", level: "L4", salary: 130000, bonus: 12000, hired: "2024-08-20", manager: "E003" },
  { emp_id: "E007", name: "Grace Davis",   dept: "Design",      level: "L4", salary: 115000, bonus: 14000, hired: "2024-02-01", manager: "E011" },
  { emp_id: "E008", name: "Hank Wilson",   dept: "Engineering", level: "L3", salary:  98000, bonus:  9000, hired: "2025-03-10", manager: "E006" },
  { emp_id: "E009", name: "Iris Taylor",   dept: "Management",  level: "L5", salary: 155000, bonus: 25000, hired: "2023-11-01", manager: "E005" },
  { emp_id: "E010", name: "Jake Anderson", dept: "Engineering", level: "L6", salary: 190000, bonus: 40000, hired: "2022-01-15", manager: "E005" },
];

// --- Example 1: Build Schema from Data --------------------------------

console.log("=== Example 1: Build Schema from Data (MLE Estimation) ===\n");

const builder = new SchemaBuilder();

const schema = builder.buildFromData(employeeData, "hr", "employee-v1");

console.log(`Schema: ${schema.schemaId} (${schema.domain}, ${schema.source})`);
console.log(`Definition type: ${schema.definition.type}`);

const props = schema.definition.properties as Record<string, Record<string, unknown>>;
for (const [name, prop] of Object.entries(props)) {
  const details: string[] = [];
  if (prop.type) details.push(`type=${prop.type}`);
  if (prop.minimum !== undefined) details.push(`min=${prop.minimum}`);
  if (prop.maximum !== undefined) details.push(`max=${prop.maximum}`);
  if (prop.enum) details.push(`enum=[${(prop.enum as string[]).join(", ")}]`);
  if (prop.minLength !== undefined) details.push(`minLen=${prop.minLength}`);
  if (prop.maxLength !== undefined) details.push(`maxLen=${prop.maxLength}`);
  console.log(`  ${name}: ${details.join(", ")}`);
}

const reqs = schema.definition.required as string[] | undefined;
console.log(`Required fields: ${reqs?.join(", ") ?? "(none)"}`);

// --- Example 2: Full Validation (Four Frameworks) ---------------------

console.log("\n=== Example 2: Full Schema Validation ===\n");

const result = builder.validateSchema(schema, { historicalData: employeeData });

console.log(`Composite Score: ${result.compositeScore}`);
console.log(`Decision:        ${result.decision}`);
console.log();
console.log("MLE Divergence:");
console.log(`  Aggregate:   ${result.mle.aggregateDivergence.toFixed(3)}`);
console.log(`  Critical:    ${result.mle.criticalCount}`);
console.log(`  Warnings:    ${result.mle.warningCount}`);
for (const fd of result.mle.fieldDivergences) {
  console.log(`  ${fd.fieldName}: score=${fd.divergenceScore.toFixed(3)} (${fd.severity})  -  ${fd.detail}`);
}
console.log();
console.log("Spectral Analysis:");
console.log(`  Fiedler:     ${result.spectral.fiedlerValue.toFixed(3)}`);
console.log(`  Spectral Gap: ${result.spectral.spectralGap.toFixed(3)}`);
console.log(`  Score:       ${result.spectral.spectralScore.toFixed(3)}`);
if (result.spectral.weakestCut.missingCouplings.length > 0) {
  console.log(`  Weakest cut: ${result.spectral.weakestCut.missingCouplings.join(", ")}`);
}
console.log();
console.log("Permissiveness:");
console.log(`  Entropy:     ${result.permissiveness.entropy.toFixed(1)}`);
console.log(`  Excess:      ${result.permissiveness.excessPermissiveness.toFixed(1)} bits`);
if (result.permissiveness.weakestConstraints.length > 0) {
  console.log(`  Weakest:     ${result.permissiveness.weakestConstraints.join(", ")}`);
}
console.log();
console.log("Modularity:");
console.log(`  Score:       ${result.modularity.modularityScore.toFixed(3)}`);
console.log(`  Modules:     ${result.modularity.modules.length}`);
for (const mod of result.modularity.modules) {
  console.log(`    Module ${mod.id}: [${mod.fields.join(", ")}] (internal=${mod.internalCoupling.toFixed(2)}, external=${mod.externalCoupling.toFixed(2)})`);
}
console.log();
console.log("Diagnostics:");
for (const d of result.diagnostics) {
  console.log(`  - ${d}`);
}

// --- Example 3: Compare Schema Candidates -----------------------------

console.log("\n=== Example 3: Compare Schema Candidates ===\n");

const humanSchema = {
  schemaId: "employee-human",
  domain: "hr",
  definition: {
    type: "object",
    properties: {
      emp_id:   { type: "string" },
      name:     { type: "string" },
      dept:     { type: "string", enum: ["Engineering", "Design", "Management", "Sales", "Support"] },
      level:    { type: "string", enum: ["L1", "L2", "L3", "L4", "L5", "L6", "L7"] },
      salary:   { type: "integer", minimum: 0, maximum: 1000000 },    // overly wide
      bonus:    { type: "integer", minimum: 0 },                       // no upper bound
      hired:    { type: "string" },                                    // no pattern
      manager:  { type: "string" },
    },
    required: ["emp_id", "name", "dept", "level", "salary", "hired"],
  },
  source: "human" as const,
  sourceModel: "architect-review",
};

const { ranked, best } = builder.compareSchemas(
  [humanSchema, schema],
  { historicalData: employeeData }
);

console.log("Ranked candidates:");
for (let i = 0; i < ranked.length; i++) {
  console.log(`  ${i + 1}. ${ranked[i].schemaId}  -  score: ${ranked[i].score.compositeScore} (${ranked[i].score.decision})`);
}
console.log(`Best: ${best.schemaId}`);

// Show detailed divergence for the human schema
console.log(`\nHuman schema diagnostics:`);
for (const d of ranked[0].score.diagnostics) {
  console.log(`  - ${d}`);
}

// --- Example 4: Propose Constraint Tightening -------------------------

console.log("\n=== Example 4: Propose Constraint Tightening ===\n");

const mleEstimation = builder.mleEstimator.estimateFromData(employeeData, "hr", "employee-v1");
const proposals = builder.proposeTightening(humanSchema, mleEstimation, 0.05);

if (proposals.length === 0) {
  console.log("No tightening proposals  -  schema constraints already match MLE estimates.");
} else {
  console.log(`${proposals.length} tightening proposals:`);
  for (const p of proposals) {
    console.log(`\n  Field: ${p.fieldName}`);
    console.log(`  Current:   ${JSON.stringify(p.currentConstraint)}`);
    console.log(`  Proposed:  ${JSON.stringify(p.proposedConstraint)}`);
    console.log(`  Evidence:  ${p.mleEvidence}`);
    console.log(`  Replay:    ${p.productionReplayResult}${p.breakingCount ? ` (${p.breakingCount}/${p.totalReplayed} breaking)` : ""}`);
  }
}

// --- Example 5: Online Estimation Update (Welford) --------------------

console.log("\n=== Example 5: Online Estimation Update (Welford) ===\n");

let liveMLE = builder.mleEstimator.estimateFromData(employeeData.slice(0, 5), "hr", "employee-v1");
console.log(`Initial: ${liveMLE.totalRecords} records`);

// Simulate streaming updates
const newRecords = employeeData.slice(5);
for (const record of newRecords) {
  liveMLE = builder.mleEstimator.updateEstimation(liveMLE, record);
}
console.log(`After ${newRecords.length} updates: ${liveMLE.totalRecords} records`);

const salaryField = liveMLE.fields.find(f => f.fieldName === "salary");
if (salaryField) {
  console.log(`salary: mean=${salaryField.mleMean?.toFixed(0)}, min=${salaryField.mleMin}, max=${salaryField.mleMax}`);
  console.log(`        95% CI: [${salaryField.confidenceIntervalLower?.toFixed(0)}, ${salaryField.confidenceIntervalUpper?.toFixed(0)}]`);
}

// --- Example 6: Detect a Weak Schema ----------------------------------

console.log("\n=== Example 6: Detect a Weak (Overly Permissive) Schema ===\n");

const weakSchema = {
  schemaId: "employee-weak",
  domain: "hr",
  definition: {
    type: "object",
    properties: {
      emp_id:  { type: "string" },
      salary:  { type: "integer", minimum: 0, maximum: 99999999 },
      level:   { type: "string" },
    },
  },
  source: "llm" as const,
  sourceModel: "unconstrained-generation",
};

const weakResult = builder.validateSchema(weakSchema, { historicalData: employeeData });
console.log(`Score:    ${weakResult.compositeScore}`);
console.log(`Decision: ${weakResult.decision}`);
for (const d of weakResult.diagnostics) {
  console.log(`  - ${d}`);
}

// --- Example 7: Low-Level Component Usage -----------------------------

console.log("\n=== Example 7: Direct Component Usage ===\n");

// Spectral analysis only
const spectralAnalyzer = new SpectralAnalyzer();
const spectral = spectralAnalyzer.analyze(schema, []);
console.log(`Spectral only: Fiedler=${spectral.fiedlerValue.toFixed(3)}, Gap=${spectral.spectralGap.toFixed(3)}`);

// Permissiveness scoring only
const permissivenessScorer = new PermissivenessScorer();
const permResult = permissivenessScorer.analyze(schema, mleEstimation);
console.log(`Permissiveness only: entropy=${permResult.entropy.toFixed(1)}, excess=${permResult.excessPermissiveness.toFixed(1)}`);

// Modularity detection only
const moduleDetector = new ModuleDetector();
const modResult = moduleDetector.analyze(schema, []);
console.log(`Modularity only: score=${modResult.modularityScore.toFixed(3)}, modules=${modResult.modules.length}`);

// --- Summary ----------------------------------------------------------

console.log("\n=== Summary ===\n");

const stats = builder.getStats();
console.log(`Total validations:   ${stats.totalValidated}`);
console.log(`  Pass:              ${stats.passCount}`);
console.log(`  Review:            ${stats.reviewCount}`);
console.log(`  Reject:            ${stats.rejectCount}`);
console.log(`  Average score:     ${stats.averageCompositeScore}`);
