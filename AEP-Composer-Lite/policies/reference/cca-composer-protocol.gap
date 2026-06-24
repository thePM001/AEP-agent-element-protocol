{
  "address": {
    "domain": "aep.cca.composer",
    "id": "protocol.v1"
  },
  "pattern": {
    "guard": "true",
    "constraints": [
      "node_type_lattice_hub_required",
      "node_types_allowed",
      "edge_kinds_allowed",
      "lattice_channel_only",
      "forbidden_canvas_dynaeep_core"
    ],
    "invariants": [
      {
        "expr": "node_type_lattice_hub_required",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "range_check",
        "description": "Topology must include Action Lattice hub type=lattice"
      },
      {
        "expr": "node_types_allowed",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "range_check",
        "description": "Only Composer Lite protocol node types permitted"
      },
      {
        "expr": "edge_kinds_allowed",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "range_check",
        "description": "Only action policy communicate integrate validation inference edges"
      },
      {
        "expr": "lattice_channel_only",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "range_check",
        "description": "No raw_http or bypass_lattice edges"
      },
      {
        "expr": "forbidden_canvas_dynaeep_core",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "range_check",
        "description": "Never duplicate dynaep-core as a canvas rectangle"
      }
    ]
  },
  "action": {
    "type": "template",
    "content": "Validate CCA topology proposals against AEP Composer Lite protocol before apply."
  },
  "weight": 1.0,
  "composition": {
    "type": "atomic"
  },
  "metadata": {
    "provenance": "gapc-validated",
    "version": "1.0.0",
    "stability": "stable",
    "aspect": "objective",
    "trust_ring": "system"
  }
}