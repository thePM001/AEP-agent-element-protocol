package api

import (
	"testing"

	"github.com/nla-aep/aep-caw-framework/internal/config"
	"github.com/nla-aep/aep-caw-framework/internal/policy"
	"github.com/nla-aep/aep-caw-framework/pkg/types"
)

func newWrapEnvTestApp(t *testing.T, enabled bool, p *policy.Policy) *App {
	t.Helper()
	eng, err := policy.NewEngine(p, false, true)
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	cfg := &config.Config{}
	cfg.Sandbox.WrapEnvPolicy.Enabled = enabled
	return &App{cfg: cfg, policy: eng}
}

func TestWrapEnvPolicyWire_EmptyWhenDisabled(t *testing.T) {
	p := &policy.Policy{
		EnvPolicy:    policy.EnvPolicy{Deny: []string{"FOO"}},
		CommandRules: []policy.CommandRule{{Name: "allow-sh", Commands: []string{"sh"}, Decision: "allow"}},
	}
	a := newWrapEnvTestApp(t, false, p)
	w := a.wrapEnvPolicyWire(nil, types.WrapInitRequest{AgentCommand: "/bin/sh", AgentArgs: []string{"-c", "echo hi"}})
	if w == nil {
		t.Fatal("flag off must yield empty non-nil wire so Filter does not Deny wrap")
	}
	if len(w.Allow) != 0 || len(w.Deny) != 0 {
		t.Errorf("flag off must yield empty wire; got %+v", w)
	}
}

func TestWrapEnvPolicyWire_PopulatedWhenEnabled(t *testing.T) {
	p := &policy.Policy{
		EnvPolicy:    policy.EnvPolicy{Deny: []string{"FOO"}},
		CommandRules: []policy.CommandRule{{Name: "allow-sh", Commands: []string{"sh"}, Decision: "allow"}},
	}
	a := newWrapEnvTestApp(t, true, p)
	w := a.wrapEnvPolicyWire(nil, types.WrapInitRequest{AgentCommand: "/bin/sh", AgentArgs: []string{"-c", "echo hi"}})
	if w == nil {
		t.Fatal("flag on must yield a non-nil wire")
	}
	found := false
	for _, d := range w.Deny {
		if d == "FOO" {
			found = true
		}
	}
	if !found {
		t.Errorf("wire.Deny should contain FOO from the resolved policy; got %v", w.Deny)
	}
}

// Fail-closed: flag on but no policy engine available => nil wire so the
// client Denies wrap. AEP28-ENV-026.
func TestWrapEnvPolicyWire_NilWhenNoEngine(t *testing.T) {
	cfg := &config.Config{}
	cfg.Sandbox.WrapEnvPolicy.Enabled = true
	a := &App{cfg: cfg, policy: nil} // policyEngineFor(nil) -> a.Policy() -> nil
	if w := a.wrapEnvPolicyWire(nil, types.WrapInitRequest{AgentCommand: "/bin/sh", AgentArgs: []string{"-c", "echo hi"}}); w != nil {
		t.Errorf("flag on but nil engine must yield nil wire (client Deny); got %+v", w)
	}
}
