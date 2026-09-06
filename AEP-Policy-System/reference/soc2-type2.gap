{
  "address": {
    "domain": "aep.reference.compliance.soc2",
    "id": "soc2-type2.v1"
  },
  "pattern": {
    "guard": "true",
    "wrap": "soc2",
    "constraints": [
      "hard: enforce capability scoping and execution ring access controls",
      "hard: rotate and expire agent credentials per configured policy",
      "hard: monitor all sessions via evidence ledger and intent drift detection",
      "hard: enable kill switch and rollback on incident escalation",
      "hard: require version gate approval for policy and schema changes"
    ]
  },
  "action": {
    "type": "template",
    "content": "Enforce SOC 2 Type II reference controls via regulation_module LRP soc2-type2."
  },
  "weight": 1.0,
  "composition": {
    "type": "atomic"
  },
  "metadata": {
    "provenance": "aep.reference.compliance.soc2",
    "version": "1.1.0",
    "stability": "stable",
    "agent_may": [
      "*"
    ],
    "lrp_id": "soc2-type2",
    "framework": "SOC 2 Type II",
    "aep_version": "2.8.5",
    "wrap": "soc2"
  }
}
