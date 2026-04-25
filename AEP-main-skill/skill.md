---
name: aep
description: Use this skill whenever working with AEP (Agent Element Protocol) or dynAEP. Triggers include 'AEP', 'dynAEP', 'scene graph', 'aep-scene.json', 'aep-registry.yaml', 'aep-theme.yaml', 'zero-trust UI', 'topological matrix', 'z-band', 'skin binding', 'AEP-FCR', 'lattice memory', 'memory fabric', 'attractor', 'rejection history', 'resolver', 'proposal routing', 'fast-path', 'aep v2', 'aep 2.2', 'AgentGateway', 'policy engine', 'evidence ledger', 'rollback', 'session governance', 'MCP proxy', 'trust scoring', 'execution ring', 'covenant', 'agent identity', 'cross-agent verification', 'intent drift', 'kill switch', 'merkle proof', 'quantum signature', 'streaming validation', 'OWASP agentic' or building validated UI for AI agents. Also use when implementing AEP three-layer architecture, writing AEP validators, creating MCP servers that validate agent UI output, working with AG-UI under AEP governance, querying validation memory or routing proposals through the resolver. If AEP MCP tools are available (list_aep_schemas, create_ui_element, get_scene_graph), always consult this skill first. Do NOT guess IDs, skin bindings, z-bands or element types.
---

# Agent Element Protocol (AEP) 2.2

AEP is a **3-layer frontend governance architecture** that gives every UI element a unique numerical identity, exact spatial coordinates, defined behaviour rules and themed visual properties. It treats the frontend as a **topological coordinate system**, not a fluid DOM tree.

AI agents propose UI structures. AEP validates every proposal against a strict registry. Only valid elements render. Invalid proposals are rejected with actionable errors. The agent self-corrects. Zero hallucinations reach the UI.

**AEP 2.2** adds trust scoring, execution rings, behavioural covenants, agent identity, cross-agent verification, Merkle proofs, post-quantum signatures, RFC 3161 timestamps, kill switch, intent drift detection, streaming validation with early abort and OWASP Agentic AI Top 10 coverage.

## The Three Layers

```
LAYER 1: STRUCTURE  (aep-scene.json)    - What exists and where it sits in space
LAYER 2: BEHAVIOUR  (aep-registry.yaml) - What each element does and cannot do
LAYER 3: SKIN       (aep-theme.yaml)    - What each element looks like
```

## AEP 2.2 Capabilities

### Trust Scoring
Continuous trust score (0-1000) with five tiers: untrusted (0-199), provisional (200-399), standard (400-599), trusted (600-799), privileged (800-1000). Time-based decay. Configurable penalties per violation type and rewards per successful action.

### Execution Rings
Four-ring privilege model. Ring 0 (kernel): full access. Ring 1: read/write/delete/network. Ring 2 (default): read/create/update only. Ring 3 (sandbox): read-only. Automatic demotion when trust drops below ring threshold.

### Behavioural Covenants
Agent-declared constraint DSL:
```
covenant ProjectRules {
  permit file:read;
  permit file:write (path in ["src/", "tests/"]);
  forbid file:delete;
  require trustTier >= "standard";
}
```
Forbid overrides permit. Evaluated as Step 7 in the 12-step policy chain.

### Intent Drift Detection
Four heuristics: tool category distribution, target scope shifts, frequency anomalies and repetition detection. Configurable warmup period (first N actions establish baseline). Actions on drift: warn, gate, deny or kill.

### Agent Identity and Cross-Agent Verification
Ed25519/RSA identity per agent. `verifyCounterparty()` handshake with ProofBundle exchange. Configurable covenant requirements for counterparty acceptance.

### Kill Switch
`killAll(reason)` terminates every active session. `killSession(id, reason)` targets one session. Optional rollback and trust reset to zero.

### Evidence Integrity
Merkle Tree per-entry verification. ML-DSA-65 post-quantum signatures. RFC 3161 timestamp authority tokens. Offline signing for air-gapped environments.

### 12-Step Policy Evaluation Chain
1. Session state check
2. Ring capability check
3. System-wide rate limit
4. Per-session rate limit
5. Intent drift check
6. Escalation rules
7. Covenant evaluation
8. Forbidden pattern check
9. Capability + trust tier match
10. Budget/limit check
11. Gate check (human or webhook)
12. Cross-agent verification

### Streaming Validation with Early Abort
`AEPStreamValidator` intercepts agent output chunk by chunk as it streams. Five checks (covenant forbids, protected elements, z-band violations, structural violations, policy forbidden patterns). On first violation the stream is aborted and a `stream:abort` entry logged. `StreamMiddleware` wraps any `ReadableStream<string>`. Model-agnostic.

### OWASP Agentic AI Top 10
Every OWASP risk mapped to specific AEP 2.2 defence mechanisms. See `docs/OWASP-MAPPING.md`.

## Built-in Policies

| Policy | Ring | Trust | Use Case |
|--------|------|-------|----------|
| coding-agent | 2 | 500 | General development sessions |
| aep-builder | 1 | 600 | AEP element creation and modification |
| readonly-auditor | 3 | 300 | Read-only code review and audit |
| strict-production | 3 | 200 | Production environment with identity requirements |
| multi-agent | 2 | 400 | Multi-agent orchestration with identity and verification |
| covenant-only | 2 | 500 | Minimal policy relying on covenant enforcement |

## CLI Commands

```bash
aep init              # Initialise AEP for Claude Code, Cursor or Codex
aep proxy             # Start MCP governance proxy
aep exec              # Execute a policy-governed command
aep validate          # Validate evidence ledger integrity
aep report            # Export session report (--format json|csv|html)
aep kill              # Activate kill switch
aep trust             # Display trust score and tier
aep ring              # Display current ring and capabilities
aep drift             # Display intent drift score
aep identity create   # Generate agent identity key pair
aep identity verify   # Verify an agent identity
aep covenant parse    # Parse covenant DSL
aep covenant verify   # Verify action against covenant
aep owasp             # Display OWASP mapping
aep describe          # Full 2.2 capability summary
aep eval <ds> --policy <p>  # Run eval dataset against policy
aep dataset create <name>   # Create eval dataset
aep dataset add <n> <input> # Add entry to dataset
aep dataset import <n> <f>  # Import from ledger
aep dataset export <name>   # Export dataset (json or csv)
aep dataset list            # List all datasets
aep prompt save <n> <v> <f> # Save prompt version
aep prompt load <name>      # Load latest prompt version
aep prompt list <name>      # List prompt versions
aep prompt diff <n> <a> <b> # Diff two prompt versions
aep prompt inject <f> --policy <p>  # Inject governance context
```

## Eval-to-Guardrail Lifecycle

The eval system runs evaluation datasets against the governance pipeline to identify failing patterns and generate suggested covenant rules or scanner patterns. The feedback loop: production ledger -> dataset -> eval -> suggested rules -> policy refinement.

`EvalRunner` replays dataset entries through the full policy evaluation chain and scanner pipeline. It tracks pass/fail rates, false positives (blocked but should pass) and false negatives (allowed but should fail). `RuleGenerator` analyses violation patterns and produces covenant rules or scanner regex patterns when confidence exceeds the threshold.

## Governed Dataset Management

`DatasetManager` provides versioned evaluation datasets. Datasets can be created manually, imported from production evidence ledgers or loaded from JSON files. Each modification bumps the patch version. Export to JSON or CSV for external tooling. The ledger import maps `allow` decisions to `pass` and `deny` to `fail` outcomes.

## Prompt Optimization Under Governance

`PromptOptimizer` injects governance context into agent prompts so the agent understands its constraints before generating output. This reduces recovery cycles by making the agent aware of permitted actions, forbidden patterns, covenant rules, trust tier, execution ring and active scanners.

`optimiseFromEval` takes an eval report and adds violation-specific instructions to avoid previously observed failures. `comparePrompts` runs two prompt variants against the same dataset to determine which produces better governance compliance.

`PromptVersionManager` saves, loads, lists and diffs prompt versions with SHA-256 content hashes for integrity tracking.
