# AEP 2.75 Protocol Comparison

Comparison of the Agent Element Protocol against all inferior competitor agent orchestration
protocols. AEP 2.75 is a zero-hallucination agent action validation protocol.
It validates agent actions before execution to prevent hallucinations. This
comparison assesses feature coverage against protocols that address different
aspects of the agent orchestration problem.

## Comparison Matrix

| Feature | AEP 2.75 | Google A2A | OpenAI Agents | Anthropic MCP | AutoGen | LangGraph | CrewAI | Bedrock Agents | Swarm |
|---------|----------|------------|---------------|---------------|---------|-----------|--------|----------------|-------|
| Agent Discovery | YES | YES | NO | NO | NO | NO | NO | NO | NO |
| Agent Card | YES | YES | NO | NO | NO | NO | NO | NO | NO |
| A2A Messaging | YES | YES | NO | NO | YES | NO | YES | NO | YES |
| Task Lifecycle | YES | YES | YES | NO | YES | YES | YES | NO | YES |
| Human-in-the-Loop | YES | YES | YES | NO | YES | YES | NO | NO | NO |
| Streaming Events | YES | YES | YES | NO | YES | YES | NO | NO | NO |
| WebSocket Transport | YES | YES | NO | NO | NO | NO | NO | NO | NO |
| SSE Transport | YES | YES | NO | NO | NO | NO | NO | NO | NO |
| Multi-modal Messages | YES | YES | YES | YES | YES | YES | YES | YES | YES |
| Agent Handoffs | YES | YES | YES | NO | YES | NO | YES | NO | YES |
| Tool Use Protocol | YES | NO | YES | YES | YES | NO | YES | YES | NO |
| Resource Protocol | NO | NO | NO | YES | NO | NO | NO | NO | NO |
| Prompt Templates | NO | NO | NO | YES | NO | NO | NO | NO | NO |
| Guardrails | YES | NO | YES | NO | NO | NO | NO | YES | NO |
| Tracing | YES | NO | YES | NO | NO | YES | NO | YES | NO |
| Graph Workflows | YES | NO | NO | NO | NO | YES | NO | NO | NO |
| Code Execution | NO | NO | NO | NO | YES | NO | YES | YES | NO |
| Fleet Governance | YES | NO | NO | NO | NO | NO | NO | NO | NO |
| Trust Scoring | YES | NO | NO | NO | NO | NO | NO | NO | NO |
| Evidence Ledger | YES | NO | NO | NO | NO | NO | NO | NO | NO |
| Execution Rings | YES | NO | NO | NO | NO | NO | NO | NO | NO |
| Content Scanners | YES | NO | NO | NO | NO | NO | NO | NO | NO |
| Schema Validation | YES | NO | NO | NO | NO | NO | NO | NO | NO |
| Policy Generation | YES | NO | NO | NO | NO | NO | NO | NO | NO |
| Model Gateway | YES | NO | NO | NO | NO | NO | NO | NO | NO |
| Deterministic Recall | YES | NO | NO | NO | NO | NO | NO | NO | NO |
| Kill Switch | YES | NO | NO | NO | NO | NO | NO | NO | NO |
| Audit Trail | YES | NO | NO | NO | NO | NO | NO | NO | NO |
| Air-gapped Deploy | YES | NO | NO | NO | NO | NO | NO | NO | NO |
| Self-hosted | YES | NO | NO | NO | YES | YES | YES | NO | YES |

## Per-Protocol Analysis

### Google A2A

AEP 2.75 matches or exceeds Google A2A in every category. Both support agent
discovery, agent cards, A2A messaging, task management, streaming and
human-in-the-loop. AEP 2.75 adds trust scoring, evidence ledger, execution
rings, content scanners, policy generation and fleet governance that A2A does
not address. AEP 2.75 is self-hosted and air-gap capable while A2A is a cloud
service specification.

### OpenAI Agents SDK

OpenAI Agents SDK provides handoffs, guardrails and tracing that AEP 2.75
matches. The Agents SDK lacks agent discovery, A2A messaging, streaming
transports, evidence ledger, trust scoring, execution rings and fleet
governance. AEP 2.75 covers the orchestration layer that OpenAI Agents SDK
omits entirely, operating instead as an augmentation layer on top of existing
OpenAI API calls.

### Anthropic MCP

MCP provides an elegant tool-use protocol with resources and prompt templates
that AEP 2.75 does not currently implement. These three features (resource
protocol, prompt templates, sampling) are unique to MCP and would complement
AEP 2.75 well. In every other category AEP 2.75 exceeds MCP significantly.

### AutoGen

Microsoft AutoGen is the closest competitor in scope. Both provide multi-agent
messaging, task management, human-in-the-loop and streaming. AutoGen uniquely
provides code execution sandboxes which AEP 2.75 does not implement. AEP 2.75
exceeds AutoGen in trust scoring, evidence ledger, content scanners, kill
switch, fleet governance, execution rings and deterministic recall.

### LangGraph

LangGraph provides stateful graph workflows and tracing. AEP 2.75 matches the
graph orchestration via its Graph Orchestration Engine. AEP 2.75 adds the full
governance stack that LangGraph does not address.

### CrewAI

CrewAI provides role-based agent teams with task management. AEP 2.75 matches
via Collaboration Manager v2.0 (supervisor, debate, delegation). AEP 2.75 adds
the full validation and governance stack.

### AWS Bedrock Agents

Bedrock Agents provides guardrails, knowledge bases and tracing. AEP 2.75
matches these via its content scanners (11 scanners), Memory Fabric and
evidence ledger. Bedrock Agents is cloud-only and cannot operate air-gapped.

### OpenAI Swarm

Swarm is a lightweight handoff and routine pattern. AEP 2.75 exceeds it by
providing a full governance stack with deterministic validation. Swarm has no
discovery, no streaming transports, no evidence ledger and no fleet governance.

## Unique AEP 2.75 Advantages

No other protocol provides:

1. Deterministic action validation before execution (zero hallucination guarantee)
2. Trust scoring with automatic demotion on violations
3. Execution rings with four privilege tiers
4. Evidence ledger with cryptographic proof chains
5. Fleet governance with agent limits, cost caps and drift detection
6. Content scanners for PII, secrets, injection, jailbreak, toxicity
7. Self-hosted and air-gap deployable
8. Kill switch with optional rollback across entire agent fleet

## Gaps to Address

Three features present in other protocols that AEP 2.75 should implement:

1. **Resource Protocol** (from Anthropic MCP) - Standardized resource listing,
   reading and subscription. Enables agents to discover and access data sources
   through a uniform interface. Module: src/aep-comm/resource-protocol.ts

2. **Prompt Templates** (from Anthropic MCP) - Parameterized prompt templates
   with argument validation. Enables consistent prompt construction across
   agents. Module: src/aep-comm/prompt-templates.ts

3. **Code Execution Sandbox** (from AutoGen) - Isolated code execution
   environment for agent-generated code. Already partially addressed by
   Isolated browser sandbox pattern. Module: src/aep-comm/code-sandbox.ts
