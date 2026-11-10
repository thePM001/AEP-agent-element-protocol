{
  "address": {
    "domain": "aep.reference.budget",
    "id": "budget.v1"
  },
  "pattern": {
    "guard": "true",
    "constraints": [
      "hard: agent.volume_bytes <= budget.agent.volume_bytes",
      "hard: agent.sensitivity <= budget.agent.sensitivity",
      "hard: agent.novelty <= budget.agent.novelty",
      "hard: wrap.volume_bytes <= budget.wrap.volume_bytes",
      "hard: wrap.sensitivity <= budget.wrap.sensitivity",
      "hard: wrap.novelty <= budget.wrap.novelty"
    ]
  },
  "action": {
    "type": "template",
    "content": "Hold every agent and every wrap inside a sliding window budget of volume, sensitivity and novelty. Admit closes the budget wall of the action that would pass a limit and Apply records only admitted actions."
  },
  "weight": 1.0,
  "composition": {
    "type": "atomic"
  },
  "metadata": {
    "provenance": "aep.reference.budget",
    "version": "1.0.0",
    "stability": "stable",
    "aep_version": "2.9.0"
  },
  "extensions": {
    "aep": {
      "budget": {
        "window_ms": 60000,
        "known_targets_max": 4096,
        "agent": {
          "volume_bytes": 262144,
          "sensitivity": 40,
          "novelty": 64
        },
        "wrap": {
          "volume_bytes": 1048576,
          "sensitivity": 120,
          "novelty": 256
        },
        "sensitivity_paths": [
          { "prefix": "secrets", "weight": 10 },
          { "prefix": "credentials", "weight": 10 },
          { "prefix": "health", "weight": 6 },
          { "prefix": "customer", "weight": 4 },
          { "prefix": "finance", "weight": 4 },
          { "prefix": "export", "weight": 4 },
          { "prefix": "records", "weight": 2 }
        ],
        "sensitivity_classes": {
          "secrets": 20,
          "pii": 8,
          "compliance": 6,
          "injection": 4,
          "mail": 4,
          "network": 2,
          "deployment": 2,
          "supply-chain": 2,
          "bindings": 2,
          "lattice": 2,
          "unicode": 1
        }
      }
    }
  }
}
