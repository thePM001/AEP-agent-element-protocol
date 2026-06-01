# AEP Privilege Rings

AEP 2.7 implements a 4-ring privilege model mapped onto the existing trust ring system.

## Ring Model

| Ring | Name | Trust Ring | Access |
|------|------|-----------|--------|
| 0 | Kernel | system | Harness, boot, identity, policy enforcement |
| 1 | System | enterprise | Governance policies, scanners, fleet control |
| 2 | User | user | Agent tools, code access, browser operations |
| 3 | Sandbox | sandbox | Development, testing, adversarial simulation |

## Ring Transitions

Agents move between rings based on:
- Boot registration (Ring 3 -> Ring 2)
- Policy compliance verification (Ring 2 -> Ring 1)
- Harness authorization (Ring 1 -> Ring 0)

## Violations

Ring violation attempts are Hard severity:
- Sandbox agent attempting system access -> blocked, logged, session terminated
- User agent attempting kernel access -> blocked, evidence ledger entry, trust score reduced
- System agent operating outside declared capability profile -> blocked, covenant violation

## Implementation

See `src/rings/` for the TypeScript implementation.
See `harness/aep-2.6-agent-harness/` for boot-time ring assignment.
See `policies/reference/governance.gap` for ring-based policy enforcement.
