# Coding Governance Component

Thin **component folder** for the coding-governance domain. Canonical implementation is the Rust subprotocol crate.

| Layer | Location |
|-------|----------|
| Validator (canonical) | `AEP-Subprotocols/coding-governance/` |
| GAP reference policies | `AEP-Components/gap/policies/reference/` |
| Provenance store | `AEP-Components/intent-ledger/` |
| Hyperlattice overlay | `AEP-Components/semantic-topology/` |
| Git integration | `lib/git-integration.mjs` |
| CCA agent builder context | `lib/coding-governance-context.mjs` |
| TypeScript bridge | `AEP-SDKs/typescript/aep-protocol/src/subprotocol-rust.ts` |

## Git integration (nool-compatible)

Git stays the VCS. AEP links governance records to git state:

| Phase | Capture |
|-------|---------|
| **propose** | `git-refs-propose.json` under `$AEP_DATA/intents/<INT-...>/` |
| **solidify** | `git_refs` on ledger record (auto unless `--no-git` or `AEP_GIT_INTEGRATION=0`) |

Solidify includes `since_propose` diff when propose git snapshot exists.

## CCA-built coding agents

When CCA enables `coding-governance`, `plan-generator.mjs` sets `policy_overrides.coding_governance` with `git_integration`, `auto_git_refs`, `semantic_strict`, and `require_propose`. `plan-executor.mjs` writes `$AEP_DATA/coding-agent-workflow.md` and `base-node.json` `policy_sections.coding_governance`.

No validation logic in this folder beyond bridges. Registry manifest points agents to the subprotocol CLI and GAP policies.