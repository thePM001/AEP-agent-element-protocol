# AEP 2.8 no journal-only tickets
# severity: critical
# description: AEP tickets must name a product hole. A ticket whose only job is coding-completion or project-completion-bac journals after other work is Deny.

rules:
  - id: aep28-no-journal-only-tickets
    description: MUST NOT file a ticket whose task is only to run coding-completion or project-completion-bac journals after other tickets land. BAC belongs as acceptance on the product ticket.
  - id: aep28-no-not-a-product-hole-tickets
    description: MUST NOT file a ticket whose notes say it is not a product hole. If there is no product hole, there is no ticket.
  - id: aep28-bac-on-same-ticket
    description: A product ticket MAY require nla-policy-scan gate coding-completion and project-completion-bac as acceptance on that same ticket. That is not a journal ticket.
  - id: aep28-no-journal-tickets-gate
    description: Enforcement is nla-policy-scan gate aep-no-journal-tickets plus write-content on GAPLUNE ticket files. Open or backlog journal-only tickets are Deny. Closed historical files may stay.
