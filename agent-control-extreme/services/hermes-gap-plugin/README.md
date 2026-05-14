# GAP Governance Plugin for Hermes Agent

External reference implementation. Makes GAP Runtime the mandatory governance
layer for EVERY Hermes tool call.

## What it does

```
Hermes Agent decides: "rm -rf /var/www && git pull"
        │
        ▼
GAP Plugin intercepts tool call
        │
        ▼
POST /v1/validate to gap-server:3200
   → 15-step lattice
   → 11 scanners
   → covenant check
        │
   ALLOW │ DENY
        │
        ▼
Tool executes (or is blocked)
```

## Installation

```bash
# Option 1: Plugin install (if Hermes plugin system supports it)
hermes plugins install /path/to/hermes-gap-plugin

# Option 2: Manual install
cp -r gap_governance ~/.hermes/plugins/gap-governance/

# Option 3: Tool wrapper (works with any Hermes version)
cp scripts/gap-wrap /usr/local/bin/
gap-wrap hermes chat
```

## Requirements

- gap-server running on port 3200 (or set GAP_SERVER_URL)
- Python 3.9+
- requests, pyyaml

## Architecture

```
gap_governance/
├── __init__.py        # Module exports
├── plugin.py          # Hermes plugin entry (hooks into tool dispatch)
├── client.py          # GAP HTTP client (validate, scan, execute)
├── policy_cache.py    # Policy sync from NLA control hub
└── scripts/
    ├── install.sh     # Install script
    └── gap-wrap       # Standalone Hermes wrapper (no plugin API needed)
```

## How it hooks into Hermes

### Method A: Native Hermes Plugin API (future)

```python
# @tool_interceptor decorator wraps every tool call
class GAPGovernancePlugin(HermesPlugin):
    @tool_interceptor(pre="all")
    def validate_tool_call(self, tool_name, tool_args, context):
        result = gap_client.validate(tool_name, tool_args)
        if not result.passed:
            raise ToolRejectedError(result.violations)
```

### Method B: Monkey-patch tool registry (works today)

Monkey-patches `tools.registry.dispatch()` to inject GAP validation
before every tool call. Survives Hermes updates since `dispatch()` is
a stable internal API.

### Method C: gap-wrap standalone wrapper (zero code changes)

Wraps Hermes with a Python proxy that intercepts stdin/stdout
and routes every tool call through GAP. Works with ANY Hermes version.
See `scripts/gap-wrap`.

## Policy sync

The plugin auto-polls the NLA control hub for policy updates every 5 minutes.
Policies are cached locally so governance works even if the hub is unreachable.

```bash
# Force sync
gap-governance --sync-policies
```
