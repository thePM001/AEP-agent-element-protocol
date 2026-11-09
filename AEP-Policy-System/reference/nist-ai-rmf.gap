{
  "address": {
    "domain": "aep.reference.compliance.nistairmf",
    "id": "nist-ai-rmf.v1"
  },
  "pattern": {
    "guard": "true",
    "constraints": [
      "hard: apply reference policy lattice govern function before agent start",
      "hard: map risk context and agent_permission grants at session registration",
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
    "provenance": "aep.reference.compliance.nistairmf",
    "version": "1.1.0",
    "stability": "stable",
    "agent_permission": [
      {
        "agent_id": "agent-a",
        "action": "*"
      }
    ],
    "aep_version": "2.9.0",
    "wrap": "nist-ai-rmf"
  },
  "extensions": {
    "aep": {
      "lrp_id": "nist-ai-rmf",
      "framework": "NIST AI RMF 1.0"
    }
  }
}
