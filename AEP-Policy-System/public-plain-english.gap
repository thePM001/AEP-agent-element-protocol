# AEP 2.8 public plain English
# severity: critical
# description: Public AEP copy (X posts, README hero, public changelog intro, press) must be readable by a person who has never opened the repository, and must read like a person talking to a person.

rules:
  - id: aep28-public-plain-english-reader
    description: Public AEP copy MUST make sense to a builder or user who does not know the kernel. First sentences say what changed in ordinary English. Ticket ids, file names and crate names are not the story.
  - id: aep28-public-no-ticket-dump
    description: Public AEP copy MUST NOT lead with ticket ids (AEP28-ENV-025 and kin), test names, crate spray lists or file paths. Those belong in tickets and code review, not on X.
  - id: aep28-public-no-slogan-cut
    description: Forbidden public slogans include honesty cut, crate spray, collect-all AND and unexplained wrapenv. Say the real event in words a stranger can follow.
  - id: aep28-public-define-or-drop
    description: If a technical word is required, define it in the same sentence. If you cannot define it, drop it from the public post.
  - id: aep28-public-no-telegram-cadence
    description: Public AEP copy MUST read like a person talking to a person. Do not stack tiny verdict sentences. Three short punches in a row is Deny. Connect the thought. A competent engineer posting on X is the bar, not a status log.
  - id: aep28-public-gate
    description: Enforcement is nla-policy-scan deliver plus gate aep-public-plain-english. A public post that fails is Deny. Rewrite until a stranger can read it and a person would actually post it.
