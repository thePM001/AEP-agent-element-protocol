{
  "address": {
    "domain": "aep.reference.compliance.hipaa",
    "id": "hipaa.v1"
  },
  "pattern": {
    "guard": "true",
    "constraints": [
      "hard: restrict PHI access to privileged trust tier agents only",
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
    "version": "1.0.0",
    "stability": "stable",
    "trust_ring": "security",
    "lrp_id": "hipaa",
    "framework": "HIPAA"
  }
}