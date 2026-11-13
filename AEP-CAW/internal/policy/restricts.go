package policy

import "strings"

// RestrictsFiles reports whether the file rules of the policy can refuse a file
// operation, so a file backend has to enforce them. A policy without file rules
// asks for nothing. A policy whose file rules all allow (or audit) and which
// holds an allow rule over every path and every operation refuses nothing.
// Every other policy with file rules restricts file access: the engine denies
// a path that no rule matches. AEP-CRV-040 refuses to run such a policy
// without an active file backend.
func (p *Policy) RestrictsFiles() bool {
	if p == nil || len(p.FileRules) == 0 {
		return false
	}
	catchAll := false
	for _, r := range p.FileRules {
		if !isPermissiveDecision(r.Decision) {
			return true
		}
		if fileRuleCoversEverything(r) {
			catchAll = true
		}
	}
	return !catchAll
}

// RestrictsNetwork reports whether the network rules of the policy can refuse
// a connection, so a network backend has to enforce them. The rule shapes
// follow RestrictsFiles: no rules ask for nothing, and a policy whose rules all
// allow and which holds a catch-all allow on every port refuses nothing. Under
// unmatched_egress: deny a catch-all allow stops matching, so it does not count.
func (p *Policy) RestrictsNetwork() bool {
	if p == nil || len(p.NetworkRules) == 0 {
		return false
	}
	catchAll := false
	for _, r := range p.NetworkRules {
		if !isPermissiveDecision(r.Decision) {
			return true
		}
		if r.IsCatchAll() && len(r.Ports) == 0 && !p.UnmatchedEgressDeny() {
			catchAll = true
		}
	}
	return !catchAll
}

// isPermissiveDecision reports whether a rule decision lets the operation run
// without asking anyone: allow, or audit (allow and record).
func isPermissiveDecision(d string) bool {
	switch strings.ToLower(strings.TrimSpace(d)) {
	case "allow", "audit":
		return true
	default:
		return false
	}
}

// fileRuleCoversEverything reports whether a file rule names every path and
// every operation.
func fileRuleCoversEverything(r FileRule) bool {
	allPaths := false
	for _, path := range r.Paths {
		switch strings.TrimSpace(path) {
		case "**", "/**":
			allPaths = true
		}
	}
	if !allPaths {
		return false
	}
	for _, op := range r.Operations {
		if strings.TrimSpace(op) == "*" {
			return true
		}
	}
	return false
}
