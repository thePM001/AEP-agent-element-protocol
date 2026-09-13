//go:build linux

package kernelinstall

import (
	"slices"
	"testing"

	"github.com/nla-aep/aep-caw-framework/internal/wrapenv"
	"github.com/nla-aep/aep-caw-framework/pkg/types"
)

// Issue #379: filtering applies to the inherited base BEFORE aep-caw markers and
// env_inject are added, so a denied var is dropped while markers and injected
// values survive.
func TestAssembleWrapperEnv_FiltersBaseKeepsMarkersAndInject(t *testing.T) {
	base := []string{"PATH=/bin", "SECRET_TOKEN=x"}
	wire := &types.EnvPolicyWire{Deny: []string{"SECRET_*"}}

	filtered, err := wrapenv.Filter(base, wire)
	if err != nil {
		t.Fatalf("Filter: %v", err)
	}
	env := assembleWrapperEnv(filtered, "", map[string]string{}, map[string]string{"INJECTED": "1"})

	for _, kv := range env {
		if kv == "SECRET_TOKEN=x" {
			t.Error("denied var must not survive filtering")
		}
	}
	if !slices.Contains(env, "INJECTED=1") {
		t.Error("env_inject value must survive (applied after filter)")
	}
	if !slices.Contains(env, "AEP_CAW_NOTIFY_SOCK_FD=3") {
		t.Error("aep-caw marker must survive (appended after filter)")
	}
	if !slices.Contains(env, "PATH=/bin") {
		t.Error("non-denied inherited var must survive")
	}
}

func TestAssembleWrapperEnv_NilWireDoesNotLeakInherited(t *testing.T) {
	base := []string{"PATH=/bin", "SECRET_TOKEN=x"}
	filtered, err := wrapenv.Filter(base, nil)
	if err == nil {
		t.Fatal("nil wire must Deny")
	}
	if len(filtered) != 0 {
		t.Fatalf("nil wire must return empty env; got %v", filtered)
	}
	env := assembleWrapperEnv(filtered, "", map[string]string{}, map[string]string{"INJECTED": "1"})
	for _, kv := range env {
		if kv == "SECRET_TOKEN=x" || kv == "PATH=/bin" {
			t.Errorf("inherited env leaked after nil-wire Deny: %v", env)
		}
	}
	if !slices.Contains(env, "INJECTED=1") {
		t.Error("env_inject value must still apply after empty filter")
	}
	if !slices.Contains(env, "AEP_CAW_NOTIFY_SOCK_FD=3") {
		t.Error("aep-caw marker must still apply after empty filter")
	}
}
