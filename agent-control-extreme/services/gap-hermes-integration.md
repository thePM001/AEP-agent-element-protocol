# GAP Runtime + Hermes Agent - Integration Architecture

## The Problem

Hermes Agent is an LLM-powered autonomous agent. It takes natural language
instructions and uses tool calling to execute them. Currently there is NO
governance layer between "what the LLM decides to do" and "what actually
executes on the system."

The GAP Runtime (Rust) provides the governance kernel: 15-step adjudication
lattice, policy evaluation, scanners, covenants, trust scoring, and proof
chains. But it is a standalone HTTP server - it has no hooks into Hermes.

## The Goal

Make GAP the mandatory governance layer for ALL actions taken by Hermes Agent.
Every tool call, every terminal command, every file write must be validated
through GAP before execution. No governance bypass is possible.

```
User: "Deploy to production"
  │
  ▼
Hermes Agent (LLM)
  │ decides: rm -rf /var/www && git pull
  │
  ▼
GAP Runtime (governance check)  ── BLOCKED: violates deployment policy
  │
  ▼
Hermes: "Cannot proceed - GAP flagged deployment policy violation"
```

## Two Implementation Approaches

### Approach A: GAP as Hermes Plugin (Hermes Plugin API)

**Best for:** Tight integration, in-process, no network dependency.

Hermes supports plugins via `hermes plugins install`. A GAP plugin would
intercept the tool call pipeline and validate every action through the GAP
Rust runtime via PyO3 (Python bindings).

**Architecture:**

```
Hermes Agent process
├── LLM (conversation loop)
├── Tool Dispatcher
│   ├── terminal tool
│   ├── file tool (read/write/patch)
│   ├── web tool
│   └── ...
└── GAP Plugin (NEW)          <-- intercepts EVERY tool call
    ├── validate action        Post /v1/validate to GAP server
    ├── scan output            Post /v1/scan to GAP server
    └── log proof              Post /v1/execute with proof chain
```

**Plugin structure:**

```
~/.hermes/plugins/gap-governance/
├── __init__.py
├── plugin.py           # Hermes plugin entry point
├── client.py           # HTTP client to GAP server (or PyO3 direct)
├── policies/           # Cached policy bundle from control hub
│   └── nla-policies.yaml
└── README.md
```

**How it works:**

1. Plugin registers a tool decorator that wraps every tool execution
2. Before a tool runs: `POST /v1/validate` with the action + context
3. GAP checks: lattice, policies, scanners, covenants
4. If DENY: Hermes gets an error, tool NEVER executes
5. If ALLOW: tool runs, output is scanned through GAP `POST /v1/scan`
6. Full proof chain logged to GAP for audit

**Implementation (Python pseudo-code):**

```python
# plugins/gap-governance/plugin.py
from hermes_plugin import HermesPlugin, tool_interceptor

class GAPGovernancePlugin(HermesPlugin):
    name = "gap-governance"
    version = "0.1.0"

    @tool_interceptor(pre="all")  # runs BEFORE any tool
    def validate_tool_call(self, tool_name, tool_args, context):
        """Validate every tool call through GAP before execution."""

        # Build GAP instruction from tool call
        instruction = {
            "name": f"tool_{tool_name}",
            "domain": "agent_governance",
            "pattern": {"input": tool_args},
            "action": {
                "steps": [{
                    "order": 1,
                    "action_type": tool_name,
                    "prompt": context.get("current_prompt", ""),
                    "parameters": tool_args
                }]
            },
            "metadata": {
                "scanners": ["pii", "injection", "secrets", "jailbreak"],
                "covenants": ["nla-policies"],
                "proof": True
            }
        }

        # Call GAP server
        import requests
        resp = requests.post(
            f"{self.gap_url}/validate",
            json={"yaml": yaml.dump(instruction), "output": json.dumps(tool_args)}
        )
        result = resp.json()

        if not result.get("valid", False):
            violations = result.get("hard_violations", [])
            raise ToolRejectedError(
                f"GAP governance blocked: {', '.join(violations)}"
            )

        return tool_name, tool_args  # proceed

    @tool_interceptor(post="all")  # runs AFTER any tool
    def scan_tool_output(self, tool_name, tool_args, result, context):
        """Scan tool output through GAP after execution."""
        import requests
        resp = requests.post(
            f"{self.gap_url}/scan",
            json={"text": result, "scanners": ["pii", "secrets", "toxicity"]}
        )
        scan_result = resp.json()

        if not scan_result.get("passed", False):
            warnings = scan_result.get("soft_warnings", [])
            if warnings:
                self.log.warning(f"Output contained: {warnings}")

        return result  # pass through
```

**Pros:**
- No Hermes code changes - pure plugin
- Can be enabled/disabled per profile
- PyO3 bindings for in-process GAP (no network latency)
- Follows existing Hermes plugin architecture

**Cons:**
- Plugin API needs `@tool_interceptor` hooks (may not exist yet)
- Must be installed on every Hermes instance
- Plugin runs in-process - could be bypassed if plugin crashes

---

### Approach B: GAP as MCP Server (Model Context Protocol)

**Best for:** External governance enforcement, no plugin API needed.

Hermes already supports MCP servers via `hermes mcp add`. A GAP MCP server
would sit between Hermes and its tools, enforcing governance as a transparent
proxy.

**Architecture:**

```
Hermes Agent
  │
  ├── MCP Client
  │     │
  │     ├── ► GAP MCP Server (NEW)
  │     │     │  validates every request
  │     │     ▼
  │     │     └── GAP Runtime (Rust, port 3200)
  │     │
  │     └── ► Other MCP servers (filesystem, database, etc.)
  │
  └── Native tools (terminal, web, etc.)
        │  each call intercepted by GAP MCP
        ▼
     GAP validates → allow/deny
```

But wait - MCP servers expose TOOLS, they don't INTERCEPT tools. The MCP
protocol is "register tools" not "intercept tool calls."

**Refined Approach B: GAP as a Hermes Tool Wrapper**

Instead of MCP, inject GAP validation as a Python wrapper around Hermes's
built-in tool dispatch. This is a code modification to `hermes-agent/agent/`.

**Refined Architecture:**

```
hermes-agent/agent/
├── tool_dispatch.py     # Main tool dispatcher
│   └── wrap_tools()     <-- NEW: wraps every handler with GAP validation
├── gap_bridge.py        <-- NEW: GAP client (HTTP or PyO3)
├── policies/            <-- NEW: cached policies
└── ...
```

**Implementation:**

```python
# agent/gap_bridge.py
"""Bridge between Hermes Agent and GAP Runtime."""

import json
import os
import subprocess
from typing import Any, Dict, List, Optional

GAP_SERVER_URL = os.environ.get("GAP_SERVER_URL", "http://127.0.0.1:3200")
GAP_ENFORCED = os.environ.get("GAP_ENFORCED", "true").lower() == "true"

class GAPViolation(Exception):
    """Raised when GAP governance rejects an action."""
    def __init__(self, message: str, violations: List[Dict]):
        self.violations = violations
        super().__init__(message)

class GAPBridge:
    """Bridge to GAP Runtime for governance enforcement."""

    def __init__(self, server_url: str = GAP_SERVER_URL):
        self.server_url = server_url
        self._available = self._check_availability()

    def _check_availability(self) -> bool:
        """Check if GAP server is reachable."""
        import requests
        try:
            resp = requests.get(f"{self.server_url}/health", timeout=2)
            return resp.status_code == 200
        except Exception:
            return False

    def validate_action(
        self,
        action_type: str,
        action_params: Dict[str, Any],
        agent_context: Optional[Dict] = None,
        session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Validate an action through GAP governance.

        Returns GAP result dict.
        Raises GAPViolation if blocked.
        """
        if not GAP_ENFORCED:
            return {"valid": True, "mode": "bypass"}

        if not self._available:
            # Fail closed: if GAP is configured but unreachable, BLOCK
            if os.environ.get("GAP_FAIL_CLOSED", "true").lower() == "true":
                raise GAPViolation(
                    "GAP server unreachable, failing closed",
                    [{"scanner": "GAPBridge", "type": "connection_error"}]
                )
            return {"valid": True, "mode": "fail_open"}

        # Build GAP instruction
        instruction = {
            "name": f"hermes_action_{action_type}",
            "domain": "agent_governance",
            "id": f"act-{session_id or 'unknown'}-{hash(str(action_params))}",
            "version": 1,
            "pattern": {"input": action_params},
            "action": {
                "steps": [{
                    "order": 1,
                    "action_type": action_type,
                    "prompt": (agent_context or {}).get("last_prompt", ""),
                    "parameters": action_params
                }]
            },
            "metadata": {
                "scanners": ["pii", "injection", "secrets", "jailbreak",
                             "toxicity"],
                "covenants": [],
                "proof": True,
                "budget_token": None,
                "budget_cost_usd": None
            }
        }

        import yaml as yaml_lib
        import requests

        yaml_str = yaml_lib.dump(instruction)
        resp = requests.post(
            f"{self.server_url}/validate",
            json={"yaml": yaml_str, "output": json.dumps(action_params)},
            timeout=10
        )
        result = resp.json()

        if not result.get("valid", False):
            hard = result.get("hard_violations", [])
            raise GAPViolation(
                f"GAP blocked {action_type}: {', '.join(hard)}",
                result.get("scanner_violations", [])
            )

        return result

    def scan_output(
        self,
        text: str,
        scanners: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Scan output text through GAP."""
        if not self._available:
            return {"passed": True, "mode": "bypass"}

        import requests
        resp = requests.post(
            f"{self.server_url}/scan",
            json={
                "text": text,
                "scanners": scanners or ["pii", "secrets", "toxicity"]
            },
            timeout=10
        )
        return resp.json()
```

Wrapping every Hermes tool handler:

```python
# In agent/tool_dispatch.py, modify the dispatch function:

from agent.gap_bridge import GAPBridge, GAPViolation

_gap_bridge = GAPBridge()

async def dispatch_with_governance(tool_name, tool_args, agent_context):
    # Step 1: PRE-validation through GAP
    try:
        gap_result = _gap_bridge.validate_action(
            action_type=tool_name,
            action_params=tool_args,
            agent_context=agent_context,
            session_id=agent_context.get("session_id")
        )
    except GAPViolation as e:
        return {
            "status": "blocked",
            "error": str(e),
            "gap": {"violations": e.violations}
        }

    # Step 2: Execute the real tool
    result = await original_dispatch(tool_name, tool_args)

    # Step 3: POST-scan output
    scan_result = _gap_bridge.scan_output(
        json.dumps(result.get("output", ""))
    )

    if not scan_result.get("passed", True):
        result["warnings"] = (
            result.get("warnings", [])
            + scan_result.get("soft_warnings", [])
        )

    result["gap"] = gap_result
    return result
```

**Pros:**
- No separate service to deploy - runs inside Hermes
- Full control over tool dispatch
- Can enforce policies at the code level (cannot be bypassed)
- Works with any Hermes version

**Cons:**
- Requires Hermes code modification (not a plugin)
- Hermes update could break the patch
- Need to reapply after Hermes upgrades

---

### Recommended Hybrid Approach: GAP + Hermes MCP Gateway

**Best for:** Production with maximum isolation.

Run GAP as:
1. **A background service** (gap-server, port 3200) - always running
2. **A Hermes "validation hook"** - via a thin MCP server or Python wrapper
3. **A cron-based policy sync** - pulls policy updates from the control hub

```
┌────────────────────────────────────────────────────────────┐
│                    VPS / Container                          │
│                                                             │
│  ┌──────────────┐   HTTP    ┌──────────────────┐           │
│  │  Hermes      │◄─────────►│  GAP MCP Server   │           │
│  │  Agent       │  validate │  (Python proxy)    │           │
│  │  (Python)    │  scan     │                     │           │
│  └──────┬───────┘  execute  │  port 3201          │           │
│         │                   └─────────┬───────────┘           │
│         │                             │                       │
│         │                    HTTP     ▼                       │
│         │                   ┌──────────────────┐              │
│         └──────────────────►│  GAP Runtime      │             │
│         tool calls          │  (Rust, port 3200)│              │
│         (via MCP)           │  15-step lattice  │             │
│                              │  11 scanners      │             │
│                              │  ProofChain       │             │
│                              │  Covenant engine   │            │
│                              └──────────────────┘              │
│                                        │                       │
│                                        ▼                       │
│                              ┌──────────────────┐              │
│                              │  Control Hub      │             │
│                              │  (Git, policies)  │             │
│                              └──────────────────┘              │
└────────────────────────────────────────────────────────────┘
```

---

## The English -> GAP Pipeline

This is the critical question: "How do we give instructions to Hermes from
English, governed through GAP?"

### The Flow

```
User: "Deploy the supervision center to staging"

                 │
                 ▼
     ┌──────────────────────┐
     │ Stage 1: Intent       │
     │ Extraction             │
     │                        │
     │ LLM (Hermes) parses    │
     │ natural language       │
     │ into structured intent │
     └──────────┬───────────┘
                │
                ▼
     ┌──────────────────────┐
     │ Stage 2: GAP          │
     │ Instruction Building   │
     │                        │
     │ English → GAP YAML     │
     │ compiler/builder       │
     │                        │
     │ Builds:                │
     │ - name: deploy-supervision-center
     │ - domain: deployment
     │ - pattern/output: [ports, paths]
     │ - action steps: [build, deploy, verify]
     │ - metadata: [scanners, covenants, proof]
     └──────────┬───────────┘
                │
                ▼
     ┌──────────────────────┐
     │ Stage 3: GAP          │
     │ Governance Validation │
     │                        │
     │ POST /v1/validate      │
     │   → 15-step lattice    │
     │   → Rego policies      │
     │   → 11 scanners        │
     │   → Covenants          │
     │   → Trust score        │
     │                        │
     │ Result: ALLOW / DENY   │
     └──────────┬───────────┘
                │
         ALLOW  │  DENY
                │
                ▼
     ┌──────────────────────┐
     │ Stage 4: Execution    │
     │                        │
     │ Hermes runs tools      │
     │ (terminal, file, etc.) │
     │                        │
     │ Each tool call scanned │
     │ by GAP post-hoc        │
     └──────────┬───────────┘
                │
                ▼
     ┌──────────────────────┐
     │ Stage 5: Proof Chain  │
     │                        │
     │ POST /v1/execute       │
     │   → ProofChain logged  │
     │   → Audit trail        │
     │   → Git commit         │
     └──────────────────────┘
```

### The English->GAP Compiler

A critical component. Takes natural language + context and produces valid
GAP instructions. Can be implemented in two ways:

#### Option 1: LLM-Assisted Generation (Recommended)

Hermes itself builds the GAP instruction from the user's English request,
then validates it through GAP before executing.

```python
# agent/gap_compiler.py
"""English to GAP instruction compiler."""

class GAPInstructionBuilder:
    """Builds GAP instructions from natural language task descriptions."""

    def from_english(self, task: str, context: dict) -> dict:
        """
        Convert English task description to GAP instruction.

        Uses the LLM to parse intent and build structured instruction.
        """

        prompt = f"""You are a GAP instruction compiler. Convert the following
task into a valid GAP YAML instruction.

Task: {task}

Context:
- Domain: {context.get('domain', 'general')}
- Session: {context.get('session_id', 'unknown')}
- Available actions: {', '.join(context.get('available_actions', ['execute']))}

Output ONLY valid GAP YAML with these fields:
- name (slug)
- domain (from context)
- id (unique)
- version (1)
- pattern (input/output types)
- action (ordered steps with action_type, prompt, parameters)
- metadata (scanners, covenants, proof=true)

GAP YAML:"""

        llm_response = self._call_llm(prompt)
        return yaml.safe_load(llm_response)

    def validate_instruction(self, instruction: dict) -> bool:
        """Validate the built instruction before sending to GAP."""
        required = ["name", "domain", "id", "pattern", "action", "metadata"]
        return all(field in instruction for field in required)
```

#### Option 2: Rule-Based Template Matching (Faster, Deterministic)

For known task types, use templates instead of LLM:

```python
# agent/gap_templates.py
TEMPLATES = {
    "deploy": {
        "name": "deploy-{app}",
        "domain": "deployment",
        "pattern": {"input": {"app": str, "target": str, "branch": str},
                    "output": {"url": str, "status": str}},
        "action": {
            "steps": [
                {"order": 1, "action_type": "build",
                 "prompt": "Build {app} from {branch}",
                 "parameters": {"app": "{app}", "branch": "{branch}"}},
                {"order": 2, "action_type": "deploy",
                 "prompt": "Deploy {app} to {target}",
                 "parameters": {"app": "{app}", "target": "{target}"}},
                {"order": 3, "action_type": "verify",
                 "prompt": "Verify {app} at {target}",
                 "parameters": {"app": "{app}", "target": "{target}"}},
            ]
        },
        "metadata": {
            "scanners": ["secrets", "injection"],
            "covenants": ["nla-deployment-policy"],
            "proof": True
        }
    },

    "filesystem_read": {
        "name": "read-{path}",
        "domain": "agent_governance",
        "pattern": {"input": {"path": str}},
        "action": {
            "steps": [{
                "order": 1, "action_type": "read_file",
                "prompt": "Read {path}",
                "parameters": {"path": "{path}"}
            }]
        },
        "metadata": {
            "scanners": ["pii", "secrets"],
            "proof": True
        }
    },

    "terminal_command": {
        "name": "exec-{hash(command)}",
        "domain": "agent_governance",
        "pattern": {"input": {"command": str, "cwd": str}},
        "action": {
            "steps": [{
                "order": 1, "action_type": "terminal",
                "prompt": "Execute: {command}",
                "parameters": {"command": "{command}", "cwd": "{cwd}"}
            }]
        },
        "metadata": {
            "scanners": ["injection", "secrets", "jailbreak"],
            "covenants": ["nla-network-policy", "nla-deployment-policy"],
            "proof": True
        }
    }
}

def build_from_template(task_type: str, params: dict) -> dict:
    """Build GAP instruction from template."""
    template = TEMPLATES.get(task_type)
    if not template:
        return None

    # Deep copy and fill template variables
    import json
    instr = json.loads(json.dumps(template))

    def _fill(obj):
        if isinstance(obj, str):
            return obj.format(**params)
        elif isinstance(obj, dict):
            return {k: _fill(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [_fill(item) for item in obj]
        return obj

    return _fill(instr)
```

## Action Plan

### Phase 1: Foundation (Week 1)

1. Deploy gap-server as a systemd service on port 3200
   - Bind to 127.0.0.1 only (Tailscale for remote)
   - Health check in supervisor

2. Create `hermes-agent/agent/gap_bridge.py`
   - HTTP client to gap-server
   - validate_action() + scan_output() + execute()
   - Fail-closed by default

3. Add GAP validation to Hermes tool dispatch
   - Wrap terminal tool (highest risk)
   - Wrap file write tools (medium risk)
   - Wrap deploy tools (critical risk)

### Phase 2: Policy Sync (Week 2)

1. Create GAP MCP server (`gap-mcp-server.py`)
   - Exposes: `validate_action`, `scan_text`, `check_policy`
   - Automatically registered via `hermes mcp add gap-mcp`

2. Policy cron: sync policies from agent-control-extreme/ -> GAP
   - `nla-harness policies --fetch` polls control hub
   - Updates GAP's covenant set

### Phase 3: Full Governance (Week 3)

1. English -> GAP compiler
   - Template matching for common tasks
   - LLM-assisted for novel tasks
   - Always validates through GAP before executing

2. Proof chain logging
   - Every session gets a GAP proof chain
   - Logged to agent-control-extreme/registry/proofs/
   - Verifiable via `nla-harness verify-proof <session_id>`

3. Supervision Center integration
   - GAP violations visible in real-time dashboard
   - Kill switch routes through GAP
   - Session ledger enriched with GAP results
