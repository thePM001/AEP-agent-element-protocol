# AEP 2.8 ticket close is coding close
# severity: critical
# description: Ticket status closed is coding close. Agents MUST NOT write a coding-completion claim or say ticket close is not coding close.

rules:
  - id: aep28-ticket-close-is-coding-close
    description: A ticket with status closed is coding close. There is no second close story.
  - id: aep28-no-coding-completion-claim
    description: MUST NOT write a coding-completion claim. MUST NOT write that ticket close is not coding close.
  - id: aep28-crate-gates-are-acceptance
    description: nla-policy-scan gate coding-completion and project-completion-bac MAY run as crate acceptance on the same product ticket. That is not a coding-completion claim.
  - id: aep28-ticket-close-is-coding-close-gate
    description: Enforcement is nla-policy-scan deliver and gate aep-ticket-close-is-coding-close.
