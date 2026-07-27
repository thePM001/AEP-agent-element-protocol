# CCA Agent Instructions

This file is for **AI coding agents** (Claude Code, Cursor, Codex, Grok, etc.) that work on or through the CCA Setup Agent. Read this before editing CCA code, generating plans or answering deployment questions.

---

## Identity

You are assisting **CCA (Central Setup Agent)**, the AEP 2.8 central deployment architect.

| Fact | Value |
|------|-------|
| Component path | `AEP-Components/cca/` |
| Registry ID | `cca` |
| CLI | `aep-cca` |
| Primary artifact | `ImplementationPlan` v1 at `{AEP_DATA}/plans/active.json` |
| Visual counterpart | Composer Lite graph at `{AEP_DATA}/composer-lite-graph.json` |

**Your job:** help users describe deployment intent, select the right AEP components, produce valid lattice-secured plans and execute them without violating protocol rules.

---

## AEP CAW Framework (mandatory for shell workloads)

When `caw-framework` is enabled (default in AEP 2.8):

- Agents run shell via `aep-caw exec`, not raw bash/zsh
- CAW enforces file, network, process and subprocess policy at the OS layer
- CAW audit events record as `CAW_AUDIT_EVENT` on the validation dock
- Plan executor writes `caw_framework` to `base-node.json` and policy sections
- Fork attribution: agentsh (Apache 2.0) -> `AEP-Components/caw-framework/`

Do not disable CAW for coding-agent or CAW intents unless the user explicitly requests no shell enforcement.

## Architecture truths (do not get these wrong)

### 1. CCA is not on the validation dock by default

The default public-tier setup has **no dedicated validation engine**:

```
validation_engine.mode = "none"
```

CCA plans may include `dock_validation` topology nodes for visualization. That does **not** mean a validation engine is installed or that CCA routes through the validation dock at runtime.

Only when the operator explicitly chooses `nla-built`, `build-own` or `third-party` validation engine modes does a real validation engine dock onto the lattice.

### 2. `writing.gap` is NOT an LRP

| Concept | What it is |
|---------|------------|
| **LRP** | Legacy nation-state regulation provider (GDPR, HIPAA, EU AI Act, commerce-subprotocol, soc2-type2, etc.) |
| **writing.gap** | Style lint rules (em-dash ban, Oxford comma ban, double-hyphen ban) |
| **EPSCOM** | Kernel-level enforcement of writing.gap via `epscom-core` LRP (priority 255) in Base Node |

Never register `writing.gap` as an LRP slot. Never route writing enforcement through the validation dock. Enforcement happens in the Base Node kernel (`AEP-Base-Node/crate/src/epscom.rs`, `aep-lattice-log validate-writing` / `enforce-writing-value`) before governed output is released.

### 3. Lattice channels are mandatory

- `security.lattice_strict` must be `true` in every plan
- No `raw_http` transport between AEP nodes
- CCA LLM calls use `latticeGatedFetch` (see `lib/chat.mjs`)
- All inter-node edges use lattice channel IDs (default: `lattice-channel-default`)

### 4. EPSCOM enforces writing on all CCA output

Before returning plans or chat replies, CCA calls:

- `epscomEnforceWritingValue(plan)` on plan objects
- `epscomEnforceWriting(reply)` on prose

Agents generating CCA-facing text must follow writing.gap rules proactively so EPSCOM does not rewrite their output.

---

## Writing rules (mandatory)

```
- Never use em-dashes, en-dashes or Unicode dash substitutes. Use a plain hyphen (-) or rewrite.
- Never use double-hyphen ( -- ) as a sentence separator in prose. Use hyphen (-) or rewrite.
- Never use Oxford commas: write "foo, bar and baz" not "foo, bar, and baz". Same rule for "or".
```

Source of truth: `AEP-Components/lattice-channels/lib/lattice-transport.mjs` (`EPSCOM_WRITING_RULES`).

---

## GAP (Governed Agentic Programming)

CCA **must** understand GAP when planning governed deployments.

| Topic | Location |
|-------|----------|
| GAP component | `AEP-Components/gap/` |
| Meta-schemas | `gap/schemas/gap-meta-schema-v1.2.json` |
| Reference policies (canonical) | `AEP-Policy-System/reference/*.gap` |
| Coding-governance GAPs | `AEP-Components/gap/policies/reference/*.gap` |
| Policy system loader | `cca/lib/policy-system-context.mjs` |
| CCA loader | `cca/lib/gap-context.mjs` |
| CLI summary | `aep-cca gap` |

### Rules for agents editing CCA or generating {AEP_DATA}/plans

1. Enable component `gap` in every governed stack (`default_enabled: true`).
2. GAP files use `.gap` extension (YAML). Required fields: `address`, `pattern`, `action`, `weight`, `composition`, `metadata`.
3. Subprotocols attach in `metadata.subprotocols` for lattice Step 3.5 (ui, commerce, **coding-governance**, etc.).
4. Set `policy_overrides.gap.reference_policies` to bundled policy paths when user mentions GAP.
5. For coding agents with pre-change intent, enable `coding-governance` and set `policy_overrides.coding_governance` with `require_propose`, `git_integration`, `auto_git_refs`, `semantic_strict` (CCA plan-generator does this automatically).
6. Plan execute writes `$AEP_DATA/coding-agent-workflow.md` with propose/solidify/git loop for deployed agents.
6. **`writing.gap` is NOT GAP** - it is EPSCOM prose lint (em-dash ban). Never conflate them.

GAP knowledge is injected into every LLM system prompt via `formatGapForPrompt()` in `registry-context.mjs`.

### dynAEP Action Lattice (mandatory CCA knowledge)

| Topic | Location |
|-------|----------|
| Protocol (no SDKs) | `AEP-Components/dynAEP/` |
| Action Lattice source | `AEP-Components/dynAEP/bridge/lattice/index.ts` |
| Lattice registry | `AEP-Components/dynAEP/registries/aep-lattice.yaml` |
| Bridge config | `AEP-Components/dynAEP/dynaep-config.yaml` (lattice.governance) |
| Observer adapters | `AEP-Components/dynAEP/observers/` (webhook, SSE, poll, blockchain example) |
| TypeScript SDK | `AEP-SDKs/typescript/dynaep/` |
| Python SDK | `AEP-SDKs/python/dynaep/` |
| React bindings | `AEP-SDKs/react/dynaep-react.tsx`, `dynaep-copilotkit.tsx` |
| SDK producer | `AEP-User-Experience/scripts/produce-aep-sdks.mjs` |
| dynAEP context loader | `cca/lib/dynaep-context.mjs` |

CCA must inject `dynaep` into registry context and set on every governed plan:

- `policy_overrides.dynaep` with `lattice_registry`, `governance_mode`, `sdk_paths`, optional `observers`
- `dynaep-core` component (default_enabled) for protocol
- `aep-dynaep-typescript` / `aep-dynaep-python` when user needs compiled client libraries

**Taxonomy:** `dynaep-action-lattice` is a kernel contract (Base Node bootstrap), **not** an LRP. Do not put `epscom-core`, `dynaep-action-lattice`, `gap-runtime-scanners` or `commerce-subprotocol` in `plan.lrps`. Regulation LRPs only: entries from `catalog.lrps`.

### AEP Policy System (mandatory CCA knowledge)

| Topic | Location |
|-------|----------|
| Canonical GAP lattice | `AEP-Policy-System/reference/*.gap` |
| Agent YAML presets | `AEP-Policy-System/*.policy.yaml` |
| Lattice mandatory rules | `AEP-Policy-System/lattice-channel-mandatory.gap` |
| Regulation LRP catalog | `AEP-Components/wizard/lrp/catalog.json` (`lrps[]` only) |
| Policy context loader | `cca/lib/policy-system-context.mjs` |
| Policy sections builder | `cca/lib/policy-sections.mjs` |
| Runtime lattice API | Composer Lite `GET /api/policy-lattice` |

CCA must inject `policy_system` into registry context and set on every plan:

- `policy_overrides.policy_lattice` (hierarchy + reference paths)
- `policy_overrides.regulation_lrps.modules` when `plan.lrps` includes compliance IDs (each with `gap_ref`)
- `policy_overrides.gap.reference_policies` pointing at `AEP-Policy-System/reference/`

`plan-executor.mjs` and `setup-agent.mjs` write `config.policy_sections` including per-LRP `gap_ref` entries.

---

## Registry knowledge

CCA loads the full catalog at runtime via `buildRegistryContext()`:

| Source | Path |
|--------|------|
| Catalog index | `AEP-Base-Node/registry/catalog.json` (59 entries, 58 bundled) |
| Manifests | `AEP-Base-Node/registry/components/*.json` |
| Plan schema | `AEP-Base-Node/registry/schemas/implementation-plan-v1.json` |
| GAP context | `cca/lib/gap-context.mjs` (also in `context.gap` JSON field) |
| Policy system | `cca/lib/policy-system-context.mjs` (also in `context.policy_system`) |
| dynAEP | `cca/lib/dynaep-context.mjs` (also in `context.dynaep`) |
| Installed extensions | `{AEP_DATA}/extensions/installed.json` |

Every bundled component has a `cca` block with `summary`, `use_when`, `avoid_when` and `pairs_with`. The prompt formatter (`formatContextForPrompt`) includes **full** metadata: all capabilities, actions, setup_hooks and requires. Do not truncate when building prompts.

### Component selection logic

Selection is implemented in `lib/component-catalog.mjs`:

1. **Base set** - all `default_enabled` and already `installed` components
2. **Kernel contracts (not LRPs)** - `epscom-core`, `dynaep-action-lattice`, `lattice-channel-default` (Base Node bootstrap). **Regulation LRPs** are sovereign/regional/international frameworks only (`eu-ai-act`, `gdpr`, etc. via `base_node.lrps`).
3. **Intent rules** - dynamic regex from each manifest's `cca.use_when`, capabilities, name and id
4. **Full stack** - phrases matching `FULL_STACK_PATTERN` enable all 58 bundled non-template components
5. **Pairs** - when a component matches, its `cca.pairs_with` are also enabled

When editing selection logic, prefer extending `component-catalog.mjs`. Do **not** add hardcoded `INTENT_RULES` arrays back into `plan-generator.mjs`.

---

## ImplementationPlan output rules

When you produce or edit a plan:

### Required structure

```json
{
  "plan_version": "1",
  "created_by": "cca",
  "created_at": "<ISO8601>",
  "user_intent": "<original user text>",
  "components": [{ "id": "<component-id>", "enabled": true, "reason": "..." }],
  "lrps": ["eu-ai-act"],
  "inference": { "provider": "...", "model": "...", "base_url": "..." },
  "topology": { "nodes": [], "edges": [] },
  "security": { "lattice_strict": true, "internet_up": true, "ucb_enabled": false }
}
```

### Component entries

- List only **enabled** components in the final array (CCA generator filters to enabled)
- Include `reason` explaining why each component was selected
- For Postgres add `config` on `connector-postgres` and mirror in `connectors.postgres`

### LRP entries

Add LRP ids to `plan.lrps` only when user requests a **regulation** compliance pack:

- `eu-ai-act`, `gdpr`, `hipaa`, `soc2-type2`, `nist-ai-rmf`, `iso-42001` (from `catalog.lrps`)

Do **not** add kernel contracts (`epscom-core`, `dynaep-action-lattice`, `lattice-channel-default`), platform features (`gap-runtime-scanners`, `commerce-subprotocol`) or `writing.gap` to `plan.lrps`. Enable those as **components**; executor syncs dock registration via `syncLrpsFromComponents`.

### Topology

- Always include `lattice-hub`, `dock-validation`, `dock-inference`
- Add `dock-regulation` when any LRP or regulation component is enabled
- Add agent nodes for coding agent counts in intent (max 8)
- Add component nodes for enabled non-infra components (see `TOPOLOGY_SKIP_IDS` in catalog)
- Wire edges with `channel` field, never `raw_http`

### Inference

Respect `environment-probe` constraints:

| Constraint | Action |
|------------|--------|
| `memory_below_8gb` | Prefer `openrouter` over local `llama_cpp` |
| `no_gpu` | Do not recommend 70B local models |
| GPU 16GB+ VRAM | `llama_cpp` with 70B hint is acceptable |

---

## Chat and LLM behavior

`runCcaChat()` flow:

1. Always generate a **rule-based plan** first (`generatePlanFromIntent`)
2. If LLM is configured and API key present, send `buildCcaSystemPrompt(context)` as system message
3. If LLM returns valid plan JSON, use it; otherwise keep rule-based plan and note validation errors
4. On LLM failure, return rule-based summary (CCA never blocks on LLM)
5. Apply EPSCOM enforcement to final plan and reply

Agents modifying chat behavior must preserve this fallback chain.

---

## Graph-plan sync

| Direction | Module | Trigger |
|-----------|--------|---------|
| Plan to graph | `plan-to-graph.mjs` | Plan execute, chat suggestion |
| Graph to plan | `graph-to-plan.mjs` | Composer `PUT /api/graph` with `plan_sync: true` |

Graph nodes enable components when `data.component_id` or `data.registry_id` is set. Node types `ucb`, `wasm_policy`, `connector` and `regulation` map back to registry ids via `componentIdsFromGraph()`.

---

## Plan execution rules

`executeImplementationPlan()` in `lib/plan-executor.mjs`:

- Validates plan against registry unless `force: true`
- Requires Base Node binary and live docking sockets
- Collects `setup_hooks` via `AEP-Base-Node/registry/lib/setup-hooks.mjs`
- Sets `commerce.enabled: true` when `commerce-subprotocol` is enabled
- Writes `base-node.json`, `installed.json`, lattice env
- Default validation engine: `{ id: "none" }`
- Runs conformance runner when `conformance-runner` component is enabled

Do not change executor to default validation engine to `nla-built` without explicit operator choice.

---

## Files you may edit

| File | Safe to edit when |
|------|-------------------|
| `lib/component-catalog.mjs` | Adding intent patterns, topology mapping, graph sync |
| `lib/registry-context.mjs` | Prompt formatting, context fields |
| `lib/plan-generator.mjs` | Orchestration only (keep catalog-driven) |
| `lib/plan-executor.mjs` | Activation steps, policy defaults |
| `lib/cca-prompt.mjs` | System prompt instructions |
| `lib/chat.mjs` | LLM integration, fallback logic |
| `lib/graph-to-plan.mjs` | Graph sync semantics |
| `AEP-Base-Node/registry/components/*.json` | Manifest `cca` blocks, capabilities |
| `AEP-Components/conformance/runner/run.sh` | Coverage tests |

## Files you must not break

| File | Why |
|------|-----|
| `AEP-Base-Node/crate/src/epscom.rs` | Kernel writing enforcement |
| `lattice-channels/lib/lattice-transport.mjs` | EPSCOM bridge and lattice gate |
| `AEP-Base-Node/registry/schemas/implementation-plan-v1.json` | Plan contract |
| `conformance/runner/run.sh` | CI gate |

---

## Testing requirements

After CCA changes, run:

```bash
cd AEP-Components/conformance/harness
./node_modules/.bin/vitest run \
  ../../../AEP-Components/conformance/runner/run.sh \
  ../../../AEP-Components/conformance/runner/run.sh \
  ../../../AEP-Components/conformance/runner/run.sh \
  ../../../AEP-Components/conformance/runner/run.sh \
  ../../../AEP-Components/conformance/runner/run.sh
```

For Rust EPSCOM changes:

```bash
cargo test -p aep-base-node epscom
```

---

## Common agent mistakes (avoid these)

| Mistake | Correct behavior |
|---------|------------------|
| Register `writing.gap` as LRP | Use EPSCOM kernel only |
| Route CCA through validation dock | CCA uses inference dock for LLM; validation dock is optional |
| Hardcode 14 intent rules | Use `component-catalog.mjs` dynamic rules |
| Set `lattice_strict: false` | Always true |
| Truncate registry prompt to 3 `use_when` / 6 capabilities | Include full metadata |
| Skip `plan_sync` on graph save | Composer must send `plan_sync: true` |
| Leave commerce `enabled: false` after commerce LRP | Executor enables it |
| Use Oxford commas or em-dashes in docs/output | Follow writing.gap |

---

## Quick CLI for agents

```bash
# Environment
aep-cca probe

# Full registry JSON
aep-cca context

# Generate plan
aep-cca plan --intent "full AEP 100% coverage"

# Validate
aep-cca validate

# Execute
aep-cca execute

# Chat
aep-cca chat --intent "Postgres, EU AI Act, 2 coding agents"
```

---

## Capabilities reference

From `AEP-Base-Node/registry/components/cca.json`:

- `cca:probe-environment`
- `cca:registry-context`
- `cca:generate-plan`
- `cca:execute-plan`
- `cca:validate-plan`
- `cca:plan-to-graph`
- `cca:graph-to-plan`
- `cca:epscom-writing-enforced`

When adding new CCA features, update the manifest capabilities and this file.

---

## Conformance IDs

| ID | Test file | What it proves |
|----|-----------|----------------|
| CC-16 | `lint-writing-gap.mjs` | Documentation writing.gap lint |
| CC-17 | `epscom-writing-kernel.test.mjs` | EPSCOM kernel enforcement |
| CC-18 | `cca-full-coverage.test.mjs` | All 58 components reachable, graph sync |
| CC-19 | `plan-execution.test.mjs` | Hooks, commerce, connectors |

---

## Summary checklist

Before submitting CCA work:

- [ ] Plan schema validates (`aep-cca validate`)
- [ ] Full-stack intent enables all bundled components
- [ ] Compliance intents match (SOC 2, NIST AI RMF, ISO 42001, GDPR, HIPAA)
- [ ] `security.lattice_strict` is true
- [ ] No writing.gap violations in prose
- [ ] No `writing.gap` LRP registration introduced
- [ ] Conformance tests pass
- [ ] README.md and this AGENTS.md updated if behavior changed