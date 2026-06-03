# Policy: Staging-Production URL Separation
# GAPC-VALIDATED: 2026-06-01 | 290 GBNF rules | 0 errors
# ID: staging-prod-url-separation.v1
# Trust Ring: SYSTEM | Grade: 10 | Mandatory

## Policy: ABSOLUTE PROHIBITION on mixing staging and production URLs

### Environment Detection
All pages MUST use environment-aware URL resolution. The canonical pattern is HexagonNav's `getNavUrls()`:
- **Staging**: `tasty.newlisbon.agency` (Tailscale-only)
- **Production**: `newlisbon.agency`, `aep.newlisbon.agency`, `my.newlisbon.agency`

### Constraints (HARD VIOLATIONS - block deployment)
1. Staging pages MUST NOT contain hardcoded production URLs (newlisbon.agency, aep.newlisbon.agency, my.newlisbon.agency)
2. Production pages MUST NOT contain hardcoded staging URLs
3. All navigation URLs MUST use environment-aware resolution via `HexagonNav.getNavUrls()`
4. Every new page or page update MUST pass URL audit before deployment

### Canonical URL Resolution Pattern
```
function getNavUrls() {
  const isStaging = window.location.hostname === 'tasty.newlisbon.agency'
  return {
    home: isStaging ? '/' : 'https://newlisbon.agency',
    aep:  isStaging ? '/aep' : 'https://aep.newlisbon.agency',
    // ... all links follow this pattern
  }
}
```

### Examples of VIOLATIONS
- `<a href="https://aep.newlisbon.agency/aep-demo">` on a staging page -> BLOCKED
- `<a href="https://tasty.newlisbon.agency/staging/shop">` on production -> BLOCKED
- CTA buttons, whitepaper links, demo links - ALL must be environment-aware

### Audit Gate
Before deployment, grep all pages for hardcoded domain references:
```
grep -r "newlisbon.agency\|tasty.newlisbon.agency" src/app/ --include="*.tsx"
```
Every match must be justified as environment-aware or fixed.

### In Doubt
Always check the manifest and deployment gates.
