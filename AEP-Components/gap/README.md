# GAP: Governed Agentic Programming

GAP is the native instructions language for governed agency in the Agent Element Protocol and an instruction is the atomic unit so agents, workflows, validators, compositions and governance rules are all instructions that generate further instructions.

Live evaluation follows AEP 2.8.5: seal a lattice-channel capsule, freeze the clock at seal, wait 1000 ms, run every check together as collect-all Admit and then Apply the allowed action. After the wait the client collects by capsule hash and live AEP 2.8.5 EPSCOM trust bundle mode is sha256-structure while rank rings are not the Admit floor.

## AEP 2.8 vendor tree

This tree vendors classic GAP into `AEP-Components/gap/` from github.com/thePM001/gap.

- `schemas/` holds GAP meta-schema v1 and v1.2 as Layer 1 authoring constraint masks.
- `policies/reference/` holds reference `.gap` instructions for coding governance, CAW sandbox profiles, task manifests and implementation plans.
- `lib/gap-compile.mjs` compiles GAP profiles to CAW mount_profiles and per-mount policies for local use.
- Coding governance validation runs in `AEP-Subprotocols/coding-governance/` in Rust.
- GAP policies here declare what agents must do.
- The subprotocol enforces domain actions propose, siee_check and solidify.
- GAP authors instructions and CAW enforces the host sandbox so they are not two policy stacks.
- Operators edit `.gap` and run `gap-compile.mjs` then `aep-caw session create --profile <name>`.
- `caw-coding-agent.gap` at `dev.aep.caw/coding-agent.v1` is the default profile for a governed coding agent.
- `${PROJECT_ROOT}` is read-write.
- `${AEP_AGENT_CONFIG_DIR}`, `${HOME}/.config/agent` and `${HOME}/.local/share/agent` are read-only.
- The base policy is `default` with agent_may grants and the LLM proxy enabled.
- Use `agent-sandbox` for untrusted code and `compiled-runtime` when the LLM proxy must stay off.
- Compile with `node lib/gap-compile.mjs --list-profiles` or `node lib/gap-compile.mjs --materialize /data/aep` then wrap with `aep-caw wrap --profile coding-agent`.
- UCB is optional. Foreign ingest needs a task manifest that is caller-provided, stored or from an explicitly configured synthesis tier.
- File format notes live at http://100.118.184.18:3003/thePM001/NLA-AEP-v2.8-open-source/src/branch/main/AEP-Components/gap/FILE-FORMAT.md

## Three-layer enforcement

GAP guarantees correctness through three independent layers and no layer requires the LLM to have seen GAP during training.

- Authoring a `.gap` file is an instruction write and Layer 3 Admit runs after a sealed capsule.
- Layer 1 constrained decoding is an authoring gate during token generation.
- Layer 2 structural validation runs after generation at load.
- Layer 3 Base Node kernel is closed-wall collect-all Admit after freeze-at-seal and the 1000 ms kernel pulse, then Apply.
- Any LLM can author valid governed GAP instructions.
- The constraint engine removes invalid tokens from the decoding space.
- The lattice enforces policy together after the kernel pulse.

## Live evaluation

The AEP 2.8.5 live path seals a lattice-channel capsule, freezes the clock at seal and waits 1000 ms for the compiled Base Node kernel pulse. Every check then runs together as collect-all Admit and the allowed action is Applied.

- `PULSE_MS` is a kernel constant rather than a dynAEP YAML key.
- Putting a capsule on the dock is a transport step.
- After the wait the client collects by capsule hash.
- A closed-wall close names the closed walls, the reasons and a prescribed repair for missing fields and writing.
- Grant lists stay off that repair.
- A retry must seal a new capsule.
- Skip is not a live verb.
- All applicable walls are judged together.
- If two walls fail both are listed and row order does not change yes or no.
- Writing and security are always-on stems and they evaluate on every action path.
- Other GAP walls bind to a wrap or prefix.

### Derived fifteen-row ledger

Fifteen named rows are a derived ledger of that evaluation and the ledger is a forensic record written from the check.

- Row 0 Task scope: action within subtask scope.
- Row 1 Session state: session active and valid.
- Row 2 Who may act: agent_may, this agent is written as allowed to do this action.
- Row 3 System rate limit: planetwide cap not exceeded.
- Row 4 Session rate limit: per-session cap not exceeded.
- Row 5 Intent drift: action aligns with baseline behaviour.
- Row 6 Escalation: higher authority required.
- Row 7 Covenant evaluation: permit, forbid and require rules.
- Row 8 Pattern check: environment forbidden patterns.
- Row 9 Capability: written capabilities. Who-may stays agent_may. A numeric trust score is evidence on the derived ledger.
- Row 10 Budget: token, cost and time limits.
- Row 11 Gate: human or webhook approval.
- Row 12 Cross-agent: counterparty identity handshake.
- Row 13 Knowledge: covenant-scoped retrieval.
- Row 14 Scanners: content scanners, lattice and perception bounds.
- Attractors stay forensic records on that derived ledger rather than live Admit skips.

### Kernel pulse

Pulse hold is the wait after a sealed capsule is opened. Base Node freezes the clock at seal, waits 1000 ms, then runs every check together and only then carries out the allowed action.

- Allowed clock drift is 50 ms against the freeze.
- A capsule held longer than five seconds is aged out.
- Wire `sent_at` freshness is a separate clock before open.
- The wire window is wider because it covers transit.
- Pulse age covers hold after freeze.
- A builder who wants a different wait rebuilds Base Node with a different compiled pulse length.
- Freeze-at-seal stays.
- Allowed drift stays independent of the wait length.
- Pulse age stays longer than the wait.
- Unbound scene, dock, timestamp or sequence closes Admit because those fields must be bound before collect-all.

### Live trust bundle

- Live AEP 2.8.5 EPSCOM trust bundle mode is sha256-structure.
- Optional proof algorithms may still name Ed25519 or ML-DSA-65.
- The signatures loader denies an ML-DSA claim on sha256-structure.
- Signed proof is not the default live AEP 2.8.5 attach.
- Collect-all Admit collects by capsule hash on that same path.
- Rank rings are not the Admit floor.
- `trust_ring` is a documentary label on classic v1 and v1.2.
- Rank use warns then denies while who-may stays `agent_may`.

## File format

Keep `.gap` as GAP source because collect-all Admit collects by capsule hash and live hash bundle mode on that path is sha256-structure.

- File format notes also live at http://100.118.184.18:3003/thePM001/NLA-AEP-v2.8-open-source/src/branch/main/AEP-Components/gap/FILE-FORMAT.md
- Extension: `.gap`
- Encoding: UTF-8
- Syntax: YAML 1.2 source. Live kernel policies may be JSON-encoded GAP instructions. YAML remains valid GAP source. The kernel reads the instruction object not the skin.
- One instruction per document. Multi-instruction families use YAML multi-document syntax (`---` separators).
- Keep `.gap` as GAP source.
- Collect-all Admit collects by capsule hash. Live AEP 2.8.5 EPSCOM trust bundle mode is sha256-structure.
- Writing and security are always-on stems and they evaluate on every action path.
- Other GAP walls bind to a wrap or prefix.
- A finance wrap GAP item does not close an inventory wrap ping.
- A non-always-on GAP with empty wrap does not fold onto every event.
- Kernel bind detail lives at http://100.118.184.18:3003/thePM001/GAP/src/branch/main/docs/kernel-json-wrap.md

### YAML GAP source

> ```yaml
> address:
>   domain: com.example.finance
>   id: pay.v1
> pattern:
>   guard: true
> action:
>   type: template
>   content: pay
> weight: 1.0
> composition:
>   type: atomic
> metadata:
>   provenance: "system.seed"
>   version: "1.0.0"
>   stability: experimental
>   wrap: finance
>   agent_may:
>     - finance.pay
> ```

### JSON-encoded kernel policy

AEP 2.8.5 reference policies are JSON objects with pattern.guard and the same instruction fields. The source below is legal GAP because the kernel reads the instruction object not the skin.

> ```json
> {
>   "address": {"domain": "aep.reference.writing", "id": "conventions.v1"},
>   "pattern": {"guard": "true"},
>   "action": {"type": "reference"},
>   "weight": 1.0,
>   "composition": {"type": "atomic"},
>   "metadata": {"provenance": "AEP 2.8.5", "version": "1.0.0", "stability": "stable"}
> }
> ```

## First example

### Minimal instruction

> ```yaml
> address:
>   domain: com.myorg.dev
>   id: code-reviewer.v1
> pattern: |
>   Review pull requests for correctness, style and security.
> action:
>   type: structured
>   schema: CodeReview
>   structured_generation: true
>   content: |
>     You review pull requests for correctness, style and security.
>     Every comment must reference a specific file and line number.
> weight: 0.90
> composition:
>   type: atomic
> metadata:
>   provenance: "system.seed"
>   version: "1.0.0"
>   stability: stable
>   grade: 8
>   agent_may:
>     - review.pull_request
> execution:
>   retry:
>     max_attempts: 3
>     backoff: exponential
>   timeout_ms: 30000
>   on_exhaustion: fail
> types:
>   CodeReview:
>     format: json
>     fields:
>       summary: string
>       issues_found: boolean
>       verdict:
>         type: enum
>         values: [approve, request_changes, comment_only]
> ```

- Instruction-runtime retry lives on the instruction.
- Live Admit is collect-all after the kernel pulse.

### With governance

> ```yaml
> metadata:
>   agent_may:
>     - review.pull_request
>   wrap: governance
>   scanners:
>     - pii
>     - secrets
>     - injection
>   covenants:
>     - "every comment must reference a file and line number [hard]"
>     - "verdict must be one of: approve, request_changes, comment_only [hard]"
>   proof:
>     sign: true
>     algorithm: ed25519
>     ledger: true
>   budget:
>     max_tokens: 30000
>     max_cost: 0.50
> ```

- The proof.algorithm field names an optional proof algorithm.
- Live AEP 2.8.5 EPSCOM trust bundle mode is sha256-structure so Ed25519 and ML-DSA-65 stay optional rather than the default live bundle.
- Who-may is `agent_may` so Agent A may X and Agent B may Y.
- Empty grants close an agent action when the grant list is empty.
- `trust_ring` is a documentary label on classic v1 and v1.2.
- Rank rings are not the Admit floor.
- Rank use warns then denies while who-may stays `agent_may`.
- `enabled` is load-time: when false the instruction is still loaded and live Admit still evaluates walls.
- A closed-wall close names the closed walls, the reasons and a prescribed repair.
- A retry must seal a new capsule.

### With self-generation

> ```yaml
> composition:
>   type: abstraction
>   self_generate: true
>   generation_constraints:
>     max_variants: 10
>     min_quality_threshold: 0.92
>     lrt:
>       enabled: true
>       significance: 0.01
> ```

## Governance

- Every instruction carries governance inline.

- agent_may: who-may grants. Agent A may X. Agent B may Y.
- wrap: lattice wrap or action path prefix this wall binds to. Writing and security stay always on.
- action_path_prefix: action path prefix this wall binds to.
- scanners: PII, Injection, Secrets, Jailbreak, Toxicity, URL, Data Profiler, Prediction, Brand, Regulatory and Temporal.
- covenants: behavioural constraints with `[hard]` or `[soft]` severity.
- budget: token and cost limits recorded on the derived ledger.
- proof: live AEP 2.8.5 EPSCOM trust bundle mode is sha256-structure. Optional proof algorithms may name Ed25519.
- fleet: multi-instance governance with spawn policy.
- knowledge: scoped knowledge base with anti-context-rot.
- tools: allowed and forbidden tool lists.
- aspect: classification label used on the derived-ledger intent-drift row.
- Same sealed bytes plus same governance state is replay and replay is keyed by capsule hash.

## GAP toolchain

This vendor tree holds classic GAP source under `AEP-Components/gap/` and `.gap` files stay GAP source.

- Live Admit still waits for freeze-at-seal, the 1000 ms kernel pulse and collect-all walls.
- Who-may is agent_may.
- Rank rings are not the Admit floor.
- Live AEP 2.8.5 EPSCOM trust bundle mode is sha256-structure.
- Compile CAW profiles with `lib/gap-compile.mjs`.
- The live classic GAP binary gap-schema-profile-v13 lives on thePM001/GAP and is not copied into this vendor tree.
- This snapshot does not ship `gapc` and there is no `structural` CLI here.

## GAP commands

> ```
> node lib/gap-compile.mjs --list-profiles
> node lib/gap-compile.mjs --materialize /data/aep
> aep-caw wrap --profile coding-agent
> ```

## Adoption ladder

Migrate incrementally because each rung adds governance without rewriting existing logic.

- Rung 1 Structured generation: schema enforcement via GAP constraint engine during authoring.
- Rung 2 Types and constraints: mathematical type validation.
- Rung 3 Covenants and scanners: behavioural governance plus content scanning.
- Rung 4 Composition: sequence, conditional, parallel orchestration.
- Rung 5 Self-generation: automatic specialization from quality data.
- Rung 6 Full governance: agent_may, sha256-structure, collect-all Admit then Apply.

## Repository files

This OSS snapshot does not include `GAP v1 spec sheet.md` or `BIOSECURITY.md` because those files live in the GAPLUNE tree and are not copied here.

- `README.md` is this file. It teaches live evaluation plus vendor compile notes.
- `FILE-FORMAT.md` holds file format notes. Keep `.gap` as GAP source. Collect-all Admit collects by capsule hash. Live hash bundle mode is sha256-structure. Rank rings are not the Admit floor.
- `schemas/gap-meta-schema-v1.json` is the JSON Schema 2020-12 Layer 1 constraint mask artifact.
- `schemas/gap-meta-schema-v1.2.json` is the updated meta schema with v1.1 additions.
- `policies/reference/` holds reference `.gap` instructions for CAW profiles and coding governance.
- `lib/gap-compile.mjs` compiles GAP profiles to CAW mount_profiles.
- Fit analysis of classic GAP against AEP 2.8.5 evaluation is at http://100.118.184.18:3003/thePM001/GAP/src/branch/main/docs/CLASSIC-GAP-VS-AEP-2.8.5.md
- Product tickets live as `.gap` source under docs/dev-tickets/.

## Comparison: GAP vs dottxt

dottxt constrains tokens to match JSON Schema, regex or CFG at the logits level and that structural constraint work is the entirety of what it does. GAP is a complete programming language that handles structural constraints natively through its own constraint engine and additionally provides the live evaluation path.

- Mathematical types with native validators
- Collect-all Admit then Apply after freeze-at-seal and the 1000 ms kernel pulse
- A derived fifteen-row ledger of that evaluation
- agent_may who-may grants
- Behavioural covenants
- Live AEP 2.8.5 EPSCOM trust bundle mode is sha256-structure with optional proof algorithms
- Self-generating instructions that evolve specialized variants
- dottxt's structural constraint capability is equivalent to one action flag in GAP: `structured_generation: true`
- GAP covers that authoring gate plus live collect-all Admit

## License

- License Apache-2.0. GAP is Governed Agentic Programming, language specification v1.1 aligned to AEP 2.8.5 live evaluation, part of the Agent Element Protocol ecosystem, author thePM_001.

## AI-eligibility status

To win the fight against the synthetic nano-parasites (SNP/NanoSinp) alien WMD, we must be intelligent and biosecure. It is recommended that bioinsecure humans do not use the provided technology/protocol to avoid bad techno-spiritual AI outcomes for them. [*"bioinsecure" = carries injectable synthetic nano-parasites growth medium controllers - SNP GMCs]
