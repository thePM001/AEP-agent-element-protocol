# GAP: Governed Agentic Programming

Native instructions language for governed, self-improving, mathematically verifiable agency. Part of the Agent Element Protocol ecosystem.

## AEP 2.8 integration

Vendored from [github.com/thePM001/gap](https://github.com/thePM001/gap) into `AEP-Components/gap/`.

| Path | Purpose |
|------|---------|
| `schemas/` | GAP meta-schema v1 and v1.2 (Layer 1 constraint masks) |
| `policies/reference/` | Reference `.gap` instructions: coding governance, CAW sandbox profiles, task manifests, implementation plans |
| `lib/gap-compile.mjs` | Compile GAP profiles to CAW `mount_profiles` and per-mount policies (local only) |


Coding governance validation runs in `AEP-Subprotocols/coding-governance/` (Rust). GAP policies here declare **what** agents must do; the subprotocol enforces **domain actions** (`propose`, `siee_check`, `solidify`).

## GAP and CAW (execution-layer sandbox)

**GAP authors. CAW enforces.** They are not two policy stacks.

| | GAP | CAW (`aep-caw`) |
|---|-----|-----------------|
| Role | Instruction language: patterns, actions, trust rings, types | Host sandbox: file/command/network rules, shims, seccomp, LLM proxy |
| Source files | `policies/reference/*.gap` | Compiled into `$AEP_DATA/caw-framework/` |
| Operator surface | Edit `.gap`, run `gap-compile.mjs` | `aep-caw session create --profile <name>` |

### `coding-agent` profile (generic)

`caw-coding-agent.gap` at `dev.aep.caw/coding-agent.v1` is the default profile for **any governed coding agent** (Hermes, CCA runners, custom agents):

- `${PROJECT_ROOT}`: read-write
- `${AEP_AGENT_CONFIG_DIR}`, `${HOME}/.config/agent`, `${HOME}/.local/share/agent`: read-only
- Base policy `default`, trust ring `user`, LLM proxy enabled

Use `agent-sandbox` for untrusted code. Use `compiled-runtime` when the LLM proxy must stay off.

```bash
node lib/gap-compile.mjs --list-profiles
node lib/gap-compile.mjs --materialize /data/aep
aep-caw wrap --profile coding-agent -- <agent-binary>
```

## UCB task manifest (optional bridge)

UCB is optional. When used, foreign ingest requires a task manifest: caller-provided, stored, or from an explicitly configured synthesis tier. UCB does not invent fallback contracts.

Optional synthesis tiers (first success wins):

1. **GAP constrained decoding** (`UCB_GAP_ENGINE_URL`) - NLA internal / licensed customers
2. **Other constrained decoding** (`UCB_CONSTRAINED_DECODER_URL`) - e.g. dottxt-compatible HTTP services
3. **LLM structured output** (`UCB_LLM_SYNTHESIS_URL`)

GAP is a complete structural programming language for governed agency. An instruction is the atomic unit. Agents, workflows, validators, compositions and governance rules are all instructions. Instructions generate instructions. This is the native mechanism of growth and adaptation.


## First Principles

1. **Instructions are the primitive.** Everything is an instruction.
2. **Patterns guard, actions resolve.** Clear separation of condition and effect.
3. **Composition is native.** Atomic, sequence, conditional, loop, parallel, gate and abstraction are first-class.
4. **Self-generation is fundamental.** High-quality resolutions create new instructions.
5. **Governance is structural.** Trust, covenants, 
6. **Mathematical truth is enforced.** Physical and geometric invariants are native, validated by the lattice.
7. **Strongly typed at the logits level where possible, mathematically validated everywhere.** Simple types use constrained decoding. Complex types use native validators.
8. **Subprotocol-first composability.** Every domain is a first-class subprotocol with its own validators.
9. **Provenance and stability are tracked.** Every instruction carries its history, quality signals and proof chain.
10. **Self-sufficient with optional compatibility.** GAP enforces correctness natively through its own Meta-Schema and governance lattice. External tools may optionally be used as accelerators.
11. **Self-governing by construction.** Agents writing GAP instructions are constrained by the GAP Meta-Schema at the logits level. The language enforces itself. Incorrect GAP is not possible.

## Three-Layer Enforcement

GAP guarantees correctness through three independent, non-bypassable layers. No layer requires the LLM to have seen GAP during training.

| Layer | What It Prevents | When It Runs | Training Required |
|-------|-----------------|-------------|------------------|
| Layer 1: Constrained Decoding | Invalid YAML, unknown fields, wrong types, missing required fields, out-of-range values | During token generation (before each token is selected) | No |
| Layer 2: Structural Validation | Unresolved references, invalid constraints, composition cycles, type mismatches | After generation, before activation | No |
| Layer 3: Governance Lattice | Ring escalation, trust verification, covenant enforcement, proof chain validation | After validation, before activation | No |

Any LLM, trained on any corpus, produces valid governed GAP instructions. GAP's constraint engine eliminates invalid tokens from the decoding space. The lattice enforces governance policy deterministically.

## File Format

- Extension: `.gap`
- Encoding: UTF-8
- Syntax: Pure YAML 1.2
- One instruction per YAML document. Multi-instruction families use YAML multi-document syntax (`---` separators).
- No Markdown. No mixed formats. One parser reads the whole file.

## Quick Start

### Minimal Instruction

```yaml
address:
  domain: com.myorg.dev
  id: code-reviewer.v1

pattern: |
  Review pull requests for correctness, style and security.

action:
  type: structured
  schema: CodeReview
  structured_generation: true
  content: |
    You review pull requests for correctness, style and security.
    Every comment must reference a specific file and line number.

weight: 0.90

composition:
  type: atomic

metadata:
  provenance: "system.seed"
  version: "1.0.0"
  stability: stable
  grade: 8

execution:
  retry:
    max_attempts: 3
    backoff: exponential
  timeout_ms: 30000
  on_exhaustion: fail

types:
  CodeReview:
    format: json
    fields:
      summary: string
      issues_found: boolean
      verdict:
        type: enum
        values: [approve, request_changes, comment_only]
```

### With Governance

```yaml
metadata:
  trust_ring: user
  scanners: [pii, secrets, injection]
  covenants:
    - "every comment must reference a file and line number [hard]"
    - "verdict must be one of: approve, request_changes, comment_only [hard]"
  proof:
    sign: true
    algorithm: ed25519
    ledger: true
  budget:
    max_tokens: 30000
    max_cost: 0.50
```

### With Self-Generation

```yaml
composition:
  type: abstraction
  self_generate: true
  generation_constraints:
    max_variants: 10
    min_quality_threshold: 0.92
    lrt:
      enabled: true
      significance: 0.01
```

## Type System

GAP types go beyond JSON Schema. Mathematical types carry native validators:

| Type | Invariant | Validator |
|------|-----------|-----------|
| Vector2f/3f/4f | Per-component range | range_check |
| Quaternion | &#124;&#124;q&#124;&#124; = 1 within tolerance | unit_norm |
| Matrix3x3/4x4 | Symmetry, PSD, orthogonal, affine | matrix_check |
| Tensor | Shape, dtype, range, NaN/Inf rejection | tensor_integrity |
| AABB | min < max on all axes | aabb_valid |
| OBB | Half-extents > 0, rotation unit-norm | obb_valid |
| Frustum | Closed convex volume | frustum_check |

Two-phase enforcement: simple constraints at logits level (Phase 1), mathematical validators post-generation (Phase 2, lattice Step 3.5).

## Composition Model

Six native composition types:

| Type | Description |
|------|-------------|
| atomic | Single instruction, no dependencies |
| sequence | Execute in order, output of each feeds next |
| conditional | Branch based on runtime expression |
| loop | Repeat until condition met or iteration cap reached |
| parallel | Execute concurrently, merge by all/any/majority |
| abstraction | Parameterized instruction family with variant selection |

Pipeline operators for inline execution flow:

| Operator | Meaning |
|----------|---------|
| `→` | Pipe: output of left feeds input of right |
| `∥` | Parallel: execute concurrently, all must succeed |
| `>>` | Gate: pause for approval before continuing |

## Self-Generation

Instructions can spawn specialized children when resolution quality exceeds thresholds. Ten safety controls govern the process:

- **max_variants**: Hard cap on total children
- **min_quality_threshold**: Absolute quality floor
- **Covenant inheritance**: Child inherits all parent covenants, cannot weaken, can add new covenants (adding is strengthening)
- **Trust reduction**: Child trust = parent trust minus `fleet.spawn.trust_reduction`
- **Ring ceiling**: Child ring cannot exceed `fleet.spawn.ring_ceiling`
- **Stability ladder**: experimental → beta → stable with execution minimums
- **Variant pruning**: Lowest-weight variant deprecated before new creation
- **Drift detection**: Lattice Step 5 output distribution check
- **Proof chain**: Full ancestry traceable
- **Recursion depth**: `max_generation_depth` (default 3)

### Statistical Self-Generation (v1.1)

The likelihood ratio test (LRT) replaces the threshold-only trigger with a formal hypothesis test:

- H0: One instruction is sufficient (all classes share quality distribution)
- H1: Specialization needed (class C has significantly different quality)

The LRT answers: is the quality difference real or noise ? Only statistically significant deviations trigger child creation. The `min_quality_threshold` remains as an absolute floor.

## Weight Estimation via MLE (v1.1)

Static weights degrade over time. MLE estimates the true weight from execution history:

```
weight_effective = argmax_θ L(θ | execution_data)
```

The lattice tracks (input_class, verdict, quality_score) per instruction. After `min_samples` executions, the static weight is replaced by the data-driven estimate. Weight self-corrects: degrading instructions drop automatically.

## Latent Governance Inference (v1.1)

Covenants are written by authors but some governance preferences emerge only from observed rejections. Latent governance inference observes rejection patterns and proposes covenants:

- Tracks (rejection_step,  input_class) per instruction
- Proposes a covenant when rejection rate exceeds threshold
- Proposals are tagged `provenance: "latent"`
- Default: proposals require human or gate approval before activation (`auto_apply: false`)
- Configurable: set `auto_apply: true` to activate latent covenants automatically when statistical confidence is met

```yaml
metadata:
  latent_governance:
    enabled: true
    rejection_threshold: 0.15
    min_observations: 50
    auto_apply: false
```

## Governance

Every instruction carries governance inline:

| Field | Description |
|-------|-------------|
| trust_ring | sandbox (Ring 3), user (Ring 2), system (Ring 1), enterprise (Ring 0) |
|  Injection, Secrets, Jailbreak, Toxicity, URL, Data Profiler, Prediction, Brand, Regulatory, Temporal |
| covenants | Behavioural constraints with `[hard]` or `[soft]` severity |
| budget | Token and cost limits enforced at lattice Step 10 |
| proof | Signed proof bundles with Ed25519 or ML-DSA-65 signatures |
| fleet | Multi-instance governance with spawn policy |
| knowledge | Scoped knowledge base with anti-context-rot |
| tools | Allowed and forbidden tool lists |
| aspect | Classification label (`objective`, `subjective`, `procedural`, `heuristic`) used by lattice Step 5 for intent drift detection |

The 15-step deterministic evaluation chain validates every instruction action. Same input, same governance state, same result.

## Structured Generation

For json, yaml and text format types, the constraint engine compiles the type definition into a constraint mask. GAP enforces this mask natively.

When external decoding engines are available, GAP's normalized constraint mask can optionally be delegated to them as accelerators. This is a performance optimization, not a requirement.

**Compatible external engines (optional):**

| Engine | Constraint Method |
|--------|-----------|
| Outlines | JSON Schema, regex, CFG at logits level |
| xgrammar | Grammar-constrained decoding |
| vLLM | Server-side schema constraint |
| llama.cpp | GGUF grammar mode |
| Provider-native | OpenAI structured outputs, Anthropic tool_use |

GAP does not depend on any of these. Without them, GAP's own constraint engine, validator and lattice provide the same correctness guarantees.

## Subprotocols

Domain-specific validators loaded at lattice Step 3.5:

| Subprotocol | Domain |
|-------------|--------|
| ui | AEP scene graph, z-bands, skin bindings |
| workflows | State machines, phase verdicts, approval gates |
| rest-api | HTTP methods, endpoints, schemas |
| events | Topics, payloads, producer permissions |
| iac | K8s, Terraform, CI/CD |
| commerce | Cart, checkout, payment, fulfillment |
| tensor | Shape, dtype, range, NaN/Inf, PSD |
| molecular | Atom types, valence, bond types, ring topology |
| drone | Waypoints, altitude bands, sensor modes |
| robotics | Joint angles, torques, end-effector, collision zones |
| material-science | Crystal symmetries, alloy compositions, phase constraints |

## structural Toolchain

`.gap` files are directly executable via `structural run`. Validation and lattice checks run inline at load time.

## structural Commands

```
structural compile <file.gap>                    # Compile to canonical artifacts
structural compile gap-instructions/             # Compile all instructions
structural lint                                  # Static analysis and warnings
structural graph                                 # Visualize instruction dependency graph
structural run <file.gap>                        # Execute an instruction
structural test <file.gap> <dataset>             # Test against a dataset
structural export <adapter> <file.gap>           # Export via adapter (n8n, rego, jsonschema)
structural subprotocol register <name> <path>    # Register custom subprotocol
structural validator register <name> <path>      # Register custom validator
structural adapter register <name> <path>        # Register custom export adapter
```

## Adoption Ladder

Migrate incrementally. Each rung adds governance without rewriting existing logic.

| Rung | What You Get | Entry Point |
|------|-------------|------------|
| 1: Structured Generation | Schema enforcement via GAP constraint engine | Raw prompts |
| 2: Types and Constraints | Mathematical type validation | JSON Schema / dottxt users |
| 3: Covenants and Scanners | Behavioural governance + content scanning | LangChain / LangGraph users |
| 4: Composition | Sequence, conditional, parallel orchestration | n8n / Zapier users |
| 5: Self-Generation | Automatic specialization from quality data | Any production pipeline |
| 6: Full Governance | Trust rings, proof bundles, 15-step lattice | Production-grade governed agency |

## Repository Files

| File | Description |
|------|-------------|
| `GAP v1 spec sheet.md` | Full language specification. The authority. |
| `GAP meta schema v1.json` | JSON Schema 2020-12. The Layer 1 constraint mask artifact. |
| `GAP meta schema v1.2.json` | Updated meta schema with v1.1 additions (LRT, MLE, latent governance). |
| `README.md` | This file. |
| `BIOSECURITY.md` | AI-eligibility status notice. |

## Research

GAP is backed by formal proofs published in Research Paper 002: https://github.com/thePM001/GAP-research-paper-002

- **No-Bypass Theorem**: Under sound constrained decoding, structurally invalid GAP documents are never produced. Bypass probability is exactly zero.
- **Self-Governance Fixed Point**: Child instructions generated through self-generation remain structurally valid and satisfy monotonic governance constraints.
- **Composition Preservation**: Six composition operators cannot bypass runtime governance.
- **Type Soundness**: Well-typed instructions produce type-conformant outputs or structured errors.

## Comparison: GAP vs dottxt

dottxt constrains tokens to match JSON Schema, regex or CFG at the logits level. That is the entirety of what it does. It is a structural constraint tool.

GAP is a complete programming language. It handles structural constraints natively through its own constraint engine and additionally provides:

- Mathematical types with native validators (Quaternion, Tensor, Matrix3x3)
- 15-step deterministic evaluation chain
- Trust scoring, execution rings, behavioural covenants
- Signed proof bundles with post-quantum signatures
- Self-generating instructions that evolve specialized variants
- Statistical self-generation (LRT) and weight estimation (MLE)
- Latent governance inference from rejection patterns
- 12 domain subprotocols
- Six composition primitives with pipeline operators
- Agent fleet governance, knowledge base, perception governance

dottxt's structural constraint capability is equivalent to one action flag in GAP: `structured_generation: true`. GAP does everything dottxt does and everything dottxt cannot do. 

## References

| Resource | URL |
|----------|-----|
| AEP (Agent Element Protocol) | https://github.com/thePM001/AEP-agent-element-protocol |
| dynAEP (Dynamic Agent Element Protocol) | https://github.com/thePM001/dynAEP-dynamic-agent-element-protocol |
| AEP Research Paper 001 | https://github.com/thePM001/AEP-research-paper-001 |
| GAP Research Paper 002 | https://github.com/thePM001/GAP-research-paper-002 |
| AEP Live Demo | Configure your deployment URL |

## License

Apache-2.0

---

*GAP: Governed Agentic Programming. Language Specification v1.1. Part of the Agent Element Protocol ecosystem. Author: thePM_001*

## AI-Eligibility Status
To win the fight against the synthetic nano-parasites (SNP/NanoSinp) alien WMD, we must be intelligent and biosecure. It is recommended that bioinsecure humans do not use the provided technology/protocol to avoid bad techno-spiritual AI outcomes for them. [*"bioinsecure" = has installed injectable synthetic nano-parasites growth medium controllers - SNP GMCs]
