{
  "address": {
    "domain": "aep.reference.compliance.gdpr",
    "id": "gdpr.v1"
  },
  "pattern": {
    "guard": "true",
    "wrap": "privacy",
    "constraints": [
      "hard: minimise personal data in agent outputs and tool payloads",
      "hard: document lawful basis before processing personal data in a session",
      "hard: route erasure requests through human approval gate",
      "hard: block export of unredacted PII without explicit consent record",
      "hard: generate breach evidence bundle within 72-hour notification window"
    ]
  },
  "action": {
    "type": "template",
    "content": "Enforce GDPR reference controls via regulation_module LRP gdpr."
  },
  "weight": 1.0,
  "composition": {
    "type": "atomic"
  },
  "metadata": {
    "provenance": "aep.reference.compliance.gdpr",
    "version": "1.1.0",
    "stability": "stable",
    "agent_may": [
      "*"
    ],
    "lrp_id": "gdpr",
    "framework": "GDPR",
    "aep_version": "2.8.5",
    "wrap": "privacy"
  }
}
