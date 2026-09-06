# AEP 2.8 finished ticket title is mandatory
# severity: critical
# description: If work on a ticket is finished the operator report MUST contain the dedicated sentence The finished ticket is {ID}. {ID} is the real ticket title. Any real ticket title is legal. Locator form alone is Deny.

rules:
  - id: aep28-finished-ticket-id-mandatory
    description: A finish or close report MUST contain the dedicated sentence The finished ticket is {ID}. Any real ticket title is legal.
  - id: aep28-finished-ticket-id-no-bury
    description: Locator form alone is Deny. Do not bury the title in a url.
  - id: aep28-finished-ticket-id-coding-close
    description: Ticket close is coding close. The dedicated sentence is the close report naming.
  - id: aep28-finished-ticket-id-gate
    description: Enforcement is nla-policy-scan deliver and gate aep-finished-ticket-id-mandatory. Policy nla-server-aep-finished-ticket-id-mandatory.
