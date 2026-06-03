# Policy: Full and Correct Task Execution
# GAPC-VALIDATED: 2026-06-01 | 290 GBNF rules | 0 errors
# ID: full-correct-task-execution-mandatory.v1
# Trust Ring: SYSTEM | Grade: 10 | Mandatory

## Policy: ALL tasks MUST be executed always full and correct

### Scope
Applies to: code changes, deployments, configuration updates, page updates, component creation, infrastructure changes.

### Hard Invariants (BLOCK completion if violated)
1. **Full completeness** - Task must be fully completed. No half-fixes, no partial implementations.
2. **Verified correctness** - Task must be verified end-to-end. Features must actually work.
3. **Build success** - Build must compile and run without errors before committing.
4. **Zero broken references** - No broken links, dead code, missing imports, or dangling references.
5. **AEP registration** - New or modified components must be registered in AEP.
6. **Deployment tested** - Deployment must be end-to-end tested. Verify the page actually renders.

### Hard Violations
- Submitting incomplete work
- Leaving broken references or dead code
- Skipping verification steps
- Deploying without end-to-end testing
- Marking work done when features don't actually work
- Multi-step fixes where only some steps are completed
- Code that compiles but produces broken output (silent failures)

### Verification Checklist (MUST complete all)
- [ ] All features implemented with absolute correctness
- [ ] Build compiles without errors
- [ ] End-to-end verification of output (curl, browser, API)
- [ ] All links and references verified (no 404s, no wrong URLs)
- [ ] New/modified components registered in AEP
- [ ] No broken state left behind
- [ ] Multi-step fixes: ALL steps completed, not just the first one

### Examples of VIOLATIONS
- Canvas rendering fix applied but browser cache not cleared -> INCOMPLETE
- Page content updated but navbar links still point to old URLs -> BROKEN REFERENCES
- Nginx redirect fixed but page hardcoded links not updated -> MULTI-STEP INCOMPLETE
- Feature cards added but card details missing -> HALF-FIX
- Service restarted but page not verified -> SKIPPED VERIFICATION

### Post-Task Verification
Every task MUST end with a verification step that confirms the output is production-ready.
