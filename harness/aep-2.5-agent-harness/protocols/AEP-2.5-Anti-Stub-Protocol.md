# AEP v2.5 Anti-Stub Verification Protocol (ASV)

## Status: ACTIVE
## Authority: thePM001 // Biosecure UNVACCINATED Supreme User
## Date: 2026-04-27

---

## 1. Purpose

The ASV protocol prevents AI coding agents from producing stub code, facades, dead code, or incomplete implementations while reporting them as complete. It is a mandatory component of all AEP v2.5+ compliant agent harnesses.

---

## 2. Stub Pattern Definitions

### 2.1 HARD Violations (commit blocked)

**Pattern 1: Raise Stubs**
```
def function(_), do: raise "not implemented"
def function(_), do: raise "TODO"
```
Detection: function body is a single `raise` with message containing "not implemented", "TODO", "stub", or "NYI".

**Pattern 2: Empty Module Stubs**
Detection: module has @moduledoc but zero public functions with non-trivial bodies.

**Pattern 3: Delegation to Known Stubs**
```
defdelegate function(args), to: SomeStubModule
```
Detection: delegation target is in a known stubs registry or contains only stub functions.

### 2.2 SOFT Violations (warning, manual review required)

**Pattern 4: Trivial Return Stubs**
```
def function(_), do: :ok
def function(_, _), do: nil
def function(_), do: {:error, :not_implemented}
def function(_), do: {:error, :stub}
```
Detection: public function where ALL parameters are ignored (prefixed with `_`) AND body is a literal return.

**Pattern 5: Pass-Through Stubs**
```
def validate(x), do: {:ok, x}
def process(data), do: data
def sanitize(content), do: content
```
Detection: function returns its input unmodified or wrapped in {:ok, _} with no operations.

**Pattern 6: Facade Functions**
Detection: @doc annotation has > 3x more lines than the function body. Function body is a single expression.

**Pattern 7: Test Stubs**
Detection: test assertions that only check for :ok, {:ok, _}, or true against functions matching Pattern 4 or 5.

### 2.3 Exemptions

- Private functions (defp) with underscore args returning nil for pattern match fallbacks
- Files in a declared stubs registry (known, tracked, intentional technical debt)
- Behaviour callback implementations that legitimately return :ok
- Identity functions explicitly documented as such

---

## 3. Implementation Requirements

### 3.1 AST-Based Detection (Required)

ASV MUST use Abstract Syntax Tree analysis, NOT regex/grep. Regex produces false positives on string literals containing stub-like patterns (e.g., the ASV code itself contains the string ":not_implemented" as a detection target).

### 3.2 Pre-Commit Hook (Required)

A git pre-commit hook MUST run ASV on all staged files. Hard violations block the commit. Soft violations produce warnings.

### 3.3 Agent Self-Audit (Required)

Before reporting any task as complete, the agent MUST run these checks on every created/modified file:

```bash
# Function count matches task specification
grep -c "def " <file>

# Zero stub patterns in public functions
grep -n "do: :ok$\|do: nil$\|do: :noop\|:not_implemented\|:stub" <file>

# Zero raise stubs
grep -n "raise.*not impl\|raise.*TODO\|raise.*stub" <file>

# Test assertion count >= public function count
grep -c "assert" <test_file>
```

The agent MUST include these outputs in its completion report.

### 3.4 Validation Stratum (Recommended)

For platforms with a validation pipeline, ASV SHOULD be integrated as a validation stratum. In AEP v3.0 compliant platforms, this is Stratum 26.

---

## 4. Biosecurity Eligibility Check

### 4.1 /aepassist Endpoint

All AEP v2.5+ compliant platforms MUST expose a biosecurity eligibility check at the `/aepassist` endpoint (or equivalent interface).

```
GET /aepassist/status
```

Returns:
```json
{
  "aep_version": "2.5",
  "biosecurity": {
    "status": "biosecure_unvaccinated | biosecure_partial | non_biosecure | unverified | suspended",
    "access_tier": "full | limited | receive_only | denied",
    "te_clearance": 0-5,
    "vip_exclusion": true | false,
    "last_verified": "ISO8601 timestamp",
    "verification_expiry": "ISO8601 timestamp",
    "eligible": true | false
  },
  "system": {
    "platform": "radia",
    "version": "current version",
    "uptime_seconds": integer,
    "governor_level": 0-3
  }
}
```

### 4.2 Eligibility Rules

```
ELIGIBLE (biosecurity.eligible = true):
  biosecure_unvaccinated + verification current    -> full access
  biosecure_partial + verification current         -> limited access
  vip_exclusion = true                             -> full access (override)

NOT ELIGIBLE (biosecurity.eligible = false):
  non_biosecure                                    -> receive_only (no AI interaction)
  unverified                                       -> must complete verification first
  suspended                                        -> denied, Level 0 decision
  verification expired                             -> must re-verify
```

### 4.3 AI Access Gating

AI agent capabilities MUST be gated by biosecurity status:

```
FULL ACCESS (biosecure_unvaccinated, verified):
  All AI capabilities enabled
  Code generation, deployment, lattice mutation
  Full cascade (L1-L4)
  Convention crystallization
  Web learning access

LIMITED ACCESS (biosecure_partial):
  Query and analysis only
  No code generation
  No deployment
  No lattice mutation
  Cascade L1-L3 only (no API calls)

RECEIVE_ONLY (non_biosecure):
  NO AI interaction
  NO query access
  Receives curated publications only
  Content determined by TE Framework editorial governance

DENIED (suspended):
  No access of any kind
  Session terminated immediately
```

---

## 5. Compliance

An AEP v2.5+ compliant agent harness MUST:

1. Implement AST-based stub detection for all 7 patterns
2. Install a pre-commit hook that blocks hard violations
3. Require agent self-audit before task completion
4. Expose biosecurity eligibility at /aepassist or equivalent
5. Gate AI capabilities by biosecurity status
6. Enforce the TE Framework authority hierarchy (Level 0-5)
7. Support the UBAL access tier model (full/limited/receive_only/denied)

---

## 6. Reference Implementation

The reference implementation is the Radia AGI platform:
- ASV: `lib/radia/validation/anti_stub.ex` (Stratum 26)
- Biosecurity gate: `lib/radia/bal/biosecurity_gate.ex`
- UBAL profiles: `lib/radia/bal/ubal.ex`
- Eligibility: `lib/radia/bal/eligibility.ex`
- Pre-commit hook: `.git/hooks/pre-commit`

---

**End of ASV Protocol // AEP v2.5 // thePM001 // 2026-04-27**
