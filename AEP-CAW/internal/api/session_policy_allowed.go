package api

import (
	"context"
	"fmt"
	"strings"
)

// sessionPolicyAllowed decides whether the caller may start a session under
// policyName (AEP-CRV-030, CAWB 02). The default policy and the names in
// policies.allowed are open to every caller. Any other policy file in the
// policy folder needs the admin role, so an agent key cannot pick a lenient
// policy for its own session. With auth disabled there is no role, so the list
// binds every caller.
func (a *App) sessionPolicyAllowed(ctx context.Context, policyName string) error {
	if !a.authDisabled() {
		if role, _ := ctx.Value(ctxKeyRole).(string); strings.EqualFold(role, "admin") {
			return nil
		}
	}
	if policyName == a.cfg.Policies.Default {
		return nil
	}
	for _, n := range a.cfg.Policies.Allowed {
		if strings.TrimSpace(n) == policyName {
			return nil
		}
	}
	return fmt.Errorf("policy %q is not allowed for this caller: add it to policies.allowed or use the default policy %q", policyName, a.cfg.Policies.Default)
}
