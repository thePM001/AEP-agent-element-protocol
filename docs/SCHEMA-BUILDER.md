# Schema Builder (AEP 2.75 Capability 12)

Data-driven schema creation and validation with four mathematical foundations: MLE estimation, graph spectral analysis, permissiveness scoring and Louvain community detection.

## Overview

The Schema Builder validates schema definitions using the same mathematical rigour AEP applies to agent outputs. It derives ground-truth constraint parameters from historical data and scores schemas against them along four independent analytical axes.

**Decision thresholds:** pass >= 0.8, review 0.5-0.8, reject < 0.5.

**Composite score:** `C = 0.35*(1-MLE_divergence) + 0.25*spectral_score + 0.25*(1-excess_permissiveness) + 0.15*modularity`

## Four Analytical Frameworks

### 1. MLE Estimation (Fisher, 1922; Welford, 1962)

Derives constraint parameters from historical data using maximum likelihood. Uses Welford's online algorithm for streaming estimation. Computes divergence between candidate schemas and MLE ground truth with per-field severity classification.

```
MLEEstimator.estimateFromData(data, domain, schemaId)  -> MLEEstimation
MLEEstimator.computeDivergence(schema, mle)             -> DivergenceReport
MLEEstimator.proposeTightening(schema, mle, margin?)    -> TighteningProposal[]
MLEEstimator.updateEstimation(existing, newRecord)      -> MLEEstimation
```

### 2. Graph Spectral Analysis (Fiedler, 1973; Chung, 1997)

Builds a constraint graph from schema + Rego rules. Computes Laplacian eigenvalues. The Fiedler value (lambda_2) measures how tightly coupled the constraints are. The Fiedler vector identifies the weakest structural boundary.

```
SpectralAnalyzer.analyze(schema, regoRules) -> SpectralAnalysis
// Returns: { fiedlerValue, spectralGap, spectralScore, weakestCut, eigenvalues }
```

### 3. Permissiveness Scoring (Amari, 2016; Cover & Thomas, 2006)

Estimates acceptance distribution entropy. Tighter schemas have lower entropy. Computes excess permissiveness vs. MLE reference. Identifies weakest constraints via principal components.

```
PermissivenessScorer.analyze(schema, mle?) -> PermissivenessAnalysis
// Returns: { entropy, excessPermissiveness, principalComponents, weakestConstraints }
```

### 4. Louvain Community Detection (Blondel et al., 2008)

Decomposes the constraint graph into independently verifiable modules. Identifies inter-module gaps where rules are missing between coupled field clusters.

```
ModuleDetector.analyze(schema, regoRules) -> ModularityAnalysis
// Returns: { modularityScore, modules, interModuleGaps }
```

## CLI Usage

```bash
# Build a schema from data
npx aep assist schema build <domain> <data-file>

# Validate an existing schema
npx aep assist schema validate <schema-file>

# Compare multiple schema candidates
npx aep assist schema compare <domain> <data-file> [--candidates <file>]

# Propose tightening for a schema
npx aep assist schema tighten <schema-file> <data-file>
```

## Programmatic Usage

```typescript
import { SchemaBuilder, MLEEstimator, SpectralAnalyzer } from "@aep/core";

// --- Setup ---
const builder = new SchemaBuilder({
  mleWeight: 0.35,          // default
  spectralWeight: 0.25,     // default
  permissivenessWeight: 0.25, // default
  modularityWeight: 0.15,   // default
  confidenceLevel: 0.99,    // default
  minSampleSize: 30,        // default
});

// --- Example 1: Build a schema from data ---
const data = [
  { name: "Alice", age: 30, role: "engineer", salary: 95000 },
  { name: "Bob",   age: 25, role: "designer",  salary: 85000 },
  { name: "Carol", age: 35, role: "manager",   salary: 120000 },
  { name: "Dan",   age: 28, role: "engineer",  salary: 92000 },
];

const candidate = builder.buildFromData(data, "hr", "employee-v1");
// candidate.definition now contains JSON Schema with MLE-derived constraints:
//   age: { type: "integer", minimum: 25, maximum: 35 }
//   salary: { type: "integer", minimum: 85000, maximum: 120000 }
//   role: { type: "string", enum: ["engineer", "designer", "manager"] }
//   name: { type: "string", minLength: 3, maxLength: 5 }
//   required: ["name", "age", "role", "salary"]

// --- Example 2: Validate a schema ---
const validation = builder.validateSchema(candidate, { historicalData: data });
// -> {
//     schemaId: "employee-v1",
//     compositeScore: 0.912,
//     decision: "pass",
//     mle: { aggregateDivergence: 0.05, criticalCount: 0, warningCount: 0 },
//     spectral: { fiedlerValue: 0.47, spectralGap: 0.18, spectralScore: 0.92 },
//     permissiveness: { entropy: 2.1, excessPermissiveness: 0.0, weakestConstraints: [] },
//     modularity: { modularityScore: 0.68, modules: [...], interModuleGaps: [] },
//     diagnostics: ["Schema passes all validation criteria."]
//   }

// --- Example 3: Detect a weak schema ---
const weakSchema = {
  schemaId: "loose-v1",
  domain: "hr",
  definition: {
    type: "object",
    properties: {
      age: { type: "integer", minimum: 0, maximum: 150 },   // overly wide
      salary: { type: "integer" },                           // no bounds at all
    },
  },
  source: "human" as const,
};

const weakResult = builder.validateSchema(weakSchema, { historicalData: data });
// -> compositeScore: 0.45, decision: "reject"
// -> diagnostics: ["Aggregate divergence 0.621 is high. Schema is significantly looser than data warrants.",
//                  "Low Fiedler value (0.12): weak structural coupling. Add cross-field constraints."]

// --- Example 4: Compare schema candidates ---
const candidates = [candidate, weakSchema];
const { ranked, best } = builder.compareSchemas(candidates, { historicalData: data });
// ranked[0] is the MLE-derived schema (highest score)
// best is the top-ranked candidate

// --- Example 5: Propose constraint tightening ---
const mle = builder.mleEstimator.estimateFromData(data, "hr", "employee-v1");
const proposals = builder.proposeTightening(weakSchema, mle);
// -> [{ fieldName: "age",
//      currentConstraint: { minimum: 0, maximum: 150 },
//      proposedConstraint: { minimum: 23, maximum: 36 },
//      mleEvidence: "MLE max=35, schema max=150, ratio=4.29",
//      productionReplayResult: "safe" }]

// --- Example 6: Online estimation update (Welford) ---
let currentMLE = builder.mleEstimator.estimateFromData(data, "hr", "employee-v1");
// Later, a new record arrives:
currentMLE = builder.mleEstimator.updateEstimation(
  currentMLE,
  { name: "Eve", age: 31, role: "engineer", salary: 98000 }
);

// --- Example 7: Get statistics ---
const stats = builder.getStats();
// -> { totalValidated: 3, passCount: 1, reviewCount: 1, rejectCount: 1, averageCompositeScore: 0.682 }
```

## Domain Prefix Conventions

When building schemas for specific domains, the Schema Builder can enforce prefix conventions:

| Domain | Convention |
|---|---|
| `erp-module` | MDL-, VW-, CTL-, SEC-, WIZ-, MIX-, RPT-, ABS- |
| `backend-api` | API-, SVC-, DB-, AUTH-, JOB-, MW- |
| `frontend` | SH-, PN-, CP-, FM-, WD- |
| `ml-pipeline` | PIP-, EVL-, TRN-, DEP-, SVC- |
| `workflow` | SVC-, JOB-, MW-, SCH- |
| `mixed` | MDL-, SVC-, CP-, SEC-, JOB- |

## Types Reference

- `MLEFieldEstimate` - per-field MLE-derived constraints (min, max, mean, variance, precision, pattern, enum, confidence intervals)
- `MLEEstimation` - complete estimation for a domain (fields + metadata)
- `SchemaCandidate` - a schema submitted for validation (definition + metadata)
- `SchemaValidationResult` - composite result with all four analysis outputs and decision
- `DivergenceReport` - per-field divergence between schema and MLE ground truth
- `SpectralAnalysis` - Fiedler value, spectral gap, weakest cut, eigenvalues
- `PermissivenessAnalysis` - entropy, excess permissiveness, weakest constraints
- `ModularityAnalysis` - Louvain modules, inter-module gaps
- `TighteningProposal` - proposed constraint changes with MLE evidence
- `SchemaBuilderConfig` - configurable weights and thresholds

## Configuration

```typescript
interface SchemaBuilderConfig {
  mleWeight: number;              // MLE divergence contribution (default: 0.35)
  spectralWeight: number;         // Spectral score contribution (default: 0.25)
  permissivenessWeight: number;   // Permissiveness penalty contribution (default: 0.25)
  modularityWeight: number;       // Modularity contribution (default: 0.15)
  divergenceThreshold: number;    // Divergence ratio threshold (default: 3.0)
  spectralThreshold: number;      // Fiedler threshold (default: 0.25)
  confidenceLevel: number;        // MLE confidence level (default: 0.99)
  minSampleSize: number;          // Minimum samples for estimation (default: 30)
}
```

## Mathematical Foundation

The Deterministic Adjudication Lattice (DAL) underlies schema validation. A population of LLM candidate schemas is filtered through hierarchical verification predicates. The convergence theorem proves zero-defect selection with population size logarithmic in the inverse failure probability. Schema validation operates BEFORE the 15-step evaluation chain - it validates the governance layer itself, ensuring that schemas and policies are formally sound before they are used to validate agent outputs.
