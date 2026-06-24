{
  "address": {
    "domain": "aep.reference.compliance.eu-ai-act",
    "id": "eu-ai-act.v1"
  },
  "pattern": {
    "guard": "true",
    "constraints": [
      "hard: maintain documented risk tiers with automatic trust degradation on drift",
      "hard: require human gate approval before high-impact autonomous actions",
      "hard: export session transparency report with Merkle audit proof on request",
      "hard: retain post-market monitoring evidence for configured retention period",
      "hard: agent outputs must carry verifiable identity for Art. 52 transparency"
    ]
  },
  "action": {
    "type": "template",
    "content": "Enforce EU AI Act reference controls via regulation_module LRP eu-ai-act."
  },
  "weight": 1.0,
  "composition": {
    "type": "atomic"
  },
  "metadata": {
    "provenance": "aep.reference.compliance.eu-ai-act",
    "version": "1.0.0",
    "stability": "stable",
    "trust_ring": "governance",
    "lrp_id": "eu-ai-act",
    "framework": "EU AI Act"
  }
}