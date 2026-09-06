# AEP 2.8 closed ticket title is mandatory
# severity: critical
# description: If a ticket is closed the operator close report MUST name that ticket title. Any real ticket title is legal. Omitting the title is Deny.

rules:
  - id: aep28-closed-ticket-id-mandatory
    description: A close report MUST name the closed ticket title. Do not write the closed ticket or ticket close is coding close without that title.
  - id: aep28-closed-ticket-id-coding-close
    description: Ticket close is coding close. Naming the real ticket title is the close report. There is no second close story.
  - id: aep28-closed-ticket-id-public-dump
    description: Operator reports MUST name the title. Public X posts MUST NOT dump ticket titles.
  - id: aep28-closed-ticket-id-gate
    description: Enforcement is nla-policy-scan deliver and gate aep-closed-ticket-id-mandatory. Policy nla-server-aep-closed-ticket-id-mandatory.
