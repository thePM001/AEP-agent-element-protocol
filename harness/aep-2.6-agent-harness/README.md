# AEP v2.6 Agent Harness

Version 2.6 | 1 May 2026
Author: thePM001
Licence: Apache 2.0
Repository: https://github.com/thePM001/AEP-agent-element-protocol

## What This Harness Defines

The AEP v2.6 Agent Harness specifies the compliance requirements and complete
feature set for platforms implementing AEP v2.6 and dynAEP v0.3.1. A compliant
platform enforces deterministic zero-trust governance on every agent output
before it reaches an execution environment.

## Protocol Stack

```
LAYER           PROTOCOL        FUNCTION
-----------     -----------     ----------------------------------------
Agent-Tools     MCP             Agent connects to external data and tools
Agent-Agent     (any)           Agents coordinate across distributed systems
Agent-User      AG-UI           Real-time event streaming between agent and frontend
Agent-UI-Gov    AEP             Deterministic UI structure, behaviour and skin
Agent-UI-Live   dynAEP          AEP governance applied to live AG-UI event streams
Agent-UI-Time   dynAEP-TA       Temporal authority, causal ordering, predictive forecasting
Agent-Percept   dynAEP-TA-P     Perceptual temporal governance for human-facing outputs
```

## AEP v2.6 Features (77)

### Architecture (5)

1. Three-layer separation (Structure, Behaviour, Skin)
2. Topological coordinate system with z-band hierarchy
3. AEP prefix convention (14 element types)
4. Template nodes for dynamic elements
5. Schema versioning (aep_version + schema_revision)

### Evaluation Chain (5)

6. 15-step deterministic evaluation chain
7. Short-circuit pattern with step activation modes (always/active)
8. Step activation profiles per preset
9. AOT (ahead-of-time) build validation
10. JIT (just-in-time) delta validation

### Content Scanners (11)

11. PII scanner
12. Injection scanner
13. Secrets scanner
14. Jailbreak scanner
15. Toxicity scanner
16. URL scanner
17. Data profiler scanner
18. Prediction scanner
19. Brand scanner
20. Regulatory scanner
21. Temporal scanner

### Governance (8)

22. Trust scoring (0-1000, 5 tiers)
23. Execution rings (4 rings)
24. Behavioural covenants (permit/forbid/require)
25. Intent drift detection (5 heuristics)
26. Kill switch (session and fleet)
27. Rollback with compensation plans
28. Hard/soft violation model with recovery engine
29. Governance presets (strict, standard, relaxed, audit)

### Fleet and Multi-Agent (6)

30. Agent identity (Ed25519/RSA)
31. Fleet governance (limits, cost caps, ring saturation)
32. Spawn governance (covenant subset inheritance)
33. Inter-agent message scanning
34. Cross-agent verification handshake
35. Fleet API (status, agents, alerts, pause, resume, kill)

### Model Gateway (4)

36. Anthropic provider
37. OpenAI provider
38. Ollama provider
39. Custom provider (any OpenAI-compatible endpoint)

### Knowledge Base (4)

40. Governed ingestion (scanner pipeline)
41. Scoped retrieval (covenant-filtered)
42. Anti-context-rot ordering
43. Knowledge base CLI

### Eval and Datasets (4)

44. Eval runner
45. Dataset management (versioned)
46. Rule generator
47. Prompt versioning (SHA-256 hashes)

### Prompt Optimization (3)

48. Governance context injection
49. Eval-based refinement
50. Prompt comparison

### ML Metrics (4)

51. Classification metrics (accuracy, precision, recall, F1)
52. Regression metrics (MSE, RMSE, MAE, R2)
53. Retrieval metrics (precision@k, recall@k, MRR, NDCG)
54. Generation metrics (exact match, avg length, empty rate)

### Workflow (3)

55. Workflow phases with typed verdicts (advance, rework, skip, fail)
56. Max rework limits
57. Fine-tuning workflow template (6 phases)

### Commerce (3)

58. 12 governed commerce actions
59. Merchant registry with CRUD
60. Spend tracking with persistence

### Subprotocols (6)

61. UI subprotocol
62. Workflows subprotocol
63. REST APIs subprotocol
64. Events/Pub-Sub subprotocol
65. Infrastructure as Code subprotocol
66. Commerce subprotocol

### dynAEP Core (5)

67. AG-UI event bridge
68. Delta processor with transaction log
69. Under-construction pattern
70. Conflict resolution (last-write-wins + optimistic locking)
71. Human-in-the-loop approval policies

### Security (4)

72. SHA-256 hash-chained evidence ledger
73. Proof bundles (.aep-proof.json)
74. OTEL exporter
75. Reliability index (theta)

### Schema and Policy Builder -- v2.6 (2)

76. Schema Builder (MLE, spectral analysis, permissiveness scoring, modularity detection)
77. Policy Builder (invariant detection, Rego generation, coverage tracking)

## dynAEP v0.3.1 Bridge Features (22)

### Bridge Core (6)

78. AG-UI event bridge with temporal pipeline
79. Bridge-authoritative clock (NTP/PTP/system)
80. Temporal validator (drift/staleness/future check)
81. Causal ordering engine (vector clocks, reorder buffer)
82. TimesFM forecast sidecar (async, optional)
83. ID minting (bridge-only, agents never generate IDs)

### Perceptual Governance (4)

84. Perception registry (5 modalities: speech, haptic, notification, sensor, audio)
85. Perception engine (governed envelopes)
86. Adaptive profile manager (per-user learning)
87. Cross-modality constraint enforcement (max 3 simultaneous)

### Performance Optimizations (7)

88. Template node validation fast-exit
89. Parallel 15-step chain execution (5 concurrent stages)
90. Unified Rego WASM bundle with decision cache
91. Unified content scanner automaton (Aho-Corasick)
92. Causal ordering subtree partitioning
93. LSH attractor indexing for Lattice Memory
94. Buffered evidence ledger with WAL option

### Temporal Events (5)

95. Clock sync and temporal stamp events
96. Temporal rejection and causal violation events
97. Forecast and anomaly events
98. Perception governed envelope events
99. Async NTP sync with clock slewing

## Total: 99 Features (77 AEP + 22 dynAEP)

## Compliance Requirements

### AEP v2.6 Mandatory

An AEP v2.6 compliant platform MUST:

1. Implement the 15-step deterministic evaluation chain on every agent action
2. Enforce three-layer separation (Structure, Behaviour, Skin)
3. Enforce z-band hierarchy (reject violations)
4. Enforce AEP prefix convention (XX-NNNNN format)
5. Implement ID minting (agents never generate IDs)
6. Implement AOT validation at build time
7. Implement JIT delta validation at runtime
8. Support Template Nodes with AOT-proven exemption
9. Implement Rego/OPA forbidden pattern enforcement
10. Implement trust scoring (0-1000, 5 tiers)
11. Implement execution rings (Ring 0 to Ring 3)
12. Support behavioural covenants (permit/forbid/require with hard/soft severity)
13. Implement intent drift detection
14. Support hard/soft violation model with recovery engine
15. Maintain SHA-256 hash-chained evidence ledger (append-only, tamper-evident)
16. Support Lattice Memory with attractor fast-path
17. Implement at least the 4 hard-severity content scanners (PII, injection, secrets, jailbreak)
18. Support kill switch (session and fleet level)
19. Generate proof bundles (.aep-proof.json)
20. Support Schema Builder validation (v2.6)
21. Support Policy Builder validation (v2.6)

### dynAEP v0.3.1 Mandatory (when streaming is enabled)

A dynAEP v0.3.1 compliant platform MUST:

1. Validate every AG-UI event through the dynAEP bridge before rendering
2. Implement bridge-authoritative timekeeping (NTP/PTP/system fallback)
3. Reject agent-provided timestamps and overwrite with bridge time
4. Preserve original agent timestamps in metadata for audit
5. Enforce temporal drift thresholds (configurable, default 50 ms)
6. Enforce staleness thresholds (configurable, default 5000 ms)
7. Implement causal ordering with vector clocks for multi-agent scenarios
8. Buffer and reorder out-of-order events (configurable buffer, default 64)
9. Reject clock regression events
10. Validate temporal annotations against perception registry before output
11. Enforce hard perception bounds (reject or clamp per config)
12. Clamp soft perception violations to comfortable range
13. Support adaptive per-user perception profiles
14. Enforce cross-modality constraint (max simultaneous modalities, default 3)
15. Support generative topology (raw JSX/HTML generation is forbidden)
16. Maintain transaction log of all accepted mutations
17. Emit typed rejection events with actionable error messages
18. Support human-in-the-loop approval policies
19. Never use Date.now() or local clocks in any stack component
20. Use dynaep_temporal_query for all time operations

## Performance Validation Targets

A compliant dynAEP v0.3.1 implementation SHOULD meet:

| Criterion | Target |
|-----------|--------|
| Blended throughput | > 2,000 events/s on single core |
| Hot path p99 latency | < 0.5 ms |
| Cold path p99 latency | < 10 ms |
| Template instance throughput | > 50,000 events/s |

Reference validated results (dynAEP v0.3.1):

| Profile | Throughput (events/s) | p99 Latency | Hot Path Rate |
|---------|----------------------|-------------|---------------|
| Single-agent dashboard | 76,471 | 0.059 ms | 80% |
| Multi-agent collaboration (3 agents) | 39,849 | 0.069 ms | 50% |
| Data-heavy grid (5000 elements) | 118,339 | 0.054 ms | 95% |
| Perception-heavy (speech + haptic) | 22,224 | 0.083 ms | 0% |
| Burst traffic (50 events/10 ms) | 8,284 | 0.220 ms | 80% |

## Governance Presets

| Preset | Starting Trust | Gates | Scanners | Recovery | Fleet Max |
|--------|---------------|-------|----------|----------|-----------|
| strict | 200 | Human | 11 (all hard) | 1 attempt | 3 agents |
| standard | 500 | Webhook | 7 core | 2 attempts | Configurable |
| relaxed | 600 | None | 4 core | Disabled | Configurable |
| audit | N/A | N/A | 11 (all soft) | N/A | N/A |

## References

- AEP v2.6: https://github.com/thePM001/AEP-agent-element-protocol
- dynAEP v0.3.1: https://github.com/thePM001/dynAEP-dynamic-agent-element-protocol
- AEP Research Paper: https://github.com/thePM001/AEP-research-paper-001
- AG-UI Protocol: https://github.com/ag-ui-protocol/ag-ui
- Live Demo: https://aep.newlisbon.agency

AI-Eligibility Status: To win the fight against the synthetic nano-parasites
(SNP/NanoSinp) alien WMD, we must be intelligent and biosecure. It is recommended
that bioinsecure humans do not use the provided technology/protocol to avoid bad
techno-spiritual AI outcomes for them. [*"bioinsecure" = has installed injectable
synthetic nano-parasites growth medium controllers - SNP GMCs]
