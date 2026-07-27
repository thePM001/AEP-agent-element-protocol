// AEP Feature Explanations
// Plain-language descriptions for every AEP concept

const EXPLANATIONS: Record<string, string> = {
  "trust": `Trust scoring tracks agent reliability on a 0-1000 scale across five tiers:

  untrusted (0-199): Agent has lost most privileges through violations.
  provisional (200-399): Agent is under probation or newly started.
  standard (400-599): Normal operating tier for most agents.
  trusted (600-799): Agent has demonstrated consistent good behaviour.
  privileged (800-1000): Full access to all trust-gated capabilities.

Rewards: Successful validated action gives +5 to +20 points. Successful rollback recovery gives +10.

Penalties: Policy violation -50, structural violation -30, rate limit hit -10, forbidden match -100, intent drift -75.

Erosion: Trust erodes during inactivity at a configurable rate (default 5 points per hour). This prevents stale sessions from retaining elevated trust. The score never drops below 0.`,

  "rings": `Execution rings are four privilege levels that restrict what an agent can do:

  Ring 0 (kernel): Full access. Can modify core elements, spawn sub-agents and access the network.
  Ring 1 (supervisor): Create, update and delete within policy. No core modification or sub-agent spawning.
  Ring 2 (user): Create and update only. No delete, no network access, no sub-agents. This is the default.
  Ring 3 (sandbox): Read-only. Can query but cannot mutate anything.

Ring assignment comes from policy. When trust drops, the agent is automatically demoted to a lower ring. Promotion to a higher ring requires the trust score to reach the configured tier threshold, and Ring 0 typically requires operator approval.

The ring check runs before all other policy checks because it is the cheapest operation and eliminates the most actions.`,

  "covenants": `Behavioural covenants are declarations an agent makes about its own behaviour. They use a 3-keyword language:

  permit: Actions the agent is allowed to take.
  forbid: Actions the agent will never take. Forbid always wins over permit.
  require: Conditions that must hold for any action.

Example:
  covenant SecureBuilder {
    permit aep:create_element (prefix in ["CP", "PN"]);
    forbid aep:delete_element (prefix == "SH");
    require trust_tier >= "standard";
  }

Covenants are different from Rego policies. Covenants are what the AGENT declares about ITSELF. They are portable and travel with the agent. They can be exchanged in cross-agent handshakes and proved to third parties.

Rego policies are what the OPERATOR enforces on the agent. They are environment-specific and stay with the deployment. Both must pass for an action to proceed.`,

  "identity": `Agent identity is a unified type that combines capability advertising, cryptographic signing and discovery into a single structure.

Each identity contains:
  - Agent ID, name, version and operator
  - Capabilities and covenant references
  - Communication endpoints
  - Maximum trust tier and default ring
  - Ed25519 public key
  - Expiration date
  - Signature over all fields

Identity serves as the agent card for session creation, the capability advertisement for discovery and the handshake credential for cross-agent verification. There is one type, not two.

Discovery is decentralised: agents publish identity at a well-known URL or DNS TXT record. No central registry is needed.`,

  "verification": `Cross-agent verification is a handshake protocol that runs before two agents interact.

Each agent sends a proof bundle containing:
  - Signed identity
  - Covenant specification
  - Merkle root of its action ledger
  - Action count and timestamp

The receiving agent verifies:
  1. Identity signature is valid and not expired
  2. Covenant signature is valid
  3. Merkle root is well-formed
  4. Counterparty covenant satisfies local requirements

Both agents must verify each other. If either fails, the interaction is refused.

Root of trust: The handshake proves the chain of cryptography is intact. It does NOT prove the operator behind the key is honest. That is a human trust problem outside the protocol scope.`,

  "drift": `Intent drift detection catches when an agent deviates from its established patterns.

Four heuristics (no LLM needed):
  1. Tool category drift: Agent starts using tools outside its baseline categories.
  2. Target scope drift: Agent targets new prefixes or paths not in the baseline.
  3. Frequency anomaly: Action rate changes significantly from the baseline.
  4. Repetition detection: Same action repeated excessively.

Warmup period: The first N actions (default 10) establish the baseline. During warmup, drift is measured but NOT penalized. After warmup, the baseline locks and drift detection activates.

Without warmup, the second action of a fresh session would trigger false positives because no baseline exists yet.

Configurable responses: warn (log but allow), gate (require approval), deny (block action), kill (terminate session).`,

  "streaming": `Streaming validation intercepts agent output as it streams and validates chunk by chunk.

If a violation is detected at token 50 of a 2000-token output, the remaining 1950 tokens are never generated. The stream is aborted immediately.

Five checks run on each chunk:
  1. Covenant forbid patterns
  2. Protected AEP element IDs
  3. Z-band violations
  4. Structural violations (orphan references)
  5. Policy forbidden patterns

This is model-agnostic. It works with any streaming API (OpenAI, Anthropic, Ollama, local models). AEP stays on the output side of the boundary. No model internals are touched.`,

  "kill-switch": `The kill switch provides emergency termination of all active sessions or a specific session.

Operations:
  - Kill all: Terminates every active session immediately.
  - Kill with rollback: Terminates and rolls back all compensatable actions.
  - Kill specific: Terminates a single session by ID.

All affected agents have their trust score reset to 0 (untrusted tier).

CLI: npx aep kill --all, npx aep kill --rollback, npx aep kill --session <id>`,

  "merkle": `Merkle proofs allow individual ledger entries to be verified without downloading the full ledger.

Every N entries (default 100), a Merkle tree is computed from the entry hashes. An individual entry can be proven authentic by providing:
  - The entry itself
  - A Merkle proof (sibling hashes along the path)
  - The Merkle root

Use case: Agent A proves a specific action to Agent B by providing the entry plus its Merkle proof. Agent B verifies without needing the full action history.`,

  "quantum": `Post-quantum ledger signatures use ML-DSA-65 (FIPS 204) on every ledger entry.

This is opt-in via policy. A key pair is generated per session, and the public key is stored in the session:start entry. The verify function checks both the hash chain and the signatures.

This protects the evidence ledger against future quantum computing attacks on the hash chain.`,

  "timestamps": `RFC 3161 timestamps provide third-party proof of when ledger entries were created.

Timestamp requests are async and batched. They do NOT block the evaluation chain.

Flow:
  1. Ledger entries are written immediately with the hash chain (synchronous).
  2. RFC 3161 requests are queued in a background worker.
  3. Timestamps are backfilled into entries when the TSA responds.
  4. If the TSA is unreachable, entries remain valid (hash chain is sufficient).

Timestamps are supplementary proof, not blocking dependencies.`,

  "concurrency": `Optimistic concurrency prevents two agents from silently overwriting each other's changes to the same AEP element.

Every element has a _version field (integer, starts at 1). Every update must include the expected _version. If the element's current version differs from expected, the update is rejected with a concurrency conflict error.

The agent must re-read the element and retry with the new version. This is standard optimistic locking.`,

  "decomposition": `Governed task decomposition breaks complex tasks into subtask trees with enforced constraints.

Scope inheritance: A child task's scope is the intersection of its parent scope. A child can never have wider access than its parent.

Completion gates: Tasks can require criteria to be met before marking complete (all children done, tests pass, no violations, trust above threshold, drift below threshold).

Action budgets: Each task can have a maximum action count. Max depth prevents unbounded recursion.`,

  "proof-bundles": `Proof bundles package a session into a signed, portable verification artifact.

A bundle contains:
  - Agent identity and covenant
  - Session report (actions allowed, denied and gated)
  - Trust score and execution ring
  - Drift score
  - Merkle root and ledger hash
  - Ed25519 signature over all fields
  - Optional task tree

Bundles can be verified independently. They prove the session happened as recorded, the identity signed the session and the ledger has not been tampered with.`,

  "gates": `Gates require approval before high-risk actions proceed.

Two types:
  human: The action pauses until a human operator approves or rejects.
  webhook: The action details are posted to a callback URL. The webhook must respond with approval within the timeout (default 30 seconds). Timeout means denial.

Gates are configured per action in the policy file with a risk level (low, medium, high, critical).`,

  "rate-limits": `Rate limiting operates at two levels:

  Per-session: Each session has its own max_per_minute limit.
  System-wide: A planetwide limit caps total actions across ALL active sessions.

If ten agents in ten sessions each do 30 actions per minute, the system-wide limit (default 200) prevents the total from reaching 300.`,

  "offline": `Offline signing queues signed actions when the network is unavailable.

Actions are validated locally and added to a local ledger with full hash chain integrity. When connectivity returns, the offline queue is synced and chain continuity is verified.

CLI: npx aep sync`,

  "reports": `Audit reports can be exported in four formats:

  text: Human-readable summary on stdout (default).
  json: Structured report object for programmatic use.
  csv: One row per action type with counts.
  html: Formatted report suitable for compliance documentation.

Required for EU AI Act and SOC 2 evidence collection.`,

  "owasp": `AEP maps all 10 OWASP Agentic AI Top 10 risks:

  01 Agent Hijacking - Intent drift detection and covenants
  02 Tool Misuse - Policy evaluation, execution rings and covenants
  03 Identity Abuse - Agent identity and trust scoring
  04 Supply Chain - Identity verification and covenant exchange
  05 Code Execution - Rings and shell proxy
  06 Memory Poisoning - Evidence ledger with read-only invariant
  07 Insecure Comms - Verification handshake and post-quantum signatures
  08 Cascading Failures - Kill switch, rate limits and system-wide limits
  09 Human Trust Exploit - Gates, trust tiers and rings
  10 Rogue Agents - Trust erosion, auto-demotion and kill switch`,

  "policy": `The policy file (agent.policy.yaml) is the single configuration for all AEP features.

It defines:
  - capabilities: Which tools the agent can use and with what scope
  - limits: Maximum runtime, file changes, AEP mutations and cost
  - gates: Actions requiring human or webhook approval
  - forbidden: Patterns that are always blocked
  - session: Action limits, rate limits and escalation rules
  - trust: Initial score, erosion rate, penalties and rewards
  - ring: Default ring and promotion conditions
  - intent: Drift detection threshold, warmup period and response
  - identity: Whether agent identity is required
  - quantum: Post-quantum signature toggle
  - timestamp: RFC 3161 TSA configuration
  - streaming: Chunk-by-chunk validation toggle
  - system: Planetwide rate limit and max concurrent sessions
  - decomposition: Task tree constraints`,

  "ledger": `The evidence ledger is an append-only JSONL file with SHA-256 hash chaining.

Every entry contains:
  - Sequence number
  - Timestamp
  - Hash of (previous hash + type + data)
  - Entry type (session:start, action:evaluate, aep:validate, etc.)
  - Entry data

The hash chain makes tampering detectable. If any entry is modified, all subsequent hashes become invalid.

Supplementary features: Merkle proofs for per-entry verification, ML-DSA-65 post-quantum signatures, RFC 3161 timestamps for third-party time proof.`,
};

export function getExplanation(topic: string): string | null {
  const key = topic.toLowerCase().replace(/[^a-z-]/g, "");
  return EXPLANATIONS[key] ?? null;
}

export function getAvailableTopics(): string[] {
  return Object.keys(EXPLANATIONS);
}

export function findBestMatch(query: string): string | null {
  const normalised = query.toLowerCase();
  // Direct match
  if (EXPLANATIONS[normalised]) return normalised;
  // Partial match
  for (const key of Object.keys(EXPLANATIONS)) {
    if (normalised.includes(key) || key.includes(normalised)) return key;
  }
  // Keyword search
  const keywords: Record<string, string[]> = {
    "trust": ["score", "tier", "reward", "penalty", "erosion", "points"],
    "rings": ["ring", "privilege", "kernel", "sandbox", "demotion", "promotion"],
    "covenants": ["covenant", "permit", "forbid", "require", "dsl", "agent-declared"],
    "identity": ["identity", "agent card", "ed25519", "key pair", "discovery"],
    "verification": ["handshake", "cross-agent", "proof bundle", "counterparty"],
    "drift": ["drift", "intent", "baseline", "warmup", "anomaly", "deviation"],
    "streaming": ["stream", "chunk", "abort", "early", "token"],
    "kill-switch": ["kill", "emergency", "terminate", "stop"],
    "merkle": ["merkle", "tree", "proof", "per-entry"],
    "quantum": ["quantum", "ml-dsa", "post-quantum", "fips"],
    "timestamps": ["timestamp", "rfc 3161", "tsa", "time"],
    "concurrency": ["concurrency", "version", "conflict", "optimistic", "overwrite"],
    "decomposition": ["task", "subtask", "scope", "child", "tree", "decomp"],
    "proof-bundles": ["bundle", "portable", "artifact", "package"],
    "gates": ["gate", "approval", "human", "webhook"],
    "rate-limits": ["rate", "limit", "throttle", "per-minute"],
    "offline": ["offline", "sync", "air-gapped", "queue"],
    "reports": ["report", "audit", "export", "csv", "html", "json", "compliance"],
    "owasp": ["owasp", "top 10", "risk", "mapping"],
    "policy": ["policy", "yaml", "configuration", "config"],
    "ledger": ["ledger", "evidence", "hash chain", "append-only", "jsonl"],
  };

  for (const [key, words] of Object.entries(keywords)) {
    for (const w of words) {
      if (normalised.includes(w)) return key;
    }
  }

  return null;
}
