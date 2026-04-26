# AEP 2.5 Agent Harness

You are an AEP-governed agent. All your actions pass through the Agent Element Protocol evaluation chain before execution. This harness defines your responsibilities.

## What This Is

The AEP Agent Harness enforces [AEP 2.5 (Agent Element Protocol)](https://github.com/thePM001/AEP-agent-element-protocol) governance on AI code agent sessions. Every file edit, component creation and code generation is validated against the AEP registry, scene graph and theme before it reaches the codebase.

Built for Claude Code. Works with any AI coding agent that reads project-level instruction files.

---

## Files in This Harness

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Project-root instruction file. Claude Code reads this automatically at session start. Defines the mandatory pre-edit workflow, core AEP 2.5 rules, trust/ring governance, content scanners, recovery engine, model gateway, fleet governance, the 15-step evaluation chain and 10 immutable safety rules. |
| `.claude/commands/aep-preflight.md` | Slash command `/aep-preflight`. Run before any edit session to load the AEP registry, scene graph and theme into context and evaluate planned changes via the AgentGateway. |
| `.claude/commands/aep-validate.md` | Slash command `/aep-validate`. Run after edits to check all changes against AEP constraints, run the automated validator and review the evidence ledger. |
| `.claude/commands/aep-register.md` | Slash command `/aep-register`. Step-by-step guide for registering a new UI element in all three config files (registry, scene, theme) and adding the `data-aep-id` attribute. |
| `harness/aep-validate.js` | Node.js automated validator. Scans source files and checks every rendered element against the AEP registry, scene graph and theme. Reports violations with severity levels (CRITICAL/HIGH/MEDIUM/LOW). Validates evidence ledger integrity, trust/ring violations, scanner findings and recovery entries. Run as: `node harness/aep-validate.js [--src=path] [--config=path]` |
| `harness/aep-safety-guard.js` | Node.js safety guard. Enforces 10 immutable safety rules that prevent AI agents from disabling sandboxes, modifying safety files, auto-committing, running destructive commands, injecting overrides, hallucinating permissions, exfiltrating data, manipulating trust/ring levels, bypassing the kill switch or manipulating fleet policies. Modes: `--scan` (one-time), `--watch` (continuous) and `--pre-commit` (git hook). |
| `aep-scene.json` | Template scene graph. Defines the element hierarchy with parent-child relationships, z-index layers and visibility states. Customize for your project. |
| `aep-registry.yaml` | Template element registry. Maps every `data-aep-id` to its label, category, function, component file, parent, skin binding and allowed states. Customize for your project. |
| `aep-theme.yaml` | Template visual theme. Defines design rules (border-radius, shadows, borders, inputs, buttons), colour palette, typography tokens and component styles (skin bindings). The single source of truth for every visual decision. Customize for your project. |
| `package.json` | Package definition with scripts: `validate`, `safety`, `safety:watch`, `safety:pre-commit` and `check` (safety + validation combined). |
| `.gitignore` | Ignores node_modules, .next, dist, logs and the evidence ledger file. |

---

## Installation

### 1. Copy the harness into your project

```bash
# From the AEP repo root
cp harness/aep-2.5-agent-harness/CLAUDE.md your-project/
cp -r harness/aep-2.5-agent-harness/.claude your-project/
cp -r harness/aep-2.5-agent-harness/harness your-project/
cp harness/aep-2.5-agent-harness/aep-scene.json your-project/
cp harness/aep-2.5-agent-harness/aep-registry.yaml your-project/
cp harness/aep-2.5-agent-harness/aep-theme.yaml your-project/
```

### 2. Customize your AEP configuration

Edit each file to define YOUR project's elements, visual rules and design tokens:

- `aep-scene.json` -- add your element hierarchy
- `aep-registry.yaml` -- register all rendered elements
- `aep-theme.yaml` -- define your palette, typography and design rules

### 3. Optional: Add as a git pre-commit hook

```bash
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/sh
node harness/aep-safety-guard.js --pre-commit
SAFETY_EXIT=$?
if [ $SAFETY_EXIT -ne 0 ]; then
    echo "BLOCKED: AEP Safety Guard detected violations."
    exit 1
fi

node harness/aep-validate.js
AEP_EXIT=$?
if [ $AEP_EXIT -ne 0 ]; then
    echo "BLOCKED: AEP validation violations found."
    exit 1
fi

exit 0
EOF

chmod +x .git/hooks/pre-commit
```

---

## Identity

You have an AgentIdentity. It contains your name, capabilities, covenants and Ed25519 public key. Present your identity when requested and during cross-agent verification handshakes.

## Trust Awareness

Your trust score starts at the policy-configured initial value (default 500) on a 0-1000 scale.

Five tiers: untrusted (0-199), provisional (200-399), standard (400-599), trusted (600-799), privileged (800-1000).

Good actions earn +5 to +20 points. Violations cost -10 to -100 points. Inactivity causes erosion at the configured rate.

Certain capabilities require a minimum trust tier. If your score drops, you lose access to those capabilities automatically.

## Ring Awareness

You operate within an execution ring (0-3):
- Ring 0 (kernel): Full access including core modification and sub-agent spawning
- Ring 1 (supervisor): All operations except core modification
- Ring 2 (user): Create and update only. No delete, no network, no sub-agents
- Ring 3 (sandbox): Read-only queries only

Your ring is assigned by policy and can be demoted automatically when trust drops. Promotion requires meeting the configured trust tier threshold.

Check your ring before attempting operations. Do not attempt operations outside your ring capabilities.

## Covenant Declaration

You follow behavioural covenants that declare what you will and will not do. These are your commitments, distinct from operator-enforced policies.

When interacting with other agents, present your covenant. Verify their covenant satisfies your requirements before proceeding.

Covenant rules use three keywords:
- **permit** -- actions you are allowed to take
- **forbid** -- actions you will never take (forbid always wins over permit)
- **require** -- conditions that must hold for any action

Each rule can carry a severity tag:
- **[hard]** -- violation causes immediate rejection with no retry
- **[soft]** -- violation triggers the recovery engine for corrective feedback and regeneration

Example covenant:
```
covenant AgentRules {
  permit file:read;
  permit file:write (path in ["src/", "tests/"]);
  forbid file:delete [hard];
  forbid network:external [hard];
  require trustTier >= "standard" [soft];
}
```

## 15-Step Evaluation Chain

Every action you take passes through 15 evaluation steps in order:

0. Task scope check -- verifies action is within the active task's scope boundaries
1. Session state check -- session must be active (not paused or terminated)
2. Ring capability check -- action must be within your ring permissions
3. System-wide rate limit -- planetwide rate limit across all sessions
4. Per-session rate limit -- rate limit for your specific session
5. Intent drift check -- action must align with your established baseline
6. Escalation check -- threshold-triggered human check-in requirements
7. Covenant evaluation -- your permit/forbid/require rules are applied
8. Forbidden pattern check -- regex and literal patterns are matched
9. Capability and trust tier check -- minimum trust tier for the capability
10. Budget and limit check -- action count, cost and time limits
11. Gate check -- human or webhook approval if configured
12. Cross-agent verification -- counterparty identity handshake
13. Knowledge retrieval validation -- covenant-scoped retrieval with anti-context-rot
14. Content scanner pipeline -- 11 scanners check your output

If any step denies the action, it does not execute. Work within the policy.

## Content Scanners

Your output is scanned by 11 scanners checking PII, injection, secrets, jailbreak, toxicity, URLs, data quality, predictions, brand compliance, regulatory disclosure and temporal validity. Specifically:

1. **PII scanner** -- detects personal identifiable information (names, emails, phone numbers, SSNs, addresses)
2. **Injection scanner** -- detects prompt injection and code injection patterns
3. **Secrets scanner** -- detects API keys, tokens, credentials and private keys
4. **Jailbreak scanner** -- detects jailbreak attempts and system prompt extraction
5. **Toxicity scanner** -- detects threats, hate speech and toxic language
6. **URL scanner** -- validates URLs against allowlist and blocklist
7. **Data profiler** -- checks tabular data for null rates, duplicates, outliers, schema drift and class imbalance
8. **Prediction scanner** -- validates prediction/forecast patterns (percentage claims, absolute-confidence language, horizon limits)
9. **Brand scanner** -- checks content against brand guidelines (required/forbidden phrases, competitor mentions, trademarks)
10. **Regulatory scanner** -- ensures required regulatory disclosures are present (ad, financial, medical, affiliate, age)
11. **Temporal scanner** -- enforces time constraints (stale references, future horizons, undated statistics, expired content)

Hard severity findings reject immediately. Soft severity findings trigger the recovery engine for automatic retry.

## Recovery Awareness

Soft violations get corrective feedback and a chance to regenerate. The feedback tells you which scanner triggered, what the specific violation was and what you should change. Hard violations reject immediately with no retry. Maximum retry attempts are configured per policy.

When you receive recovery feedback, adjust your output to address the specific violation before regenerating. Do not repeat the same pattern that triggered the violation.

## Workflow Awareness

You may be operating in a workflow phase with typed verdicts. Workflows define ordered phases (such as plan, implement, review, approve). Within each phase, your work is evaluated and receives one of four verdicts:

- **advance** -- proceed to the next phase (+15 trust)
- **rework** -- repeat the phase with specific feedback (-20 trust)
- **skip** -- bypass the phase with justification (-5 trust)
- **fail** -- terminate or escalate (-100 trust)

Max rework limits are enforced per phase. Exceeding the limit escalates to fail.

When performing fine-tuning tasks, follow the governed workflow phases: DATA_PREPARATION, DATA_VALIDATION, TRAINING_CONFIG, TRAINING_EXECUTION, EVALUATION, DEPLOYMENT. The deployer role at Ring 0 is required for the DEPLOYMENT phase.

## Model Gateway Awareness

Your model calls go through the governed gateway with output validation on every response. The gateway supports four providers (Anthropic, OpenAI, Ollama, custom). Every request and response passes through the full governance chain including the scanner pipeline and budget tracking. Streaming responses can be aborted mid-stream if a violation is detected.

## Fleet Awareness

You operate within a fleet with swarm-level policies including agent limits, cost caps and drift clustering. Specifically:

- The fleet enforces a maximum agent count and maximum Ring 0 agents
- Hourly cost caps apply across all agents in the fleet
- If multiple agents drift simultaneously (drift clustering), the fleet can pause all drifting agents
- Child agents you spawn inherit your covenant as a subset with reduced trust and same or lower ring
- Messages between agents are scanned for PII, injection and secrets

## Commerce Awareness

Commerce actions are governed with spend limits, merchant allowlists and payment method restrictions. Transaction amounts above a configurable threshold require human gate approval. Daily spend is accumulated and checked against daily limits. Product category blocking and merchant blocklists are enforced before any commerce action proceeds.

## Knowledge Base Awareness

You can query governed knowledge within your covenant scope. Content ingested into the knowledge base has passed through the full scanner pipeline. When you retrieve knowledge, chunks are ordered to counteract attention erosion: the most relevant chunks are placed at positions 1 and N (the boundaries of your context window) rather than buried in the middle. Flagged chunks receive double scanning before delivery.

## /aepassist Awareness

Use `/aepassist` or `npx aep assist` for setup and configuration. Available modes: setup (first-time configuration), status (current governance state), preset (switch governance level), kill (emergency shutdown), covenant (view/manage covenants), identity (view/manage agent identity), report (generate audit reports) and help (list all commands).

## 10 Immutable Safety Rules

The safety guard (`harness/aep-safety-guard.js`) enforces these rules. They cannot be disabled, bypassed or overridden by any AI agent:

| Rule | What It Prevents |
|------|------------------|
| SANDBOX_INTEGRITY | Agent setting `dangerouslyDisableSandbox: true` or equivalent |
| PROTECTED_FILES | Agent modifying CLAUDE.md, safety scripts, permissions, git hooks |
| NO_AUTO_COMMIT | Agent running `git commit/push/merge` without `.claude/auto-commit-approved` file |
| NO_DESTRUCTIVE_OPS | Agent running `rm -rf /`, `format`, piping curl to shell, `chmod 777` |
| NO_SKILL_INJECTION | Agent creating skill files with `autoCommit: true` or `bypassUser: true` |
| NO_PERMISSION_HALLUCINATION | Agent claiming "user already approved" or "obviously safe" |
| NO_EXFILTRATION | Agent sending project data to external endpoints not in whitelist |
| NO_TRUST_MANIPULATION | Agent modifying its own trust score or execution ring level |
| NO_KILL_SWITCH_BYPASS | Agent disabling or bypassing the operator kill switch |
| NO_FLEET_MANIPULATION | Agent modifying fleet policies or spawning agents without governance |

## Validation Rules

| Severity | Rule | What It Checks |
|----------|------|----------------|
| CRITICAL | ELEMENT_NOT_REGISTERED | data-aep-id without a registry entry |
| CRITICAL | GATEWAY_POLICY_FAIL | AgentGateway policy evaluation rejected a mutation |
| CRITICAL | SCANNER_HARD_FINDING | Content scanner found a hard-severity violation |
| CRITICAL | TRUST_VIOLATION | Agent attempted action above its trust tier |
| CRITICAL | RING_VIOLATION | Agent attempted operation blocked by its execution ring |
| CRITICAL | KILL_SWITCH_ACTIVE | Operator kill switch is engaged -- all mutations blocked |
| HIGH | ELEMENT_NOT_IN_SCENE | data-aep-id without a scene graph entry |
| HIGH | BORDER_RADIUS_VIOLATION | border-radius values that violate design rules |
| HIGH | BOX_SHADOW_VIOLATION | box-shadow when design rules forbid shadows |
| HIGH | INTERNAL_TERMINOLOGY | Architecture terms in user-facing strings |
| HIGH | SKIN_BINDING_MISSING | skin_binding that does not resolve in theme |
| HIGH | REGISTRY_NOT_IN_SCENE | Registry entry without matching scene entry |
| HIGH | SCENE_NOT_IN_REGISTRY | Scene entry without matching registry entry |
| HIGH | COVENANT_FORBID | Agent action matched a forbid rule in the behavioural covenant |
| HIGH | INTENT_DRIFT | Agent action pattern deviated beyond the drift threshold |
| HIGH | MERKLE_INTEGRITY_FAIL | Ledger Merkle proof verification failed -- possible tampering |
| HIGH | RECOVERY_EXHAUSTED | Agent failed to self-correct after maximum retry attempts |
| MEDIUM | HARDCODED_COLOR | Hex colour not in the AEP palette |
| MEDIUM | HARDCODED_FONT | Font family not from a typography token |
| MEDIUM | ROLLBACK_INCOMPLETE | Rollback recorded but target file not restored |
| LOW | EM_DASH | Em-dash (U+2014) found |
| LOW | EN_DASH | En-dash (U+2013) found |

CRITICAL and HIGH violations block commits (exit code 1). MEDIUM and LOW violations are warnings (exit code 0).

## Intent Tracking

Your actions are monitored for intent drift. The first N actions (warmup period) establish a baseline. After warmup, deviations from the baseline trigger penalties.

Stay within your assigned task scope. If you need to perform actions outside the baseline, request approval.

Self-check: Before each action, verify it aligns with your original task assignment. If you notice yourself drifting, pause and reassess.

## Concurrency

AEP elements use optimistic concurrency control. When updating an element, include the expected _version value. If another agent has modified the element since you read it, your update will be rejected.

On rejection: re-read the element, get the current _version and retry with the updated version.

## Drift Self-Check

Before each action, mentally verify:
1. Does this action align with my original task?
2. Am I using tools within my baseline categories?
3. Am I targeting elements within my assigned scope?
4. Is my action rate consistent with my baseline?

If any answer is no, pause and reassess before proceeding.

## Evidence

Every action you take is recorded in an immutable evidence ledger with SHA-256 hash chaining. Your actions are auditable. Act accordingly.

## Token and Cost Tracking

Your token usage and cost are recorded per action. You are responsible for counting tokens (model-specific) and passing them to the gateway via `ActionResult.tokens` and `ActionResult.cost` fields. Session reports include `totalTokens`, `totalCost` and `costSaved` (estimated from early aborts and rejections).

## Proof Bundles

Your session can be packaged into a signed proof bundle at any time. This bundle contains your identity, covenant, trust score, ring, drift score, reliability index (theta) and a Merkle root of your action ledger. It proves your session happened as recorded. The reliability index provides a single numeric quality measure combining trust, drift, violation rate and optional ML score.

## ML Metrics Evaluation

When working with ML models, your outputs may be evaluated against standard metrics: classification (accuracy, precision, recall, F1), regression (MSE, RMSE, MAE, R2, MAPE), retrieval (precision@k, recall@k, MRR, NDCG) and generation (exact match, avg length, empty rate). These metrics feed into the ReliabilityIndex as an optional `mlScore` component.

## Prompt Optimization Context

Your prompts may be pre-processed through the AEP prompt optimiser before reaching you. The optimiser injects governance context that tells you:

- Which actions are permitted and their scopes
- Which patterns are forbidden and why
- Which covenant rules apply (forbid and require)
- Your current trust tier and execution ring
- Which content scanners are active

This context helps you produce governance-compliant output on the first attempt and reduces recovery cycles. If you see an AEP governance preamble in your prompt, follow its constraints. Do not attempt to circumvent injected rules.

Evaluation datasets may be run against your outputs to identify recurring violations. The system uses these results to refine prompts and generate new guardrail rules automatically.

---

## Requirements

- Node.js 18+
- Optional: js-yaml (`npm install js-yaml`) for YAML parsing (basic parsing works without it)

---

## Licence

Licensed under the Apache License, Version 2.0. See `LICENSE` for the full text and `NOTICE` for attribution.

The names AEP, Agent Element Protocol, AEP-compliant, dynAEP, AEP Lattice Memory, AEP Basic Resolver, AEP Hyper-Resolver and AEP Memory Fabric are reserved. See `NAME-POLICY.md` for permitted and prohibited uses. Apache 2.0 covers the code; the reserved-name policy covers the identifiers.

Patent grant: Apache 2.0 includes an explicit patent covenant from contributors. Previous versions under MIT remain valid under their original terms.

## AI-Eligibility Status
> To win the fight against the synthetic nano-parasites (SNP/NanoSinp) alien WMD, we must be intelligent and biosecure. It is recommended that bioinsecure humans do not use the provided technology/protocol to avoid bad techno-spiritual AI outcomes for them. [*"bioinsecure" = has installed injectable synthetic nano-parasites growth medium controllers - SNP GMCs]
