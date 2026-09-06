# AEP 2.8 closed ticket id is mandatory
# severity: critical
# description: If a ticket is closed the operator close report MUST name that ticket id (AEP28-ENV-068 form). Omitting the id is Deny.

rules:
  - id: aep28-closed-ticket-id-mandatory
    description: A close report MUST name the closed ticket id. Do not write the closed ticket or ticket close is coding close without that id.
  - id: aep28-closed-ticket-id-coding-close
    description: Ticket close is coding close. Naming AEP28-ENV-068 is the close report. There is no second close story.
  - id: aep28-closed-ticket-id-public-dump
    description: Operator reports MUST name the id. Public X posts MUST NOT dump ticket ids.
  - id: aep28-closed-ticket-id-gate
    description: Enforcement is nla-policy-scan deliver and gate aep-closed-ticket-id-mandatory. Policy nla-server-aep-closed-ticket-id-mandatory.
