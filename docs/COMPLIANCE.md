# AEP 2.75 Compliance Mapping

This document maps AEP 2.75 features to requirements in the EU AI Act, SOC 2 Type II and HIPAA.

## EU AI Act

| EU AI Act Requirement | AEP 2.75 Feature |
|----------------------|-----------------|
| Art. 9 - Risk Management System | Trust Scoring with configurable risk tiers and automatic degradation; Schema Builder with MLE divergence detection for drift monitoring |
| Art. 13 - Transparency and Provision of Information | Evidence Ledger with full action audit trail and session reports; Merkle-Tree Audit Records with cryptographic proof bundles |
| Art. 14 - Human Oversight | Gates (human approval), Escalation Rules (automatic pause), Kill Switch; Workflow Graph with checkpoint-based phase approval |
| Art. 15 - Accuracy, Robustness and Cybersecurity | Execution Rings (least privilege), Forbidden Patterns, Structural Validation; Schema Builder spectral analysis detecting weak constraint coupling; Policy Builder invariant validation; MCP Security Gateway (tool poisoning, typosquatting, drift detection) |
| Art. 52 - Transparency for Certain AI Systems | Agent Identity with cryptographic verification and compact serialisation; Proof Bundles with Merkle roots and Ed25519 signatures |
| Art. 61 - Post-Market Monitoring | Evidence Ledger, Merkle Proofs, RFC 3161 Timestamps; Schema Builder online MLE estimation (Welford's algorithm) for continuous drift tracking |

## SOC 2 Type II

| SOC 2 Trust Service Criteria | AEP 2.75 Feature |
|------------------------------|-----------------|
| CC6.1 - Logical and Physical Access Controls | Execution Rings, Trust-Gated Capabilities, Agent Identity; MCP Security Gateway with tool-level blocking |
| CC6.2 - Prior to Issuing Credentials | Agent Identity Manager with key pair generation and expiry |
| CC6.3 - Based on Authorisation | Capability Scoping with paths, binaries and element prefix constraints; Policy Builder invariant enforcement via Rego deny rules |
| CC7.2 - Monitoring Activities | Evidence Ledger, Intent Drift Detection, Session Statistics; Intercept Proxy for MCP traffic monitoring; Graph Orchestration checkpoints |
| CC7.3 - Evaluation of Events | Trust Scoring (penalty/reward), Escalation Rules; Schema Builder MLE divergence alerts for schema drift |
| CC7.4 - Incident Response | Kill Switch, Rollback, Session Termination; Fleet Manager with pause/resume/kill capabilities |
| CC8.1 - Change Management | Optimistic Concurrency (_version), Rollback and Compensation Plans; Schema Builder compareSchemas for candidate evaluation; Policy Builder spectral impact projection for rule changes |

## HIPAA

| HIPAA Safeguard | AEP 2.75 Feature |
|----------------|-----------------|
| 164.312(a) - Access Control | Execution Rings, Trust Tiers, Capability Scoping; MCP Intercept Proxy with policy-based tool blocking |
| 164.312(b) - Audit Controls | Evidence Ledger (SHA-256 hash-chained), Merkle Proofs; Proof Bundles with ML-DSA-65 post-quantum signatures |
| 164.312(c) - Integrity | Merkle Tree per-entry verification, Post-Quantum Signatures; Schema Builder validation ensuring constraint integrity; Policy Builder coverage tracking |
| 164.312(d) - Person Authentication | Agent Identity (Ed25519/RSA), Cross-Agent Verification Handshake; Multi-Agent Collaboration with identity-gated delegation |
| 164.312(e) - Transmission Security | RFC 3161 Timestamps, Offline Signing for air-gapped environments; MCP Security Gateway monitoring inter-agent communication |
| 164.308(a)(5) - Security Awareness | OWASP Agentic AI Top 10 Mapping, Behavioural Covenants; Reference Policy Lattice (security, deployment, governance, writing standards) |

---

## AEP 2.75 Compliance Enhancements Over v2.2

| Capability | v2.2 | v2.75 |
|---|---|---|
| Audit trail | Hash-chained ledger | Merkle-Tree Audit Records with cryptographic proof bundles |
| Constraint validation | Forbidden Patterns (regex) | Schema Builder (MLE + spectral + permissiveness + modularity) + Policy Builder (invariant detection + Rego generation) |
| Tool security | Capability Scoping | MCP Security Gateway (poisoning, typosquatting, drift detection) + Intercept Proxy |
| Workflow governance | Escalation Rules | Graph Orchestration with persistent stateful checkpoints |
| Multi-agent | Cross-Agent Verification | Supervisor, debate and delegation collaboration primitives |
| Policy formats | GAP + Rego | GAP + Rego + Cedar transpilers + Reference Policy Lattice |
| Content scanners | Not present (v2.2) | 11 content scanners (v2.5) expanded to 12 (v2.75) |

---

Note: AEP 2.75 provides the governance framework and enforcement mechanisms. Organisations must still configure policies, identity requirements and evidence retention periods appropriate to their specific compliance obligations. The Schema Builder and Policy Builder validate the governance layer itself  -  ensuring that schemas and policies are mathematically sound before they govern agent outputs.
