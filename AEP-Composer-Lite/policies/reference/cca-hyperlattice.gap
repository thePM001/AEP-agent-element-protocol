{
  "address": {
    "domain": "aep.cca.hyperlattice",
    "id": "self-govern.v1"
  },
  "pattern": {
    "guard": "true",
    "constraints": [
      "action_path_composer_lite_cca_chat",
      "action_path_composer_lite_cca_validate_writing",
      "action_path_composer_lite_cca_release",
      "action_path_composer_lite_cca_topology_validate",
      "policy_writing_gap",
      "policy_composer_protocol",
      "policy_epscom_core"
    ],
    "invariants": [
      {
        "expr": "hyperlattice_self_govern",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "range_check",
        "description": "CCA must pass hyperlattice wrap before output or topology ships"
      }
    ]
  },
  "action": {
    "type": "template",
    "content": "CCA must pass hyperlattice validation before any output or topology ships."
  },
  "weight": 1.0,
  "composition": {
    "type": "atomic"
  },
  "metadata": {
    "provenance": "gapc-validated",
    "version": "1.0.0",
    "stability": "stable",
    "aspect": "procedural",
    "trust_ring": "system"
  }
}