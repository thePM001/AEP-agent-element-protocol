# AEP 2.2 Compliance Mapping

This document maps AEP 2.2 features to requirements in the EU AI Act, SOC 2 Type II and HIPAA.

## EU AI Act

| EU AI Act Requirement | AEP 2.2 Feature |
|----------------------|-----------------|
| Art. 9 -- Risk Management System | Trust Scoring with configurable risk tiers and automatic degradation |
| Art. 13 -- Transparency and Provision of Information | Evidence Ledger with full action audit trail and session reports |
| Art. 14 -- Human Oversight | Gates (human approval), Escalation Rules (automatic pause), Kill Switch |
| Art. 15 -- Accuracy, Robustness and Cybersecurity | Execution Rings (least privilege), Forbidden Patterns, Structural Validation |
| Art. 52 -- Transparency for Certain AI Systems | Agent Identity with cryptographic verification and compact serialisation |
| Art. 61 -- Post-Market Monitoring | Evidence Ledger, Merkle Proofs, RFC 3161 Timestamps |

## SOC 2 Type II

| SOC 2 Trust Service Criteria | AEP 2.2 Feature |
|------------------------------|-----------------|
| CC6.1 -- Logical and Physical Access Controls | Execution Rings, Trust-Gated Capabilities, Agent Identity |
| CC6.2 -- Prior to Issuing Credentials | Agent Identity Manager with key pair generation and expiry |
| CC6.3 -- Based on Authorisation | Capability Scoping with paths, binaries and element prefix constraints |
| CC7.2 -- Monitoring Activities | Evidence Ledger, Intent Drift Detection, Session Statistics |
| CC7.3 -- Evaluation of Events | Trust Scoring (penalty/reward), Escalation Rules |
| CC7.4 -- Incident Response | Kill Switch, Rollback, Session Termination |
| CC8.1 -- Change Management | Optimistic Concurrency (_version), Rollback and Compensation Plans |

## HIPAA

| HIPAA Safeguard | AEP 2.2 Feature |
|----------------|-----------------|
| 164.312(a) -- Access Control | Execution Rings, Trust Tiers, Capability Scoping |
| 164.312(b) -- Audit Controls | Evidence Ledger (SHA-256 hash-chained), Merkle Proofs |
| 164.312(c) -- Integrity | Merkle Tree per-entry verification, Post-Quantum Signatures |
| 164.312(d) -- Person Authentication | Agent Identity (Ed25519/RSA), Cross-Agent Verification Handshake |
| 164.312(e) -- Transmission Security | RFC 3161 Timestamps, Offline Signing for air-gapped environments |
| 164.308(a)(5) -- Security Awareness | OWASP Agentic AI Top 10 Mapping, Behavioural Covenants |

---

Note: AEP 2.2 provides the governance framework and enforcement mechanisms. Organisations must still configure policies, identity requirements and evidence retention periods appropriate to their specific compliance obligations.
