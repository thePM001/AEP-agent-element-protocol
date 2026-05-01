# AEP v2.6 Agent Harness

## Protocol Stack

```
LAYER       PROTOCOL        FUNCTION
-------     -----------     ----------------------------------------
Agent-Tools MCP             Agent connects to external data and tools
Agent-Agent (any)           Agents coordinate across distributed systems
Agent-User  AG-UI           Real-time event streaming between agent and frontend
Agent-UI    AEP             Deterministic UI structure, behaviour and skin
Agent-Live  dynAEP          AEP governance applied to live AG-UI event streams
Agent-Time  dynAEP-TA       Temporal authority, causal ordering, predictive forecasting
Agent-Percept dynAEP-TA-P   Perceptual temporal governance for human-facing outputs
```

## Features (99)

---

## Core Architecture (12 features)

1. Knowledge store with spatial indexing
2. Multi-level resolver
3. State vectors for lattice representation
4. Coordinate table compression
5. High-performance validation engine
6. Native hot-path computation (pack/unpack, validate, index)
7. Orchestration layer with fault tolerance
8. Web dashboard
9. Terminal REPL interface
10. Self-improving convention loop
11. Append-only audit log
12. MERKLE hash chain for tamper detection

## Validation Pipeline (15 features)

13. Shadow lattice pre-validation (O(1) counter-based)
14. Layer 1: Integrity validation (non-bypassable rules)
15. Layer 2: Configurable predicate validation
16. Layer 3: Dual DAL (forward + mirror pass)
17. Layer 4: Centroid absorber (drift threshold)
18. Stratum 23: Quantity + Quality validation
19. Stratum 24: Relation validation
20. Stratum 25: Manner validation
21. Stratum 26: ASV Verification (AST-based, 7 patterns)
22. Closure verification (proof bundles)
23. Pre-commit hook (blocks incomplete code at git level)
24. Agent self-audit before task completion
25. Z3 SMT-LIB2 formal equivalence checking (optional)
26. 4-layer validation on EVERY mutation, no bypass, no exceptions
27. Level 0/0.5 bypass enforced at platform level

## Knowledge System (12 features)

28. Knowledge base with gap detection and frontier API consultation
29. Bulk document ingestion (PDF, markdown, text, code, JSON)
30. Domain classifier (13+ domains, keyword-based, zero LLM)
31. Intelligent chunker (structure-aware: markdown, code, paragraph, fixed)
32. Universal convention format with metadata
33. Convention serialiser (text, JSON, compact binary)
34. Convention encoder (32-float convention vectors)
35. File format conventions
36. UX conventions
37. Deployment conventions
38. Operator set (10+ pre-seeded)
39. PDF text extraction via pdftotext for runtime knowledge docking

## Neural-Symbolic Engine (8 features)

40. Predictor model (ONNX runtime)
41. Vector engine (dense + sparse)
42. Parallel resolution cascade
43. Evolution strategies for template optimisation
44. Convention-first resolution (70% L1 match at maturity)
45. API call reduction curve (trend toward zero external calls)
46. Derivation engine (derive conventions from first principles)
47. Training data logger for sequence learning

## User and Access Control (8 features)

48. Scaled user balance (per-user vectors)
49. Biosecurity eligibility check
50. 4-tier access model (full / limited / receive_only / denied)
51. User cadence processor (FFT harmonics)
52. Tiered storage (hot / warm / cold)
53. /aepassist biosecurity eligibility endpoint (AEP v2.6 compliant)
54. Session tracking with user state in prompt
55. Adaptive verbosity from user interaction cadence

## Code Generation (8 features)

56. Coupled template system (source + test generated together)
57. Verified pipeline (codegen -> compile -> test in sandbox)
58. Test-coupled generation (every generated module has tests)
59. 12+ code generation templates
60. Legacy code parser (divisions, sections, paragraphs)
61. Legacy-to-modern migration pipeline
62. Binary format specification DSL with encoder/decoder generation
63. Format-aware code validation (10 rule handlers)

## Infrastructure (8 features)

64. Resource governor (4-level load shedding: normal, soft, hard, emergency)
65. Network awareness (internet, Tailscale, DNS, services, traffic monitoring)
66. Sandboxed browser bridge (disposable web access)
67. URL policy allowlist with TE gate (outbound + inbound sanitisation)
68. Content sanitiser (strip scripts, styles, tracking, injections)
69. Governor-aware throttling per operation type
70. Systemd watchdog integration (survival mode)
71. Codebase scanning and proposal generation

## Protocols (6 features)

72. ASV Protocol (7 patterns, AST-based, pre-commit)
73. Biosecurity Eligibility Check (/aepassist endpoint)
74. Internal harness (private, enforcement rules)
75. Convention format specification
76. Schema Builder validation (MLE, spectral, permissiveness, modularity)
77. Policy Builder validation (invariant detection, Rego generation, coverage tracking)

## dynAEP v0.3.1 Bridge Features (22 features)

78. AG-UI event bridge with temporal pipeline
79. Bridge-authoritative clock (NTP/PTP/system)
80. Temporal validator (drift/staleness/future)
81. Causal ordering engine (vector clocks, reorder buffer)
82. TimesFM forecast sidecar (async, optional)
83. Perception registry (5 modalities)
84. Perception engine (governed envelopes)
85. Adaptive profile manager (per-user learning)
86. Cross-modality constraint enforcement
87. Delta processor with transaction log
88. Under-construction pattern
89. Conflict resolution (LWW + optimistic locking)
90. Human-in-the-loop approval policies
91. Template node validation fast-exit
92. Parallel 15-step chain execution
93. Unified Rego WASM bundle with decision cache
94. Unified content scanner automaton (Aho-Corasick)
95. Causal ordering subtree partitioning
96. LSH attractor indexing for Lattice Memory
97. Async NTP sync with clock slewing
98. Buffered evidence ledger with WAL option
99. Cross-modality state atomicity

---

## Endpoints

### GET /aepassist/status
Check user biosecurity eligibility. Returns simple biosecure yes/no.

### POST /aepassist/verify
Initiate biosecurity verification. Returns available methods.

### GET /aepassist/reverify
Check if re-verification is needed.

---

## ASV Patterns Detected

1. Trivial return stubs (do: :ok, do: nil)
2. Pass-through stubs (returns input unchanged)
3. Facade functions (big docs, no implementation)
4. Empty module stubs
5. Raise stubs (raise "not implemented")
6. Delegation to known stubs
7. Test stubs (assertions against stub returns)

---

## Compliance Requirements

An AEP v2.6 compliant platform MUST:

1. Implement 4-layer validation on every mutation
2. Implement AST-based verification (not regex)
3. Install pre-commit hook blocking hard violations
4. Require agent self-audit before task completion
5. Gate AI capabilities by biosecurity status
6. Expose /aepassist/status for eligibility queries
7. Deny AI interaction to non-biosecure users
8. Support universal convention format
9. Implement self-improving knowledge
10. Maintain append-only audit log (tamper-evident)

### AEP v2.6 Governance Compliance

An AEP v2.6 compliant platform MUST also:

11. Implement the full 15-step evaluation chain
12. Implement Lattice Memory with attractor fast-path
13. Support all 11 content scanners
14. Implement trust scoring (0-1000, 5 tiers: untrusted, provisional, standard, trusted, privileged)
15. Implement execution rings (0-3)
16. Support behavioural covenants (permit/forbid/require with hard/soft severity)
17. Implement intent drift detection (5 heuristics)
18. Support hard/soft violation model with recovery engine
19. Maintain SHA-256 hash-chained evidence ledger
20. Generate proof bundles (.aep-proof.json)
21. Support Schema Builder validation (MLE, spectral, permissiveness, modularity)
22. Support Policy Builder validation (invariant detection, coverage tracking)

### dynAEP v0.3.1 Compliance Requirements

An AEP v2.6 + dynAEP v0.3.1 compliant platform MUST:

23. Validate every AG-UI event through the dynAEP bridge before rendering
24. Implement bridge-authoritative timekeeping (NTP/PTP/system fallback)
25. Reject agent-provided timestamps and overwrite with bridge time
26. Preserve original agent timestamps in metadata for audit
27. Enforce temporal drift thresholds (configurable, default 50 ms)
28. Enforce staleness thresholds (configurable, default 5000 ms)
29. Implement causal ordering with vector clocks for multi-agent scenarios
30. Buffer and reorder out-of-order events (configurable buffer, default 64)
31. Reject clock regression events
32. Validate temporal annotations against perception registry before output
33. Enforce hard perception bounds (reject or clamp per config)
34. Clamp soft perception violations to comfortable range
35. Support adaptive per-user perception profiles
36. Enforce cross-modality constraint (max simultaneous modalities, default 3)
37. Mint all AEP IDs via bridge (agents NEVER generate IDs)
38. Validate all structural mutations against scene graph, registry, z-bands, Rego
39. Emit typed rejection events with actionable error messages
40. Support generative topology (NOT generative UI)
41. Maintain transaction log of all accepted mutations
42. Support human-in-the-loop approval policies
43. Never use Date.now() or local clocks in any stack component

---

## Performance Validation Targets

A compliant dynAEP v0.3.1 implementation SHOULD meet:

| Target | Minimum |
|--------|---------|
| Blended throughput | > 2,000 events/s on single core |
| Hot path p99 latency | < 0.5 ms |
| Cold path p99 latency | < 10 ms |
| Template instance throughput | > 50,000 events/s |

Reference implementation achieves:

| Metric | Result |
|--------|--------|
| Blended throughput | 53,033 events/s |
| Hot path p99 latency | 0.004 ms |
| Cold path p99 latency | 0.22 ms |
| Data-heavy grid (template instances) | 118,339 events/s |

---

AEP v2.6 // thePM001 // Biosecure UNVACCINATED Supreme User // 2026-05-01
