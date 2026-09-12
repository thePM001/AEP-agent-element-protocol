{
  "address": {
    "domain": "aep.reference.compliance.hipaa",
    "id": "hipaa.v1"
  },
  "pattern": {
    "guard": "true",
    "wrap": "health",
    "constraints": [
      "hard: restrict PHI access to agents listed in agent_may only",
      "hard: record immutable hash-chained audit entry for every PHI-touching action",
      "hard: verify Merkle integrity on every evidence export",
      "hard: require authenticated agent identity before PHI tool invocation",
      "hard: monitor transmission paths via MCP intercept proxy policy"
    ]
  },
  "action": {
    "type": "template",
    "content": "Enforce HIPAA reference controls via regulation_module LRP hipaa."
  },
  "weight": 1.0,
  "composition": {
    "type": "atomic"
  },
  "metadata": {
    "provenance": "aep.reference.compliance.hipaa",
    "version": "1.1.0",
    "stability": "stable",
    "agent_may": [
      "*"
    ],
    "lrp_id": "hipaa",
    "framework": "HIPAA",
    "aep_version": "2.8.6",
    "wrap": "health"
  }
}
