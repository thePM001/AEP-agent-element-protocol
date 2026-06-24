# AEP-HCSE (AEP-HCS-External)

Optional code graph parser for external AEP 2.8 users. **Not bundled** in the main repo.

## Flow

1. CCA enables `hcse` in the ImplementationPlan.
2. `install.mjs` downloads [DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) from GitHub Releases (lattice-gated).
3. `rebrand.mjs` renames the install to **aep-hcse** (opaque to the user).
4. `mcp-config.mjs` wires MCP for detected coding agents.
5. `hcse-integration.mjs` connects propose/solidify to symbol blast radius and `.aep-hcse/` artifacts.

## Paths after install

| What | Where |
|------|-------|
| Binary | `$AEP_DATA/modules/aep-hcse/{version}/aep-hcse` |
| Cache | `$AEP_DATA/cache/hcse/` (`CBM_CACHE_DIR`) |
| Git artifact | `{repo}/.aep-hcse/graph.db.zst` |
| MCP name | `aep-hcse` |

## Wiring

- `coding-governance/lib/propose.mjs` - symbol impact via `detect_changes`
- `coding-governance/lib/solidify.mjs` - `hcse_artifact` hash on solidify
- `cca/lib/plan-executor.mjs` - download on plan execute
- `cca/lib/component-catalog.mjs` - intent keyword match

No HCS. External users only.