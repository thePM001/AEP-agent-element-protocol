# /aep-validate

## AEP 2.5 Post-Edit Validation

After making code changes, run this validation before committing.

### Step 1: Run the Automated Validator

```bash
node harness/aep-validate.js
```

If the validator reports violations, fix ALL CRITICAL and HIGH severity issues before proceeding.

### Step 2: Manual Cross-Reference

For each file you modified, verify:

**Element Registration:**
- Does every new rendered element have a `data-aep-id` attribute?
- Does every `data-aep-id` have a matching entry in `aep-registry.yaml`?
- Does every registry entry have a matching entry in `aep-scene.json`?
- Does every `skin_binding` resolve in `aep-theme.yaml`?

**Visual Compliance:**
- Are all colors from the `aep-theme.yaml` palette? No hardcoded hex?
- Are all fonts/sizes/weights from typography tokens? No inline font declarations?
- Do all design_rules hold? (Check border-radius, shadows, borders, inputs, buttons)

**Structural Compliance:**
- Do parent-child relationships match `aep-scene.json`?
- Are z-index values consistent with the scene graph?
- Do element states match the `states` field in the registry?

**Naming Compliance:**
- No internal/architecture terms in user-facing text?
- Labels match registry entries?
- No underscores in user-facing labels?

### Step 3: Review Evidence Ledger

Check `.claude/aep-evidence.jsonl` for the current session's audit trail:
- Confirm all agent actions were recorded with timestamps and outcomes
- Verify no policy evaluation failures went unresolved
- If any rollback entries exist, confirm the rollback completed successfully

### Step 4: Declare

State: "AEP validation complete. {N} files checked. {N} violations found. Evidence ledger reviewed. {resolution}."

If zero violations: proceed to commit.
If violations remain: fix them before committing. Use rollback if a change introduced regressions.
