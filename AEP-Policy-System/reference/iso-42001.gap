{
  "address": {
    "domain": "aep.reference.compliance.iso-42001",
    "id": "iso-42001.v1"
  },
  "pattern": {
    "guard": "true",
    "wrap": "iso-42001",
    "constraints": [
      "hard: require documented AI impact assessment before production deployment",
      "hard: assign agent_may grants based on agent competence and role",
      "hard: record operational evidence in ledger for performance evaluation",
      "hard: generate session performance review report on checkpoint",
      "hard: version all policy changes with compareSchemas impact review"
    ]
  },
  "action": {
    "type": "template",
    "content": "Enforce ISO 42001 reference controls via regulation_module LRP iso-42001."
  },
  "weight": 1.0,
  "composition": {
    "type": "atomic"
  },
  "metadata": {
    "provenance": "aep.reference.compliance.iso-42001",
    "version": "1.1.0",
    "stability": "stable",
    "agent_may": [
      "*"
    ],
    "lrp_id": "iso-42001",
    "framework": "ISO/IEC 42001",
    "aep_version": "2.8.6",
    "wrap": "iso-42001"
  }
}
