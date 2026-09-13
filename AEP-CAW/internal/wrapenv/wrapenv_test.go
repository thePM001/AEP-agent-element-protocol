package wrapenv

import (
	"errors"
	"slices"
	"testing"

	"github.com/nla-aep/aep-caw-framework/internal/policy"
	"github.com/nla-aep/aep-caw-framework/pkg/types"
)

func has(env []string, kv string) bool { return slices.Contains(env, kv) }

func TestFilter_NilWireDeniesEmptyEnv(t *testing.T) {
	base := []string{"PATH=/bin", "FOO=bar", "SECRET_TOKEN=x"}
	got, err := Filter(base, nil)
	if err == nil {
		t.Fatal("nil wire must Deny")
	}
	if !errors.Is(err, ErrNilWire) {
		t.Errorf("err = %v, want ErrNilWire", err)
	}
	if len(got) != 0 {
		t.Errorf("nil wire must return empty env, never inherited base; got %v", got)
	}
	for _, kv := range base {
		if has(got, kv) {
			t.Errorf("inherited %q leaked on nil wire", kv)
		}
	}
}

func TestFilter_BuildEnvErrorDeniesEmptyEnv(t *testing.T) {
	base := []string{"PATH=/bin", "SECRET_TOKEN=x"}
	orig := buildEnv
	t.Cleanup(func() { buildEnv = orig })
	buildEnv = func(pol policy.ResolvedEnvPolicy, baseEnv []string, addKeys map[string]string) ([]string, error) {
		return []string{"LEAK=1", "PATH=/bin"}, errors.New("forced BuildEnv error")
	}
	got, err := Filter(base, &types.EnvPolicyWire{Deny: []string{"SECRET_*"}})
	if err == nil {
		t.Fatal("BuildEnv error must Deny")
	}
	if len(got) != 0 {
		t.Errorf("BuildEnv error must return empty env, never unfiltered base; got %v", got)
	}
	if has(got, "LEAK=1") || has(got, "PATH=/bin") || has(got, "SECRET_TOKEN=x") {
		t.Errorf("inherited or leaked env on BuildEnv error: %v", got)
	}
}

func TestFilter_DenyStripsMatchKeepsRest(t *testing.T) {
	base := []string{"PATH=/bin", "SECRET_TOKEN=x", "HOME=/h"}
	got, err := Filter(base, &types.EnvPolicyWire{Deny: []string{"SECRET_*"}})
	if err != nil {
		t.Fatalf("Filter: %v", err)
	}
	if has(got, "SECRET_TOKEN=x") {
		t.Error("denied var must be stripped")
	}
	if !has(got, "PATH=/bin") || !has(got, "HOME=/h") {
		t.Error("non-denied vars must be kept")
	}
}

func TestFilter_DefaultSecretDenyWhenNoAllow(t *testing.T) {
	base := []string{"PATH=/bin", "AWS_SECRET_ACCESS_KEY=zzz"}
	got, err := Filter(base, &types.EnvPolicyWire{}) // empty policy, no allow
	if err != nil {
		t.Fatalf("Filter: %v", err)
	}
	if has(got, "AWS_SECRET_ACCESS_KEY=zzz") {
		t.Error("default-secret-deny var must be stripped when no allow patterns")
	}
	if !has(got, "PATH=/bin") {
		t.Error("ordinary var must be kept")
	}
}

func TestFilter_AllowIsAllowlist(t *testing.T) {
	base := []string{"PATH=/bin", "HOME=/h", "OTHER=1"}
	got, err := Filter(base, &types.EnvPolicyWire{Allow: []string{"PATH", "HOME"}})
	if err != nil {
		t.Fatalf("Filter: %v", err)
	}
	if has(got, "OTHER=1") {
		t.Error("non-allowed var must be dropped under allowlist")
	}
	if !has(got, "PATH=/bin") || !has(got, "HOME=/h") {
		t.Error("allowed vars must be kept")
	}
}

// max_bytes/max_keys are intentionally NOT carried on the wrap path (#379):
// BuildEnv errors on overflow, which under fail-closed Denies wrap. EnvPolicyWire
// therefore has no such fields; a large env is filtered by allow/deny only.
func TestFilter_NoMaxEnforcementLargeEnvNotRejected(t *testing.T) {
	base := []string{"A=1", "B=2", "C=3", "D=4", "SECRET_TOKEN=x"}
	got, err := Filter(base, &types.EnvPolicyWire{Deny: []string{"SECRET_*"}})
	if err != nil {
		t.Fatalf("Filter: %v", err)
	}
	if has(got, "SECRET_TOKEN=x") {
		t.Error("denied var must be stripped")
	}
	if len(got) != 4 {
		t.Errorf("large env must pass through (minus denied), not be rejected; got %d entries: %v", len(got), got)
	}
}
