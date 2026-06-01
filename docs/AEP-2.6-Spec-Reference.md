# AEP 2.6 - Agent Element Protocol Specification

Version 2.6 | 1 May 2026
Author: thePM_001
Licence: Apache-2.0

## Abstract

The Agent Element Protocol (AEP) is a deterministic zero-trust governance protocol for AI agents. It provides a formal framework for controlling agent outputs through adjudication lattices - partially ordered sets of policies, validators, and constraints that guarantee deterministic, verifiable behavior. AEP 2.6 adds Policy Builder and Schema Builder, improving the mathematical and formal safety of rules inserted into AEP lattices.

## 1. Architecture

AEP operates as a three-layer architecture:

```
Layer 1: Meta AEP - Protocol governance (protocol-level rules, naming, versioning)
Layer 2: Core AEP - Output validation (element schemas, scene graphs, evaluation chain)
Layer 3: dynAEP - Streaming validation (real-time delta processing, temporal authority)
```

### 1.1 Adjudication Lattices

Every governance decision in AEP forms a lattice. A lattice is a partially ordered set (L, <=) where every pair of elements a, b in L has:
- A unique supremum (join): a v b (least upper bound)
- A unique infimum (meet): a ^ b (greatest lower bound)

This guarantees that policies compose without conflicts. When two policies constrain the same action, the lattice structure determines the combined constraint deterministically.

### 1.2 15-Step Evaluation Chain

Every agent output passes through 15 verification steps:

1. Schema validation (structure correctness)
2. Unicode/codepoint validation
3. PII and secret scanning
4. Injection detection (SQL, XSS, command)
5. Comment policy enforcement
6. Property-based testing (generative)
7. Cedar policy evaluation
8. Z3 SMT constraint solving
9. cvc5 DualSMT cross-verification
10. Symbolic execution
11. CHC (Constrained Horn Clause) verification
12. Stream-based data property testing
13. TLA+ temporal model checking
14. MIRI Rust memory safety verification
15. Evidence ledger recording

## 2. Element System

### 2.1 Element Types

AEP defines 30 standard UI element types, each with:
- Unique element ID (data-aep-id attribute)
- z-band (spatial layer ordering)
- Parent-child topology constraints
- Skin binding (visual theme attachment)
- Spatial validation rules

### 2.2 Scene Graph

The AEP scene graph is a JSON document (`aep-scene.json`) defining the element topology. Every element position, z-band and parent relationship is validated against this schema before rendering.

### 2.3 Registry

The AEP registry (`config/aep-registry.yaml`) defines all valid element types, their schemas, validation rules and visual constraints. The registry is the single source of truth for element definitions.

## 3. Policy System

### 3.1 Policy Domains

Policies are organized by domain:
- **governance**: deployment, code access, browser operations
- **writing**: output conventions (dashes, commas, text color)
- **security**: verification, scanning, anti-stub enforcement
- **harness**: agent boot registration, harness compliance
- **network**: binding, isolation, Tailscale

### 3.2 Policy Composition

Policies compose via conjunction: all applicable policies must pass for an action to be allowed. The lattice structure guarantees that composed policies have a well-defined result:
- Join (v) = combined restriction of two policies
- Meet (^) = shared permission of two policies

### 3.3 Trust Rings

Policies apply based on the agent's trust ring:
- **sandbox**: most restrictive (development, testing)
- **user**: moderate restrictions (personal use)
- **system**: elevated access (infrastructure agents)
- **enterprise**: broadest access (governed production)

## 4. Evaluation Chain

### 4.1 Step Execution

Each step in the 15-step chain:
1. Receives the agent output and evaluation context
2. Applies its specific validation logic
3. Returns {pass, reject} with evidence
4. Evidence is recorded in the audit ledger

### 4.2 Evidence Ledger

SHA-256 hash-chained audit log. Every validation decision (pass or reject) is recorded. Tampering with any entry breaks the hash chain. The ledger provides:
- Full audit trail of every agent action
- Cryptographic proof of validation
- Temporal ordering via bridge-authoritative clock
- Cross-session traceability

## 5. Agent Harness

### 5.1 Boot Registration

Every AEP-compliant agent must register via the harness before performing any work. Registration creates a GAP-validated session document with:
- Agent identity and type
- Session UUID
- Start timestamp
- Trust ring assignment
- Capability profile reference

### 5.2 Capability Profiles

Agents operate under GAP-based capability profiles defining:
- Allowed read/write paths
- Allowed network endpoints
- Allowed tools and operations
- Token and call limits
- Trust ring assignment

## 6. Protocol Extensions

### 6.1 dynAEP (Streaming)

Real-time AG-UI event stream validation. Every token in a streaming response passes through the AEP scene graph validation before rendering. Includes temporal authority for time-sensitive operations.

### 6.2 Subprotocols

AEP supports composable subprotocols for specialized domains:
- Commerce subprotocol (transactions, payments)
- Identity subprotocol (authentication, authorization)
- Fleet subprotocol (multi-agent coordination)

## 7. Compliance

See `docs/COMPLIANCE.md` for:
- OWASP mapping
- SOC2/HIPAA/PCI-DSS alignment
- GDPR data handling
- Supply chain verification requirements

## 8. Migration

See `docs/MIGRATION-v1-to-v2.md` and `docs/MIGRATION-v2.1-to-v2.2.md` for upgrade paths from previous AEP versions.

## 9. References

- Research paper: https://github.com/thePM001/AEP-research-paper-001
- Live demo: https://aep.newlisbon.agency
- dynAEP: https://github.com/thePM001/dynAEP-dynamic-agent-element-protocol
- Agent harness: harness/aep-2.6-agent-harness/
- Policy lattice guide: See Policy Lattice Formation section in README.md
