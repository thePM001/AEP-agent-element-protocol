package policy

import (
	"testing"

	"github.com/nla-aep/aep-caw-framework/pkg/types"
)

func TestCheckExecveMostSpecificAllowBeatsCatchAllDeny(t *testing.T) {
	p := &Policy{
		Version: 1,
		Name:    "spec-exec",
		CommandRules: []CommandRule{
			{Name: "deny-all", Commands: []string{"*"}, Decision: "deny", Context: DefaultContext()},
			{Name: "allow-git", Commands: []string{"git"}, Decision: "allow", Context: DefaultContext()},
		},
	}
	e, err := NewEngine(p, true, true)
	if err != nil {
		t.Fatal(err)
	}
	dec := e.CheckExecve("/usr/bin/git", []string{"git", "status"}, 0)
	if dec.EffectiveDecision != types.DecisionAllow {
		t.Fatalf("git should allow via most-specific, got %s rule=%s", dec.EffectiveDecision, dec.Rule)
	}
	if dec.Rule != "allow-git" {
		t.Fatalf("rule=%s want allow-git", dec.Rule)
	}
	dec = e.CheckExecve("/usr/bin/wget", []string{"wget"}, 0)
	if dec.EffectiveDecision != types.DecisionDeny {
		t.Fatalf("wget should deny, got %s", dec.EffectiveDecision)
	}
}

func TestCheckNetworkMostSpecificDomainBeatsPortApprove(t *testing.T) {
	p := &Policy{
		Version: 1,
		Name:    "spec-net",
		NetworkRules: []NetworkRule{
			{Name: "allow-github", Domains: []string{"github.com"}, Ports: []int{443}, Decision: "allow"},
			{Name: "approve-https", Ports: []int{443}, Decision: "approve"},
			{Name: "deny-all", Domains: []string{"*"}, Decision: "deny"},
		},
	}
	e, err := NewEngine(p, true, true)
	if err != nil {
		t.Fatal(err)
	}
	dec := e.CheckNetwork("github.com", 443)
	if dec.PolicyDecision != types.DecisionAllow || dec.Rule != "allow-github" {
		t.Fatalf("github allow got %s rule=%s", dec.PolicyDecision, dec.Rule)
	}
	dec = e.CheckNetwork("random.com", 443)
	if dec.PolicyDecision != types.DecisionApprove || dec.Rule != "approve-https" {
		t.Fatalf("random https approve got %s rule=%s", dec.PolicyDecision, dec.Rule)
	}
	dec = e.CheckNetwork("random.com", 80)
	if dec.PolicyDecision != types.DecisionDeny {
		t.Fatalf("random http deny got %s rule=%s", dec.PolicyDecision, dec.Rule)
	}
}

func TestCheckUnixSocketMostSpecificExactBeatsCatchAllDeny(t *testing.T) {
	p := &Policy{
		Version: 1,
		Name:    "spec-unix",
		UnixRules: []UnixSocketRule{
			{Name: "deny-run", Paths: []string{"/var/run/**"}, Operations: []string{"connect"}, Decision: "deny"},
			{Name: "allow-docker", Paths: []string{"/var/run/docker.sock"}, Operations: []string{"connect"}, Decision: "allow"},
		},
	}
	e, err := NewEngine(p, true, true)
	if err != nil {
		t.Fatal(err)
	}
	dec := e.CheckUnixSocket("/var/run/docker.sock", "connect")
	if dec.EffectiveDecision != types.DecisionAllow || dec.Rule != "allow-docker" {
		t.Fatalf("docker.sock allow got %s rule=%s", dec.EffectiveDecision, dec.Rule)
	}
	dec = e.CheckUnixSocket("/var/run/dbus/system_bus_socket", "connect")
	if dec.EffectiveDecision != types.DecisionDeny || dec.Rule != "deny-run" {
		t.Fatalf("dbus deny got %s rule=%s", dec.EffectiveDecision, dec.Rule)
	}
	dec = e.CheckUnixSocket("/tmp/other.sock", "connect")
	if dec.EffectiveDecision != types.DecisionDeny || dec.Rule != "default-deny-unix" {
		t.Fatalf("unmatched deny got %s rule=%s", dec.EffectiveDecision, dec.Rule)
	}
}

func TestCheckRegistryMostSpecificExactBeatsGlob(t *testing.T) {
	p := &Policy{
		Version: 1,
		Name:    "spec-reg",
		RegistryRules: []RegistryRule{
			{Name: "deny-software", Paths: []string{`HKLM\SOFTWARE\**`}, Operations: []string{"set"}, Decision: "deny"},
			{Name: "allow-myapp", Paths: []string{`HKLM\SOFTWARE\MyApp\Config`}, Operations: []string{"set"}, Decision: "allow"},
		},
	}
	e, err := NewEngine(p, true, true)
	if err != nil {
		t.Fatal(err)
	}
	dec := e.CheckRegistry(`HKLM\SOFTWARE\MyApp\Config`, "set")
	if dec.EffectiveDecision != types.DecisionAllow || dec.Rule != "allow-myapp" {
		t.Fatalf("myapp allow got %s rule=%s", dec.EffectiveDecision, dec.Rule)
	}
	dec = e.CheckRegistry(`HKLM\SOFTWARE\Other\X`, "set")
	if dec.EffectiveDecision != types.DecisionDeny {
		t.Fatalf("other deny got %s rule=%s", dec.EffectiveDecision, dec.Rule)
	}
}

func TestCheckHTTPServiceMostSpecificBeatsCatchAll(t *testing.T) {
	e := newTestEngineForHTTP(t, []HTTPService{{
		Name: "svc", Upstream: "https://example.com", Default: "deny",
		Rules: []HTTPServiceRule{
			{Name: "deny-all", Methods: []string{"GET"}, Paths: []string{"/**"}, Decision: "deny"},
			{Name: "allow-health", Methods: []string{"GET"}, Paths: []string{"/health"}, Decision: "allow"},
		},
	}})
	dec := e.CheckHTTPService("svc", "GET", "/health")
	if dec.EffectiveDecision != types.DecisionAllow || dec.Rule != "allow-health" {
		t.Fatalf("health allow got %s rule=%s", dec.EffectiveDecision, dec.Rule)
	}
	dec = e.CheckHTTPService("svc", "GET", "/other")
	if dec.EffectiveDecision != types.DecisionDeny {
		t.Fatalf("other deny got %s rule=%s", dec.EffectiveDecision, dec.Rule)
	}
}

func TestEvaluateConnectRedirectMostSpecificBeatsWildcardListedFirst(t *testing.T) {
	p := &Policy{
		Version: 1,
		Name:    "spec-conn",
		ConnectRedirectRules: []ConnectRedirectRule{
			{Name: "wildcard", Match: ".*:443", RedirectTo: "general-proxy:443"},
			{Name: "specific", Match: `api\.example\.com:443`, RedirectTo: "specific-proxy:443"},
		},
	}
	engine, err := NewEngine(p, true, true)
	if err != nil {
		t.Fatal(err)
	}
	result := engine.EvaluateConnectRedirect("api.example.com:443")
	if result.Rule != "specific" {
		t.Fatalf("specific rule want specific got %q", result.Rule)
	}
}
