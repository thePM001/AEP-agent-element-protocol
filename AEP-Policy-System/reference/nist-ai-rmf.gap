{
  "address": {
    "domain": "aep.reference.compliance.nist-ai-rmf",
    "id": "nist-ai-rmf.v1"
  },
  "pattern": {
    "guard": "true",
    "wrap": "nist-ai-rmf",
    "constraints": [
      "hard: apply reference policy lattice govern function before agent start",
      "hard: map risk context and agent_may grants at session registration",
      "hard: measure outputs via Admit collect-all of compiled walls plus live OPA on lattice-policy.rego and derived ledger scoring",
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
    "version": "1.1.0",
    "stability": "stable",
    "agent_may": [
      "*"
    ],
    "lrp_id": "nist-ai-rmf",
    "framework": "NIST AI RMF 1.0",
    "aep_version": "2.8.6",
    "wrap": "nist-ai-rmf"
  }
}
