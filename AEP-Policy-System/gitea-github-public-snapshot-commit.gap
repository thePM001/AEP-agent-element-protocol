# AEP 2.8 Gitea to GitHub public snapshot commit message
# severity: critical
# description: The only allowed commit message content on AEP 2.8 pushes from Gitea to GitHub is AEP 2.8 public snapshot YYYY-MM-DD.

rules:
  - id: aep28-gitea-github-snapshot-commit-message-only
    description: Every commit in an AEP 2.8 push to github.com/thePM001/AEP-agent-element-protocol MUST have subject exactly AEP 2.8 public snapshot YYYY-MM-DD and no body. Example AEP 2.8 public snapshot 2026-07-27. Extra words, ticket ids, Signed-off-by and multi-line bodies are Deny.
  - id: aep28-gitea-github-snapshot-no-internal-subjects
    description: Internal Gitea subjects (ticket ids, repair notes, file lists) MUST NOT appear on the GitHub-facing AEP 2.8 snapshot. Squash or rewrite to the snapshot line before push.
  - id: aep28-gitea-github-snapshot-gate
    description: Enforcement is nla-policy-scan gate aep-gitea-github-snapshot-commit on the pre-push path to github.com. Unknown or empty message is Deny.
