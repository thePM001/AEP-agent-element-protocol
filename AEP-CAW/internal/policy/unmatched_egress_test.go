package policy

import (
	"context"
	"net"
	"strings"
	"testing"

	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/pkg/types"
)

const unmatchedEgressRule = "unmatched-egress-deny"

// Domain globs compile with '.' as separator, so the pattern "*" matches a
// single label host such as "intranet" but not "a.example". The tests use
// single label hosts wherever a "*" rule has to match.

func newUnmatchedEgressEngine(t *testing.T, mode string, rules ...NetworkRule) *Engine {
	t.Helper()
	p := &Policy{
		Version:         1,
		Name:            "unmatched-egress",
		UnmatchedEgress: mode,
		NetworkRules:    rules,
	}
	if err := p.Validate(); err != nil {
		t.Fatalf("validate: %v", err)
	}
	e, err := NewEngine(p, true, true)
	if err != nil {
		t.Fatal(err)
	}
	return e
}

// checkBoth runs CheckNetworkCtx with an IP literal (no DNS) and
// CheckNetworkIP with the same address and asserts they agree.
func checkBoth(t *testing.T, e *Engine, ip string, port int) Decision {
	t.Helper()
	ctxDec := e.CheckNetworkCtx(context.Background(), ip, port)
	ipDec := e.CheckNetworkIP("", net.ParseIP(ip), port)
	if ctxDec.EffectiveDecision != ipDec.EffectiveDecision || ctxDec.Rule != ipDec.Rule {
		t.Fatalf("CheckNetworkCtx %+v and CheckNetworkIP %+v disagree for %s:%d", ctxDec, ipDec, ip, port)
	}
	return ctxDec
}

func TestUnmatchedEgress_OffKeepsCatchAllDecisions(t *testing.T) {
	for _, mode := range []string{"", "default"} {
		e := newUnmatchedEgressEngine(t, mode,
			NetworkRule{Name: "approve-https", Ports: []int{443}, Decision: "approve"},
			NetworkRule{Name: "allow-any", Domains: []string{"*"}, Ports: []int{80}, Decision: "allow"},
		)
		dec := checkBoth(t, e, "203.0.113.7", 443)
		if dec.EffectiveDecision != types.DecisionApprove || dec.Rule != "approve-https" {
			t.Fatalf("mode %q: expected approve-https, got %+v", mode, dec)
		}
		dec = e.CheckNetworkCtx(context.Background(), "intranet", 80)
		if dec.EffectiveDecision != types.DecisionAllow || dec.Rule != "allow-any" {
			t.Fatalf("mode %q: expected allow-any, got %+v", mode, dec)
		}
		dec = checkBoth(t, e, "203.0.113.7", 22)
		if dec.EffectiveDecision != types.DecisionDeny || dec.Rule != "default-deny-network" {
			t.Fatalf("mode %q: expected default-deny-network, got %+v", mode, dec)
		}
	}
}

func TestUnmatchedEgress_DenyIgnoresCatchAllNonDenyRules(t *testing.T) {
	cases := []struct {
		name string
		rule NetworkRule
		ip   string
		off  types.Decision // effective decision of the rule with the mode off
	}{
		{"wildcard-allow", NetworkRule{Name: "allow-any", Domains: []string{"*"}, Decision: "allow"}, "203.0.113.7", types.DecisionAllow},
		{"ports-only-approve", NetworkRule{Name: "approve-https", Ports: []int{443}, Decision: "approve"}, "203.0.113.7", types.DecisionApprove},
		{"default-route-allow", NetworkRule{Name: "allow-all-v4", CIDRs: []string{"0.0.0.0/0"}, Decision: "allow"}, "203.0.113.7", types.DecisionAllow},
		{"default-route-v6-allow", NetworkRule{Name: "allow-all-v6", CIDRs: []string{"::/0"}, Domains: []string{"*"}, Decision: "allow"}, "2001:db8::7", types.DecisionAllow},
		{"wildcard-audit", NetworkRule{Name: "audit-any", Domains: []string{"*"}, Decision: "audit"}, "203.0.113.7", types.DecisionAllow},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// With the mode off the rule matches this destination.
			off := newUnmatchedEgressEngine(t, "", tc.rule)
			dec := off.CheckNetworkIP("intranet", net.ParseIP(tc.ip), 443)
			if dec.EffectiveDecision != tc.off || dec.Rule != tc.rule.Name {
				t.Fatalf("mode off: expected %s via %s, got %+v", tc.off, tc.rule.Name, dec)
			}

			on := newUnmatchedEgressEngine(t, "deny", tc.rule)
			dec = on.CheckNetworkIP("intranet", net.ParseIP(tc.ip), 443)
			if dec.EffectiveDecision != types.DecisionDeny || dec.Rule != unmatchedEgressRule {
				t.Fatalf("CheckNetworkIP: expected %s, got %+v", unmatchedEgressRule, dec)
			}
			if dec.Message != "no explicit network rule names this destination and unmatched_egress is deny" {
				t.Fatalf("unexpected message %q", dec.Message)
			}
			dec = on.CheckNetworkCtx(context.Background(), "intranet", 443)
			if dec.EffectiveDecision != types.DecisionDeny || dec.Rule != unmatchedEgressRule {
				t.Fatalf("CheckNetworkCtx domain: expected %s, got %+v", unmatchedEgressRule, dec)
			}
			for _, ip := range []string{"203.0.113.7", "2001:db8::7"} {
				dec = checkBoth(t, on, ip, 443)
				if dec.EffectiveDecision != types.DecisionDeny || dec.Rule != unmatchedEgressRule {
					t.Fatalf("%s: expected %s, got %+v", ip, unmatchedEgressRule, dec)
				}
			}
		})
	}
}

func TestUnmatchedEgress_DenyStillAllowsExplicitRules(t *testing.T) {
	// Domain rule: the only CIDR rule is a skipped catch-all, so
	// CheckNetworkCtx never resolves DNS here.
	dom := newUnmatchedEgressEngine(t, "deny",
		NetworkRule{Name: "allow-api", Domains: []string{"api.example.com"}, Ports: []int{443}, Decision: "allow"},
		NetworkRule{Name: "allow-any", Domains: []string{"*"}, Decision: "allow"},
		NetworkRule{Name: "allow-all-v4", CIDRs: []string{"0.0.0.0/0"}, Decision: "allow"},
	)
	dec := dom.CheckNetworkIP("api.example.com", net.ParseIP("198.51.100.4"), 443)
	if dec.EffectiveDecision != types.DecisionAllow || dec.Rule != "allow-api" {
		t.Fatalf("CheckNetworkIP: expected allow-api, got %+v", dec)
	}
	dec = dom.CheckNetworkCtx(context.Background(), "api.example.com", 443)
	if dec.EffectiveDecision != types.DecisionAllow || dec.Rule != "allow-api" {
		t.Fatalf("CheckNetworkCtx: expected allow-api, got %+v", dec)
	}
	dec = dom.CheckNetworkCtx(context.Background(), "api.example.com", 80)
	if dec.EffectiveDecision != types.DecisionDeny || dec.Rule != unmatchedEgressRule {
		t.Fatalf("wrong port: expected %s, got %+v", unmatchedEgressRule, dec)
	}

	// Domain rule that lists an IP literal, checked with an IP literal.
	lit := newUnmatchedEgressEngine(t, "deny",
		NetworkRule{Name: "allow-literal", Domains: []string{"198.51.100.4"}, Decision: "allow"},
		NetworkRule{Name: "allow-any", Domains: []string{"*"}, Decision: "allow"},
	)
	dec = lit.CheckNetworkCtx(context.Background(), "198.51.100.4", 443)
	if dec.EffectiveDecision != types.DecisionAllow || dec.Rule != "allow-literal" {
		t.Fatalf("CheckNetworkCtx literal: expected allow-literal, got %+v", dec)
	}
	dec = lit.CheckNetworkIP("198.51.100.4", net.ParseIP("198.51.100.4"), 443)
	if dec.EffectiveDecision != types.DecisionAllow || dec.Rule != "allow-literal" {
		t.Fatalf("CheckNetworkIP literal: expected allow-literal, got %+v", dec)
	}

	// CIDR rule.
	cidr := newUnmatchedEgressEngine(t, "deny",
		NetworkRule{Name: "allow-dock", CIDRs: []string{"127.0.0.1/32"}, Decision: "allow"},
		NetworkRule{Name: "allow-any", Domains: []string{"*"}, Decision: "allow"},
	)
	dec = checkBoth(t, cidr, "127.0.0.1", 8080)
	if dec.EffectiveDecision != types.DecisionAllow || dec.Rule != "allow-dock" {
		t.Fatalf("expected allow-dock, got %+v", dec)
	}
	dec = checkBoth(t, cidr, "203.0.113.7", 8080)
	if dec.EffectiveDecision != types.DecisionDeny || dec.Rule != unmatchedEgressRule {
		t.Fatalf("outside CIDR: expected %s, got %+v", unmatchedEgressRule, dec)
	}
}

func TestUnmatchedEgress_CatchAllDenyStillApplies(t *testing.T) {
	e := newUnmatchedEgressEngine(t, "deny",
		NetworkRule{Name: "allow-dock", CIDRs: []string{"127.0.0.1/32"}, Decision: "allow"},
		NetworkRule{Name: "deny-other-egress", Domains: []string{"*"}, Decision: "deny"},
		NetworkRule{Name: "allow-any", Domains: []string{"*"}, Decision: "allow"},
	)
	dec := e.CheckNetworkIP("intranet", net.ParseIP("203.0.113.7"), 443)
	if dec.EffectiveDecision != types.DecisionDeny || dec.Rule != "deny-other-egress" {
		t.Fatalf("CheckNetworkIP: expected deny-other-egress, got %+v", dec)
	}
	dec = e.CheckNetworkCtx(context.Background(), "intranet", 443)
	if dec.EffectiveDecision != types.DecisionDeny || dec.Rule != "deny-other-egress" {
		t.Fatalf("CheckNetworkCtx: expected deny-other-egress, got %+v", dec)
	}
	// A destination the "*" glob does not reach still ends in the fallback.
	dec = checkBoth(t, e, "203.0.113.7", 443)
	if dec.EffectiveDecision != types.DecisionDeny || dec.Rule != unmatchedEgressRule {
		t.Fatalf("expected %s, got %+v", unmatchedEgressRule, dec)
	}
	dec = checkBoth(t, e, "127.0.0.1", 9000)
	if dec.EffectiveDecision != types.DecisionAllow || dec.Rule != "allow-dock" {
		t.Fatalf("expected allow-dock, got %+v", dec)
	}
}

func TestUnmatchedEgress_ValidateRejectsUnknownValue(t *testing.T) {
	for _, v := range []string{"", "default", "deny"} {
		p := Policy{Version: 1, Name: "x", UnmatchedEgress: v}
		if err := p.Validate(); err != nil {
			t.Fatalf("value %q: unexpected error %v", v, err)
		}
	}
	p := Policy{Version: 1, Name: "x", UnmatchedEgress: "allow"}
	err := p.Validate()
	if err == nil || !strings.Contains(err.Error(), "unmatched_egress") {
		t.Fatalf("expected unmatched_egress error, got %v", err)
	}
	if _, err := LoadFromBytesNamed([]byte("version: 1\nname: x\nunmatched_egress: allow\n"), "x"); err == nil {
		t.Fatal("expected load to reject unmatched_egress: allow")
	}
}

func TestUnmatchedEgress_LoadFromBytesNamed(t *testing.T) {
	src := `version: 1
name: wrapped
unmatched_egress: deny
network_rules:
  - name: allow-dock
    cidrs: ["127.0.0.1/32"]
    decision: allow
  - name: allow-any
    domains: ["*"]
    decision: allow
`
	p, err := LoadFromBytesNamed([]byte(src), "wrapped")
	if err != nil {
		t.Fatal(err)
	}
	if !p.UnmatchedEgressDeny() {
		t.Fatalf("expected UnmatchedEgressDeny, got %q", p.UnmatchedEgress)
	}
	e, err := NewEngine(p, false, true)
	if err != nil {
		t.Fatal(err)
	}
	dec := checkBoth(t, e, "203.0.113.7", 443)
	if dec.EffectiveDecision != types.DecisionDeny || dec.Rule != unmatchedEgressRule {
		t.Fatalf("expected %s, got %+v", unmatchedEgressRule, dec)
	}

	off, err := LoadFromBytesNamed([]byte("version: 1\nname: plain\n"), "plain")
	if err != nil {
		t.Fatal(err)
	}
	if off.UnmatchedEgressDeny() {
		t.Fatal("unmatched_egress must be off by default")
	}
	var nilPolicy *Policy
	if nilPolicy.UnmatchedEgressDeny() {
		t.Fatal("nil policy must report the mode off")
	}
}

func TestUnmatchedEgress_NetworkRulesFiltering(t *testing.T) {
	rules := []NetworkRule{
		{Name: "allow-api", Domains: []string{"api.example.com"}, Decision: "allow"},
		{Name: "allow-dock", CIDRs: []string{"127.0.0.1/32"}, Decision: "allow"},
		{Name: "allow-any", Domains: []string{"*"}, Decision: "allow"},
		{Name: "approve-https", Ports: []int{443}, Decision: "approve"},
		{Name: "allow-all-v4", CIDRs: []string{"0.0.0.0/0"}, Decision: "allow"},
		{Name: "audit-any", Domains: []string{"*"}, Decision: "audit"},
		{Name: "deny-other-egress", Domains: []string{"*"}, Decision: "deny"},
	}
	names := func(rs []NetworkRule) string {
		var out []string
		for _, r := range rs {
			out = append(out, r.Name)
		}
		return strings.Join(out, ",")
	}

	off := newUnmatchedEgressEngine(t, "", rules...)
	if got, want := names(off.NetworkRules()), names(rules); got != want {
		t.Fatalf("mode off: got %s want %s", got, want)
	}

	on := newUnmatchedEgressEngine(t, "deny", rules...)
	if got, want := names(on.NetworkRules()), "allow-api,allow-dock,deny-other-egress"; got != want {
		t.Fatalf("mode on: got %s want %s", got, want)
	}
	if got := len(on.Policy().NetworkRules); got != len(rules) {
		t.Fatalf("filtering must not change the policy, got %d rules", got)
	}
}

func TestNetworkRule_IsCatchAll(t *testing.T) {
	cases := []struct {
		rule NetworkRule
		want bool
	}{
		{NetworkRule{}, true},
		{NetworkRule{Ports: []int{443}}, true},
		{NetworkRule{Domains: []string{"*"}}, true},
		{NetworkRule{Domains: []string{"*", "*"}, Ports: []int{80}}, true},
		{NetworkRule{CIDRs: []string{"0.0.0.0/0", "::/0"}}, true},
		{NetworkRule{CIDRs: []string{"0.0.0.0/0"}, Domains: []string{"*"}}, true},
		{NetworkRule{Domains: []string{"**"}}, true},
		{NetworkRule{Domains: []string{"*.*", "?*"}, Ports: []int{443}}, true},
		{NetworkRule{Domains: []string{"*.example.com"}}, false},
		{NetworkRule{Domains: []string{"*", "api.example.com"}}, false},
		{NetworkRule{CIDRs: []string{"10.0.0.0/8"}}, false},
		{NetworkRule{CIDRs: []string{"0.0.0.0/0", "10.0.0.0/8"}}, false},
		{NetworkRule{CIDRs: []string{"0.0.0.0/0"}, Domains: []string{"api.example.com"}}, false},
	}
	for i, tc := range cases {
		if got := tc.rule.IsCatchAll(); got != tc.want {
			t.Fatalf("case %d %+v: IsCatchAll=%v want %v", i, tc.rule, got, tc.want)
		}
		cr := compiledNetworkRule{rule: tc.rule}
		for _, c := range tc.rule.CIDRs {
			_, n, err := net.ParseCIDR(c)
			if err != nil {
				t.Fatal(err)
			}
			cr.cidrs = append(cr.cidrs, n)
		}
		if got := cr.isCatchAll(); got != tc.want {
			t.Fatalf("case %d %+v: compiled isCatchAll=%v want %v", i, tc.rule, got, tc.want)
		}
	}
}

// A "**" glob spans label separators and matches every host, so it names no
// destination. Under unmatched_egress: deny an allow rule written that way
// must not let a dotted host through.
func TestUnmatchedEgress_DoubleStarAllowIsCatchAll(t *testing.T) {
	rule := NetworkRule{Name: "allow-everything", Domains: []string{"**"}, Decision: "allow"}
	off := newUnmatchedEgressEngine(t, "", rule)
	dec := off.CheckNetworkCtx(context.Background(), "api.example.org", 443)
	if dec.EffectiveDecision != types.DecisionAllow || dec.Rule != "allow-everything" {
		t.Fatalf("mode off: expected allow-everything, got %+v", dec)
	}
	on := newUnmatchedEgressEngine(t, "deny", rule)
	dec = on.CheckNetworkCtx(context.Background(), "api.example.org", 443)
	if dec.EffectiveDecision != types.DecisionDeny || dec.Rule != unmatchedEgressRule {
		t.Fatalf("mode deny: expected %s, got %+v", unmatchedEgressRule, dec)
	}
}

func TestIsWildcardDomain(t *testing.T) {
	for _, d := range []string{"*", "**", " * ", "*.*", "?*", "*.?"} {
		if !IsWildcardDomain(d) {
			t.Fatalf("%q should be a wildcard", d)
		}
	}
	for _, d := range []string{"", "a", "*.example.com", "intranet", "*a"} {
		if IsWildcardDomain(d) {
			t.Fatalf("%q should name a destination", d)
		}
	}
}
