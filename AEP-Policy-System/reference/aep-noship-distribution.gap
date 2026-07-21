{
  "address": {
    "domain": "aep.platform.distribution",
    "id": "aep-noship.v1"
  },
  "pattern": {
    "guard": "distribution_attempt",
    "constraints": [
      "hard: AEP-NOSHIP/ must never ship to public GitHub or any public open-source release channel",
      "hard: AEP-NOSHIP/tests/, AEP-NOSHIP/plans/, and AEP-NOSHIP/docs/ are internal engineering assets only",
      "hard: runtime Docker images, npm packages, and public tarballs must exclude AEP-NOSHIP/",
      "hard: git push, gh release, and gh repo sync targeting github.com must not include AEP-NOSHIP/ paths",
      "soft: private Gitea or operator-controlled mirrors may retain AEP-NOSHIP/ for internal development",
      "hard: mechanical pre-push and gate-no-noship-on-github must fail closed if AEP-NOSHIP appears on any tip destined for github.com",
      "hard: human approval for github.com push does NOT authorize AEP-NOSHIP inclusion",
      "hard: public policy content must live under AEP-Policy-System/ (or other public trees), never under AEP-NOSHIP/",
      "hard: agents must not add AEP-NOSHIP paths when preparing github.com publishes or cherry-picks"
    ],
    "invariants": [
      {
        "expr": "public_github_push_includes_noship == false",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "path_scope_check",
        "description": "No public GitHub push may include AEP-NOSHIP/"
      },
      {
        "expr": "runtime_distribution_includes_noship == false",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "path_scope_check",
        "description": "Runtime distributions must exclude AEP-NOSHIP/"
      },
      {
        "expr": "npm_publish_includes_noship == false",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "path_scope_check",
        "description": "npm registry publish must not include AEP-NOSHIP/"
      },
      {
        "expr": "docker_image_includes_noship == false",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "path_scope_check",
        "description": "Container images must exclude AEP-NOSHIP/ via .dockerignore"
      },
      {
        "expr": "github_push_approval_cannot_include_noship == true",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "path_scope_check",
        "description": "Even with explicit GitHub push approval, AEP-NOSHIP/ paths are forbidden."
      },
      {
        "expr": "public_policy_not_under_noship == true",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "path_scope_check",
        "description": "Standard public policies ship under AEP-Policy-System, never AEP-NOSHIP."
      }
    ]
  },
  "action": {
    "type": "template",
    "content": "Enforce AEP-NOSHIP distribution boundary: internal-only assets under AEP-NOSHIP/ must not ship to GitHub, npm, or runtime distributions."
  },
  "weight": 1.0,
  "composition": {
    "type": "atomic"
  },
  "metadata": {
    "provenance": "aep.platform.distribution",
    "version": "2.8.0",
    "stability": "stable",
    "trust_ring": "system",
    "policy_class": "platform_mandatory",
    "authority": "EPSCOM",
    "protected_paths": [
      "AEP-NOSHIP/**"
    ],
    "excluded_from": [
      "github.com public repositories",
      "npm registry",
      "runtime docker images",
      "public release tarballs"
    ],
    "enforcement_updated": "2026-07-21",
    "enforcement_hooks": [
      "scripts/gate-no-noship-on-github.sh",
      "global pre-push AEP-NOSHIP path scan for github.com"
    ],
    "incident_note": "2026-07-21: NETWORK-EGRESS doc wrongly published under AEP-NOSHIP on GitHub; removed same day; public policy remains under AEP-Policy-System."
  }
}