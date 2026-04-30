# AEP v2.5 Agent Harness

## Protocol Version: 2.5
## Features: 75
## Authority: thePM001 // Biosecure UNVACCINATED Supreme User

---

## Core Architecture (12 features)

1. Hypergraph-Lattice knowledge store with R-tree spatial indexing
2. 4-level cascade resolver (Convention -> Attractor -> JEPA -> Frontier API)
3. 375-float frame vectors for lattice state representation
4. 86-token coordinate table compression
5. Binary wire format (zero-parse, typed fields at known offsets)
6. Rust NIF hot-path computation (pack/unpack, validate, pulse, R-tree, JEPA)
7. Elixir/OTP orchestration layer with supervision trees
8. Phoenix LiveView web dashboard
9. Cochelle terminal REPL interface
10. Convention crystallisation via SEPL self-feeding loop
11. CHRONOS append-only audit log
12. MERKLE hash chain for tamper detection

## Validation Pipeline (15 features)

13. SOMTAL shadow lattice pre-validation (O(1) counter-based)
14. Layer 1: Integrity validation (8 non-toggleable rules)
15. Layer 2: Strata validation (26 toggleable predicates)
16. Layer 3: Dual DAL (forward + mirror pass)
17. Layer 4: CAMARA 16D centroid absorber (drift threshold tau_a)
18. Stratum 23: Gricean Quantity + Quality validation
19. Stratum 24: Gricean Relation validation
20. Stratum 25: Gricean Manner validation
21. Stratum 26: Anti-Stub Verification (AST-based, 7 patterns)
22. Closure verification (S3 quaternion, proof bundles)
23. Pre-commit hook (blocks stub patterns at git level)
24. Agent self-audit before task completion
25. Z3 SMT-LIB2 formal equivalence checking (optional)
26. 4-layer validation on EVERY mutation, no bypass, no exceptions
27. Level 0/0.5 bypass enforced at Elixir level, not in Rust

## Knowledge System (12 features)

28. Knowledge pump with gap detection and frontier API consultation
29. Bulk document ingestion (PDF, markdown, text, code, JSON, ASICF)
30. Domain classifier (13+ domains, keyword-based, zero LLM)
31. Intelligent chunker (structure-aware: markdown, code, paragraph, fixed)
32. ASICF universal convention format with syntrometric metadata
33. ASICF serialiser (text, JSON, compact binary)
34. ASICF JEPA encoder (32-float convention vectors)
35. 74 file format conventions (DOCK 6a)
36. 40 UX conventions (DOCK 6c)
37. 25 deployment conventions (DOCK 6d)
38. Syntrometric operator set (10+ pre-seeded from Heim)
39. PDF text extraction via pdftotext for runtime knowledge docking

## Neural-Symbolic Engine (8 features)

40. JEPA 527K parameter predictor (ONNX runtime in Rust NIF)
41. MLE 4096-bit HyperVector engine (dense + sparse, syntrometric header)
42. Parallel speculative cascade (L1-L3 simultaneous)
43. EGGROLL evolution strategies for template optimisation
44. Convention-first resolution (70% L1 match at maturity)
45. Self-elimination curve (L4 API calls trend toward zero)
46. Syntrometric derivation engine (derive conventions from first principles)
47. Training data logger for JEPA sequence learning

## User and Access Control (8 features)

48. UBAL-2 scaled user balance (128-float vectors per user)
49. Biosecurity gating (16-byte eligibility header)
50. 4-tier access model (full / limited / receive_only / denied)
51. Wave processor (user cadence as FFT harmonics)
52. Tiered storage (ETS hot / mmap warm / PostgreSQL cold)
53. /aepassist biosecurity eligibility endpoint (AEP 2.5 compliant)
54. Session tracking with UBAL state in prompt
55. Temporal empathy (adaptive verbosity from user typing cadence)

## Code Generation (8 features)

56. Coupled template system (source + test generated together)
57. Verified pipeline (codegen -> compile -> test in sandbox)
58. Test-coupled generation (every generated module has tests)
59. 12+ code generation templates
60. COBOL parser (divisions, sections, paragraphs, PIC clauses)
61. COBOL-to-modern migration pipeline (Elixir, Python, TypeScript)
62. Binary format specification DSL with encoder/decoder generation
63. Format-aware code validation (10 rule handlers)

## Infrastructure (8 features)

64. Resource governor (4-level load shedding: normal, soft, hard, emergency)
65. Network awareness (internet, Tailscale, DNS, services, traffic monitoring)
66. Firecracker micro-VM browser bridge (disposable sandboxed web access)
67. URL policy allowlist with TE gate (outbound + inbound sanitisation)
68. Content sanitiser (strip scripts, styles, tracking, injections)
69. Governor-aware throttling per operation type
70. Systemd watchdog integration (Level 4 survival mode)
71. Self-architecture analysis (codebase scanning, proposal generation)

## Protocols (4 features)

72. Anti-Stub Verification Protocol (7 patterns, AST-based, pre-commit)
73. Biosecurity Eligibility Check (/aepassist endpoint)
74. AEP v3.0 internal harness (private, enforcement rules)
75. ASICF convention format specification

---

## Endpoints

### GET /aepassist/status
Check user biosecurity eligibility. Returns simple biosecure yes/no.

### POST /aepassist/verify
Initiate biosecurity verification. Returns available methods.

### GET /aepassist/reverify
Check if re-verification is needed.

---

## Anti-Stub Patterns Detected

1. Trivial return stubs (do: :ok, do: nil)
2. Pass-through stubs (returns input unchanged)
3. Facade functions (big docs, no implementation)
4. Empty module stubs
5. Raise stubs (raise "not implemented")
6. Delegation to known stubs
7. Test stubs (assertions against stub returns)

---

## Compliance Requirements

An AEP v2.5 compliant platform MUST:

1. Implement 4-layer validation on every mutation
2. Implement AST-based stub detection (not regex)
3. Install pre-commit hook blocking hard violations
4. Require agent self-audit before task completion
5. Gate AI capabilities by biosecurity status
6. Expose /aepassist/status for eligibility queries
7. Deny AI interaction to non-biosecure users
8. Support ASICF universal convention format
9. Implement convention crystallisation (self-improving knowledge)
10. Maintain CHRONOS audit log (append-only, tamper-evident)

---

## Reference Implementation

Radia AGI Platform (private) -- 49 build phases, 2700+ tests, ~50K lines of real code, running on commodity hardware.

---

**AEP v2.5 // thePM001 // Biosecure UNVACCINATED Supreme User // 2026-04-28**
