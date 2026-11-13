package api

import (
	"net"
	"testing"
	"time"

	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/netmonitor/ebpf"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/policy"
)

func TestBuildAllowedEndpoints_MixedRules(t *testing.T) {
	t.Cleanup(func() { resolveDomainWithTTL = resolveDomainTTL })
	resolveDomainWithTTL = func(domain string, _ time.Duration) ([]net.IP, time.Duration) {
		switch domain {
		case "a.example.com":
			return []net.IP{net.ParseIP("1.2.3.4")}, 30 * time.Second
		case "b.example.com":
			return []net.IP{net.ParseIP("2001:db8::1")}, 45 * time.Second
		default:
			return nil, 0
		}
	}
	noResolvers(t)

	pol := &policy.Policy{
		NetworkRules: []policy.NetworkRule{
			{
				Name:     "allow-a",
				Domains:  []string{"a.example.com"},
				Ports:    []int{443},
				Decision: "allow",
			},
			{
				Name:     "allow-b-cidr",
				CIDRs:    []string{"10.0.0.0/8"},
				Ports:    []int{80},
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
		t.Fatalf("expected the default deny armed for exact domains and a cidr")
	}
	if !plan.HasDomains {
		t.Fatalf("expected HasDomains true")
	}
	if plan.TTLHint == 0 {
		t.Fatalf("expected ttl hint > 0")
	}
	if !hasAllowKey(plan, "1.2.3.4", 443) {
		t.Fatalf("expected an exact allow entry for a.example.com:443")
	}
	if !hasCIDR(plan.AllowCIDRs, "10.0.0.0", 8, 80) {
		t.Fatalf("expected an allow CIDR entry for 10.0.0.0/8:80")
	}
	if len(plan.Deny) != 0 || len(plan.DenyCIDRs) != 0 {
		t.Fatalf("expected no deny entries")
	}
}

// CAWA-16 acceptance: a wildcard allow keeps the default deny armed.
func TestBuildAllowedEndpoints_WildcardKeepsDefaultDeny(t *testing.T) {
	t.Cleanup(func() { resolveDomainWithTTL = resolveDomainTTL })
	resolveDomainWithTTL = func(_ string, _ time.Duration) ([]net.IP, time.Duration) {
		return []net.IP{net.ParseIP("1.1.1.1")}, 10 * time.Second
	}
	noResolvers(t)
	pol := &policy.Policy{
		NetworkRules: []policy.NetworkRule{
			{
				Name:     "wild",
				Domains:  []string{"*.example.com"},
				Decision: "allow",
			},
		},
	}
	engine, _ := policy.NewEngine(pol, false, true)
	plan := buildAllowedEndpoints(engine, 60*time.Second)
	if !plan.DefaultDeny {
		t.Fatalf("a wildcard allow domain disarmed the default deny")
	}
	if len(plan.UnservedWildcards) != 1 || plan.UnservedWildcards[0] != "*.example.com" {
		t.Fatalf("unserved wildcards = %v, want [*.example.com]", plan.UnservedWildcards)
	}
}

// CAWA-16 acceptance: one literal allow that does not resolve keeps the
// default deny armed and adds no address.
func TestBuildAllowedEndpoints_UnresolvedLiteralKeepsDefaultDeny(t *testing.T) {
	t.Cleanup(func() { resolveDomainWithTTL = resolveDomainTTL })
	resolveDomainWithTTL = func(domain string, _ time.Duration) ([]net.IP, time.Duration) {
		if domain == "ok.example.com" {
			return []net.IP{net.ParseIP("192.0.2.10")}, 10 * time.Second
		}
		return nil, 0
	}
	noResolvers(t)
	pol := &policy.Policy{
		NetworkRules: []policy.NetworkRule{
			{Name: "ok", Domains: []string{"ok.example.com"}, Ports: []int{443}, Decision: "allow"},
			{Name: "gone", Domains: []string{"gone.example.com"}, Ports: []int{443}, Decision: "allow"},
		},
	}
	engine, _ := policy.NewEngine(pol, false, true)
	plan := buildAllowedEndpoints(engine, 60*time.Second)
	if !plan.DefaultDeny {
		t.Fatalf("an unresolved literal allow disarmed the default deny")
	}
	if len(plan.Unresolved) != 1 || plan.Unresolved[0] != "gone.example.com" {
		t.Fatalf("unresolved = %v, want [gone.example.com]", plan.Unresolved)
	}
	if !hasAllowKey(plan, "192.0.2.10", 443) {
		t.Fatalf("the resolved literal is missing from the allow list")
	}
}

func TestBuildAllowedEndpoints_ShippedDefaultPolicy(t *testing.T) {
	t.Cleanup(func() { resolveDomainWithTTL = resolveDomainTTL })
	resolveDomainWithTTL = func(domain string, _ time.Duration) ([]net.IP, time.Duration) {
		if domain == "github.com" {
			return []net.IP{net.ParseIP("140.82.112.3")}, 60 * time.Second
		}
		return nil, 0
	}
	t.Cleanup(func() { ebpfResolverAddrs = systemResolverAddrs })
	ebpfResolverAddrs = func() []net.IP { return []net.IP{net.ParseIP("127.0.0.53")} }

	p, err := policy.LoadFromFile("../../configs/policies/default.yaml")
	if err != nil {
		t.Fatal(err)
	}
	engine, err := policy.NewEngine(p, false, true)
	if err != nil {
		t.Fatal(err)
	}
	plan := buildAllowedEndpoints(engine, 60*time.Second)
	if !plan.DefaultDeny {
		t.Fatal("the shipped default policy must run with the default deny armed")
	}
	if !hasAllowKey(plan, "140.82.112.3", 443) || !hasAllowKey(plan, "140.82.112.3", 22) {
		t.Fatal("github.com is missing from the allow list on 443 and 22")
	}
	if !hasAllowKey(plan, "127.0.0.53", 53) {
		t.Fatal("the system name server is missing on port 53")
	}
	// allow-llm-proxy names 127.0.0.1/32, which outranks block-private-networks
	// on 127.0.0.0/8: the engine allows it, so the kernel deny list must not
	// hold it. The name server address leaves the deny list as well.
	for _, ip := range []string{"127.0.0.1", "127.0.0.53"} {
		if denyMatches(plan, ip, 8080) {
			t.Fatalf("%s is still in the kernel deny list", ip)
		}
	}
	// Every other address of 127.0.0.0/8 stays denied.
	for _, ip := range []string{"127.0.0.2", "127.0.0.52", "127.0.0.54", "127.255.255.255"} {
		if !denyMatches(plan, ip, 8080) {
			t.Fatalf("%s left the kernel deny list", ip)
		}
	}
	if !denyMatches(plan, "169.254.169.254", 80) || !denyMatches(plan, "10.1.2.3", 443) {
		t.Fatal("metadata and private ranges must stay denied")
	}
}

func TestBuildAllowedEndpoints_CatchAllAllowDisarmsDefaultDeny(t *testing.T) {
	t.Cleanup(func() { resolveDomainWithTTL = resolveDomainTTL })
	noResolvers(t)
	pol := &policy.Policy{
		NetworkRules: []policy.NetworkRule{
			{Name: "deny-meta", CIDRs: []string{"169.254.169.254/32"}, Decision: "deny"},
			{Name: "allow-all", Domains: []string{"*"}, Decision: "allow"},
		},
	}
	engine, _ := policy.NewEngine(pol, false, true)
	plan := buildAllowedEndpoints(engine, 60*time.Second)
	if plan.DefaultDeny {
		t.Fatal("a catch-all allow on every port must leave the default deny off")
	}
	if !denyMatches(plan, "169.254.169.254", 80) {
		t.Fatal("the deny rule must still reach the kernel")
	}
}

func TestBuildAllowedEndpoints_PortOnlyAllow(t *testing.T) {
	t.Cleanup(func() { resolveDomainWithTTL = resolveDomainTTL })
	noResolvers(t)
	pol := &policy.Policy{
		NetworkRules: []policy.NetworkRule{
			{Name: "https-anywhere", Ports: []int{443}, Decision: "allow"},
		},
	}
	engine, _ := policy.NewEngine(pol, false, true)
	plan := buildAllowedEndpoints(engine, 60*time.Second)
	if !plan.DefaultDeny {
		t.Fatal("a port-only allow must keep the default deny for other ports")
	}
	if !hasCIDR(plan.AllowCIDRs, "0.0.0.0", 0, 443) || !hasCIDR(plan.AllowCIDRs, "::", 0, 443) {
		t.Fatal("a port-only allow must open every address on its port")
	}
}

// A port-specific allow inside an any-port deny is carved out only while no
// losing allow would open the other ports of the carved addresses.
func TestBuildAllowedEndpoints_CarveRespectsLosingPortAllow(t *testing.T) {
	t.Cleanup(func() { resolveDomainWithTTL = resolveDomainTTL })
	noResolvers(t)
	pol := &policy.Policy{
		NetworkRules: []policy.NetworkRule{
			{Name: "deny-private", CIDRs: []string{"10.0.0.0/8"}, Decision: "deny"},
			{Name: "allow-svc", CIDRs: []string{"10.1.0.0/16"}, Ports: []int{443}, Decision: "allow"},
			{Name: "http-anywhere", Ports: []int{80}, Decision: "allow"},
		},
	}
	engine, _ := policy.NewEngine(pol, false, true)
	plan := buildAllowedEndpoints(engine, 60*time.Second)
	// Carving 10.1.0.0/16 for every port would let http-anywhere open
	// 10.1.2.3:80, which the engine denies. The deny must stay whole.
	if !denyMatches(plan, "10.1.2.3", 80) {
		t.Fatal("10.1.2.3:80 left the deny list although the engine denies it")
	}
	if dec := engine.CheckNetworkIP("", net.ParseIP("10.1.2.3"), 80); dec.EffectiveDecision != "deny" {
		t.Fatalf("engine decision for 10.1.2.3:80 = %s, want deny", dec.EffectiveDecision)
	}
}

func TestSubtractPrefix(t *testing.T) {
	_, outer, _ := net.ParseCIDR("10.0.0.0/8")
	_, inner, _ := net.ParseCIDR("10.1.2.0/24")
	pieces := subtractPrefix(newPrefix(outer, 0), newPrefix(inner, 0))
	if len(pieces) != 16 {
		t.Fatalf("pieces = %d, want 16", len(pieces))
	}
	in := net.ParseIP("10.1.2.77")
	for _, p := range pieces {
		if p.net.Contains(in) {
			t.Fatalf("piece %s still holds the carved address", p.net)
		}
		if p.origin != 8 {
			t.Fatalf("piece %s origin = %d, want 8", p.net, p.origin)
		}
	}
	for _, ip := range []string{"10.0.0.1", "10.1.3.1", "10.255.0.1", "10.1.2.255"} {
		covered := false
		for _, p := range pieces {
			if p.net.Contains(net.ParseIP(ip)) {
				covered = true
			}
		}
		if covered == (ip == "10.1.2.255") {
			t.Fatalf("%s covered = %v", ip, covered)
		}
	}
}

func noResolvers(t *testing.T) {
	t.Helper()
	t.Cleanup(func() { ebpfResolverAddrs = systemResolverAddrs })
	ebpfResolverAddrs = func() []net.IP { return nil }
}

func hasAllowKey(plan ebpfAllowPlan, ip string, port uint16) bool {
	want := net.ParseIP(ip)
	for _, k := range plan.Allow {
		if k.Dport != port {
			continue
		}
		var got net.IP
		if k.Family == 2 {
			got = net.IP(k.Addr[:4])
		} else {
			got = net.IP(k.Addr[:])
		}
		if got.Equal(want) {
			return true
		}
	}
	return false
}

func hasCIDR(cidrs []ebpf.AllowCIDR, ip string, prefix uint32, port uint16) bool {
	want := net.ParseIP(ip)
	for _, c := range cidrs {
		if c.PrefixLen != prefix || c.Dport != port {
			continue
		}
		var got net.IP
		if c.Family == 2 {
			got = net.IP(c.Addr[:4])
		} else {
			got = net.IP(c.Addr[:])
		}
		if got.Equal(want) {
			return true
		}
	}
	return false
}

// denyMatches mirrors the deny lookups of the BPF program: the exact deny map
// on the port, then the deny LPM trie on the port and on port 0.
func denyMatches(plan ebpfAllowPlan, ip string, port uint16) bool {
	addr := net.ParseIP(ip)
	for _, k := range plan.Deny {
		var got net.IP
		if k.Family == 2 {
			got = net.IP(k.Addr[:4])
		} else {
			got = net.IP(k.Addr[:])
		}
		if k.Dport == port && got.Equal(addr) {
			return true
		}
	}
	for _, c := range plan.DenyCIDRs {
		if c.Dport != port && c.Dport != 0 {
			continue
		}
		var n net.IPNet
		if c.Family == 2 {
			n = net.IPNet{IP: net.IP(c.Addr[:4]), Mask: net.CIDRMask(int(c.PrefixLen), 32)}
		} else {
			n = net.IPNet{IP: net.IP(c.Addr[:]), Mask: net.CIDRMask(int(c.PrefixLen), 128)}
		}
		if n.Contains(addr) {
			return true
		}
	}
	return false
}
