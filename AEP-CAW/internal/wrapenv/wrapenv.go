// Package wrapenv applies env_policy filtering to the inherited environment on
// the client-spawned wrap path (shell adapter / kernel-install / aep-caw wrap),
// the counterpart to server-side buildPolicyEnv. Issue #379. AEP28-ENV-026.
package wrapenv

import (
	"errors"
	"fmt"
	"log/slog"

	"github.com/nla-aep/aep-caw-framework/internal/policy"
	"github.com/nla-aep/aep-caw-framework/pkg/types"
)

// ErrNilWire is returned when Filter is called with a nil env policy wire.
// Callers must Deny wrap. The returned env is empty, never the inherited base.
var ErrNilWire = errors.New("wrapenv: nil env policy wire")

// buildEnv is policy.BuildEnv. Tests replace it to lock the error path.
var buildEnv = policy.BuildEnv

// Filter applies the wrapped command's env policy subtractively over the
// inherited base environment.
//
// Fail-closed (AEP28-ENV-026):
//   - A nil wire returns an empty env and ErrNilWire. Never the inherited base.
//   - A BuildEnv error returns an empty env and that error. Never the unfiltered base.
//
// Callers must Deny wrap on error. Empty env is a second lock if a caller
// ignores the error.
func Filter(base []string, wire *types.EnvPolicyWire) ([]string, error) {
	if wire == nil {
		slog.Error("wrap env policy missing; denying inherited env")
		return []string{}, ErrNilWire
	}
	pol := policy.ResolvedEnvPolicy{
		Allow: wire.Allow,
		Deny:  wire.Deny,
	}
	out, err := buildEnv(pol, base, nil)
	if err != nil {
		slog.Error("wrap env policy filter failed; denying inherited env", "error", err)
		return []string{}, fmt.Errorf("wrapenv: BuildEnv: %w", err)
	}
	return out, nil
}
