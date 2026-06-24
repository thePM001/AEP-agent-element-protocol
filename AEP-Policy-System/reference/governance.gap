{
  "address": {
    "domain": "aep.reference.governance",
    "id": "governance.v1"
  },
  "pattern": {
    "guard": "true",
    "constraints": [
      "hard: no grep, search_files, or read_file on source code",
      "hard: browser ops through isolated sandbox Firecracker microVM",
      "hard: every agent session registered via gapc validated GAP document",
      "hard: every agent scans output after every tool call and reports violations"
    ]
  },
  "action": {
    "type": "template",
    "content": "Enforce AEP 2.75 governance policy."
  },
  "weight": 1.0,
  "composition": {
    "type": "atomic"
  },
  "metadata": {
    "provenance": "aep.reference.governance",
    "version": "1.0.0",
    "stability": "stable",
    "trust_ring": "system"
  }
}