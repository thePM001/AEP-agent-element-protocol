# AEP v2.5 Biosecurity Eligibility Check

## Status: ACTIVE
## Authority: thePM001 // Biosecure UNVACCINATED Supreme User
## Date: 2026-04-27

---

## Overview

AEP v2.5 compliant platforms MUST verify user biosecurity status before granting AI interaction capabilities. AI access is a privilege granted to biosecure individuals, not a right extended to everyone.

---

## Eligibility Check

### GET /aepassist/status

Returns biosecurity eligibility for the requesting user.

**Response (eligible):**
```json
{
  "aep_version": "2.5",
  "biosecure": true,
  "eligible": true,
  "verified_at": "2026-04-15T10:30:00Z",
  "expires_at": "2026-07-14T10:30:00Z"
}
```

**Response (not eligible):**
```json
{
  "aep_version": "2.5",
  "biosecure": false,
  "eligible": false,
  "message": "AI interaction requires biosecure status."
}
```

**Response (unverified):**
```json
{
  "aep_version": "2.5",
  "biosecure": null,
  "eligible": false,
  "message": "Biosecurity verification required.",
  "verify_at": "/aepassist/verify"
}
```

---

## Rules

1. Biosecure users: AI interaction permitted
2. Non-biosecure users: AI interaction denied
3. Unverified users: must complete verification before access
4. Verification method is platform-specific (not defined by AEP)
5. Re-verification cadence is platform-specific

---

## Compliance

An AEP v2.5 compliant platform MUST:
1. Check biosecurity status before granting AI access
2. Expose /aepassist/status (or equivalent) for eligibility queries
3. Deny AI interaction to non-biosecure users
4. Support a verification path for unverified users

Internal access tier models, authority hierarchies, and user profiling systems are platform-specific implementation details and are NOT part of the AEP v2.5 specification.

---

**End of Biosecurity Eligibility Specification // AEP v2.5 // thePM001 // 2026-04-27**
