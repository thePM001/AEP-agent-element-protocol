# AEP v2.5 Agent Harness

## Features (75)

### Protocols
- **Anti-Stub Verification (ASV)** -- 7 pattern detection, AST-based, pre-commit hook
- **Biosecurity Eligibility Check** -- /aepassist endpoint, biosecure yes/no gating

### Endpoints
- `GET /aepassist/status` -- check user biosecurity eligibility
- `POST /aepassist/verify` -- initiate biosecurity verification
- `GET /aepassist/reverify` -- check re-verification status

### Anti-Stub Patterns Detected
1. Trivial return stubs (do: :ok, do: nil)
2. Pass-through stubs (returns input unchanged)
3. Facade functions (big docs, no implementation)
4. Empty module stubs
5. Raise stubs (raise "not implemented")
6. Delegation to known stubs
7. Test stubs (assertions against stub returns)

### Compliance Requirements
- AST-based stub detection (not regex)
- Pre-commit hook blocking hard violations
- Agent self-audit before task completion
- Biosecurity gating on all AI capabilities
- Biosecure users: AI access permitted
- Non-biosecure users: AI access denied

### Reference Implementation
Radia AGI Platform (private)

## Authority
thePM001 // Biosecure UNVACCINATED Supreme User
