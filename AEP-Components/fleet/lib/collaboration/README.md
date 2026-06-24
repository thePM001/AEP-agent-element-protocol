# AEP Multi-Agent Collaboration Primitives

Role-based agent team coordination with GAP-native role and handoff declarations.

## Patterns

### Supervisor Pattern
One agent governs sub-agents. Supervisor assigns tasks, validates outputs, enforces policies.
Sub-agents inherit supervisor's trust ring (monotonic safety).

### Debate Pattern
Agents cross-validate each other's outputs. Disagreements escalate to evidence ledger.
Majority-vote or consensus-based resolution.

### Task Delegation
Dynamic task assignment with inheritance. Child agents can never be less governed than parents.
GAP policies define delegation rules and limits.

## GAP Role Declaration

```gap
address:
 domain: aep.fleet
 id: agent-role.v1

action:
 type: role_declaration
 role:
 name: code_reviewer
 capabilities: [read_code, write_review, flag_issues]
 delegation: [tester]
 trust_ring: user
```

## Fleet Governance Integration

Extends existing src/fleet/ with collaboration layer.
All messages pass through 15-step evaluation chain.
Inter-agent messaging scanned by all 11 scanners.
