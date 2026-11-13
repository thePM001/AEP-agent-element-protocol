package api

import (
	"net"
	"testing"
	"time"

	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/policy"
)

func TestBuildAllowedEndpoints_StrictExactDomain(t *testing.T) {
	t.Cleanup(func() { resolveDomainWithTTL = resolveDomainTTL })
	resolveDomainWithTTL = func(_ string, _ time.Duration) ([]net.IP, time.Duration) {
		return []net.IP{net.ParseIP("1.1.1.1")}, 30 * time.Second
	}
	noResolvers(t)
	pol := &policy.Policy{
		NetworkRules: []policy.NetworkRule{
			{
				Name:     "allow-google",
				Domains:  []string{"www.google.com"},
				Ports:    []int{443},
				Decision: "allow",
			},
		},
	}
	engine, err := policy.NewEngine(pol, false, true)
	if err != nil {
		t.Fatal(err)
	}
	plan := buildAllowedEndpoints(engine, 60*time.Second)
	if !plan.DefaultDeny {
		t.Fatalf("expected the default deny armed when only exact domains are present")
	}
	if !hasAllowKey(plan, "1.1.1.1", 443) {
		t.Fatalf("expected an allow entry for the resolved domain")
	}
	if len(plan.Deny) != 0 || len(plan.DenyCIDRs) != 0 {
		t.Fatalf("expected no deny entries")
	}
}

// A literal domain allow without ports allows every port. The exact BPF map
// has no port 0 fallback, so the address must go to the LPM trie as a host
// prefix on port 0.
func TestBuildAllowedEndpoints_AnyPortHostGoesToTrie(t *testing.T) {
	t.Cleanup(func() { resolveDomainWithTTL = resolveDomainTTL })
	resolveDomainWithTTL = func(_ string, _ time.Duration) ([]net.IP, time.Duration) {
		return []net.IP{net.ParseIP("192.0.2.44")}, 30 * time.Second
	}
	noResolvers(t)
	pol := &policy.Policy{
		NetworkRules: []policy.NetworkRule{
			{Name: "allow-host", Domains: []string{"host.example.com"}, Decision: "allow"},
		},
	}
	engine, _ := policy.NewEngine(pol, false, true)
	plan := buildAllowedEndpoints(engine, 60*time.Second)
	if !hasCIDR(plan.AllowCIDRs, "192.0.2.44", 32, 0) {
		t.Fatalf("an any-port host allow must be a /32 trie entry on port 0: %+v", plan.AllowCIDRs)
	}
	for _, k := range plan.Allow {
		if k.Dport == 0 {
			t.Fatalf("exact allow entry with port 0 can never match: %+v", k)
		}
	}
}

func TestBuildAllowedEndpoints_CIDRAllowKeepsDefaultDeny(t *testing.T) {
	t.Cleanup(func() { resolveDomainWithTTL = resolveDomainTTL })
	noResolvers(t)
	pol := &policy.Policy{
		NetworkRules: []policy.NetworkRule{
			{
				Name:     "allow-cidr",
				CIDRs:    []string{"10.0.0.0/8"},
				Decision: "allow",
			},
		},
	}
	engine, err := policy.NewEngine(pol, false, true)
	if err != nil {
		t.Fatal(err)
	}
	plan := buildAllowedEndpoints(engine, 60*time.Second)
	if !plan.DefaultDeny {
		t.Fatalf("CIDR rules keep the default deny armed")
	}
	if !hasCIDR(plan.AllowCIDRs, "10.0.0.0", 8, 0) {
		t.Fatalf("expected the cidr in the allow trie")
	}
}

func TestBuildAllowedEndpoints_UnmatchedEgressDenyDropsCatchAll(t *testing.T) {
	t.Cleanup(func() { resolveDomainWithTTL = resolveDomainTTL })
	resolveDomainWithTTL = func(_ string, _ time.Duration) ([]net.IP, time.Duration) {
		return []net.IP{net.ParseIP("1.1.1.1")}, 30 * time.Second
	}
	noResolvers(t)
	build := func(mode string) bool {
		pol := &policy.Policy{
			UnmatchedEgress: mode,
			NetworkRules: []policy.NetworkRule{
				{Name: "allow-google", Domains: []string{"www.google.com"}, Ports: []int{443}, Decision: "allow"},
				{Name: "allow-any", Domains: []string{"*"}, Decision: "allow"},
			},
		}
		engine, err := policy.NewEngine(pol, false, true)
		if err != nil {
			t.Fatal(err)
		}
		return buildAllowedEndpoints(engine, 60*time.Second).DefaultDeny
	}
	if build("") {
		t.Fatalf("mode off: a catch-all allow rule allows every destination, so the default deny is off")
	}
	if !build("deny") {
		t.Fatalf("unmatched_egress deny: the catch-all allow rule is dropped, so the default deny is armed")
	}
}

// The name servers open only when the policy names hosts by domain.
func TestBuildAllowedEndpoints_ResolversOnlyForDomainRules(t *testing.T) {
	t.Cleanup(func() { resolveDomainWithTTL = resolveDomainTTL })
	t.Cleanup(func() { ebpfResolverAddrs = systemResolverAddrs })
	ebpfResolverAddrs = func() []net.IP { return []net.IP{net.ParseIP("192.0.2.53")} }

	cidrOnly, _ := policy.NewEngine(&policy.Policy{NetworkRules: []policy.NetworkRule{
		{Name: "allow-cidr", CIDRs: []string{"198.51.100.0/24"}, Decision: "allow"},
	}}, false, true)
	if plan := buildAllowedEndpoints(cidrOnly, time.Minute); hasAllowKey(plan, "192.0.2.53", 53) {
		t.Fatal("a policy without domain rules must not open the name server")
	}

	withDomain, _ := policy.NewEngine(&policy.Policy{NetworkRules: []policy.NetworkRule{
		{Name: "allow-wild", Domains: []string{"*.example.org"}, Decision: "allow"},
	}}, false, true)
	plan := buildAllowedEndpoints(withDomain, time.Minute)
	if !hasAllowKey(plan, "192.0.2.53", 53) {
		t.Fatal("a policy with domain rules must open the name server on port 53")
	}
	if len(plan.Resolvers) != 1 || plan.Resolvers[0] != "192.0.2.53" {
		t.Fatalf("resolvers = %v", plan.Resolvers)
	}
}

// A deny that names the name server address itself stays: the operator closed
// that server on purpose.
func TestBuildAllowedEndpoints_ExactDenyOfResolverStays(t *testing.T) {
	t.Cleanup(func() { resolveDomainWithTTL = resolveDomainTTL })
	t.Cleanup(func() { ebpfResolverAddrs = systemResolverAddrs })
	ebpfResolverAddrs = func() []net.IP { return []net.IP{net.ParseIP("192.0.2.53")} }
	engine, _ := policy.NewEngine(&policy.Policy{NetworkRules: []policy.NetworkRule{
		{Name: "allow-wild", Domains: []string{"*.example.org"}, Decision: "allow"},
		{Name: "deny-dns", CIDRs: []string{"192.0.2.53/32"}, Decision: "deny"},
	}}, false, true)
	plan := buildAllowedEndpoints(engine, time.Minute)
	if !denyMatches(plan, "192.0.2.53", 53) {
		t.Fatal("an exact policy deny on the name server must stay in the deny list")
	}
}
