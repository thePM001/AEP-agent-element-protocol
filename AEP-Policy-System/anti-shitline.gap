# AEP 2.8 anti-shitline
# severity: critical
# description: Operator-facing AEP prose must state the situation in ordinary connected English a person can act on. An overloaded run-on that dumps test names, crate names, gate names and verdicts is Deny.

rules:
  - id: aep28-anti-shitline-situation
    description: A person who was not in the session MUST be able to say what happened and what to do next after one read. Identifier dumps are Deny.
  - id: aep28-anti-shitline-no-overloaded-dump
    description: One overloaded sentence that stacks product verdicts, snake_case test names, hyphen crate names, gate names and tooling results is Deny. False-causal joiners so, while and plus that glue unrelated facts are Deny.
  - id: aep28-anti-shitline-heuristic
    description: Match by exact normalized seed, by identifier-set Jaccard against the example corpus and by an independent fingerprint so a similar dump fails before it is added as an example.
  - id: aep28-anti-shitline-corpus
    description: Additional examples are added gradually to anti-shitline-examples.gaplune. Seed specimens stay in the corpus and in scanner tests. Do not paste a forbidden specimen into operator-facing prose.
  - id: aep28-anti-shitline-impl-spray
    description: Repeating the same internal name, dumping source file paths or reciting a spec in operator-facing prose is Deny. A ticket locator and one short product-hole sentence stay allowed.
  - id: aep28-anti-shitline-not-telegram
    description: Stacked tiny verdict sentences stay under public-plain-english. This rule catches the opposite failure: one overloaded dump.
  - id: aep28-anti-shitline-gate
    description: Enforcement is nla-policy-scan deliver plus gate aep-anti-shitline. Write DENY on miss.
