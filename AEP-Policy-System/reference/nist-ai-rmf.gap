{
  "address": {
    "domain": "aep.reference.compliance.nist-ai-rmf",
    "id": "nist-ai-rmf.v1"
  },
  "pattern": {
    "guard": "true",
    "constraints": [
      "hard: apply reference policy lattice govern function before agent start",
      "hard: map risk context and trust tier at session registration",
      "hard: measure outputs via 15-step evaluation chain and trust scoring",
      "hard: manage incidents via escalation rules and kill switch",
      "hard: document AI system changes through policy version gates"
    ]
  },
  "action": {
    "type": "template",
    "content": "Enforce NIST AI RMF reference controls via regulation_module LRP nist-ai-rmf."
  },
  "weight": 1.0,
  "composition": {
    "type": "atomic"
  },
  "metadata": {
    "provenance": "aep.reference.compliance.nist-ai-rmf",
    "version": "1.0.0",
    "stability": "stable",
    "trust_ring": "governance",
    "lrp_id": "nist-ai-rmf",
    "framework": "NIST AI RMF 1.0"
  }
}