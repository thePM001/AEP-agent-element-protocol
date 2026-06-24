# Schema Builder

**Schema Builder is a distinct AEP 2.8 component** (Capability 12). Data-driven schema creation and validation using MLE estimation, graph spectral analysis, permissiveness scoring and Louvain modularity detection.

- **Implementation:** `schema-builder/lib/`
- **Registry:** `AEP-Base-Node/registry/components/schema-builder.json`
- **Runtime hook:** `AgentGateway.validateSchemaProposal()`

## Modules

| File | Role |
|------|------|
| `schema-builder.ts` | Orchestrator |
| `mle-estimator.ts` | Maximum-likelihood field estimation |
| `spectral-analyzer.ts` | Graph spectral analysis |
| `permissiveness-scorer.ts` | Permissiveness vs tightness scoring |
| `module-detector.ts` | Louvain modularity clustering |

## Integration status

Gateway and AEPassistant expose validation APIs. **Not yet wired** to setup-agent, CCA or Docker activation path.