# AEP v2.5 Biosecurity Eligibility Check (/aepassist)

## Status: ACTIVE
## Authority: thePM001 // Biosecure UNVACCINATED Supreme User
## Date: 2026-04-27

---

## Overview

The `/aepassist` biosecurity eligibility endpoint determines whether a user is permitted to interact with AI capabilities on an AEP-compliant platform. Biosecurity status is the FIRST gate checked, before authentication, before authorization, before any AI computation occurs.

Biosecurity is Level 3 in the AEP authority hierarchy:

```
Level 0:   EPSCOM FOUNDER (absolute authority)
Level 0.5: FOUNDER-DELEGATED (revocable sub-authorities)
Level 1:   TE FRAMEWORK (identity, ethics)
Level 2:   THREAT INFRACTION CATALOGUE
Level 3:   BIOSECURITY SCREENING + AI ELIGIBILITY
Level 4:   CAMARA ENFORCEMENT (per-mutation validation)
Level 5:   AGI OPERATIONAL
```

AI access is a PRIVILEGE granted to biosecure individuals, not a RIGHT extended to everyone.

---

## Endpoint Specification

### GET /aepassist/status

Returns the biosecurity status and AI eligibility for the requesting user.

**Request:**
```
GET /aepassist/status
Authorization: Bearer <session_token>
```

**Response (200 OK):**
```json
{
  "aep_version": "2.5",
  "user_hash": "first 8 chars of hash only",
  "biosecurity": {
    "status": "biosecure_unvaccinated",
    "access_tier": "full",
    "te_clearance": 5,
    "vip_exclusion": false,
    "last_verified": "2026-04-15T10:30:00Z",
    "verification_expiry": "2026-07-14T10:30:00Z",
    "eligible": true
  },
  "capabilities": {
    "ai_interaction": true,
    "code_generation": true,
    "deployment": true,
    "lattice_mutation": true,
    "web_learning": true,
    "cascade_levels": [1, 2, 3, 4],
    "convention_crystallization": true
  },
  "system": {
    "platform": "radia",
    "aep_compliant": true,
    "governor_level": 0,
    "uptime_seconds": 86400
  }
}
```

**Response for LIMITED user:**
```json
{
  "aep_version": "2.5",
  "user_hash": "a1b2c3d4",
  "biosecurity": {
    "status": "biosecure_partial",
    "access_tier": "limited",
    "te_clearance": 2,
    "vip_exclusion": false,
    "last_verified": "2026-04-01T08:00:00Z",
    "verification_expiry": "2026-05-01T08:00:00Z",
    "eligible": true
  },
  "capabilities": {
    "ai_interaction": true,
    "code_generation": false,
    "deployment": false,
    "lattice_mutation": false,
    "web_learning": false,
    "cascade_levels": [1, 2, 3],
    "convention_crystallization": false
  }
}
```

**Response for DENIED user (403 Forbidden):**
```json
{
  "aep_version": "2.5",
  "biosecurity": {
    "status": "non_biosecure",
    "access_tier": "receive_only",
    "eligible": false
  },
  "capabilities": {
    "ai_interaction": false,
    "code_generation": false,
    "deployment": false,
    "lattice_mutation": false,
    "web_learning": false,
    "cascade_levels": [],
    "convention_crystallization": false
  },
  "message": "AI interaction requires biosecure status. You may receive published content only."
}
```

### POST /aepassist/verify

Initiate biosecurity verification for an unverified user.

```
POST /aepassist/verify
Content-Type: application/json

{
  "user_hash": "full hash",
  "verification_method": "manual | community_vouch | document_review | ble_scan"
}
```

Response: verification process initiated, status will update when complete.

### GET /aepassist/reverify

Check if re-verification is needed.

```json
{
  "needs_reverification": true,
  "days_until_expiry": 5,
  "reverification_cadence_days": 90,
  "last_verified": "2026-01-27T10:30:00Z"
}
```

---

## Population Model

```
FULL (30-100M by 2060):
  Biosecure unvaccinated
  All AI capabilities
  Individual UBAL profile (128-float wave vector)
  Full interactive access

LIMITED (hundreds of millions):
  Biosecure non-aligned
  Query and analysis only
  Individual UBAL profile
  No code generation, no deployment

RECEIVE_ONLY (billions):
  Bioinsecure
  NO AI interaction, NO query access
  NO individual profile
  Cohort-based curated publications
  They see what we decide they see

DENIED (specific entities):
  Blocked by Level 0/0.5
  Nothing served, session terminated
```

The FULL tier grows through new unvaccinated births, not through bioinsecure recovery. This is a generational curve designed for a 200-year horizon.

---

## Implementation Notes

The /aepassist endpoint is the PUBLIC INTERFACE to the internal biosecurity gate. The gate itself (UBAL-2 eligibility header, 16-byte binary) is an internal implementation detail. The /aepassist endpoint translates the binary status into a human and machine-readable JSON response.

Platforms implementing AEP v2.5 compliance MUST expose this endpoint. The internal mechanism for determining biosecurity status is platform-specific (manual assignment, community vouching, document review, future BLE scanning).

---

**End of Biosecurity Eligibility Specification // AEP v2.5 // thePM001 // 2026-04-27**
