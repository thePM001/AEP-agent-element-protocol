# Migration Guide: AEP v2.5 to v2.75

## What Changed

### Version bump
- `aep_version` in all config files updated from `"2.5"` to `"2.75"`.
- `package.json` version bumped to `2.6.0`.
- Agent harness renamed from `aep-2.5-agent-harness` to `aep-2.75-agent-harness`.

### New modules
- `src/schema-builder/` - Schema Builder (Capability 12): data-driven schema creation and validation with four analytical frameworks (MLE estimation, graph spectral analysis, permissiveness scoring, Louvain modularity detection).
- `src/policy-builder/` - Policy Builder (Capability 13): invariant detection from data, Rego rule generation, coverage tracking, spectral impact projection.
- `src/subprotocols/mcp-security/` - MCP Security Gateway: tool poisoning, typosquatting and drift detection for MCP servers.
- `src/policy/transpilers/` - Multi-Language Policy transpilers: OPA Rego to GAP, Cedar to GAP.
- `src/policy/importer/` - YAML Policy Importer for external policy formats.
- `src/ledger/merkle.ts` - Merkle-Tree Audit Records with SHA-256 proof bundles and per-entry verification.
- `src/intercept/` - AEP Intercept Proxy: one-command MCP proxy with policy-based tool blocking.
- `src/graph/` - AEP-Graph Orchestration Engine: stateful persistent cyclic workflows with checkpoints.
- `src/fleet/collaboration/` - Multi-Agent Collaboration: supervisor, debate and delegation primitives.

### New policy config sections (all optional)
- `schema_builder` - MLE, spectral, permissiveness and modularity weights and thresholds.
- `policy_builder` - auto-propose toggle, confidence threshold, manifest requirement.
- `mcp_security` - tool poisoning detection, typosquatting scanning, drift monitoring.
- `graph` - workflow orchestration with checkpoint persistence.
- `collaboration` - multi-agent patterns (supervisor, debate, delegation).

### New CLI commands
- `aep schema build <domain> <data-file>` - build schema from historical data.
- `aep schema validate <schema-file>` - validate schema with all four frameworks.
- `aep schema compare <domain> <data-file> [--candidates <file>]` - compare and rank schema candidates.
- `aep schema tighten <schema-file> <data-file>` - propose tighter constraints from MLE.
- `aep policy build <schema-file>` - build Rego policies from schema.
- `aep policy validate <schema-file> <rego-dir>` - validate policy coverage.
- `aep policy gaps <schema-file> <manifest-file>` - identify coverage gaps.
- `aep intercept` - launch MCP intercept proxy.
- `aep graph` - manage workflow graphs.
- `aep fleet collaborate` - manage multi-agent collaboration.

### New built-in policies
- `reference/security.gap` - baseline security policy for the reference lattice.
- `reference/deployment.gap` - deployment governance policy.
- `reference/governance.gap` - governance meta-policy.
- `reference/writing.gap` - writing and documentation standards policy.

### Updated modules
- `SchemaBuilder` class with four analytical frameworks: `validateSchema()`, `buildFromData()`, `compareSchemas()`, `proposeTightening()`.
- `PolicyBuilder` class with `buildPolicy()`, `validatePolicy()` and access to `InvariantDetector` and `RegoGenerator`.
- `PolicyEvaluator` now runs a 15-step evaluation chain (was 13 in v2.5). Steps 0 (task scope) and 12 (cross-agent) were added.
- Scanner pipeline expanded from 11 to 12 possible scanners.
- `LedgerEntryType` extended with `schema:validate`, `policy:validate`, `intercept:block`, `graph:checkpoint`, `collaboration:delegate`.
- `aepassist` supports `schema` and `policy` subcommands.

## What Stayed the Same

- Three-layer architecture (Structure, Behaviour, Skin).
- Z-band hierarchy and prefix convention.
- AOT and JIT validation logic.
- All existing Rego policies remain valid.
- Lattice Memory and Basic Resolver.
- All existing SDK files (`sdk-aep-*.*`).
- Licence (Apache 2.0).
- All v2.5 policy files remain valid. New sections are optional with sensible defaults.

## Step-by-Step Migration

### 1. Update policy versions

In every `.policy.yaml` file:
```yaml
version: "2.75"
```

### 2. Install updated package

```bash
npm install @aep/core@2.6.0
```

### 3. (Optional) Enable Schema Builder

```yaml
schema_builder:
  mle_weight: 0.35
  spectral_weight: 0.25
  permissiveness_weight: 0.25
  modularity_weight: 0.15
  confidence_level: 0.99
  min_sample_size: 30
```

Build a schema from data:
```bash
npx aep assist schema build orders data/orders.json
```

Validate an existing schema:
```bash
npx aep assist schema validate schemas/orders-schema.json
```

### 4. (Optional) Enable Policy Builder

```yaml
policy_builder:
  auto_propose: true
  confidence_threshold: 0.8
  require_manifest: true
```

Build Rego policies from a validated schema:
```bash
npx aep assist policy build schemas/orders-schema.json
```

Validate policy coverage:
```bash
npx aep assist policy validate schemas/orders-schema.json policies/rego/
```

### 5. (Optional) Enable MCP Security Gateway

```yaml
mcp_security:
  tool_poisoning_detection: true
  typosquatting_scan: true
  drift_monitoring: true
```

### 6. (Optional) Add reference policy lattice

Copy the reference policies into your policy directory:
```bash
cp -r node_modules/@aep/core/policies/reference/ ./policies/reference/
```

### 7. (Optional) Enable multi-language policy transpilers

```yaml
policy_transpilers:
  rego_to_gap: true
  cedar_to_gap: true
```

### 8. (Optional) Enable graph orchestration

```yaml
graph:
  enabled: true
  checkpoints:
    persist: true
    max_retry: 3
```

### 9. (Optional) Enable multi-agent collaboration

```yaml
collaboration:
  enabled: true
  patterns:
    - supervisor
    - debate
    - delegation
```

### 10. Update agent harness

Replace `aep-2.5-agent-harness` with `aep-2.75-agent-harness` in your project.

### 11. Run tests

```bash
npm test
```

All tests should pass with zero regressions.

## Rollback

All new policy sections are optional with defaults matching v2.5 behaviour. To revert:

1. Change `version: "2.75"` back to `version: "2.5"` in policy files.
2. Remove any `schema_builder`, `policy_builder`, `mcp_security`, `graph`, `collaboration` or `policy_transpilers` sections.
3. Downgrade the package: `npm install @aep/core@2.5.0`.
4. Replace `aep-2.75-agent-harness` with `aep-2.5-agent-harness`.

## Feature Summary (v2.5 to v2.75)

| v2.5 | v2.75 |
|---|---|
| 75 features | 77+ features |
| 11 content scanners | 12 content scanners |
| 13-step evaluation chain | 15-step evaluation chain |
| No schema governance | Schema Builder (MLE + spectral + permissiveness + modularity) |
| No policy governance | Policy Builder (invariant detection + Rego generation + coverage) |
| GAP-only policies | GAP + Rego + Cedar transpilers |
| Workflow phases | Stateful persistent cyclic workflows (graph) |
| No MCP security | MCP Security Gateway (poisoning, typosquatting, drift) |
| No intercept proxy | Intercept Proxy (one-command MCP proxy) |
| No multi-agent collaboration | Supervisor, debate, delegation primitives |
| Hash-chained ledger | Merkle-tree audit records with proof bundles |
