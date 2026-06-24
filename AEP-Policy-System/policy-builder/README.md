# Policy Builder

**Policy Builder is a distinct AEP 2.8 component** (Capability 13). Invariant detection from data, Rego rule generation, coverage tracking and spectral impact projection.

- **Implementation:** `policy-builder/lib/`
- **Registry:** `AEP-Base-Node/registry/components/policy-builder.json`
- **Depends on:** `schema-builder/` (MLE + spectral analysis)
- **Runtime hook:** `AgentGateway.validatePolicyProposal()`

## Modules

| File | Role |
|------|------|
| `policy-builder.ts` | Orchestrator |
| `invariant-detector.ts` | Domain invariant extraction |
| `rego-generator.ts` | Rego rule proposals from invariants |

## Integration status

Gateway and AEPassistant expose validation APIs. **Not yet wired** to setup-agent, CCA or Docker activation path.