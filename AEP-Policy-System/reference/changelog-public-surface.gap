{
  "address": {
    "domain": "aep.reference.distribution",
    "id": "changelog-public-surface.v1"
  },
  "pattern": {
    "guard": "true",
    "constraints": [
      "changelog_no_internal_distribution_tokens",
      "changelog_no_public_purge_narratives",
      "changelog_product_changes_only"
    ],
    "invariants": [
      {
        "expr": "no_internal_distribution_tokens",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "changelog_public_surface_scanner",
        "description": "CHANGELOG must not name internal-only distribution trees or internal publish gates"
      },
      {
        "expr": "no_public_purge_narratives",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "changelog_public_surface_scanner",
        "description": "CHANGELOG must not narrate removal of internal-only assets from public hosting"
      },
      {
        "expr": "product_facing_entries_only",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "changelog_public_surface_scanner",
        "description": "CHANGELOG entries must describe product features not publish hygiene"
      }
    ]
  },
  "action": {
    "type": "pipeline",
    "steps": [
      "Scan CHANGELOG.md",
      "Fail closed on hit"
    ]
  },
  "weight": 1,
  "composition": {
    "type": "atomic"
  },
  "metadata": {
    "provenance": "aep.reference.distribution.changelog-public-surface",
    "version": "1.0.0",
    "stability": "stable",
    "trust_ring": "governance",
    "format": "gaplune.policy.v1",
    "policy_name": "changelog-public-surface",
    "applies_to": [
      "CHANGELOG.md"
    ]
  }
}
